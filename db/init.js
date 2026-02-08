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
// Indexes
// ============================================

db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_data_sources_tenant ON tenant_data_sources(tenant_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug)`);

module.exports = db;
