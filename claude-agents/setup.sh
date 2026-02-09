#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Quick Setup — Drop this pipeline into your existing project
# ============================================================================
# Usage: ./setup.sh /path/to/your/project
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${1:-.}"

if [[ ! -d "$TARGET_DIR" ]]; then
    echo "❌ Directory not found: $TARGET_DIR"
    exit 1
fi

TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

echo "📦 Setting up Claude Code pipeline in: $TARGET_DIR"
echo ""

# Copy pipeline files
cp "$SCRIPT_DIR/orchestrator.sh" "$TARGET_DIR/"
cp "$SCRIPT_DIR/test-watcher.sh" "$TARGET_DIR/"
cp "$SCRIPT_DIR/TASKS.md" "$TARGET_DIR/"

chmod +x "$TARGET_DIR/orchestrator.sh" "$TARGET_DIR/test-watcher.sh"

# Copy subagent definitions
mkdir -p "$TARGET_DIR/.claude/agents"
cp "$SCRIPT_DIR/.claude/agents/"*.md "$TARGET_DIR/.claude/agents/"

# Create .agent-state directory
mkdir -p "$TARGET_DIR/.agent-state"

# Add .agent-state to .gitignore if not already there
if [[ -f "$TARGET_DIR/.gitignore" ]]; then
    if ! grep -q ".agent-state" "$TARGET_DIR/.gitignore"; then
        echo "" >> "$TARGET_DIR/.gitignore"
        echo "# Claude agent pipeline state" >> "$TARGET_DIR/.gitignore"
        echo ".agent-state/" >> "$TARGET_DIR/.gitignore"
    fi
else
    cat > "$TARGET_DIR/.gitignore" << 'EOF'
# Claude agent pipeline state
.agent-state/
EOF
fi

# Append pipeline context to CLAUDE.md if it exists
if [[ -f "$TARGET_DIR/CLAUDE.md" ]]; then
    if ! grep -q "Agent Pipeline" "$TARGET_DIR/CLAUDE.md"; then
        cat >> "$TARGET_DIR/CLAUDE.md" << 'EOF'

## Agent Pipeline Context
- This project uses an automated multi-agent pipeline
- Check `.agent-state/phase-history.json` for completed phases
- Check `.agent-state/test-results.json` for latest test status
- Commits from the pipeline use `[phase-N]` prefix format
- If you see TODOs from previous phases, address them
EOF
    fi
fi

echo "✅ Pipeline files installed:"
echo "   $TARGET_DIR/orchestrator.sh"
echo "   $TARGET_DIR/test-watcher.sh"
echo "   $TARGET_DIR/TASKS.md"
echo "   $TARGET_DIR/.claude/agents/test-runner.md"
echo "   $TARGET_DIR/.claude/agents/code-reviewer.md"
echo ""
echo "📝 Next steps:"
echo "   1. Edit $TARGET_DIR/TASKS.md with your project phases"
echo "   2. Set your test command: export TEST_CMD='npm test'  (or pytest, cargo test, etc.)"
echo "   3. Terminal 1: cd $TARGET_DIR && ./test-watcher.sh"
echo "   4. Terminal 2: cd $TARGET_DIR && ./orchestrator.sh"
echo ""
echo "   Or to run without the test watcher:"
echo "   cd $TARGET_DIR && ./orchestrator.sh --skip-tests"
