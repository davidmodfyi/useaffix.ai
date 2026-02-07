const bcrypt = require('bcrypt');
const db = require('../db/init');

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
    // Fetch fresh user data
    const stmt = db.prepare('SELECT id, email, name FROM users WHERE id = ?');
    const user = stmt.get(req.session.userId);
    if (user) {
      req.user = user;
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

// Middleware to redirect if already logged in
function redirectIfAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return res.redirect('/');
  }
  next();
}

module.exports = {
  verifyCredentials,
  requireAuth,
  redirectIfAuth
};
