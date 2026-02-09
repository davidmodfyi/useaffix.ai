const bcrypt = require('bcrypt');
const db = require('../db/init');
const { v4: uuidv4 } = require('uuid');

// Helper function to ensure default project exists for tenant
function ensureDefaultProject(tenantId) {
  // Check if tenant already has a default project
  const existingDefault = db.prepare(
    'SELECT * FROM projects WHERE tenant_id = ? AND is_default = 1'
  ).get(tenantId);

  if (existingDefault) {
    return existingDefault;
  }

  // Check if tenant has any projects
  const anyProject = db.prepare(
    'SELECT * FROM projects WHERE tenant_id = ? LIMIT 1'
  ).get(tenantId);

  if (anyProject) {
    // Tenant has projects but none marked as default, mark the first one
    db.prepare('UPDATE projects SET is_default = 1 WHERE id = ?').run(anyProject.id);
    return anyProject;
  }

  // Create a new default project
  const projectId = uuidv4();
  db.prepare(`
    INSERT INTO projects (id, tenant_id, name, description, icon, color, is_default)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(
    projectId,
    tenantId,
    'My First Project',
    'Your default project for data exploration',
    '📊',
    '#5b7cfa'
  );

  return db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
}

// Verify user credentials
async function verifyCredentials(email, password) {
  const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
  const user = stmt.get(email);

  if (!user) {
    return null;
  }

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    return null;
  }

  // Update last login
  const updateStmt = db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?');
  updateStmt.run(user.id);

  // Return user without password hash
  const { password_hash, ...safeUser } = user;
  return safeUser;
}

// Middleware to require authentication
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    // Fetch fresh user data with tenant info
    const stmt = db.prepare(`
      SELECT u.id, u.email, u.name, u.tenant_id, u.role, t.name as tenant_name, t.slug as tenant_slug
      FROM users u
      LEFT JOIN tenants t ON u.tenant_id = t.id
      WHERE u.id = ?
    `);
    const user = stmt.get(req.session.userId);
    if (user) {
      req.user = user;
      req.tenantId = user.tenant_id;

      // Ensure default project exists for this tenant
      if (user.tenant_id) {
        try {
          ensureDefaultProject(user.tenant_id);
        } catch (err) {
          console.error('Error ensuring default project:', err);
        }
      }

      return next();
    }
  }

  // For API requests, return JSON error
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // For regular requests, redirect to login
  res.redirect('/login');
}

// Middleware to require tenant context
function requireTenant(req, res, next) {
  if (!req.tenantId) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(403).json({ error: 'No tenant associated with this user' });
    }
    return res.redirect('/onboarding');
  }
  next();
}

// Middleware to require specific role within tenant
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

// Middleware to redirect if already logged in
function redirectIfAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return res.redirect('/');
  }
  next();
}

// Get tenant for a user
function getTenantForUser(userId) {
  const stmt = db.prepare(`
    SELECT t.* FROM tenants t
    JOIN users u ON u.tenant_id = t.id
    WHERE u.id = ?
  `);
  const tenant = stmt.get(userId);

  if (tenant) {
    tenant.settings = JSON.parse(tenant.settings || '{}');
  }

  return tenant;
}

module.exports = {
  verifyCredentials,
  requireAuth,
  requireTenant,
  requireRole,
  redirectIfAuth,
  getTenantForUser,
  ensureDefaultProject
};
