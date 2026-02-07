const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');

// Initialize database (creates tables if needed)
const db = require('./db/init');
const { verifyCredentials, requireAuth } = require('./middleware/auth');
const SQLiteStore = require('./middleware/session-store');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Trust proxy in production (required for secure cookies behind Render/etc)
if (isProduction) {
  app.set('trust proxy', 1);
}

// Generate a session secret (in production, use environment variable)
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// Parse request bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Session configuration
app.use(session({
  name: 'affix.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
  store: new SQLiteStore()
}));

// Serve static files
app.use(express.static(__dirname, {
  index: false, // Don't serve index.html automatically
}));

// ============================================
// Subdomain detection middleware
// ============================================
app.use((req, res, next) => {
  const host = req.hostname || req.headers.host?.split(':')[0] || '';

  // Check if this is the app subdomain
  if (host === 'app.useaffix.ai' || host.startsWith('app.')) {
    req.isAppSubdomain = true;
  } else {
    req.isAppSubdomain = false;
  }

  next();
});

// ============================================
// Auth Routes
// ============================================

// Login page
app.get('/login', (req, res) => {
  if (req.session?.userId) {
    return res.redirect(req.isAppSubdomain ? '/' : '/app');
  }
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// Login API
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = await verifyCredentials(email, password);

  if (!user) {
    // Generic error message to prevent user enumeration
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Create session
  req.session.userId = user.id;
  req.session.userEmail = user.email;
  req.session.userName = user.name;

  res.json({
    success: true,
    redirect: '/app',
    user: {
      id: user.id,
      email: user.email,
      name: user.name
    }
  });
});

// Get current user
app.get('/auth/me', requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    name: req.user.name
  });
});

// Logout
app.post('/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    res.clearCookie('affix.sid');
    res.json({ success: true });
  });
});

// ============================================
// App Routes (authenticated)
// ============================================

// App dashboard (requires auth)
app.get('/app', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'app.html'));
});

// Root route for app subdomain
app.get('/', (req, res) => {
  if (req.isAppSubdomain) {
    // App subdomain - require auth
    if (req.session?.userId) {
      return res.sendFile(path.join(__dirname, 'views', 'app.html'));
    } else {
      return res.redirect('/login');
    }
  }

  // Main site - serve landing page
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================
// Other Routes
// ============================================

app.get('/modfyinew', (req, res) => {
  res.sendFile(path.join(__dirname, 'modfyinew.html'));
});

app.get('/strideforge', (req, res) => {
  res.sendFile(path.join(__dirname, 'strideforge.html'));
});

// Clean up expired sessions periodically
setInterval(() => {
  try {
    const stmt = db.prepare('DELETE FROM sessions WHERE expired < ?');
    stmt.run(Date.now());
  } catch (err) {
    console.error('Session cleanup error:', err);
  }
}, 60 * 60 * 1000); // Every hour

app.listen(PORT, () => {
  console.log(`Affix running on port ${PORT}`);
  console.log(`  Main site: http://localhost:${PORT}`);
  console.log(`  App: http://localhost:${PORT}/app`);
  console.log(`  Login: http://localhost:${PORT}/login`);
});
