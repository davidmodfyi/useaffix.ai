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

// Create users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
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

// Create index on sessions expiry for cleanup
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired)
`);

module.exports = db;
