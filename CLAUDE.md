# Affix Project

> **Affix: AI-powered BI platform with dark luxury theme and per-tenant SQLite data storage**

## GitHub Repository
- Repo: https://github.com/davidmodfyi/useaffix.ai
- Username: davidmodfyi
- Personal Access Token: Stored in environment or git credentials (not in repo)

## Git Remote (already configured)
```
origin https://github.com/davidmodfyi/useaffix.ai.git
```

## Live URLs
- Landing page: https://useaffix.ai
- App dashboard: https://useaffix.ai/app
- Login: https://useaffix.ai/login

---

## Tech Stack

### Backend
| Component | Technology | Version |
|-----------|------------|---------|
| Runtime | Node.js | - |
| Framework | Express.js | ^4.18.2 |
| Main Database | SQLite (better-sqlite3) | ^9.4.3 |
| Tenant Data Storage | SQLite per tenant | ^9.4.3 |
| Authentication | Session-based (express-session) | ^1.18.0 |
| Password Hashing | bcrypt (12 salt rounds) | ^5.1.1 |
| Security Headers | Helmet | ^7.1.0 |
| File Upload | Multer (memory storage) | ^1.4.5-lts.1 |
| Excel/CSV Parsing | xlsx | ^0.18.5 |
| UUID Generation | uuid | ^9.0.1 |
| Cookie Parsing | cookie-parser | ^1.4.6 |
| Subdomain Routing | vhost | ^3.0.2 |

### AI Integration
| Component | Technology |
|-----------|------------|
| AI Provider | Anthropic Claude API |
| SDK | @anthropic-ai/sdk ^0.39.0 |
| Model | `claude-sonnet-4-20250514` |
| Max Tokens | 1500 |
| Temperature | 0 (deterministic) |

### Frontend
| Component | Technology |
|-----------|------------|
| Framework | Vanilla JavaScript (no build) |
| Visualization | ECharts 5.x (CDN) |
| Charts Theme | `feather-dark` (custom registered) |
| Fonts | DM Sans (body), Instrument Serif (display), JetBrains Mono (code) |
| Styling | Inline CSS with CSS Variables |

---

## File/Directory Structure

```
affix/
├── index.js                        # Main Express server (all routes)
├── index.html                      # Landing page (44KB)
├── favicon.svg                     # App icon
├── package.json                    # Dependencies
├── CLAUDE.md                       # This documentation file
│
├── db/
│   ├── init.js                     # SQLite database setup & schema creation
│   ├── seed.js                     # Default user & tenant seeding
│   └── affix.db                    # SQLite database (dev) - DO NOT COMMIT
│
├── lib/
│   ├── nlquery.js                  # Claude AI integration for NL queries
│   ├── datasources/
│   │   ├── DataSource.js           # Abstract base class (interface)
│   │   ├── FileDataSource.js       # SQLite implementation (21KB)
│   │   ├── CloudDBDataSource.js    # PostgreSQL/MySQL stub (placeholder)
│   │   ├── GatewayDataSource.js    # Firewalled DB stub (placeholder)
│   │   └── index.js                # Factory & exports
│   └── tenant/
│       ├── TenantManager.js        # Tenant CRUD & data source management (12KB)
│       └── index.js                # Exports
│
├── middleware/
│   ├── auth.js                     # Authentication & authorization middleware
│   └── session-store.js            # Custom SQLite session store
│
├── views/
│   ├── login.html                  # Login page (7.6KB)
│   └── app.html                    # Dashboard single-page app (79KB)
│
├── scripts/
│   └── create-user.js              # CLI tool for user creation
│
├── data/                           # Dev tenant data (auto-created)
│   └── tenants/{tenantId}/data.db
│
└── .agent-state/                   # Automated pipeline state
    ├── phase-history.json
    └── *.json
```

---

## Naming Conventions

### Database
- Table names: `snake_case` (tenants, users, sessions, tenant_data_sources)
- Column names: `snake_case` (tenant_id, created_at, password_hash)
- Primary keys: `id` (auto-increment INTEGER or TEXT UUID)
- Foreign keys: `{entity}_id` (e.g., tenant_id)
- Timestamps: `created_at`, `updated_at`
- Boolean flags: `is_` prefix (is_default, is_active)

### JavaScript
- Classes: `PascalCase` (TenantManager, FileDataSource, DataSource)
- Functions: `camelCase` (loadUserInfo, verifyCredentials, buildBarChart)
- Async functions: `async function methodName()`
- Variables: `camelCase` (dataSourceId, currentTable, isQuerying)
- Private methods: `_methodName()` (e.g., `_detectColumnTypes()`)
- Constants: `UPPERCASE` (SALT_ROUNDS, DANGEROUS_KEYWORDS, CHART_COLORS)

### Frontend
- Element IDs: `camelCase` (uploadSection, queryInput, chartContainer)
- CSS Classes: `kebab-case` (app-header, upload-section, query-response)
- Component state: `camelCase` (isQuerying, currentTable, currentSQL)

### API
- Routes: `/api/{resource}` or `/api/{resource}/{id}/{subresource}`
- Query params: `snake_case` (page, limit, sheet)
- Error response: `{ error: true, errorType: 'code', message: 'text' }`
- Success response: `{ success: true, data: {...} }`

---

## ECharts Theme

### Theme Name
`feather-dark` - registered globally at app load

### Theme Registration Location
`views/app.html` line ~1886:
```javascript
echarts.registerTheme('feather-dark', { ... });
```

### Theme Initialization
```javascript
chartInstance = echarts.init(chartWrapper, 'feather-dark');
```

### Color Palette (CHART_COLORS)
```javascript
const CHART_COLORS = [
  '#00d4ff', // Electric cyan - primary
  '#a78bfa', // Soft violet
  '#34d399', // Mint green
  '#f59e0b', // Warm amber
  '#f472b6', // Soft pink
  '#60a5fa', // Sky blue
  '#fbbf24', // Gold
  '#c084fc', // Lavender
];
```

### CSS Design Variables
```css
--bg-primary: #0a0a0f        /* dark background */
--bg-secondary: #111118      /* darker */
--bg-card: #16161f           /* card background */
--bg-hover: #1c1c28
--border: #232330
--text-primary: #e8e8f0      /* light text */
--text-secondary: #8888a0    /* muted */
--text-muted: #555568        /* very muted */
--accent: #5b7cfa            /* blue */
--accent-bright: #7b9aff
--accent-glow: rgba(91, 124, 250, 0.15)
--gradient-start: #5b7cfa
--gradient-end: #c084fc      /* purple */
--success: #34d399
--error: #f87171
--warning: #fbbf24
--font-display: 'Instrument Serif'
--font-body: 'DM Sans'
--font-mono: 'JetBrains Mono'
```

---

## Anthropic API Integration Pattern

### Location
`lib/nlquery.js`

### Model
`claude-sonnet-4-20250514`

### Configuration
```javascript
const anthropic = new Anthropic({ apiKey });
const message = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1500,
  temperature: 0,  // deterministic output
  system: systemPrompt,
  messages: [{ role: 'user', content: question }]
});
```

### Context Gathering Flow
1. `FileDataSource.gatherSchemaContext()` builds rich schema text:
   - Table names with row counts
   - Column metadata (type, nullable, primary key)
   - Cardinality (distinct value counts)
   - Sample values (first 5 distinct)
   - Min/max ranges for numeric columns
   - Date range detection
   - Potential foreign key relationships

2. Schema context injected into system prompt via `{schema_context}` placeholder

### Response Format (Claude's output)
```
EXPLANATION:
[1-3 sentences explaining interpretation and approach]

ASSUMPTIONS:
[Any assumptions made, or "None"]

SQL:
```sql
[SQLite-compatible SELECT query]
```

VISUALIZATION:
[Chart recommendation with reasoning]

VISUALIZATION_TYPE:
[single type: table|bar_chart|line_chart|pie_chart|scatter_plot|area_chart|heatmap|single_number|grouped_bar_chart]
```

### SQL Validation
- Blocked keywords: DELETE, UPDATE, INSERT, DROP, ALTER, CREATE, TRUNCATE, GRANT, REVOKE, EXEC, EXECUTE
- Only SELECT and WITH (CTEs) allowed
- No multiple statements (semicolon only at end)
- Results limited to 1000 rows

### Error Types
| Type | Meaning |
|------|---------|
| `no_data` | No tables found in tenant database |
| `configuration_error` | Missing ANTHROPIC_API_KEY |
| `api_error` | Claude API call failed |
| `sql_validation_error` | Generated SQL contains forbidden keywords |
| `timeout_error` | Query exceeded 30-second limit |
| `sql_execution_error` | SQLite execution error |

---

## Multi-Tenant Architecture

### Tenant Isolation

Each tenant's data is isolated through:

1. **Database-level**: All tables use `tenant_id` foreign key
2. **File-level**: Each tenant's FileDataSource uses separate SQLite DB
   - Production: `/var/data/tenants/{tenantId}/data.db`
   - Development: `./data/tenants/{tenantId}/data.db`
3. **Middleware-level**: `requireTenant` validates tenant context
4. **Data source validation**: `getDataSourceInstance()` verifies `dsRecord.tenant_id === tenantId`

### Core Concepts

| Entity | Description |
|--------|-------------|
| Tenant | Organization using Affix, fully isolated |
| User | Belongs to exactly one tenant, has role |
| Project | Organizes data sources within a tenant; every tenant gets a default project |
| Data Source | Per-tenant data storage (currently FileDataSource) |

### Default Project Creation

Every tenant automatically gets a default project called "My First Project" created:
- **On tenant creation**: When a new tenant is created via `/api/tenants`
- **On first login**: When a user with an existing tenant logs in (via `requireAuth` middleware)
- **On seed**: When the default user/tenant is seeded on first startup

The default project:
- Has `is_default = 1` in the database
- Cannot be deleted
- Is used for file uploads when no specific project is specified
- Serves as the initial landing project for new users

### User Roles
| Role | Permissions |
|------|-------------|
| `owner` | Full tenant control, can delete tenant, manage billing |
| `admin` | Manage team, invite users, manage data sources and projects |
| `editor` | Create/edit projects, queries, dashboards. Cannot manage users |
| `viewer` | View projects and dashboards, ask queries. Cannot edit or delete |
| `member` | Legacy role, equivalent to viewer |

---

## Database Schema (Main SQLite)

### tenants
```sql
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,              -- UUID
  name TEXT NOT NULL,               -- Display name
  slug TEXT UNIQUE NOT NULL,        -- URL-safe identifier
  plan TEXT DEFAULT 'free',         -- Subscription tier
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  settings TEXT DEFAULT '{}'        -- JSON blob
);
```

### users
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,      -- bcrypt, 12 salt rounds
  name TEXT NOT NULL,
  tenant_id TEXT REFERENCES tenants(id),
  role TEXT DEFAULT 'member',       -- 'owner', 'admin', 'editor', 'viewer', 'member'
  invited_by INTEGER REFERENCES users(id),
  last_active_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME
);
```

### tenant_data_sources
```sql
CREATE TABLE tenant_data_sources (
  id TEXT PRIMARY KEY,              -- UUID
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,               -- 'file', 'cloud', 'gateway'
  config TEXT NOT NULL,             -- JSON: { tenantId, type, ... }
  is_default INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, name)
);
```

### sessions
```sql
CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,               -- Serialized session JSON
  expired DATETIME NOT NULL
);
```

### projects
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,              -- UUID
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,                        -- Emoji or icon name
  color TEXT,                       -- Hex color for accent
  is_default INTEGER DEFAULT 0,     -- Every tenant gets one default project
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### data_sources (extended file tracking)
```sql
CREATE TABLE data_sources (
  id TEXT PRIMARY KEY,              -- UUID
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,               -- User-friendly name
  original_filename TEXT,           -- Original uploaded filename
  file_type TEXT,                   -- 'csv', 'xlsx', 'tsv'
  row_count INTEGER,
  column_count INTEGER,
  size_bytes INTEGER,
  schema_snapshot TEXT,             -- JSON: cached column names, types, samples
  status TEXT DEFAULT 'processing', -- 'processing', 'ready', 'error'
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### queries (NL query history)
```sql
CREATE TABLE queries (
  id TEXT PRIMARY KEY,              -- UUID
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question TEXT NOT NULL,           -- User's natural language question
  sql_generated TEXT,
  explanation TEXT,
  assumptions TEXT,
  visualization_type TEXT,
  visualization_config TEXT,        -- JSON: full ECharts config
  result_summary TEXT,              -- JSON: row_count, column_names, first 5 rows
  execution_time_ms INTEGER,
  status TEXT DEFAULT 'success',    -- 'success', 'error', 'timeout'
  error_message TEXT,
  is_pinned INTEGER DEFAULT 0,
  pin_title TEXT,                   -- User can rename pinned chart
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### dashboards
```sql
CREATE TABLE dashboards (
  id TEXT PRIMARY KEY,              -- UUID
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  layout TEXT,                      -- JSON: grid layout config
  is_pinned INTEGER DEFAULT 0,
  share_token TEXT,                 -- Public sharing token
  is_public INTEGER DEFAULT 0,      -- 1 if publicly shared
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### invite_tokens
```sql
CREATE TABLE invite_tokens (
  id TEXT PRIMARY KEY,              -- UUID
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  token TEXT UNIQUE NOT NULL,
  invited_by INTEGER NOT NULL REFERENCES users(id),
  expires_at DATETIME NOT NULL,
  used INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### dashboard_widgets
```sql
CREATE TABLE dashboard_widgets (
  id TEXT PRIMARY KEY,              -- UUID
  dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  query_id TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  widget_type TEXT NOT NULL,        -- 'chart', 'single_number', 'insight_card', 'table'
  position TEXT,                    -- JSON: {x, y, w, h} grid coordinates
  config_overrides TEXT,            -- JSON: user tweaks to default config
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### insights (AI-generated)
```sql
CREATE TABLE insights (
  id TEXT PRIMARY KEY,              -- UUID
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  query_id TEXT REFERENCES queries(id) ON DELETE SET NULL,
  insight_type TEXT NOT NULL,       -- 'anomaly', 'trend', 'opportunity', 'warning', 'correlation'
  title TEXT NOT NULL,              -- Short headline
  description TEXT,                 -- 2-3 sentence AI explanation
  severity TEXT DEFAULT 'info',     -- 'info', 'warning', 'critical', 'opportunity'
  data_evidence TEXT,               -- JSON: specific numbers/rows supporting insight
  is_dismissed INTEGER DEFAULT 0,
  source TEXT,                      -- 'auto_chart', 'background_analysis', 'user_query'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### credits_usage
```sql
CREATE TABLE credits_usage (
  id TEXT PRIMARY KEY,              -- UUID
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month DATE NOT NULL,              -- First of month for budget tracking
  credits_allocated REAL DEFAULT 0, -- $ worth of API credits
  credits_used REAL DEFAULT 0,      -- Running total
  query_count INTEGER DEFAULT 0,
  background_analysis_count INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, month)
);
```

### background_jobs
```sql
CREATE TABLE background_jobs (
  id TEXT PRIMARY KEY,              -- UUID
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued', -- 'queued', 'running', 'completed', 'paused_credits', 'failed'
  total_questions_planned INTEGER DEFAULT 0,
  questions_completed INTEGER DEFAULT 0,
  credits_used REAL DEFAULT 0,
  credits_budget REAL DEFAULT 2.00, -- Max credits this job may spend
  findings TEXT DEFAULT '[]',       -- JSON array of findings
  executive_summary TEXT,           -- AI-generated summary
  error_message TEXT,
  started_at DATETIME,
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Indexes
```sql
-- Core tables
CREATE INDEX idx_sessions_expired ON sessions(expired);
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_data_sources_tenant ON tenant_data_sources(tenant_id);
CREATE INDEX idx_tenants_slug ON tenants(slug);

-- Projects
CREATE INDEX idx_projects_tenant ON projects(tenant_id);
CREATE INDEX idx_projects_default ON projects(tenant_id, is_default);

-- Data Sources (new)
CREATE INDEX idx_data_sources_project ON data_sources(project_id);
CREATE INDEX idx_data_sources_tenant_new ON data_sources(tenant_id);
CREATE INDEX idx_data_sources_status ON data_sources(status);

-- Queries
CREATE INDEX idx_queries_project ON queries(project_id);
CREATE INDEX idx_queries_tenant ON queries(tenant_id);
CREATE INDEX idx_queries_pinned ON queries(is_pinned);
CREATE INDEX idx_queries_created ON queries(created_at);

-- Dashboards
CREATE INDEX idx_dashboards_project ON dashboards(project_id);
CREATE INDEX idx_dashboards_tenant ON dashboards(tenant_id);

-- Widgets
CREATE INDEX idx_widgets_dashboard ON dashboard_widgets(dashboard_id);
CREATE INDEX idx_widgets_query ON dashboard_widgets(query_id);

-- Insights
CREATE INDEX idx_insights_project ON insights(project_id);
CREATE INDEX idx_insights_tenant ON insights(tenant_id);
CREATE INDEX idx_insights_query ON insights(query_id);
CREATE INDEX idx_insights_dismissed ON insights(is_dismissed);
CREATE INDEX idx_insights_type ON insights(insight_type);

-- Credits
CREATE INDEX idx_credits_tenant ON credits_usage(tenant_id);
CREATE INDEX idx_credits_month ON credits_usage(month);

-- Background jobs
CREATE INDEX idx_background_jobs_tenant ON background_jobs(tenant_id);
CREATE INDEX idx_background_jobs_project ON background_jobs(project_id);
CREATE INDEX idx_background_jobs_status ON background_jobs(status);
```

---

## API Endpoints

### Authentication
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/login` | — | Login page |
| POST | `/auth/login` | — | Authenticate user |
| POST | `/auth/logout` | ✓ | Destroy session |
| GET | `/auth/me` | ✓ | Get current user + tenant info |

### Tenants
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/tenants` | ✓ | Create tenant (signup) |
| GET | `/api/tenant` | ✓ | Get current tenant |
| PATCH | `/api/tenant` | ✓ owner/admin | Update tenant settings |

### Projects
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/projects` | ✓ | List all projects for tenant |
| POST | `/api/projects` | ✓ owner/admin | Create a new project |
| PUT | `/api/projects/:id` | ✓ owner/admin | Update project name/description/icon/color |
| DELETE | `/api/projects/:id` | ✓ owner/admin | Delete project and all its data |
| GET | `/api/projects/:id/summary` | ✓ | Get project overview (counts, latest activity) |
| POST | `/api/projects/:id/upload` | ✓ owner/admin | Upload file to project |
| GET | `/api/projects/:id/sources` | ✓ | List data sources in project |
| POST | `/api/projects/:id/query` | ✓ | Ask NL question about project data |
| GET | `/api/projects/:id/queries` | ✓ | List query history for project (paginated) |
| GET | `/api/projects/:id/dashboards` | ✓ | List dashboards in project |
| POST | `/api/projects/:id/dashboards` | ✓ | Create new dashboard in project |
| GET | `/api/projects/:id/dashboard-suggestions` | ✓ | Get AI-suggested dashboard prompts |
| POST | `/api/projects/:id/generate-dashboard` | ✓ | Auto-generate dashboard from description |
| POST | `/api/projects/from-template` | ✓ owner/admin | Create project from template |
| POST | `/api/projects/:id/column-mappings` | ✓ | Suggest column mappings for template |

### Data Sources (Legacy endpoints - still supported)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/datasources` | ✓ | List tenant's data sources |
| POST | `/api/datasources` | ✓ owner/admin | Create data source |
| POST | `/api/datasources/:id/query` | ✓ | Execute SQL |
| GET | `/api/datasources/:id/schema` | ✓ | Get tables/views |
| GET | `/api/datasources/:id/tables` | ✓ | List tables |
| GET | `/api/datasources/:id/tables/:table/columns` | ✓ | Get column metadata |
| GET | `/api/datasources/:id/tables/:table/data` | ✓ | Paginated table data |
| POST | `/api/datasources/:id/upload` | ✓ owner/admin | Upload CSV/Excel/JSON |
| DELETE | `/api/datasources/:id/tables/:table` | ✓ owner/admin | Drop table |
| DELETE | `/api/sources/:id` | ✓ owner/admin | Delete a data source |

### Queries
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| PUT | `/api/queries/:id/pin` | ✓ | Toggle pin status, optionally set pin_title |
| GET | `/api/queries/pinned` | ✓ | Get all pinned queries across all projects |

### Dashboards
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| PUT | `/api/dashboards/:id` | ✓ | Update dashboard name/description/layout |
| DELETE | `/api/dashboards/:id` | ✓ | Delete a dashboard |
| POST | `/api/dashboards/:id/widgets` | ✓ | Add a widget to dashboard (from pinned query) |
| POST | `/api/dashboards/:id/execute-widget` | ✓ | Execute widget question and add to dashboard |

### Dashboard Widgets
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| PUT | `/api/widgets/:id` | ✓ | Update widget position or config |
| DELETE | `/api/widgets/:id` | ✓ | Remove a widget from dashboard |

### Natural Language Query (Legacy - use project-scoped endpoint)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/query` | ✓ | Ask question in natural language |

### Background Analysis
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/projects/:id/background-analysis` | ✓ | Start background analysis job (async) |
| GET | `/api/background-jobs/active` | ✓ | Get all active jobs for tenant |
| GET | `/api/background-jobs/recent` | ✓ | Get recently completed jobs |
| GET | `/api/background-jobs/:id` | ✓ | Get job status and findings |
| GET | `/api/background-jobs/:id/queries` | ✓ | Get queries generated by job |
| POST | `/api/background-jobs/:id/cancel` | ✓ | Cancel a running job |
| GET | `/api/projects/:id/background-jobs` | ✓ | List all jobs for a project |

### Credits
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/credits` | ✓ | Get current month's credit usage |
| PUT | `/api/credits/budget` | ✓ owner/admin | Set monthly credit budget |

### Team
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/team` | ✓ | List users in tenant |
| POST | `/api/team/invite` | ✓ owner/admin | Create user in tenant |
| PUT | `/api/team/:userId/role` | ✓ owner/admin | Change user role |
| DELETE | `/api/team/:userId` | ✓ owner/admin | Remove user from tenant |

### Dashboard Sharing
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| PUT | `/api/dashboards/:id/share` | ✓ | Toggle public sharing, get share URLs |
| GET | `/public/dashboards/:shareToken` | — | View public dashboard (no auth) |
| GET | `/embed/dashboards/:shareToken` | — | Embed dashboard (minimal chrome, no auth) |

### Project Templates
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/templates` | ✓ | Get all available project templates |
| GET | `/api/templates/:id` | ✓ | Get specific template details |

### Settings
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/settings` | ✓ | Settings page with team, billing, profile tabs |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | development | 'production' or 'development' |
| `PORT` | No | 3000 | Server port |
| `SESSION_SECRET` | Yes* | Generated | Session signing secret |
| `PERSISTENT_DISK_PATH` | No | /var/data | Base path for persistent storage |
| `DEFAULT_USER_EMAIL` | No | — | Email for seed user |
| `DEFAULT_USER_PASSWORD` | No | — | Password for seed user |
| `DEFAULT_USER_NAME` | No | — | Name for seed user |
| `ANTHROPIC_API_KEY` | Yes | — | Claude API key (required for NL queries) |

*Generated automatically if not set, but should be set in production for session persistence across restarts.

---

## Development Workflow

**No local development required.** Push changes directly to GitHub and test on the live Render-hosted site at useaffix.ai. Render auto-deploys on push to main.

### Running Locally (Optional)
```bash
# Install dependencies
npm install

# Start server
npm start

# Server runs at:
#   Main site: http://localhost:3000
#   App: http://localhost:3000/app
#   Login: http://localhost:3000/login
```

### Create User CLI
```bash
npm run create-user
```

---

## Testing Commands

Currently no automated tests. Manual testing:

1. **Upload Flow**: Go to `/app`, upload a CSV file
2. **Query Flow**: Type a natural language question, verify chart renders
3. **Auth Flow**: Login at `/login`, verify session persists

---

## Deployment (Render)

- Auto-deploys from GitHub on push to main
- Uses persistent disk at `/var/data`
- Database at `/var/data/affix.db`
- Tenant data at `/var/data/tenants/`
- Trust proxy enabled for secure cookies behind reverse proxy
- npm install runs automatically (installs native modules)

---

## Data Source Abstraction

### Interface (DataSource.js)
```javascript
class DataSource {
  async connect()               // Connect to the data source
  async disconnect()            // Disconnect
  async execute(sql, params)    // Execute SQL, returns {rows, columns}
  async getSchema()             // Get {tables, views}
  async getTables()             // Get table names
  async getColumns(table)       // Get column metadata
  isConnected()                 // Check connection status
  getType()                     // Get data source type ('file', 'cloud', 'gateway')
}
```

### Implementations

| Type | Status | Description |
|------|--------|-------------|
| FileDataSource | ✅ Implemented | SQLite per tenant, supports CSV/Excel/JSON import |
| CloudDBDataSource | 🔲 Placeholder | PostgreSQL, MySQL, SQL Server direct connections |
| GatewayDataSource | 🔲 Placeholder | Tunneled connections for firewalled databases |

### FileDataSource Features
- Auto-creates tenant directory
- Supports: CSV, JSON, Excel (.xlsx/.xls)
- Auto-detects column types (INTEGER, REAL, TEXT)
- CSV parser handles quoted fields & escaped quotes
- Transaction-based bulk inserts
- Column name sanitization
- Rich `gatherSchemaContext()` for AI queries

---

## Background Analysis System

The background analysis feature allows users to trigger an autonomous AI exploration of their data.

### How It Works

1. **User triggers analysis**: Clicks "Run Background Analysis" button on project page
2. **Credit check**: System verifies tenant has at least $0.50 in remaining credits
3. **Plan generation**: Claude generates 10 analytical questions based on schema context
4. **Sequential execution**: Each question is executed through the NL query pipeline
5. **Insight generation**: Insights are generated for each successful query
6. **Summary**: An executive summary is generated from all insights

### Job States
| Status | Description |
|--------|-------------|
| `queued` | Job created, waiting to start |
| `running` | Actively executing queries |
| `completed` | All questions processed successfully |
| `paused_credits` | Stopped due to budget exhaustion |
| `failed` | Error occurred during execution |

### Credit Tracking
- Each API call's token usage is tracked
- Cost calculated using Claude Sonnet pricing ($3/M input, $15/M output)
- Credits deducted from monthly allocation
- Jobs pause automatically when budget is exhausted

### Files
- `lib/backgroundAnalysis.js` - Core job execution logic
- `lib/api-usage.js` - Credit tracking utilities

---

## Visualization Types

| Type | Description |
|------|-------------|
| `table` | Enhanced data table with pagination |
| `bar_chart` | Vertical bars (horizontal if labels > 15 chars) |
| `grouped_bar_chart` | Multi-series grouped bars |
| `line_chart` | Line plot with smooth curves |
| `area_chart` | Stacked area chart |
| `pie_chart` | Pie/donut chart with center label |
| `scatter_plot` | X-Y scatter with optional size dimension |
| `heatmap` | 2D grid heatmap |
| `single_number` | Large KPI metric display |

---

## Security

### Authentication
- Session-based with bcrypt password hashing (12 rounds)
- Cookie: `affix.sid`, httpOnly, secure in production, 7-day expiry
- Custom SQLiteStore for session persistence

### Headers (Helmet)
```javascript
contentSecurityPolicy: {
  defaultSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "https://fonts.gstatic.com"],
  scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
  imgSrc: ["'self'", "data:", "https:"],
}
```

### SQL Injection Prevention
- Parameterized queries for user input
- Column/table validation against schema
- Blocked dangerous SQL keywords in NL query

---

## AI-Generated Dashboards

The platform includes an AI-powered dashboard generation system that can create complete dashboards from natural language descriptions.

### How It Works

1. **User describes dashboard**: Users provide a text description of what they want (e.g., "A sales overview showing revenue trends and top products")
2. **AI generates specification**: Claude analyzes the data schema and creates a dashboard spec with 4-8 widgets
3. **Automatic execution**: Each widget's question is executed through the NL query pipeline
4. **Layout assignment**: Widgets are automatically positioned in a balanced grid layout
5. **Insight generation**: AI insights are generated for each widget

### Dashboard Generation Flow

```javascript
// User clicks "Auto-Generate Dashboard"
// → Modal opens with suggested prompts
// → User enters description or selects suggestion
// → Backend generates spec with widget questions
// → Each widget is executed sequentially
// → Dashboard is created and populated
```

### Widget Placement Algorithm

The system uses a smart grid layout algorithm:
- Grid is 12 columns wide
- Widget sizes: `small` (3 cols), `medium` (6 cols), `large` (6 cols), `full_width` (12 cols)
- Position hints guide placement: `top_left`, `top_center`, `top_right`, etc.
- KPI widgets (single_number) are typically small and placed at top
- Charts are medium to large
- Layout aims for visual balance

### Dashboard Regeneration

Dashboards created via auto-generation can be regenerated:
- Original prompt is stored in `dashboards.auto_generation_prompt`
- "Regenerate" button appears for auto-generated dashboards
- User can modify the prompt and regenerate with new widgets
- New widgets are added alongside existing ones (not replaced)

---

## Project Templates

The platform includes pre-configured templates for common use cases:

### Available Templates

1. **Sales Analytics** (`sales-analytics`)
   - Icon: 📊, Color: #5b7cfa
   - Dashboard: Revenue KPIs, top products, trends, regional breakdown
   - Expected columns: revenue, date, customer, product, region

2. **Inventory Management** (`inventory-management`)
   - Icon: 📦, Color: #34d399
   - Dashboard: Stock levels, low stock alerts, turnover rates
   - Expected columns: stock, product, cost, supplier, category

3. **Customer Intelligence** (`customer-intelligence`)
   - Icon: 👥, Color: #c084fc
   - Dashboard: Customer LTV, segmentation, retention metrics
   - Expected columns: customer, value, segment, status

4. **Financial Overview** (`financial-overview`)
   - Icon: 💰, Color: #f59e0b
   - Dashboard: Revenue vs expenses, profit margins, budget tracking
   - Expected columns: revenue, expenses, category, date

5. **Marketing Performance** (`marketing-performance`)
   - Icon: 📈, Color: #f472b6
   - Dashboard: Campaign ROI, conversion funnel, channel comparison
   - Expected columns: campaign, channel, spend, conversions

6. **Blank Project** (`blank`)
   - Icon: 🔧, Color: #8888a0
   - No pre-configured dashboard or suggestions

### Template Features

- **Suggested questions**: Each template includes 6-8 suggested NL questions
- **Default dashboard prompt**: Templates can auto-generate a starter dashboard
- **Column mapping**: Smart column name matching to template expectations
- **Auto-generation offer**: After creating project from template, user is prompted to auto-generate the default dashboard

### Template Data Structure

Templates are defined in `lib/projectTemplates.js`:

```javascript
{
  id: 'sales-analytics',
  name: 'Sales Analytics',
  icon: '📊',
  description: 'Track revenue, customers, and product performance',
  color: '#5b7cfa',
  defaultDashboardPrompt: 'Create a sales overview dashboard...',
  suggestedQuestions: [ ... ],
  expectedColumns: {
    revenue: ['revenue', 'sales', 'amount', ...],
    date: ['date', 'order_date', ...],
    ...
  }
}
```

---

## Files Added in Phase 11

- `lib/dashboardGenerator.js` - AI dashboard generation logic
- `lib/projectTemplates.js` - Project template definitions

### Database Schema Changes

**dashboards table:**
- Added `auto_generation_prompt TEXT` - Stores original prompt for regeneration

**projects table:**
- Added `template_id TEXT` - References which template was used

---

## Agent Pipeline Context

This project uses an automated multi-agent pipeline:

- Check `.agent-state/phase-history.json` for completed phases
- Check `.agent-state/test-results.json` for latest test status
- Commits from the pipeline use `[phase-N]` prefix format
- If you see TODOs from previous phases, address them

---

## TODO / Future Work

1. **Google OAuth** - Add as alternative login method
2. **DuckDB support** - For analytics workloads on FileDataSource
3. **CloudDBDataSource** - Implement Postgres, MySQL, SQL Server
4. **GatewayDataSource** - Build gateway agent infrastructure
5. **Onboarding flow** - UI for creating tenant after signup
6. **Billing integration** - Stripe for subscription management
7. **Query history** - Save and recall previous questions
8. **Rate limiting** - Control AI API costs
9. **Projects** - Organize data sources into projects
10. **Dashboards** - Save and share chart collections
