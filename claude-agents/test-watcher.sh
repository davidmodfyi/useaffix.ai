#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Claude Code Test Watcher Agent
# ============================================================================
# Runs in a separate git worktree, watches for phase commits,
# pulls changes, runs tests, and reports results.
#
# Optionally uses Claude Code to ANALYZE test failures and suggest fixes.
# ============================================================================

# --- Configuration -----------------------------------------------------------
STATE_DIR=".agent-state"
TEST_RESULTS="$STATE_DIR/test-results.json"
WORKTREE_DIR="../$(basename "$PWD")-test-worktree"
POLL_INTERVAL=30                           # Seconds between checks
ANALYZE_FAILURES=true                      # Use Claude to analyze failures
MODEL="sonnet"                             # Cheaper/faster model for test analysis

# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  CONFIGURE YOUR TEST COMMAND HERE                                       ║
# ╠══════════════════════════════════════════════════════════════════════════╣
# ║  This should be whatever command runs your test suite.                  ║
# ║  It must exit 0 on success and non-zero on failure.                    ║
# ╚══════════════════════════════════════════════════════════════════════════╝
TEST_COMMAND="${TEST_CMD:-npm test}"
# Other examples:
# TEST_COMMAND="pytest -x --tb=short"
# TEST_COMMAND="cargo test"
# TEST_COMMAND="go test ./..."
# TEST_COMMAND="mix test"
# TEST_COMMAND="dotnet test"

# --- Parse Arguments ---------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case $1 in
        --test-cmd) TEST_COMMAND="$2"; shift 2 ;;
        --no-analyze) ANALYZE_FAILURES=false; shift ;;
        --poll-interval) POLL_INTERVAL="$2"; shift 2 ;;
        --model) MODEL="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# --- Setup Git Worktree ------------------------------------------------------
MAIN_DIR="$PWD"
MAIN_BRANCH=$(git branch --show-current 2>/dev/null || echo "main")

setup_worktree() {
    if [[ -d "$WORKTREE_DIR" ]]; then
        echo "🔄 Worktree already exists at $WORKTREE_DIR"
        return
    fi

    echo "📁 Creating git worktree for test agent..."
    git worktree add "$WORKTREE_DIR" "$MAIN_BRANCH" 2>/dev/null || {
        # If branch is already checked out, create a detached worktree
        git worktree add --detach "$WORKTREE_DIR" HEAD
    }
    echo "✅ Worktree created at $WORKTREE_DIR"
}

cleanup_worktree() {
    echo ""
    echo "🧹 Cleaning up worktree..."
    cd "$MAIN_DIR"
    git worktree remove "$WORKTREE_DIR" --force 2>/dev/null || true
    echo "Done."
    exit 0
}

trap cleanup_worktree EXIT INT TERM

setup_worktree

# --- Ensure state dir exists in main project ---------------------------------
mkdir -p "$MAIN_DIR/$STATE_DIR"

# --- Helper: Get latest phase commit -----------------------------------------
get_latest_phase_commit() {
    cd "$MAIN_DIR"
    git log -1 --format="%H" --grep="\[phase-" 2>/dev/null || echo ""
}

# --- Helper: Run tests -------------------------------------------------------
run_tests() {
    local phase_num=$1
    local commit_hash=$2

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🧪 Testing Phase $phase_num ($(date '+%H:%M:%S'))"
    echo "   Commit: ${commit_hash:0:8}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    cd "$WORKTREE_DIR"

    # Pull latest changes
    git fetch origin 2>/dev/null || true
    git checkout "$MAIN_BRANCH" 2>/dev/null || true
    git reset --hard "$commit_hash" 2>/dev/null || git pull origin "$MAIN_BRANCH" 2>/dev/null || true

    # Install dependencies if needed (detect by package manager)
    if [[ -f "package.json" ]] && [[ ! -d "node_modules" || "package.json" -nt "node_modules" ]]; then
        echo "📦 Installing dependencies..."
        npm install --silent 2>/dev/null || true
    elif [[ -f "requirements.txt" ]]; then
        pip install -r requirements.txt -q 2>/dev/null || true
    fi

    # Run the test command
    echo "🏃 Running: $TEST_COMMAND"
    local test_output
    local test_exit_code
    local start_time
    start_time=$(date +%s)

    set +e
    test_output=$(eval "$TEST_COMMAND" 2>&1)
    test_exit_code=$?
    set -e

    local end_time
    end_time=$(date +%s)
    local duration=$((end_time - start_time))

    # Build results JSON
    local passed="false"
    [[ $test_exit_code -eq 0 ]] && passed="true"

    # Truncate output if too long (keep last 3000 chars for relevance)
    local truncated_output="$test_output"
    if [[ ${#test_output} -gt 3000 ]]; then
        truncated_output="...(truncated)...
${test_output: -3000}"
    fi

    # Escape for JSON
    local json_output
    json_output=$(python3 -c "
import json, sys
output = sys.stdin.read()
print(json.dumps(output))
" <<< "$truncated_output")

    local result_json="{
  \"passed\": $passed,
  \"exit_code\": $test_exit_code,
  \"phase\": $phase_num,
  \"commit\": \"$commit_hash\",
  \"duration_seconds\": $duration,
  \"test_command\": \"$TEST_COMMAND\",
  \"timestamp\": \"$(date -Iseconds)\",
  \"output\": $json_output
}"

    # Write results to main project's state dir
    echo "$result_json" > "$MAIN_DIR/$TEST_RESULTS"

    if [[ "$passed" == "true" ]]; then
        echo "✅ Tests PASSED (${duration}s)"
    else
        echo "❌ Tests FAILED (exit code $test_exit_code, ${duration}s)"
        echo ""
        echo "--- Test Output (last 50 lines) ---"
        echo "$test_output" | tail -50
        echo "-----------------------------------"

        # Optionally analyze with Claude
        if [[ "$ANALYZE_FAILURES" == "true" ]]; then
            analyze_failure "$phase_num" "$test_output"
        fi
    fi

    cd "$MAIN_DIR"
}

# --- Helper: Use Claude to analyze test failures ----------------------------
analyze_failure() {
    local phase_num=$1
    local test_output=$2

    echo ""
    echo "🤖 Analyzing failure with Claude ($MODEL)..."

    local analysis_prompt="You are a test analysis agent. A test suite just failed after Phase $phase_num of an automated build pipeline.

Test command: $TEST_COMMAND
Test output (last 2000 chars):
${test_output: -2000}

Provide a brief, actionable analysis:
1. What specific tests failed and why
2. The most likely root cause
3. A concrete fix suggestion (file + change)

Be concise — this will be fed to the next builder agent."

    set +e
    local analysis
    analysis=$(claude -p "$analysis_prompt" \
        --model "$MODEL" \
        --allowedTools "Read,Grep" \
        --permission-mode "acceptEdits" \
        2>/dev/null)
    set -e

    if [[ -n "$analysis" ]]; then
        echo ""
        echo "📋 Analysis:"
        echo "$analysis" | head -30
        echo ""

        # Append analysis to test results
        python3 -c "
import json
results = json.load(open('$MAIN_DIR/$TEST_RESULTS'))
results['analysis'] = '''$analysis'''[:2000]
json.dump(results, open('$MAIN_DIR/$TEST_RESULTS', 'w'), indent=2)
" 2>/dev/null || true
    fi
}

# --- Main Watch Loop ---------------------------------------------------------
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║       Claude Code Test Watcher Agent         ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  Watching for [phase-N] commits...           ║"
echo "║  Test command: $TEST_COMMAND"
echo "║  Poll interval: ${POLL_INTERVAL}s            ║"
echo "║  Worktree: $WORKTREE_DIR                     ║"
echo "║  Press Ctrl+C to stop                        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

last_tested_commit=""

while true; do
    # Check for new phase commits
    latest_commit=$(get_latest_phase_commit)

    if [[ -n "$latest_commit" && "$latest_commit" != "$last_tested_commit" ]]; then
        # Extract phase number from commit message
        cd "$MAIN_DIR"
        commit_msg=$(git log -1 --format="%s" "$latest_commit" 2>/dev/null || echo "")
        phase_num=$(echo "$commit_msg" | grep -oP '\[phase-\K\d+' || echo "0")

        if [[ "$phase_num" != "0" ]]; then
            run_tests "$phase_num" "$latest_commit"
            last_tested_commit="$latest_commit"
        fi
    fi

    # Also check if orchestrator is signaling readiness
    if [[ -f "$MAIN_DIR/$STATE_DIR/ready-for-test.txt" ]]; then
        signal_phase=$(cat "$MAIN_DIR/$STATE_DIR/ready-for-test.txt")
        latest_commit=$(get_latest_phase_commit)
        if [[ -n "$latest_commit" && "$latest_commit" != "$last_tested_commit" ]]; then
            run_tests "$signal_phase" "$latest_commit"
            last_tested_commit="$latest_commit"
        fi
        rm -f "$MAIN_DIR/$STATE_DIR/ready-for-test.txt"
    fi

    sleep "$POLL_INTERVAL"
done
