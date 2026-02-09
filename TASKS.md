# Pipeline Tasks — Affix BI Platform Build-Out

## Phase 1: Codebase Review, CLAUDE.md, and Data Models

You are building Affix, an AI-powered BI platform. The app currently supports: user auth, single CSV/Excel upload per tenant into DuckDB, a natural language query interface that calls the Anthropic API (claude-sonnet-4-20250514) to generate DuckDB SQL, executes it, and displays results with ECharts visualizations in a dark luxury theme.

This phase focuses ONLY on understanding the codebase and creating the data model foundation. Do NOT build API endpoints or modify the upload flow — that's the next phase.

### 1A. Review and document the existing codebase

- Read every file in the project. Understand the current architecture: routes, models, database setup, frontend structure, the query/chart pipeline.
- Create or update `CLAUDE.md` at the project root with:
  - Project overview ("Affix: AI-powered BI platform, dark luxury theme, DuckDB per-tenant")
  - Tech stack (list every framework, library, database, API used)
  - File/directory structure map
  - Naming conventions (routes, models, components, CSS classes)
  - The ECharts theme name and where it's registered
  - The Anthropic API integration pattern (which model, how context is gathered, how SQL is parsed)
  - How tenant isolation works
  - How to run the app locally
  - Testing commands and conventions

### 1B. Extend the data model for Projects and multi-source support

Create database migrations/models for:

**Projects table:**
- `id` (UUID, primary key)
- `tenant_id` (FK to tenants)
- `name` (VARCHAR, not null)
- `description` (TEXT, nullable)
- `icon` (VARCHAR, nullable — emoji or icon name)
- `color` (VARCHAR, nullable — hex color for the project accent)
- `is_default` (BOOLEAN, default false — every tenant gets one default project)
- `created_at`, `updated_at` (TIMESTAMP)

**Data Sources table** (replaces or extends whatever currently tracks uploads):
- `id` (UUID, primary key)
- `project_id` (FK to projects)
- `tenant_id` (FK to tenants)
- `name` (VARCHAR — user-friendly name, defaults to filename)
- `original_filename` (VARCHAR)
- `file_type` (VARCHAR — 'csv', 'xlsx', 'tsv')
- `row_count` (INTEGER)
- `column_count` (INTEGER)
- `size_bytes` (BIGINT)
- `schema_snapshot` (JSON — cached column names, types, sample values for fast context gathering)
- `status` (VARCHAR — 'processing', 'ready', 'error')
- `uploaded_at` (TIMESTAMP)

**Queries table** (history of every NL query):
- `id` (UUID, primary key)
- `project_id` (FK to projects)
- `tenant_id` (FK to tenants)
- `question` (TEXT — the user's natural language question)
- `sql_generated` (TEXT)
- `explanation` (TEXT)
- `assumptions` (TEXT)
- `visualization_type` (VARCHAR)
- `visualization_config` (JSON — the full ECharts option used to render)
- `result_summary` (JSON — row_count, column_names, first 5 rows for preview)
- `execution_time_ms` (INTEGER)
- `status` (VARCHAR — 'success', 'error', 'timeout')
- `error_message` (TEXT, nullable)
- `is_pinned` (BOOLEAN, default false)
- `pin_title` (VARCHAR, nullable — user can rename a pinned chart)
- `created_at` (TIMESTAMP)

**Dashboards table:**
- `id` (UUID, primary key)
- `project_id` (FK to projects)
- `tenant_id` (FK to tenants)
- `name` (VARCHAR)
- `description` (TEXT, nullable)
- `layout` (JSON — stores the grid layout config for all widgets)
- `is_pinned` (BOOLEAN, default false)
- `created_at`, `updated_at` (TIMESTAMP)

**Dashboard Widgets table:**
- `id` (UUID, primary key)
- `dashboard_id` (FK to dashboards)
- `query_id` (FK to queries — the saved query this widget displays)
- `widget_type` (VARCHAR — 'chart', 'single_number', 'insight_card', 'table')
- `position` (JSON — `{x, y, w, h}` grid coordinates)
- `config_overrides` (JSON — any user tweaks to the default chart config)
- `created_at` (TIMESTAMP)

**Insights table** (AI-generated business insights):
- `id` (UUID, primary key)
- `project_id` (FK to projects)
- `tenant_id` (FK to tenants)
- `query_id` (FK to queries, nullable — insight may be attached to a specific query or freestanding)
- `insight_type` (VARCHAR — 'anomaly', 'trend', 'opportunity', 'warning', 'correlation')
- `title` (VARCHAR — short headline, e.g. "Revenue dropped 23% in Northeast")
- `description` (TEXT — 2-3 sentence AI explanation)
- `severity` (VARCHAR — 'info', 'warning', 'critical', 'opportunity')
- `data_evidence` (JSON — the specific numbers/rows that support this insight)
- `is_dismissed` (BOOLEAN, default false)
- `source` (VARCHAR — 'auto_chart', 'background_analysis', 'user_query')
- `created_at` (TIMESTAMP)

**Credits/Usage table:**
- `id` (UUID, primary key)
- `tenant_id` (FK to tenants)
- `month` (DATE — first of the month, for monthly budget tracking)
- `credits_allocated` (DECIMAL — $ worth of API credits for this month)
- `credits_used` (DECIMAL — running total of API costs this month)
- `query_count` (INTEGER)
- `background_analysis_count` (INTEGER)
- `updated_at` (TIMESTAMP)


### Acceptance Criteria
- `CLAUDE.md` is comprehensive and accurate with full project documentation
- All database tables created with proper foreign keys and indexes
- Existing upload + query flow still works (no regressions — you only added tables, didn't change logic)
- Run the app and confirm: upload a CSV, run a query, see the chart — everything still works
- The new tables exist but are empty — that's expected, endpoints come in Phase 2

## Phase 2: API Endpoints, Upload Flow, and Default Projects

Before starting, review the existing codebase: read `CLAUDE.md` for conventions, check `.agent-state/phase-history.json` for Phase 1 accomplishments, and check `.agent-state/test-results.json` for any test failures. Fix any failing tests FIRST.

This phase builds all the API endpoints for the data models created in Phase 1, modifies the upload flow to support projects and multi-source, and adds default project auto-creation.

### 1C. Create API endpoints (backend only, no frontend yet)

Create RESTful API routes for:

**Projects:**
- `GET /api/projects` — list all projects for the current tenant
- `POST /api/projects` — create a new project
- `PUT /api/projects/:id` — update project name/description/icon/color
- `DELETE /api/projects/:id` — delete project and all its data (with confirmation)
- `GET /api/projects/:id/summary` — return project overview: data source count, query count, dashboard count, latest activity

**Data Sources:**
- `POST /api/projects/:id/upload` — upload file to a specific project (modify existing upload flow)
- `GET /api/projects/:id/sources` — list data sources in a project
- `DELETE /api/sources/:id` — remove a data source

**Queries:**
- `POST /api/projects/:id/query` — the existing NL query endpoint, now scoped to a project
- `GET /api/projects/:id/queries` — list query history for a project (paginated, newest first)
- `PUT /api/queries/:id/pin` — toggle pin status, optionally set pin_title
- `GET /api/queries/pinned` — get all pinned queries across all projects for this tenant

**Dashboards:**
- `GET /api/projects/:id/dashboards` — list dashboards in a project
- `POST /api/projects/:id/dashboards` — create a new dashboard
- `PUT /api/dashboards/:id` — update dashboard name/description/layout
- `DELETE /api/dashboards/:id` — delete a dashboard
- `POST /api/dashboards/:id/widgets` — add a widget (from a pinned query)
- `PUT /api/widgets/:id` — update widget position or config
- `DELETE /api/widgets/:id` — remove a widget from a dashboard

All endpoints must validate tenant isolation — a user can NEVER access another tenant's data.

### 1D. Update the upload flow

Modify the existing file upload to:
- Require a `project_id` (default project if not specified)
- After ingesting into DuckDB, compute and cache the `schema_snapshot` JSON (column names, types, sample values, cardinality, min/max — the same info gathered for Claude context)
- Store this in the data_sources table so we don't have to recompute it on every query
- Support multiple file uploads to the same project — each becomes a separate table in the tenant's DuckDB

### 1E. On tenant creation, auto-create a default project

When a new user signs up or on first login, automatically create a project called "My First Project" with `is_default=true`. Migrate existing users: if they have uploaded data but no project exists, create the default project and associate their existing data sources with it.

### Acceptance Criteria
- All database tables created with proper foreign keys and indexes
- All API endpoints return proper JSON responses with appropriate HTTP status codes
- `CLAUDE.md` is comprehensive and accurate
- Existing upload + query flow still works (no regressions)
- Default project auto-creation works for new and existing users
- Schema snapshot is computed and cached on upload
- Every endpoint validates tenant isolation
- Run the app and confirm: upload a CSV, run a query, see the chart — everything still works



## Phase 3: App Shell, Sidebar Navigation, and Project Switching

Before starting, review the existing codebase: read `CLAUDE.md` for conventions, check `.agent-state/phase-history.json` for Phase 1-2 accomplishments, and check `.agent-state/test-results.json` for any test failures. Fix any failing tests FIRST.

This phase replaces the single-page layout with a proper app shell featuring sidebar navigation. Focus ONLY on the sidebar, navigation, and project switching. The project home page content and query improvements come in the next phase.

### 2A. Left sidebar navigation

Replace the current single-page layout with a proper app shell:

**Sidebar (always visible, left side, 260px wide, collapsible to 64px icon-only):**
- Top: Affix logo/wordmark
- Section: "Projects" header with a "+" button to create new project
  - List of projects, each showing: icon/emoji, project name, colored dot accent
  - Active project is highlighted
  - Click a project to navigate into it
- Section: "Pinned" — shows pinned charts/dashboards across all projects (quick access)
- Section: "Background Jobs" — shows count of active/queued background analyses (build the UI shell, will be wired in Phase 9)
- Bottom: User avatar/name, settings gear icon, credit usage indicator (small bar showing % used this month — just the UI, backend was built in Phase 1)

**Style the sidebar to match the existing dark luxury theme:**
- Background: slightly lighter than the main content area, maybe `rgba(255,255,255,0.03)` overlay
- Subtle border-right: `1px solid rgba(255,255,255,0.06)`
- Hover states on project items: subtle background glow
- Active project: left accent bar in the project's color
- Smooth collapse animation (sidebar slides to icon-only width)
- On mobile (< 768px): sidebar becomes a slide-out drawer with a hamburger menu


### 3B. Responsive sidebar behavior

- Sidebar collapses to icons on screens < 1200px
- Sidebar becomes a drawer on screens < 768px with a hamburger menu
- Smooth collapse animation (sidebar slides to icon-only width)

### 3C. New Project creation modal


A clean modal for creating projects:
- Name field (required)
- Description field (optional)
- Emoji/icon picker (a small grid of common business emojis: 📊📈💰🏪📦🎯🔍💡🏗️⚡)
- Color picker (6-8 preset accent colors that look good on dark backgrounds)
- "Create Project" button with loading state
- After creation, navigate into the new project


### Acceptance Criteria
- App has a proper sidebar with project list
- Sidebar shows projects with icons, names, and colored accents
- Active project is highlighted with accent bar
- Creating a new project works end to end (modal → API → appears in sidebar)
- Navigation between projects works
- Sidebar collapses on medium screens, becomes drawer on mobile
- Pinned section shows in sidebar (can be empty for now)
- Dark theme is consistent — no white flashes or unstyled elements
- All existing functionality (upload, query, chart) continues to work

## Phase 4: Project Home Page, Query History, and Result Improvements

Before starting, review the existing codebase: read `CLAUDE.md` for conventions, check `.agent-state/phase-history.json` for Phase 1-3 accomplishments, and check `.agent-state/test-results.json` for any test failures. Fix any failing tests FIRST.

This phase builds the project home page content — the stat cards, query bar, tabbed content area, and improved query results. After this phase, the app should feel like a real product, not a single-page demo.

### 2B. Project home page

When you click into a project, show:

**Header area:**
- Project name (editable inline on click) with icon/emoji
- Project description (editable, shows placeholder "Add a description..." if empty)
- Three stat cards in a row: "X Data Sources", "Y Queries Asked", "Z Dashboards"
- These should be styled as small dark glass cards with the numbers in the project's accent color

**Below the header, the "Ask Your Data" bar:**
- Move the existing NL query input here — same functionality but styled to feel integrated
- Below it: "Suggested Questions" — 4-6 clickable pill buttons with auto-generated questions based on the project's data. For now, generate these statically from the cached schema_snapshot (e.g., if there's a column called "revenue", suggest "What is the total revenue?"). In Phase 8 we'll make these AI-generated.

**Content tabs below the query bar:**
- **"Recent"** (default) — shows the last 10 queries as a feed/timeline. Each entry shows: the question text, a mini preview of the chart (small thumbnail), the visualization type badge, timestamp, and a pin button (star icon)
- **"Data Sources"** — shows uploaded files as cards (filename, row count, column count, upload date, preview button). Include the "+ Upload" button here. Click a data source card to show a modal with schema details and sample data rows.
- **"Dashboards"** — shows dashboards as cards. Each card shows name, widget count, last updated. Click to open the dashboard. Include a "+ New Dashboard" button. (Dashboard builder UI comes in Phase 5.)

### 2C. Query result area improvements

When a user asks a question, the result should appear below the query bar in a polished card:

- Claude's explanation at the top (collapsible, starts expanded)
- The chart visualization (using existing ECharts setup)
- Below the chart: a row of action buttons:
  - 📌 "Pin" — saves this query as pinned
  - 📊 "Add to Dashboard" — opens a dropdown to pick which dashboard (or create new)
  - 📋 "Show SQL" — toggles the SQL code block
  - ⬇️ "Download" — exports chart as PNG or data as CSV
  - 🔄 "Ask a follow-up" — (UI only for now, wired in Phase 8)
- The result should animate in smoothly (the transition effect from the chart visualization prompt)


### 4D. Responsive content layout

- Project home stacks stat cards vertically on mobile
- Query results go full-width on mobile
- Tabs work as horizontal scroll on mobile
- Everything must look intentional on mobile — not broken, but adapted

### Acceptance Criteria
- Project home shows stat cards, query bar, and tabbed content
- Uploading files within a project context works
- Query history appears in the "Recent" tab with chart thumbnails
- Pinning a query works (star toggles, appears in sidebar "Pinned" section)
- Suggested questions appear based on schema data
- Query result cards show all action buttons (Pin, Add to Dashboard, Show SQL, Download)
- The app feels like a real multi-page product, not a single-page demo
- Mobile layout is usable (not perfect, but functional)
- All existing functionality continues to work within the project context

## Phase 5: Dashboard Grid Engine and Canvas Layout

Before starting, review the codebase: read `CLAUDE.md`, check `.agent-state/phase-history.json` and `.agent-state/test-results.json`. Fix any failing tests FIRST.

This phase sets up the dashboard builder's foundation — the grid layout library and the dashboard canvas with widget rendering. Focus on getting drag-and-drop and resize working with proper ECharts integration. The widget picker, persistence, and menus come in the next phase.

### 3A. Choose and install a grid layout library

Use `react-grid-layout` if the frontend is React, or `gridstack.js` if it's vanilla JS/HTML templates. Check the existing frontend framework in `CLAUDE.md` and pick accordingly. If neither is suitable, use CSS Grid with custom drag handling.

The layout library must support:
- Responsive grid (12 columns)
- Drag to reposition widgets
- Resize handles on widgets
- Collision detection (widgets don't overlap)
- Serializable layout (save to JSON in the dashboards table `layout` field)
- Smooth animations on move/resize

### 3B. Dashboard view page

Route: `/projects/:projectId/dashboards/:dashboardId`

**Top bar:**
- Dashboard name (editable inline)
- "Add Widget" button (opens the widget picker — see 3C)
- "Auto-Layout" button — AI rearranges widgets for optimal visual flow (for now, just use a simple algorithm: sort by widget type, single_numbers on top row, charts in middle, tables at bottom, maximize use of grid space)
- "Share" button (UI only — functionality in Phase 10)
- "Edit / View" toggle — in View mode, dragging and resizing are disabled, and the dashboard is presentation-ready
- A subtle grid overlay when in Edit mode (faint dotted lines at `rgba(255,255,255,0.04)`)

**The Canvas:**
- The grid layout area fills the remaining viewport
- Default background: the same deep dark as the rest of the app, but slightly different to feel like a "canvas" — maybe a very subtle radial gradient or noise texture centered on the canvas
- In Edit mode: empty spaces show a faint "+" icon on hover, clicking opens the widget picker
- Minimum widget size: 3 columns × 2 rows for charts, 2 columns × 1 row for single_numbers
- Maximum: full width (12 columns)
- Default height for new widgets: 3 rows for charts, 1 row for single_numbers, 4 rows for tables


### 3D. Widget rendering on the dashboard

Each widget on the canvas is rendered inside a widget container:

**Widget container:**
- Same dark glass card style from the existing chart containers (gradient background, subtle border, rounded corners)
- Top: small drag handle (three dots icon, only visible in Edit mode) + widget title (the question that was asked, truncated with ellipsis)
- The chart/table fills the remaining space
- ECharts must call `resize()` when the widget is resized — this is critical
- Resize handle in bottom-right corner (only visible in Edit mode, styled as a small diagonal grip)
- On hover (View mode): subtle border glow in the project's accent color

**Widget menu (three dots icon in top-right of each widget):**
- "View Full" — opens the chart in a modal at full screen
- "Edit Question" — lets you modify the NL query and regenerate
- "Change Chart Type" — dropdown to override the visualization type
- "Remove from Dashboard" — removes widget (with confirmation)


### Acceptance Criteria
- Grid layout library is installed and configured
- Dashboard page renders at the correct route
- Widgets can be dragged and repositioned with smooth animation
- Widgets can be resized with handles
- ECharts charts call `resize()` correctly when widgets are resized — this is critical
- Edit/View mode toggle works (no drag handles or resize in View mode)
- Widget containers have the dark glass card style matching the existing theme
- Grid overlay shows faint dotted lines in Edit mode
- Collision detection prevents widget overlap

## Phase 6: Widget Picker, Dashboard Persistence, and Polish

Before starting, review the codebase: read `CLAUDE.md`, check `.agent-state/phase-history.json` and `.agent-state/test-results.json`. Fix any failing tests FIRST.

This phase completes the dashboard builder: the widget picker modal, widget menus, auto-save persistence, empty states, and dashboard list improvements. After this phase, dashboards should be fully functional end-to-end.

### 3C. Widget picker modal

When "Add Widget" is clicked, show a modal with two tabs:

**Tab 1: "From Pinned Queries"**
- Shows all pinned queries for this project as cards
- Each card shows: the question text, chart type badge, mini chart preview
- Click to add to dashboard — widget appears in the first available grid position
- Already-added queries are dimmed with a checkmark

**Tab 2: "Ask a New Question"**
- Embeds the same NL query interface
- User asks a question, sees the result
- A "Add to Dashboard" button appears below the result
- The query is automatically saved (pinned) when added to a dashboard


### 6B. Widget context menu

Each widget has a three-dot menu icon in the top-right:
- "View Full" — opens the chart in a modal at full screen
- "Edit Question" — lets you modify the NL query and regenerate
- "Change Chart Type" — dropdown to override the visualization type
- "Remove from Dashboard" — removes widget (with confirmation)

### 3E. Dashboard persistence

- Every layout change (drag, resize) auto-saves to the API with a 1-second debounce
- Show a subtle "Saving..." → "Saved ✓" indicator in the top bar
- When loading a dashboard, fetch the layout JSON and all widget queries, then render
- If a widget's underlying query fails on reload (e.g., data source deleted), show an error state in that widget: "Data source unavailable" with a refresh button

### 3F. Empty dashboard state

When a dashboard has no widgets:
- Show a large, centered illustration area (just use styled text/icons, no external images)
- "Your dashboard is empty" headline
- "Add your first widget by clicking the button above, or try asking a question" subtext
- Three suggested actions as large clickable cards:
  1. "📊 Add from Pinned Queries" — opens widget picker Tab 1
  2. "💬 Ask a New Question" — opens widget picker Tab 2
  3. "✨ Auto-Generate Dashboard" — (UI button only, wired in Phase 11)

### 3G. Dashboard list improvements

On the project home's Dashboards tab (built in Phase 4), add:
- Dashboard preview thumbnails (capture a screenshot-like representation: a small grid showing colored rectangles where widgets are positioned, sized proportionally to the actual layout)
- "Duplicate Dashboard" action
- "Pin Dashboard" action (appears in sidebar Pinned section)

### Acceptance Criteria
- Can create a new empty dashboard from the project page
- Can add widgets from pinned queries
- Can add widgets by asking a new question directly in the dashboard
- Drag and resize widgets smoothly with animated transitions
- Layout persists — refresh the page and widgets are in the same positions
- Edit/View mode toggle works (no drag handles or resize in View mode)
- Widget menu works (full view, remove)
- ECharts charts resize correctly when widgets are resized
- Auto-save works with visible save indicator
- Empty dashboard state looks designed, not broken
- Dashboard appears in the project's dashboard list with a preview thumbnail
- The whole experience feels polished and intentional


### Acceptance Criteria
- Can add widgets from pinned queries via the picker modal
- Can add widgets by asking a new question directly in the dashboard
- Widget context menu works (full view, edit, change type, remove)
- Layout auto-saves with debounce and shows "Saving..." → "Saved ✓" indicator
- Refreshing the page restores all widgets in the same positions
- Empty dashboard state looks designed with three action cards
- Dashboard list on project home shows preview thumbnails
- Duplicate and pin dashboard actions work
- Error state shows in widgets when data source is unavailable
- The whole dashboard experience feels polished and intentional

## Phase 7: Auto-Insights Engine — AI Business Intelligence on Every Chart

Before starting, review the codebase: read `CLAUDE.md`, check `.agent-state/phase-history.json` and `.agent-state/test-results.json`. Fix any failing tests FIRST.

This phase adds the feature that makes Affix more than a chart tool. Every time a query returns data, the AI analyzes the results and generates business insights automatically. These appear as "Insight Cards" — compact, glowing nuggets of wisdom attached to every chart.

### 7A. Insight generation after every query

Modify the query execution pipeline (look at the route that handles `POST /api/projects/:id/query`):

After the SQL executes and returns results, make a SECOND Anthropic API call. This call gets:
- The original user question
- The SQL that was generated
- The full result set (or first 200 rows if large)
- The column names and types
- The schema context (from the cached schema_snapshot)

**System prompt for the insight generation call:**

```
You are a senior business analyst reviewing query results. Analyze the data and provide 2-4 concise, actionable business insights.

DATA CONTEXT:
User asked: "{question}"
Query returned {row_count} rows with columns: {column_names}

RESULTS:
{formatted_results}

SCHEMA CONTEXT:
{schema_context}

For each insight, respond in this exact JSON format:
[
  {
    "type": "anomaly|trend|opportunity|warning|correlation",
    "severity": "info|warning|critical|opportunity",
    "title": "Short headline (max 80 chars)",
    "description": "2-3 sentence explanation with specific numbers from the data. Be concrete, not vague. Reference actual values.",
    "evidence": {"metric": "value", "comparison": "value", "delta": "value or percentage"}
  }
]

RULES:
1. Be specific — cite actual numbers from the results. "Revenue is $1.2M" not "Revenue is high."
2. Look for: outliers, concentration risks (one customer = 40% of revenue), trends, missing data patterns, suspicious values, growth/decline rates, Pareto distributions (80/20 rule).
3. Compare against business common sense — if average order is $3, that's unusual for B2B. If one region has 10x the others, flag it.
4. Severity guide: "critical" = needs immediate attention (data anomaly, huge drop). "warning" = should investigate. "opportunity" = potential upside. "info" = interesting observation.
5. If the data is too simple or small for meaningful insights (e.g., a simple count), return 1 insight maximum.
6. Do NOT hallucinate data that isn't in the results. Only reference actual values returned.
```

**API call parameters:**
- Model: `claude-sonnet-4-20250514`
- max_tokens: 1000
- temperature: 0.3 (slightly creative for insights, but grounded)

Parse the JSON response. Save each insight to the `insights` table linked to this query.

### 7B. Track API costs

Every Anthropic API call (both the SQL generation call and the insights call) should estimate and track cost:
- Count input and output tokens from the API response
- Calculate cost based on Sonnet pricing (check current pricing, approximately $3/M input, $15/M output)
- Add to the `credits_used` column in the credits table for this tenant's current month
- This is critical for the background analysis feature (Phase 9) which needs to check budget before running

Create a utility function: `track_api_usage(tenant_id, input_tokens, output_tokens, purpose)` where purpose is 'query_sql', 'query_insights', or 'background_analysis'.

### 7C. Insight Cards UI

Below each chart result (and on dashboard widgets), display the AI insights as "Insight Cards":

**Card design:**
- Compact horizontal cards, max 2 per row, stacked below the chart
- Left edge: colored accent bar based on severity (blue=info, amber=warning, red=critical, green=opportunity)
- Icon based on type: 📉 anomaly, 📈 trend, 💡 opportunity, ⚠️ warning, 🔗 correlation
- Title in medium weight, white
- Description in lighter weight, `rgba(255,255,255,0.7)`, smaller font
- Evidence values highlighted in the accent color (e.g., the specific numbers are rendered in cyan or amber)
- Background: subtle glass card, same style as other cards but with the severity color at very low opacity in the background (e.g., `rgba(red, 0.05)` for critical)
- Small "dismiss" (X) button in top right — marks insight as dismissed
- Animate cards in: stagger them appearing one by one, 200ms apart, sliding up with a subtle fade

**On dashboard widgets:**
- Show a small insight indicator in the widget header: a colored dot (highest severity color) + count ("3 insights")
- Clicking it expands an overlay panel within the widget showing the insight cards
- This keeps dashboards clean but insights accessible

### 7D. Insights feed on project home

Add a new tab to the project home page (alongside Recent, Data Sources, Dashboards):

**"Insights" tab:**
- Shows ALL insights for this project, sorted by newest first
- Filterable by type (anomaly, trend, etc.) and severity
- Each insight card here also shows: which query generated it (clickable link to the chart), and when
- Undismissed insights with severity "critical" or "warning" should also show a count badge on the tab header (like email unread count)

### 7E. Insight summary at project level

On the project home header (above the query bar), add a subtle insight summary strip:
- Shows the count of active (undismissed) insights by severity: "2 ⚠️ 1 🔴 5 💡"
- Clicking any count jumps to the Insights tab filtered to that severity
- If there are critical insights, animate the strip with a very subtle pulse (not distracting, just noticeable)

### Acceptance Criteria
- Every query generates 2-4 business insights automatically
- Insights appear below charts as styled Insight Cards
- Insight type, severity, and evidence are clearly displayed
- API token usage is tracked per call and stored in the credits table
- Dashboard widgets show insight indicators
- Project Insights tab shows all insights with filtering
- Dismissing an insight works and persists
- The insight generation doesn't block the chart from appearing — show the chart first, then load insights with a subtle "Analyzing..." shimmer that resolves into the cards
- If insight generation fails (API error), fail silently — show the chart without insights, log the error


## Phase 8: Conversational Follow-ups, AI-Generated Suggestions, and Smart Context

Before starting, review the codebase: read `CLAUDE.md`, check `.agent-state/phase-history.json` and `.agent-state/test-results.json`. Fix any failing tests FIRST.

This phase adds the features that make Affix feel like a conversation with a brilliant analyst, not a single-shot query tool. Multi-turn follow-ups, AI-generated question suggestions, and drill-down from chart interactions.

### 8A. Conversational follow-up queries

When a user asks a question and sees results, they should be able to ask follow-up questions that maintain context. This is the "Ask a follow-up" button built in Phase 4.

**Implementation:**

Modify the query endpoint to accept an optional `parent_query_id`. When present:
1. Fetch the parent query's question, SQL, explanation, and result_summary from the database
2. Include this context in the Anthropic API call as conversation history

**Modified system prompt when there's a parent query:**

Add this section before the user's new question:

```
CONVERSATION CONTEXT:
The user previously asked: "{parent_question}"
Which generated this SQL: {parent_sql}
And returned these results: {parent_result_summary}
The user's explanation was: {parent_explanation}

The user is now asking a follow-up question. Use the context above to understand what they're referring to. You may need to modify the previous query, add filters, change grouping, or drill into a specific segment. Write a NEW standalone SQL query (don't reference the previous one as a subquery unless necessary).
```

**Frontend flow:**
- After seeing query results, the "Ask a follow-up" button transforms the query bar into a contextual follow-up bar
- Show a small chip above the input: "Following up on: '{original question}'" with an X to clear context
- When the user submits, send with `parent_query_id`
- Show the follow-up result below the original (like a conversation thread)
- Allow chaining: the follow-up becomes the new parent for the next follow-up
- Max chain depth: 5 (after that, start a fresh query)

### 8B. AI-generated question suggestions

Replace the static suggested questions (from Phase 4) with AI-generated ones. On project load (or when data sources change), call the Anthropic API with the project's schema context:

**Prompt for question generation:**

```
You are analyzing a business database to suggest the most valuable questions a user should ask. Given the following data schema, generate exactly 6 suggested questions.

SCHEMA:
{schema_context_for_all_tables_in_project}

Generate questions in this JSON format:
[
  {
    "question": "What are the top 10 customers by total revenue?",
    "category": "ranking|trend|comparison|summary|anomaly|prediction",
    "complexity": "simple|moderate|complex",
    "business_value": "Brief note on why this question matters"
  }
]

RULES:
1. Mix categories: include at least one ranking, one trend, and one summary question.
2. Reference actual column names and tables from the schema.
3. Start with simple questions, escalate to more complex ones.
4. Frame questions as a business user would ask them, not a data engineer.
5. If there are date columns, include at least one time-trend question.
6. If there are multiple tables with joinable keys, include at least one cross-table question.
```

**Cache these suggestions** in a new table or in the project metadata. Refresh when:
- A new data source is uploaded to the project
- A data source is deleted
- The user clicks a "Refresh suggestions" button
- 24 hours have elapsed

**Frontend:**
- Display as pill buttons below the query bar, styled with category-based subtle color coding
- "Simple" questions have a plain style; "complex" questions have a small ✨ sparkle icon
- Clicking a suggestion fills the query bar and auto-submits
- Show a tooltip on hover with the `business_value` text

### 8C. Chart interaction drill-down

When a user clicks on a chart element (a bar, a pie slice, a line point), open a contextual drill-down:

**Implementation:**

1. Attach ECharts click event handlers to all chart instances
2. When an element is clicked, extract:
   - The series name (if multi-series)
   - The category value (e.g., "Northeast")
   - The data value
3. Pre-fill the follow-up query bar with a contextual question:
   - Bar clicked on "Northeast" in a revenue-by-region chart → "Tell me more about the Northeast region"
   - Pie slice clicked on "Product Category: Electronics" → "Break down Electronics by sub-category"
   - Time series point clicked on "2024-03" → "What happened in March 2024?"
4. Show the pre-filled question and let the user edit before submitting
5. Send as a follow-up to the current query (using `parent_query_id`)

**Visual feedback on click:**
- The clicked element pulses/highlights briefly
- A small popover appears near the click point showing the pre-filled question with "Ask this →" button

### 8D. "Explain this chart" button

Add an "Explain" button to the chart action row (alongside Pin, Add to Dashboard, etc.):

When clicked, make an API call to Claude with:
- The original question and SQL
- The full result data
- A prompt: "Explain these results as if presenting to a CEO. Be concise (3-5 sentences). Focus on the key takeaway, any surprises, and what action might be warranted. Use specific numbers."

Display the response in a styled callout above the chart — like a mini executive briefing.

### Acceptance Criteria
- Follow-up queries work and maintain conversational context
- Context chip shows which question is being followed up
- Follow-up chain works at least 3 levels deep
- AI-generated question suggestions appear on project load
- Suggestions are diverse (different categories and complexities)
- Clicking a chart element pre-fills a contextual drill-down question
- "Explain this chart" generates a CEO-friendly summary
- Suggestion pills are clickable and auto-submit
- Everything maintains the dark luxury theme
- All features fail gracefully if the API call fails


## Phase 9: Background Analysis — "The AI That Works For You"

Before starting, review the codebase: read `CLAUDE.md`, check `.agent-state/phase-history.json` and `.agent-state/test-results.json`. Fix any failing tests FIRST.

This is the killer feature: the user clicks a button and the AI autonomously explores their data in the background, finding insights they never thought to ask about. Marketing pitch: "The AI that works for you even when you don't."

### 9A. Background analysis job system

Create a job/task system for background analysis:

**Background Jobs table:**
- `id` (UUID)
- `tenant_id` (FK)
- `project_id` (FK)
- `status` (VARCHAR — 'queued', 'running', 'completed', 'paused_credits', 'failed')
- `total_questions_planned` (INTEGER)
- `questions_completed` (INTEGER)
- `credits_used` (DECIMAL)
- `credits_budget` (DECIMAL — max credits this job may spend)
- `findings` (JSON — array of insights discovered)
- `started_at`, `completed_at` (TIMESTAMP)
- `created_at` (TIMESTAMP)

**The analysis algorithm:**

When a background analysis is triggered:

1. Check credit budget: Calculate remaining credits for this tenant this month (`credits_allocated - credits_used`). If less than $0.50 remaining, decline with message: "Not enough credits remaining this month. You have $X.XX left."

2. Generate an analysis plan by calling Claude with the full schema context:

```
You are a senior data analyst beginning an exploratory analysis of a business database. Your goal is to find hidden insights, anomalies, cost-saving opportunities, and patterns the business owner hasn't thought to look for.

SCHEMA:
{schema_context}

Generate exactly 10 analytical questions to explore, ordered from most likely to reveal valuable insights to least. Focus on:
1. Money leaks: overspending, pricing anomalies, unprofitable segments
2. Concentration risks: over-reliance on one customer/product/region
3. Trend breaks: sudden changes that deserve investigation
4. Pareto analysis: are 20% of X causing 80% of Y?
5. Missing data patterns: columns with lots of nulls might indicate process issues
6. Cross-table relationships: correlations between different datasets
7. Seasonality and time patterns
8. Outlier detection: values far from the mean

Respond as JSON:
[
  {
    "question": "The natural language question",
    "rationale": "Why this might reveal something valuable",
    "estimated_complexity": "simple|moderate|complex"
  }
]
```

3. Execute each question sequentially:
   - Before each query: check remaining credits. If budget exhausted, pause the job.
   - Use the existing NL query pipeline (SQL generation → execution → insight generation)
   - Save each query to the queries table with a `source='background'` marker
   - Save insights to the insights table with `source='background_analysis'`
   - Track credits spent per query
   - Wait 2 seconds between queries to avoid rate limiting

4. After all questions are done (or credits exhausted), generate a summary:

```
You just completed an exploratory analysis of a business database. Here are the insights discovered:

{all_insights_json}

Write a 3-5 sentence executive summary of the most important findings. Prioritize actionable items. Start with the most critical finding.
```

Save the summary to the job record.

### 9B. Background job API endpoints

- `POST /api/projects/:id/background-analysis` — start a background analysis job
  - Body: `{ "credits_budget": 2.00 }` (optional, defaults to $2.00 max)
  - Returns the job ID immediately (async)
- `GET /api/background-jobs/:id` — check job status, progress, and findings
- `GET /api/projects/:id/background-jobs` — list all jobs for a project
- `POST /api/background-jobs/:id/cancel` — cancel a running job

### 9C. Background job execution

This should run asynchronously. Depending on the tech stack:
- If Python with a task queue (Celery, RQ, etc.): use that
- If Node.js: use a background worker with `bull` or `bee-queue`
- If neither is set up: use a simple in-process async approach — launch the analysis in a background thread/async task, poll for status from the frontend. This is fine for now. Do NOT spend time setting up a full job queue infrastructure.

The key requirement: the analysis must NOT block the user's main request/response cycle. The user clicks "Analyze" and immediately gets back a job ID. They can continue using the app while it runs.

### 9D. Background analysis UI

**Trigger button on the project home:**
- A prominent button below the query bar: "✨ Run Background Analysis"
- On click, show a confirmation modal:
  - "The AI will explore your data and look for hidden insights, anomalies, and opportunities."
  - "Credit budget for this run: $2.00" (with a slider to adjust, $0.50 — $5.00)
  - "Remaining credits this month: $X.XX"
  - "Start Analysis" button
- After starting: the button changes to a progress indicator showing "Analyzing... (3/10 questions)"

**In the sidebar "Background Jobs" section:**
- Show active jobs with a pulsing dot animation
- Show completed jobs with a checkmark and insight count
- Click a completed job to see the full results

**Background analysis results page:**
Route: `/projects/:projectId/analysis/:jobId`
- Executive summary at the top in a special card (slightly different style — maybe with a subtle glow border to feel "premium")
- Below: each question explored as a collapsible section
  - Question text as the header
  - Expand to see: the chart, the insights, the SQL
  - Pin button to save any individual chart/insight
  - "Add to Dashboard" button on each chart
- Credit usage summary at the bottom: "This analysis used $1.47 of $2.00 budget, exploring 10 questions"

### 9E. Credits display

Wire up the credit usage indicator in the sidebar (UI shell built in Phase 3):
- Small horizontal bar showing percentage used this month
- Text: "$X.XX / $Y.XX used this month"
- Bar color shifts from green → amber → red as usage approaches limit
- Tooltip: "Resets on [first of next month]. Usage includes all AI queries and background analysis."

### Acceptance Criteria
- Can trigger a background analysis job from the project page
- Job runs asynchronously — user can continue using the app
- Job generates 10 analytical questions and executes them sequentially
- Credits are tracked per query and job pauses if budget exhausted
- Job status is visible in the sidebar and on the project page
- Completed analysis shows executive summary + individual findings
- Individual findings can be pinned or added to dashboards
- Credit usage bar in sidebar reflects actual usage
- The whole system respects tenant isolation
- If the Anthropic API fails during a background job, the job handles it gracefully (skip that question, continue with the next)


## Phase 10: User Management, Sharing, and Public Links

Before starting, review the codebase: read `CLAUDE.md`, check `.agent-state/phase-history.json` and `.agent-state/test-results.json`. Fix any failing tests FIRST.

This phase adds multi-user support within a tenant and the ability to share dashboards externally.

### 10A. Team members within a tenant

**Users table** (extend existing auth if needed):
- Add `role` field: 'owner', 'admin', 'editor', 'viewer'
- Add `invited_by` (FK to users, nullable)
- Add `last_active_at` (TIMESTAMP)

**Role permissions:**
- Owner: everything, including billing and deleting the account
- Admin: everything except billing
- Editor: can create/edit projects, queries, dashboards. Cannot manage users.
- Viewer: can view projects and dashboards, can ask queries, but cannot edit dashboards or delete anything.

**API endpoints:**
- `GET /api/team` — list all users in the tenant
- `POST /api/team/invite` — invite a user by email (sends invite with a link)
- `PUT /api/team/:userId/role` — change a user's role (owner/admin only)
- `DELETE /api/team/:userId` — remove a user from the tenant

**For the invite flow:** Keep it simple. Generate an invite token, store it. When the invited user visits `/invite/:token`, they sign up (or log in if existing) and are added to the tenant with the specified role. Send the invite email using a simple transactional email service — check if the project already has an email setup (e.g., SendGrid, Resend, or even SMTP). If not, just store the invite link and show it to the inviter to manually share. Don't spend time setting up email infrastructure.

### 10B. Settings page

Route: `/settings`

**Tabs:**
- **"Team"** — shows team members in a table (name, email, role, last active, actions). Invite button at top.
- **"Billing & Credits"** — shows current plan, credit usage chart for the last 6 months (use ECharts — a simple bar chart), and a placeholder for Stripe integration: "Manage subscription" button that goes nowhere yet.
- **"Profile"** — user's name, email, password change
- **"API Keys"** — placeholder for future API/integration keys. Just show "Coming soon" with a styled empty state.

All styled in the dark luxury theme with clean form inputs.

### 10C. Dashboard sharing — public links

Enable sharing a dashboard via a public URL that anyone can view without logging in.

**Implementation:**
- Add to dashboards table: `share_token` (VARCHAR, nullable, unique), `is_public` (BOOLEAN, default false)
- When "Share" is clicked (button exists from Phase 5):
  - Show a modal with a toggle: "Public link"
  - When enabled, generate a random share token and save it
  - Display the URL: `https://yourapp.com/public/dashboards/:shareToken`
  - "Copy Link" button
  - Toggle off to revoke access
- Create a public route `/public/dashboards/:shareToken` that:
  - Does NOT require authentication
  - Renders the dashboard in View mode (no edit controls)
  - Shows a subtle "Powered by Affix" watermark/badge in the bottom corner
  - Fetches all widget data by re-executing the queries (or using cached results if < 1 hour old)
  - Navbar is minimal: just the dashboard title and "Powered by Affix" with a "Try Affix free →" CTA link

### 10D. Embed snippet

In the share modal, add a second option below the public link:

**"Embed"** — shows an iframe embed code:
```html
<iframe src="https://yourapp.com/embed/dashboards/:shareToken" 
        width="100%" height="600" frameborder="0"></iframe>
```

Create the `/embed/dashboards/:shareToken` route that:
- Renders the dashboard without ANY chrome (no header, no watermark — just the widgets)
- Is responsive to the iframe dimensions
- Has a tiny "Affix" link in the absolute bottom-right

### Acceptance Criteria
- Can invite team members by email (or shareable link)
- Role-based permissions work (viewer can't edit dashboards)
- Settings page shows team, billing placeholder, and profile
- Public dashboard links work — accessible without login
- Embed iframe code works
- Public dashboards show "Powered by Affix" branding
- Shared link can be revoked (toggle off)
- Team member list shows on settings page with role management
- Everything respects tenant isolation (even shared dashboards only show data from that tenant)


## Phase 11: AI-Generated Dashboards and Project Templates

Before starting, review the codebase: read `CLAUDE.md`, check `.agent-state/phase-history.json` and `.agent-state/test-results.json`. Fix any failing tests FIRST.

This phase adds the true "magic" — tell the AI what you want and it builds an entire dashboard for you.

### 11A. Natural language dashboard generation

Wire up the "✨ Auto-Generate Dashboard" button (placed in Phase 6's empty dashboard state):

**Flow:**
1. User can either click the auto-generate button or a new "Generate Dashboard" option in the project's dashboard tab
2. Show a modal with a text field: "Describe the dashboard you want"
   - Placeholder: "e.g., A sales overview showing top products, revenue trends, and regional performance"
   - Below: 3 suggested dashboard prompts (generated from schema, like "Inventory health overview", "Customer analysis dashboard", "Revenue performance tracker")
3. On submit, call Claude with:

```
You are building a dashboard for a business intelligence tool. Based on the user's description and the available data, generate a dashboard specification.

AVAILABLE DATA:
{schema_context_for_all_project_tables}

USER REQUEST: "{user_description}"

Generate a dashboard with 4-8 widgets. Respond as JSON:
{
  "dashboard_name": "Dashboard title",
  "dashboard_description": "One sentence description",
  "widgets": [
    {
      "question": "The natural language question to ask",
      "suggested_viz": "bar_chart|line_chart|pie_chart|single_number|table|area_chart|scatter_plot|heatmap|grouped_bar_chart",
      "size": "small|medium|large|full_width",
      "position_hint": "top_left|top_right|top_center|middle_left|middle_right|bottom_left|bottom_right|bottom_center"
    }
  ]
}

RULES:
1. Start with 1-2 single_number KPI widgets at the top (total revenue, total orders, etc.)
2. Include at least one time-trend chart if date data is available
3. Include at least one ranking/comparison chart
4. Include at least one breakdown/composition chart (pie or grouped bar)
5. Vary visualization types — don't make every widget a bar chart
6. Size guide: single_number = small, KPI charts = medium, detailed tables = large, primary charts = large or full_width
7. Questions must reference actual tables and columns from the schema
8. Aim for a balanced, visually pleasing layout
```

4. After getting the spec, automatically:
   - Create the dashboard
   - Execute each widget's question through the NL query pipeline
   - Generate insights for each
   - Assign grid positions based on size hints and position hints
   - Save everything

5. Show a progress overlay: "Building your dashboard... (3/6 widgets)"

6. When done, navigate to the dashboard. It should feel magical — one prompt and a full, beautiful, insightful dashboard appears.

### 11B. Project templates / suggested projects

When a user first signs up (or from the "+" new project button), offer templates:

**Template selection screen:**
- Show 4-6 template cards:
  1. "📊 Sales Analytics" — "Track revenue, customers, and product performance"
  2. "📦 Inventory Management" — "Monitor stock levels, turnover, and reorder points"
  3. "👥 Customer Intelligence" — "Understand segments, lifetime value, and churn risk"
  4. "💰 Financial Overview" — "P&L tracking, expense analysis, and budget monitoring"
  5. "📈 Marketing Performance" — "Campaign ROI, funnel analysis, and channel comparison"
  6. "🔧 Blank Project" — "Start from scratch"

Each template stores:
- A set of suggested questions (to be used as the AI question suggestions)
- A default dashboard generation prompt (e.g., "Create a sales overview dashboard with revenue KPIs, top products, monthly trends, and regional breakdown")
- Expected column name mappings (so the system can auto-suggest which uploaded columns map to "revenue", "date", "customer", etc.)

**After selecting a template and uploading data:**
- Auto-generate the question suggestions based on the template
- Offer to auto-generate the template's default dashboard: "Want us to build your Sales Analytics dashboard automatically? ✨"

### 11C. Dashboard regeneration

Add a "Regenerate" button in the dashboard top bar:
- Opens a modal: "Describe what you'd like to change"
- Pre-fills with the current dashboard's auto-generate prompt (if it was auto-generated)
- Generates a NEW set of widgets (doesn't modify existing ones — creates alongside them so user can compare and remove old ones)

### Acceptance Criteria
- "Auto-Generate Dashboard" creates a full dashboard from a text description
- Generated dashboards have 4-8 widgets with varied visualization types
- Layout is balanced and looks intentional (KPIs on top, charts below)
- Project templates appear during new project creation
- Template selection pre-configures suggestions and offers auto-dashboard generation
- Dashboard generation shows progress and handles errors gracefully
- Generated dashboards include insights on each widget
- The entire flow from "describe dashboard" to "see full dashboard" takes under 60 seconds
- Credits are tracked for all AI calls during generation


## Phase 12: Integration Framework, Data Relationships, and Export

Before starting, review the codebase: read `CLAUDE.md`, check `.agent-state/phase-history.json` and `.agent-state/test-results.json`. Fix any failing tests FIRST.

This phase adds practical features that make Affix useful for daily work.

### 12A. Auto-detect data relationships across tables

When a project has multiple data sources, automatically detect potential join relationships:

**On data source upload (after schema caching):**
1. Compare column names across all tables in the project
2. Flag likely foreign keys: exact name matches (e.g., `customer_id` in both tables), or partial matches with common patterns (`orders.customer_id` → `customers.id`)
3. Store detected relationships in a `data_relationships` table:
   - `source_table`, `source_column`, `target_table`, `target_column`, `confidence` (0-1), `status` ('suggested', 'confirmed', 'rejected')

**Relationship management UI:**
- On the project's Data Sources tab, add a "Relationships" section
- Show detected relationships as connection lines between table cards (or as a simple list)
- User can confirm or reject suggestions
- User can manually add relationships

**Use in query context:**
- When building schema context for Claude, include confirmed and high-confidence relationships:
  ```
  CONFIRMED RELATIONSHIPS:
  - orders.customer_id → customers.id
  - order_items.order_id → orders.id
  ```
- This dramatically improves Claude's ability to write JOIN queries correctly

### 12B. Export capabilities

**Dashboard export to PDF:**
- "Export to PDF" button in the dashboard top bar
- Use a server-side approach: render the dashboard at a fixed viewport, capture each widget as an image, compose into a PDF
- Include: dashboard title, date, each chart image with its title and insights below
- Style the PDF to match the dark theme (dark background, light text) — it should look premium even printed
- Use a library appropriate to the stack (e.g., `puppeteer` for headless rendering + `pdfkit` for Node, or `playwright` + `reportlab` for Python)

**Data export:**
- On any query result: "Download CSV" and "Download Excel" buttons
- On any dashboard: "Export All Data" — downloads a ZIP with one CSV per widget

**Scheduled export (UI only):**
- In the export modal, add a "Schedule" toggle with options: Daily, Weekly, Monthly
- Show "Email to:" field
- Just save the schedule config to the database. Don't implement the actual email sending — just the UI and config storage. Add a comment: `# TODO: Wire up scheduled export with cron job and email service`

### 12C. Integration webhooks (outgoing)

Simple integration point for connecting Affix to other tools:

**Webhook configuration:**
- In project settings, add "Webhooks" section
- User can add webhook URLs with triggers:
  - "New critical insight detected"
  - "Background analysis completed"
  - "Dashboard updated"
- On trigger, POST a JSON payload to the URL:
```json
{
  "event": "insight.critical",
  "project": "Sales Analytics",
  "timestamp": "2026-02-08T...",
  "data": { "title": "Revenue dropped 23%...", "severity": "critical" }
}
```
- Store webhook configs in a `webhooks` table
- On the relevant events, fire the webhooks asynchronously (don't block the main flow)
- Log webhook delivery status (success/failure/retry)

### 12D. Data refresh

For uploaded files, add a "Re-upload / Refresh" capability:
- On a data source card, add a "Refresh" button
- Opens a file picker to upload a new version of the same file
- Replaces the DuckDB table data but keeps the same table name
- All existing queries, dashboards, and insights still reference the same table
- After refresh: re-compute schema snapshot, invalidate cached suggestions
- Show a subtle "Data refreshed" toast notification

### Acceptance Criteria
- Cross-table relationships are auto-detected and shown to the user
- Confirmed relationships improve multi-table query accuracy
- Dashboard PDF export produces a clean, dark-themed document
- CSV/Excel download works on any query result
- Webhook configuration UI works, webhooks fire on events
- Data refresh replaces file contents without breaking existing queries
- All new features maintain the dark luxury theme
- No regressions in existing functionality


## Phase 13: Polish, Performance, Security, and Final Cleanup

Before starting, review the codebase thoroughly: read `CLAUDE.md`, check `.agent-state/phase-history.json` for ALL phase accomplishments, and check `.agent-state/test-results.json`. Fix ALL failing tests FIRST. This is the final phase.

### 13A. Performance audit and fixes

1. **Query performance:** Add result caching. If the same question is asked within 1 hour and the underlying data hasn't changed (no refresh), return cached results instead of calling Claude + DuckDB again. Store cache in a `query_cache` table with TTL.

2. **Dashboard load time:** When opening a dashboard, batch-fetch all widget data in parallel (not sequentially). Use `Promise.all` (JS) or `asyncio.gather` (Python).

3. **Schema context size:** If a project has 20+ tables, the schema context might be too large. Implement smart context selection: only include tables that Claude is likely to need based on the question. Use a quick pre-filter: if the question mentions "revenue", only include tables with revenue-related columns.

4. **Frontend bundle size:** If ECharts is imported fully, switch to modular imports (only import the chart types actually used: bar, line, pie, scatter, heatmap). This can cut bundle size by 60%.

5. **Lazy loading:** Dashboard widgets below the viewport should lazy-load their chart data as they scroll into view.

### 13B. Security review

1. **SQL injection in DuckDB queries:** Claude generates SQL, but verify it's truly read-only before execution. Add a SQL parser check (not just keyword matching — use a proper parser if available, or at minimum a regex that catches common bypass patterns like `; DROP`, comment-based injection `--`, and UNION-based attacks).

2. **Tenant isolation audit:** Review every API endpoint. Write a comment at the top of each route confirming it checks tenant_id. Look for any endpoint where a user could access another tenant's data by guessing an ID.

3. **XSS in chart labels:** User-uploaded data becomes chart labels and tooltip content. Ensure all user data rendered in the DOM is properly escaped. ECharts handles this internally for canvas rendering, but any HTML tooltips or labels must be sanitized.

4. **Rate limiting:** Add rate limiting to the query endpoint (max 30 queries per minute per tenant) and the background analysis trigger (max 3 concurrent jobs per tenant).

5. **File upload validation:** Verify file type (check magic bytes, not just extension). Limit file size (100MB). Reject files that fail to parse as valid CSV/Excel.

6. **API key security:** Confirm the Anthropic API key is only used server-side, never exposed to the frontend. Check that it's not in any client-side bundle, git history, or error messages.

7. **Public dashboard security:** Public dashboard routes must ONLY serve the dashboard's widget data — no access to project settings, other dashboards, user info, or schema details.

### 13C. UI polish pass

1. **Loading states:** Every async action must have a loading state. Audit all buttons, forms, and data-loading areas. Replace any missing loading states with the shimmer animation pattern (not spinners).

2. **Error states:** Every section that loads data must handle errors gracefully with styled error cards (not browser alert boxes or unstyled error text).

3. **Empty states:** Every list/grid that can be empty must have a designed empty state with an icon, message, and call-to-action.

4. **Transitions:** Verify smooth transitions between:
   - Navigating between projects
   - Switching tabs on the project home
   - Opening/closing modals
   - Chart transitions on new query results
   - Dashboard entering and exiting edit mode

5. **Typography consistency:** Audit all font sizes, weights, and colors across the app. Create a typography scale if one doesn't exist (e.g., headings: 24/20/16px, body: 14px, caption: 12px, all with consistent rgba colors).

6. **Color consistency:** All accent colors, severity colors, and background gradients should be defined as CSS variables and used consistently everywhere.

7. **Mobile audit:** Test every major flow on a 375px viewport:
   - Sidebar drawer works
   - Query input is usable
   - Charts are readable
   - Dashboards show widgets stacked vertically
   - Modals don't overflow

### 13D. Documentation

1. **Update `CLAUDE.md`** with:
   - All new features added across all phases
   - All database tables and their purposes
   - API endpoint documentation (method, path, request/response)
   - Environment variables required
   - How to set up the Anthropic API key
   - How credit tracking works
   - How background analysis works

2. **Create `README.md`** for the project root with:
   - Product overview (what Affix does)
   - Screenshots/GIFs placeholder notes
   - Setup instructions (prerequisites, install, run)
   - Environment variables
   - Tech stack
   - Architecture overview
   - Contributing guidelines (basic)

3. **Remove all TODO/FIXME comments** — either resolve them or document them as known limitations in the README.

### 13E. Final verification

Run through this manual test script to verify everything works:

1. Sign up as a new user → default project is created
2. Upload a CSV with sales-like data (date, customer, product, amount, region columns)
3. Upload a second CSV with customer details (customer_id, name, segment, join_date)
4. Verify data relationships are auto-detected
5. Ask "What is total revenue?" → single_number chart with count-up animation
6. Ask "Show revenue by region" → bar chart with insights
7. Ask a follow-up: "Which products are strongest in the top region?"
8. Pin 3-4 queries
9. Create a dashboard → add pinned queries as widgets
10. Rearrange widgets → verify auto-save
11. Auto-generate a dashboard from text description
12. Run a background analysis → verify it completes and shows insights
13. Share a dashboard via public link → open in incognito → verify it works
14. Invite a team member → verify they can see the project
15. Export dashboard as PDF
16. Check credit usage reflects all AI calls made
17. Verify mobile layout on all major pages

### Acceptance Criteria
- All tests pass
- No TypeScript/linting errors
- No console errors in the browser
- All loading, error, and empty states are designed
- Security review complete with no critical issues
- Performance is acceptable: dashboard loads in < 3 seconds, queries return in < 10 seconds
- Mobile layout is functional
- README and CLAUDE.md are comprehensive
- The entire app manual test script passes
- The app feels polished, professional, and magical
