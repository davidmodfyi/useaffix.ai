#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Claude Code Multi-Agent Pipeline Orchestrator
# ============================================================================
# Chains Claude Code instances sequentially, each with a fresh context window.
# Each phase reads from TASKS.md and communicates through the codebase + state files.
# ============================================================================

# --- Configuration -----------------------------------------------------------
MODEL="${CLAUDE_MODEL:-opus}"              # Model to use (opus, sonnet)
TASKS_FILE="TASKS.md"                      # Task definitions
STATE_DIR=".agent-state"                   # Shared state directory
SESSIONS_DIR="$STATE_DIR/sessions"         # Session IDs for resuming
LOG_FILE="$STATE_DIR/pipeline.log"         # Pipeline log
TEST_RESULTS="$STATE_DIR/test-results.json"
PHASE_HISTORY="$STATE_DIR/phase-history.json"
CURRENT_PHASE_FILE="$STATE_DIR/current-phase.txt"
MAX_RETRIES=2                              # Retries per phase on test failure
WAIT_FOR_TESTS=true                        # Wait for test-watcher between phases
TEST_TIMEOUT=300                           # Seconds to wait for tests
PERMISSION_MODE="acceptEdits"              # acceptEdits or acceptAll

# --- Parse Arguments ---------------------------------------------------------
START_PHASE=1
END_PHASE=""
SKIP_TESTS=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --start-phase) START_PHASE="$2"; shift 2 ;;
        --end-phase) END_PHASE="$2"; shift 2 ;;
        --skip-tests) SKIP_TESTS=true; WAIT_FOR_TESTS=false; shift ;;
        --model) MODEL="$2"; shift 2 ;;
        --accept-all) PERMISSION_MODE="bypassPermissions"; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# --- Setup -------------------------------------------------------------------
mkdir -p "$STATE_DIR" "$SESSIONS_DIR"
[[ -f "$PHASE_HISTORY" ]] || echo '[]' > "$PHASE_HISTORY"

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$msg" | tee -a "$LOG_FILE"
}

log "=========================================="
log "Pipeline starting (model=$MODEL, start_phase=$START_PHASE)"
log "=========================================="

# --- Parse TASKS.md ----------------------------------------------------------
# Format: phases separated by "## Phase N:" headers
# Everything between headers becomes the phase prompt

parse_phases() {
    local file="$1"
    local phase_num=0
    local current_content=""
    local phase_count=0

    while IFS= read -r line; do
        if [[ "$line" =~ ^##[[:space:]]+Phase[[:space:]]+([0-9]+) ]]; then
            if [[ $phase_num -gt 0 && -n "$current_content" ]]; then
                # Save previous phase
                echo "$current_content" > "$STATE_DIR/phase-${phase_num}-prompt.txt"
                phase_count=$phase_num
            fi
            phase_num="${BASH_REMATCH[1]}"
            current_content="$line"$'\n'
        elif [[ $phase_num -gt 0 ]]; then
            current_content+="$line"$'\n'
        fi
    done < "$file"

    # Save last phase
    if [[ $phase_num -gt 0 && -n "$current_content" ]]; then
        echo "$current_content" > "$STATE_DIR/phase-${phase_num}-prompt.txt"
        phase_count=$phase_num
    fi

    echo "$phase_count"
}

TOTAL_PHASES=$(parse_phases "$TASKS_FILE")
[[ -z "$END_PHASE" ]] && END_PHASE="$TOTAL_PHASES"
log "Parsed $TOTAL_PHASES phases from $TASKS_FILE"
log "Running phases $START_PHASE through $END_PHASE"

if [[ $TOTAL_PHASES -eq 0 ]]; then
    log "ERROR: No phases found in $TASKS_FILE. See TASKS.md for format."
    exit 1
fi

# --- Helper: Build the full prompt for a phase -------------------------------
build_prompt() {
    local phase_num=$1
    local phase_prompt
    phase_prompt=$(cat "$STATE_DIR/phase-${phase_num}-prompt.txt")

    local prompt="You are working on Phase $phase_num of $TOTAL_PHASES in an automated pipeline.

## Your Task for This Phase
$phase_prompt

## Important Context
- You are one instance in a chain. Previous phases may have already done work.
- Check .agent-state/phase-history.json for what was accomplished in prior phases.
- Check git log for recent [phase-N] commits to understand what changed.
- After completing your work, make sure all changes are saved to files."

    # Add test results from previous phase if they exist
    if [[ -f "$TEST_RESULTS" ]]; then
        local test_content
        test_content=$(cat "$TEST_RESULTS")
        prompt+="

## Test Results from Previous Phase
The test agent reported the following after the last phase:
\`\`\`json
$test_content
\`\`\`
If there are failures, prioritize fixing them before starting your new work."
    fi

    # Add retry context if this is a retry
    if [[ -f "$STATE_DIR/retry-context-${phase_num}.txt" ]]; then
        local retry_ctx
        retry_ctx=$(cat "$STATE_DIR/retry-context-${phase_num}.txt")
        prompt+="

## RETRY — Previous Attempt Failed
Your previous attempt at this phase resulted in test failures:
$retry_ctx
Please fix these issues."
    fi

    echo "$prompt"
}

# --- Helper: Wait for test results -------------------------------------------
wait_for_test_results() {
    local phase_num=$1

    if [[ "$WAIT_FOR_TESTS" == "false" ]]; then
        log "  Skipping test wait (--skip-tests)"
        return 0
    fi

    log "  Waiting for test-watcher to report results..."

    # Signal that we're ready for testing
    echo "$phase_num" > "$STATE_DIR/ready-for-test.txt"

    local elapsed=0
    local old_hash=""
    [[ -f "$TEST_RESULTS" ]] && old_hash=$(md5sum "$TEST_RESULTS" 2>/dev/null | cut -d' ' -f1)

    while [[ $elapsed -lt $TEST_TIMEOUT ]]; do
        if [[ -f "$TEST_RESULTS" ]]; then
            local new_hash
            new_hash=$(md5sum "$TEST_RESULTS" 2>/dev/null | cut -d' ' -f1)
            if [[ "$new_hash" != "$old_hash" ]]; then
                # New test results
                local pass
                pass=$(python3 -c "import json; d=json.load(open('$TEST_RESULTS')); print(d.get('passed', False))" 2>/dev/null || echo "false")
                if [[ "$pass" == "True" ]]; then
                    log "  ✅ Tests PASSED"
                    return 0
                else
                    log "  ❌ Tests FAILED"
                    return 1
                fi
            fi
        fi
        sleep 10
        elapsed=$((elapsed + 10))
    done

    log "  ⏱️  Test timeout after ${TEST_TIMEOUT}s — proceeding anyway"
    return 0
}

# --- Helper: Commit changes after a phase ------------------------------------
commit_phase() {
    local phase_num=$1

    # Stage all changes, but handle errors (e.g. nested .git repos)
    local add_output
    if ! add_output=$(git add -A 2>&1); then
        log "  ⚠️  git add -A had errors:"
        log "  $add_output"
        # Try adding files individually, skipping problematic ones
        log "  Falling back to adding tracked + new files individually..."
        git add -u 2>/dev/null || true
        git ls-files --others --exclude-standard | while read -r f; do
            git add "$f" 2>/dev/null || log "  Skipped: $f"
        done
    fi

    # Check if there are changes to commit
    if git diff --cached --quiet 2>/dev/null; then
        log "  No changes to commit for phase $phase_num"
        return
    fi

    if git commit -m "[phase-${phase_num}] Automated pipeline - phase ${phase_num} of ${TOTAL_PHASES}" \
        --no-verify 2>&1; then
        log "  ✅ Committed changes for phase $phase_num"
    else
        log "  ❌ git commit failed for phase $phase_num"
        return
    fi

    # Push to remote
    if git push 2>&1; then
        log "  ✅ Pushed to remote"
    else
        log "  ⚠️  git push failed (will retry at end of pipeline)"
    fi
}

# --- Helper: Record phase result ---------------------------------------------
record_phase() {
    local phase_num=$1
    local status=$2
    local session_id=$3

    python3 -c "
import json, datetime
history = json.load(open('$PHASE_HISTORY'))
history.append({
    'phase': $phase_num,
    'status': '$status',
    'session_id': '$session_id',
    'timestamp': datetime.datetime.now().isoformat(),
    'model': '$MODEL'
})
json.dump(history, open('$PHASE_HISTORY', 'w'), indent=2)
" 2>/dev/null || log "  Warning: Could not update phase history"
}

# --- Main Pipeline Loop ------------------------------------------------------
for phase_num in $(seq "$START_PHASE" "$END_PHASE"); do
    log ""
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log "Phase $phase_num of $TOTAL_PHASES"
    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    echo "$phase_num" > "$CURRENT_PHASE_FILE"

    retries=0
    phase_passed=false

    while [[ $retries -le $MAX_RETRIES && "$phase_passed" == "false" ]]; do
        if [[ $retries -gt 0 ]]; then
            log "  Retry $retries/$MAX_RETRIES for phase $phase_num"
        fi

        # Build the prompt
        prompt=$(build_prompt "$phase_num")

        # Run Claude Code in headless mode
        log "  Launching claude -p (model=$MODEL, permission=$PERMISSION_MODE)..."

        local_output="$STATE_DIR/phase-${phase_num}-output.json"

        set +e
        claude -p "$prompt" \
            --model "$MODEL" \
            --output-format json \
            --permission-mode "$PERMISSION_MODE" \
            --verbose \
            > "$local_output" 2>> "$LOG_FILE"
        exit_code=$?
        set -e

        if [[ $exit_code -ne 0 ]]; then
            log "  ⚠️  Claude exited with code $exit_code"
        fi

        # Extract session ID for potential resuming
        session_id="none"
        if [[ -f "$local_output" ]]; then
            session_id=$(python3 -c "import json; print(json.load(open('$local_output')).get('session_id', 'none'))" 2>/dev/null || echo "none")
            echo "{\"session_id\": \"$session_id\", \"phase\": $phase_num}" > "$SESSIONS_DIR/phase-${phase_num}.json"
            log "  Session ID: $session_id"
        fi

        # Commit whatever was produced
        commit_phase "$phase_num"

        # Wait for tests
        if wait_for_test_results "$phase_num"; then
            phase_passed=true
            record_phase "$phase_num" "passed" "$session_id"
        else
            retries=$((retries + 1))
            if [[ $retries -le $MAX_RETRIES ]]; then
                # Save test failure context for the retry
                [[ -f "$TEST_RESULTS" ]] && cp "$TEST_RESULTS" "$STATE_DIR/retry-context-${phase_num}.txt"
                log "  Will retry phase $phase_num with test failure context"
            else
                log "  ❌ Phase $phase_num failed after $MAX_RETRIES retries"
                record_phase "$phase_num" "failed" "$session_id"

                # Ask whether to continue or abort
                if [[ -t 0 ]]; then
                    read -rp "Continue to next phase anyway? (y/n): " answer
                    [[ "$answer" != "y" ]] && exit 1
                else
                    log "  Non-interactive mode — continuing to next phase"
                fi
                phase_passed=true  # Move on
            fi
        fi
    done
done

# --- Done --------------------------------------------------------------------
log ""
log "=========================================="
log "Pipeline complete! Phases $START_PHASE through $END_PHASE executed."
log "=========================================="
log ""
log "Review the work:"
log "  git log --oneline  (see all phase commits)"
log "  cat $PHASE_HISTORY  (see phase results)"
log "  cat $LOG_FILE  (full pipeline log)"