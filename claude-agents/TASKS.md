# Pipeline Tasks
<!-- 
  Define your project work as sequential phases.
  Each phase gets its own fresh Claude Code instance with a clean context window.
  
  GUIDELINES:
  - Each phase should take 15-45 minutes of Claude Code work
  - Each phase should touch roughly 5-15 files max  
  - Be specific about what to build, not vague about goals
  - Include acceptance criteria so the test agent can validate
  - Later phases can reference earlier phases' work
  
  The orchestrator parses "## Phase N:" headers to split work.
  Everything between headers becomes that phase's prompt.
-->

## Phase 1: Project scaffolding and core data models

Set up the foundational project structure:
- Initialize the project with [your framework/language]
- Create the core data models/types for: [list your entities]
- Set up the database schema/migrations
- Add a basic test harness with at least one passing test
- Create a CLAUDE.md with project conventions

Acceptance criteria:
- Project builds without errors
- At least 1 test passes
- All data models have proper TypeScript types / Python type hints / etc.

## Phase 2: Core business logic and API layer

Build the main business logic on top of Phase 1's data models:
- Implement [describe core feature 1]
- Implement [describe core feature 2]  
- Create API routes/endpoints for: [list endpoints]
- Add input validation and error handling
- Write unit tests for all business logic functions

Acceptance criteria:
- All new functions have corresponding tests
- API endpoints return proper status codes
- Error cases are handled gracefully

## Phase 3: Integration layer and external services

Wire up external integrations:
- Connect to [database/API/service]
- Implement authentication/authorization
- Add retry logic and error handling for external calls
- Write integration tests with mocks/stubs

Acceptance criteria:
- Integration tests pass with mocked services
- Auth flow works end-to-end
- Failed external calls are handled with proper retries

## Phase 4: Frontend / UI layer

Build the user-facing interface:
- Create [list main pages/views/components]
- Wire up to the API layer from Phase 2
- Add loading states, error states, and empty states
- Implement responsive design
- Add basic E2E tests

Acceptance criteria:
- All pages render without errors
- Forms submit and display responses correctly
- Mobile viewport works

## Phase 5: Polish, edge cases, and documentation

Final pass:
- Fix any failing tests from previous phases
- Add error boundaries and fallback UI
- Write API documentation
- Add README with setup instructions
- Review and fix any TODO comments left by previous phases
- Run linter and fix all warnings

Acceptance criteria:
- Zero test failures
- Zero linter warnings
- README has clear setup instructions
- No TODO comments remain
