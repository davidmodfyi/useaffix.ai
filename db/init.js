const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

// Use persistent disk in production, local db folder in development
const isProduction = process.env.NODE_ENV === 'production';
const PERSISTENT_DISK_PATH = process.env.PERSISTENT_DISK_PATH || '/var/data';

let dbPath;
if (isProduction) {
  // Ensure the persistent disk directory exists
  if (!fs.existsSync(PERSISTENT_DISK_PATH)) {
    fs.mkdirSync(PERSISTENT_DISK_PATH, { recursive: true });
  }
  dbPath = path.join(PERSISTENT_DISK_PATH, 'affix.db');
} else {
  dbPath = path.join(__dirname, 'affix.db');
}

console.log(`Database path: ${dbPath}`);
const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// ============================================
// Core Tables
// ============================================

// Tenants table (multi-tenancy)
db.exec(`
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    plan TEXT DEFAULT 'free',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    settings TEXT DEFAULT '{}'
  )
`);

// Create users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    tenant_id TEXT REFERENCES tenants(id),
    role TEXT DEFAULT 'member',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
  )
`);

// Add tenant_id column if missing (for existing databases)
try {
  const columns = db.prepare(`PRAGMA table_info(users)`).all();
  const hasTenantId = columns.some(col => col.name === 'tenant_id');
  if (!hasTenantId) {
    db.exec(`ALTER TABLE users ADD COLUMN tenant_id TEXT REFERENCES tenants(id)`);
  }
  const hasRole = columns.some(col => col.name === 'role');
  if (!hasRole) {
    db.exec(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'member'`);
  }
  const hasInvitedBy = columns.some(col => col.name === 'invited_by');
  if (!hasInvitedBy) {
    db.exec(`ALTER TABLE users ADD COLUMN invited_by INTEGER REFERENCES users(id)`);
  }
  const hasLastActiveAt = columns.some(col => col.name === 'last_active_at');
  if (!hasLastActiveAt) {
    db.exec(`ALTER TABLE users ADD COLUMN last_active_at DATETIME`);
  }
} catch (err) {
  // Table might not exist yet, that's fine
}

// Tenant data sources table
db.exec(`
  CREATE TABLE IF NOT EXISTS tenant_data_sources (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config TEXT NOT NULL,
    is_default INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, name)
  )
`);

// Create sessions table for persistent sessions
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired DATETIME NOT NULL
  )
`);

// ============================================
// Projects Table
// ============================================
// Projects organize data sources within a tenant

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    color TEXT,
    is_default INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ============================================
// Data Sources Table (extended)
// ============================================
// Tracks uploaded files and their metadata per project

db.exec(`
  CREATE TABLE IF NOT EXISTS data_sources (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    original_filename TEXT,
    file_type TEXT,
    row_count INTEGER,
    column_count INTEGER,
    size_bytes INTEGER,
    schema_snapshot TEXT,
    status TEXT DEFAULT 'processing',
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ============================================
// Queries Table
// ============================================
// History of every natural language query

db.exec(`
  CREATE TABLE IF NOT EXISTS queries (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    sql_generated TEXT,
    explanation TEXT,
    assumptions TEXT,
    visualization_type TEXT,
    visualization_config TEXT,
    result_summary TEXT,
    execution_time_ms INTEGER,
    status TEXT DEFAULT 'success',
    error_message TEXT,
    is_pinned INTEGER DEFAULT 0,
    pin_title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ============================================
// Dashboards Table
// ============================================
// User-created dashboards containing pinned charts

db.exec(`
  CREATE TABLE IF NOT EXISTS dashboards (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    layout TEXT,
    is_pinned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ============================================
// Dashboard Widgets Table
// ============================================
// Individual widgets within a dashboard

db.exec(`
  CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id TEXT PRIMARY KEY,
    dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    query_id TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
    widget_type TEXT NOT NULL,
    position TEXT,
    config_overrides TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ============================================
// Insights Table
// ============================================
// AI-generated business insights

db.exec(`
  CREATE TABLE IF NOT EXISTS insights (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    query_id TEXT REFERENCES queries(id) ON DELETE SET NULL,
    insight_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    severity TEXT DEFAULT 'info',
    data_evidence TEXT,
    is_dismissed INTEGER DEFAULT 0,
    source TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ============================================
// Credits/Usage Table
// ============================================
// Track API usage and costs per tenant per month

db.exec(`
  CREATE TABLE IF NOT EXISTS credits_usage (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    month DATE NOT NULL,
    credits_allocated REAL DEFAULT 0,
    credits_used REAL DEFAULT 0,
    query_count INTEGER DEFAULT 0,
    background_analysis_count INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, month)
  )
`);

// ============================================
// Background Jobs Table
// ============================================
// Tracks background analysis jobs

db.exec(`
  CREATE TABLE IF NOT EXISTS background_jobs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued',
    total_questions_planned INTEGER DEFAULT 0,
    questions_completed INTEGER DEFAULT 0,
    credits_used REAL DEFAULT 0,
    credits_budget REAL DEFAULT 2.00,
    findings TEXT DEFAULT '[]',
    executive_summary TEXT,
    error_message TEXT,
    started_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ============================================
// Indexes
// ============================================

db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_data_sources_tenant ON tenant_data_sources(tenant_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug)`);

// Indexes for new tables
db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_default ON projects(tenant_id, is_default)`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_data_sources_project ON data_sources(project_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_data_sources_tenant_new ON data_sources(tenant_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_data_sources_status ON data_sources(status)`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_queries_project ON queries(project_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_queries_tenant ON queries(tenant_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_queries_pinned ON queries(is_pinned)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_queries_created ON queries(created_at)`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_dashboards_project ON dashboards(project_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_dashboards_tenant ON dashboards(tenant_id)`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_widgets_dashboard ON dashboard_widgets(dashboard_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_widgets_query ON dashboard_widgets(query_id)`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_insights_project ON insights(project_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_insights_tenant ON insights(tenant_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_insights_query ON insights(query_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_insights_dismissed ON insights(is_dismissed)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_insights_type ON insights(insight_type)`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_credits_tenant ON credits_usage(tenant_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_credits_month ON credits_usage(month)`);

// Background jobs indexes
db.exec(`CREATE INDEX IF NOT EXISTS idx_background_jobs_tenant ON background_jobs(tenant_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_background_jobs_project ON background_jobs(project_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_background_jobs_status ON background_jobs(status)`);

// Add source column to queries table if missing (for tracking background vs user queries)
try {
  const queryColumns = db.prepare(`PRAGMA table_info(queries)`).all();
  const hasSource = queryColumns.some(col => col.name === 'source');
  if (!hasSource) {
    db.exec(`ALTER TABLE queries ADD COLUMN source TEXT DEFAULT 'user'`);
  }
  const hasBackgroundJobId = queryColumns.some(col => col.name === 'background_job_id');
  if (!hasBackgroundJobId) {
    db.exec(`ALTER TABLE queries ADD COLUMN background_job_id TEXT REFERENCES background_jobs(id)`);
  }
} catch (err) {
  // Table might not exist yet, that's fine
}

// Add sharing columns to dashboards table if missing
try {
  const dashboardColumns = db.prepare(`PRAGMA table_info(dashboards)`).all();
  const hasShareToken = dashboardColumns.some(col => col.name === 'share_token');
  if (!hasShareToken) {
    db.exec(`ALTER TABLE dashboards ADD COLUMN share_token TEXT`);
  }
  const hasIsPublic = dashboardColumns.some(col => col.name === 'is_public');
  if (!hasIsPublic) {
    db.exec(`ALTER TABLE dashboards ADD COLUMN is_public INTEGER DEFAULT 0`);
  }
  const hasAutoGenerationPrompt = dashboardColumns.some(col => col.name === 'auto_generation_prompt');
  if (!hasAutoGenerationPrompt) {
    db.exec(`ALTER TABLE dashboards ADD COLUMN auto_generation_prompt TEXT`);
  }
} catch (err) {
  // Table might not exist yet, that's fine
}

// ============================================
// Invite Tokens Table
// ============================================
// For team member invitations

db.exec(`
  CREATE TABLE IF NOT EXISTS invite_tokens (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    token TEXT UNIQUE NOT NULL,
    invited_by INTEGER NOT NULL REFERENCES users(id),
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_invite_tokens_token ON invite_tokens(token)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_invite_tokens_tenant ON invite_tokens(tenant_id)`);

// Add project template tracking column if missing
try {
  const projectColumns = db.prepare(`PRAGMA table_info(projects)`).all();
  const hasTemplateId = projectColumns.some(col => col.name === 'template_id');
  if (!hasTemplateId) {
    db.exec(`ALTER TABLE projects ADD COLUMN template_id TEXT`);
  }
} catch (err) {
  // Table might not exist yet, that's fine
}

// ============================================
// Data Relationships Table (Phase 12)
// ============================================
// Auto-detected and user-confirmed relationships between tables

db.exec(`
  CREATE TABLE IF NOT EXISTS data_relationships (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source_table TEXT NOT NULL,
    source_column TEXT NOT NULL,
    target_table TEXT NOT NULL,
    target_column TEXT NOT NULL,
    confidence REAL DEFAULT 0,
    status TEXT DEFAULT 'suggested',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_relationships_project ON data_relationships(project_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_relationships_status ON data_relationships(status)`);

// ============================================
// Webhooks Table (Phase 12)
// ============================================
// Outgoing webhooks for integrations

db.exec(`
  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    triggers TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    last_triggered_at DATETIME,
    last_status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_webhooks_tenant ON webhooks(tenant_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_webhooks_project ON webhooks(project_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(is_active)`);

// ============================================
// Webhook Delivery Logs Table (Phase 12)
// ============================================
// Track webhook delivery attempts and outcomes

db.exec(`
  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    response_status INTEGER,
    response_body TEXT,
    error_message TEXT,
    delivered_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status)`);

// ============================================
// Scheduled Exports Table (Phase 12)
// ============================================
// Configuration for scheduled dashboard/data exports

db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_exports (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    dashboard_id TEXT REFERENCES dashboards(id) ON DELETE CASCADE,
    query_id TEXT REFERENCES queries(id) ON DELETE CASCADE,
    export_type TEXT NOT NULL,
    frequency TEXT NOT NULL,
    email_to TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    last_exported_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_scheduled_exports_tenant ON scheduled_exports(tenant_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_scheduled_exports_dashboard ON scheduled_exports(dashboard_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_scheduled_exports_active ON scheduled_exports(is_active)`);

module.exports = db;
