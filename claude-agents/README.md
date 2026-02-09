# Claude Code Multi-Agent Pipeline

A lightweight orchestration system that chains Claude Code instances for long-running projects, with a dedicated test agent running in parallel.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    orchestrator.sh                        │
│                                                          │
│   Phase 1 ──► Phase 2 ──► Phase 3 ──► ... ──► Done     │
│   (claude -p)  (claude -p)  (claude -p)                  │
│       │            │            │                         │
│       ▼            ▼            ▼                         │
│   git commit   git commit   git commit                   │
│       │            │            │                         │
└───────┼────────────┼────────────┼────────────────────────┘
        │            │            │
        ▼            ▼            ▼
┌─────────────────────────────────────────────────────────┐
│                  test-watcher.sh                          │
│            (separate git worktree)                        │
│                                                          │
│   Detects commit ──► Pulls ──► Runs tests ──► Reports   │
│                                                          │
│   Writes results to .agent-state/test-results.json       │
│   Next builder phase reads these before starting         │
└─────────────────────────────────────────────────────────┘
```

**Why this works for 3+ hour projects:**
- Each `claude -p` call gets a **fresh context window** — no compaction
- Phases communicate through the **codebase + state files**, not context
- The test agent runs in a **separate git worktree** so it never conflicts with the builder
- Everything is automated — you kick it off and walk away

## Quick Start

### 1. Copy files into your project root

```bash
cp orchestrator.sh test-watcher.sh TASKS.md your-project/
cp -r .claude/ your-project/.claude/
chmod +x your-project/orchestrator.sh your-project/test-watcher.sh
```

### 2. Edit TASKS.md

Break your project into phases. Each phase should be a self-contained chunk of work that a fresh Claude Code instance can complete in one session (roughly 15-45 minutes of work). See `TASKS.md` for the format.

### 3. Configure your project's CLAUDE.md

Add this to your existing CLAUDE.md (or create one):

```markdown
## Agent Pipeline State
- Check `.agent-state/` for test results and phase history before starting work
- After completing work, commit with message format: `[phase-N] description`
- Keep changes focused on the current phase's objectives
```

### 4. Start the test watcher (Terminal 1)

```bash
cd your-project
./test-watcher.sh
```

### 5. Start the pipeline (Terminal 2)

```bash
cd your-project
./orchestrator.sh
```

That's it. Go get coffee. Check back periodically.

## How It Works

### The Orchestrator (`orchestrator.sh`)

1. Parses `TASKS.md` into discrete phases
2. For each phase:
   - Reads any test results from the previous phase
   - Builds a rich prompt with: phase instructions + project context + test feedback
   - Launches `claude -p` in headless mode with `--output-format json`
   - Captures the session ID (so you can `--resume` if needed)
   - Auto-commits changes with `[phase-N]` prefix
   - Waits for the test agent to finish testing
3. If tests fail, the next phase gets failure context automatically
4. Logs everything to `.agent-state/pipeline.log`

### The Test Watcher (`test-watcher.sh`)

1. Runs in a **git worktree** (isolated checkout, same repo)
2. Polls for new `[phase-N]` commits every 30 seconds
3. When it detects one:
   - Pulls the latest changes
   - Runs your test suite
   - Writes structured results to `.agent-state/test-results.json`
   - Signals the orchestrator to proceed

### Communication Protocol

The agents communicate through `.agent-state/`:
```
.agent-state/
├── pipeline.log          # Full orchestrator log
├── test-results.json     # Latest test run output
├── phase-history.json    # What each phase accomplished
├── current-phase.txt     # Which phase is running now
└── sessions/             # Claude session IDs for resuming
    ├── phase-1.json
    ├── phase-2.json
    └── ...
```

## Customization

### Adjusting Phase Duration

If a phase is too big for one context window, split it in TASKS.md. A good rule of thumb: each phase should involve editing 5-15 files max.

### Resuming After Failure

If the orchestrator crashes or you need to restart:
```bash
# Resume from phase 3
./orchestrator.sh --start-phase 3
```

### Running Without the Test Agent

```bash
./orchestrator.sh --skip-tests
```

### Using Specific Models

Edit the `MODEL` variable in `orchestrator.sh`:
```bash
MODEL="opus"    # or "sonnet" for faster/cheaper phases
```

## Subagents (Bonus)

The `.claude/agents/` directory includes two pre-built subagents that Claude Code can invoke _within_ any phase:

- **test-runner**: Specialized agent for running and analyzing test results
- **code-reviewer**: Reviews changes before committing

These are optional and work independently of the pipeline.

## Requirements

- Claude Code CLI installed and authenticated
- Claude Max plan (recommended for sustained usage)
- Git repository initialized
- A test command that exits 0/1 (configure in `test-watcher.sh`)
