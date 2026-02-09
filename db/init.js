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

module.exports = db;
