# Affix Project

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

## Architecture Overview

Affix is a multi-tenant BI platform with:
- Express.js backend
- SQLite database (better-sqlite3)
- Session-based authentication
- Tenant isolation with separate data stores

### Directory Structure
```
affix/
├── index.js                    # Main Express server with all routes
├── package.json
├── db/
│   ├── init.js                # Database initialization (creates all tables)
│   ├── seed.js                # Default user seeding
│   └── affix.db               # SQLite database (dev) - DO NOT COMMIT
├── lib/
│   ├── datasources/           # Data source abstraction layer
│   │   ├── DataSource.js      # Abstract base class
│   │   ├── FileDataSource.js  # SQLite-based local data source
│   │   ├── CloudDBDataSource.js   # Direct cloud DB connection (placeholder)
│   │   ├── GatewayDataSource.js   # Tunneled connection (placeholder)
│   │   └── index.js           # Exports all data sources
│   └── tenant/
│       ├── TenantManager.js   # Tenant CRUD and data source management
│       └── index.js
├── middleware/
│   ├── auth.js                # Authentication middleware
│   └── session-store.js       # Custom SQLite session store
├── views/
│   ├── login.html             # Login page
│   └── app.html               # Dashboard
├── scripts/
│   └── create-user.js         # CLI to create users
└── index.html                 # Landing page
```

---

## Multi-Tenant Architecture

### Core Concepts

1. **Tenants**: Organizations that use Affix. Each tenant is isolated.
2. **Users**: Belong to exactly one tenant, have roles (owner, admin, member)
3. **Data Sources**: Each tenant can have multiple data sources (file-based, cloud DB, or gateway)

### Database Schema

**tenants** - Organization records
- `id` (TEXT, PK): UUID
- `name` (TEXT): Display name
- `slug` (TEXT, UNIQUE): URL-safe identifier
- `plan` (TEXT): Subscription plan (free, pro, enterprise)
- `settings` (TEXT): JSON blob for tenant settings

**users** - User accounts
- `id` (INTEGER, PK): Auto-increment
- `email` (TEXT, UNIQUE): Login email
- `password_hash` (TEXT): bcrypt hash
- `name` (TEXT): Display name
- `tenant_id` (TEXT, FK): References tenants.id
- `role` (TEXT): 'owner', 'admin', or 'member'

**tenant_data_sources** - Data source configurations per tenant
- `id` (TEXT, PK): UUID
- `tenant_id` (TEXT, FK): References tenants.id
- `name` (TEXT): Display name
- `type` (TEXT): 'file', 'cloud', or 'gateway'
- `config` (TEXT): JSON configuration
- `is_default` (INTEGER): 1 if this is the default data source

**sessions** - Express session storage
- `sid` (TEXT, PK): Session ID
- `sess` (TEXT): Serialized session data
- `expired` (DATETIME): Expiration timestamp

### Tenant Isolation

Each tenant's data is isolated through:
1. **Database-level**: tenant_id foreign key on all tenant-specific data
2. **File-level**: Each tenant's FileDataSource uses a separate SQLite database at `/var/data/tenants/{tenantId}/data.db`
3. **Middleware**: `requireTenant` middleware ensures tenant context exists

---

## Data Source Abstraction

All data sources implement the `DataSource` interface:

```javascript
class DataSource {
  async connect()           // Connect to the data source
  async disconnect()        // Disconnect
  async execute(sql, params) // Execute SQL, returns {rows, columns}
  async getSchema()         // Get {tables, views}
  async getTables()         // Get table names
  async getColumns(table)   // Get column metadata for a table
  isConnected()             // Check connection status
  getType()                 // Get data source type
}
```

### Data Source Types

1. **FileDataSource** (IMPLEMENTED)
   - Uses SQLite (better-sqlite3) for each tenant
   - Stored at `/var/data/tenants/{tenantId}/data.db` in production
   - Supports CSV and JSON file imports
   - Can be extended to DuckDB for analytics

2. **CloudDBDataSource** (PLACEHOLDER)
   - Direct connections to PostgreSQL, MySQL, SQL Server
   - Needs database drivers (pg, mysql2, mssql)

3. **GatewayDataSource** (PLACEHOLDER)
   - Tunneled connections for firewalled databases
   - Requires gateway infrastructure to be built

---

## Authentication Flow

1. User visits `/login`
2. Submits email/password to `POST /auth/login`
3. Server validates via `verifyCredentials()`, creates session
4. Session stored in SQLite via custom `SQLiteStore`
5. Cookie `affix.sid` set with 7-day expiry
6. `requireAuth` middleware validates session on protected routes
7. Logout via `POST /auth/logout` destroys session and clears cookie

### User Roles
- **owner**: Full tenant control, can delete tenant
- **admin**: Can manage team and data sources
- **member**: Read-only access to data

---

## API Endpoints

### Auth
- `GET /login` - Login page
- `POST /auth/login` - Authenticate user
- `POST /auth/logout` - Logout user
- `GET /auth/me` - Get current user with tenant info

### Tenants
- `POST /api/tenants` - Create tenant (signup flow)
- `GET /api/tenant` - Get current user's tenant
- `PATCH /api/tenant` - Update tenant settings (owner/admin only)

### Data Sources
- `GET /api/datasources` - List tenant's data sources
- `POST /api/datasources` - Create data source
- `POST /api/datasources/:id/query` - Execute SQL query
- `GET /api/datasources/:id/schema` - Get schema (tables/views)
- `GET /api/datasources/:id/tables` - List tables
- `GET /api/datasources/:id/tables/:table/columns` - Get column info

### Team
- `GET /api/team` - List users in tenant
- `POST /api/team/invite` - Create user in tenant (owner/admin only)

---

## Environment Variables

- `NODE_ENV` - 'production' or 'development'
- `PORT` - Server port (default: 3000)
- `SESSION_SECRET` - Session signing secret
- `PERSISTENT_DISK_PATH` - Base path for persistent storage (default: /var/data)
- `DEFAULT_USER_EMAIL` - Email for default seeded user
- `DEFAULT_USER_PASSWORD` - Password for default seeded user
- `DEFAULT_USER_NAME` - Name for default seeded user

---

## Development Workflow

**No local development required.** Push changes directly to GitHub and test on the live Render-hosted site at useaffix.ai. Render auto-deploys on push to main.

## Deployment (Render)

- Auto-deploys from GitHub on push to main
- Uses persistent disk at `/var/data`
- Database at `/var/data/affix.db`
- Tenant data at `/var/data/tenants/`
- Trust proxy enabled for secure cookies behind reverse proxy
- npm install runs automatically on deploy (installs all dependencies including native modules like DuckDB)

---

## TODO / Future Work

1. **Google OAuth** - Add as alternative login method
2. **DuckDB support** - For analytics workloads on FileDataSource
3. **CloudDBDataSource** - Implement Postgres, MySQL, SQL Server
4. **GatewayDataSource** - Build gateway agent infrastructure
5. **File uploads** - Allow CSV/JSON upload through API
6. **Onboarding flow** - UI for creating tenant after signup
7. **Billing integration** - Stripe for subscription management
