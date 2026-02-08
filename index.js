const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

// Configure multer for file uploads (memory storage for processing)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.csv', '.xlsx', '.xls', '.json'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not supported. Allowed: ${allowedTypes.join(', ')}`));
    }
  }
});

// Initialize database (creates tables if needed)
const db = require('./db/init');
const { seedDefaultUser } = require('./db/seed');
const { verifyCredentials, requireAuth, requireTenant, requireRole } = require('./middleware/auth');
const SQLiteStore = require('./middleware/session-store');
const { TenantManager } = require('./lib/tenant');
const { askQuestion } = require('./lib/nlquery');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Initialize tenant manager
const tenantManager = new TenantManager(db);

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
    name: req.user.name,
    tenantId: req.user.tenant_id,
    tenantName: req.user.tenant_name,
    tenantSlug: req.user.tenant_slug,
    role: req.user.role
  });
});

// Logout
app.post('/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    // Clear cookie with same options used when setting it
    res.clearCookie('affix.sid', {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/'
    });
    res.json({ success: true });
  });
});

// ============================================
// Tenant API Routes
// ============================================

// Create a new tenant (signup flow)
app.post('/api/tenants', requireAuth, async (req, res) => {
  try {
    const { name, slug } = req.body;

    if (!name || !slug) {
      return res.status(400).json({ error: 'Name and slug are required' });
    }

    // Create tenant
    const tenant = tenantManager.createTenant({ name, slug });

    // Associate current user with tenant as owner
    tenantManager.associateUserWithTenant(req.user.id, tenant.id);

    // Update user role to owner
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run('owner', req.user.id);

    res.json({ success: true, tenant });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get current user's tenant
app.get('/api/tenant', requireAuth, (req, res) => {
  if (!req.tenantId) {
    return res.status(404).json({ error: 'No tenant found' });
  }

  const tenant = tenantManager.getTenant(req.tenantId);
  if (!tenant) {
    return res.status(404).json({ error: 'Tenant not found' });
  }

  res.json(tenant);
});

// Update tenant settings
app.patch('/api/tenant', requireAuth, requireTenant, requireRole('owner', 'admin'), (req, res) => {
  try {
    const updated = tenantManager.updateTenant(req.tenantId, req.body);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================
// Data Source API Routes
// ============================================

// List data sources for tenant
app.get('/api/datasources', requireAuth, requireTenant, (req, res) => {
  const dataSources = tenantManager.getDataSourcesForTenant(req.tenantId);
  // Don't expose sensitive config
  const sanitized = dataSources.map(ds => ({
    id: ds.id,
    name: ds.name,
    type: ds.type,
    isDefault: ds.is_default === 1,
    createdAt: ds.created_at
  }));
  res.json(sanitized);
});

// Create a new data source
app.post('/api/datasources', requireAuth, requireTenant, requireRole('owner', 'admin'), (req, res) => {
  try {
    const ds = tenantManager.createDataSourceForTenant(req.tenantId, req.body);
    res.json({
      id: ds.id,
      name: ds.name,
      type: ds.type,
      isDefault: ds.is_default === 1,
      createdAt: ds.created_at
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Execute a query against a data source
app.post('/api/datasources/:id/query', requireAuth, requireTenant, async (req, res) => {
  try {
    const { sql } = req.body;

    if (!sql) {
      return res.status(400).json({ error: 'SQL query is required' });
    }

    const ds = await tenantManager.getDataSourceInstance(req.tenantId, req.params.id);
    const result = await ds.execute(sql);

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get schema for a data source
app.get('/api/datasources/:id/schema', requireAuth, requireTenant, async (req, res) => {
  try {
    const ds = await tenantManager.getDataSourceInstance(req.tenantId, req.params.id);
    const schema = await ds.getSchema();
    res.json(schema);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get tables for a data source
app.get('/api/datasources/:id/tables', requireAuth, requireTenant, async (req, res) => {
  try {
    const ds = await tenantManager.getDataSourceInstance(req.tenantId, req.params.id);
    const tables = await ds.getTables();
    res.json(tables);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get columns for a table
app.get('/api/datasources/:id/tables/:table/columns', requireAuth, requireTenant, async (req, res) => {
  try {
    const ds = await tenantManager.getDataSourceInstance(req.tenantId, req.params.id);
    const columns = await ds.getColumns(req.params.table);
    res.json(columns);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get paginated data from a table
app.get('/api/datasources/:id/tables/:table/data', requireAuth, requireTenant, async (req, res) => {
  try {
    const ds = await tenantManager.getDataSourceInstance(req.tenantId, req.params.id);
    const table = req.params.table;

    // Validate table exists
    const tables = await ds.getTables();
    if (!tables.includes(table)) {
      return res.status(404).json({ error: `Table '${table}' not found` });
    }

    // Pagination params
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await ds.execute(`SELECT COUNT(*) as total FROM "${table}"`);
    const total = countResult.rows[0]?.total || 0;

    // Get paginated data
    const dataResult = await ds.execute(`SELECT * FROM "${table}" LIMIT ? OFFSET ?`, [limit, offset]);

    res.json({
      rows: dataResult.rows,
      columns: dataResult.columns,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Upload file to a data source
app.post('/api/datasources/:id/upload', requireAuth, requireTenant, requireRole('owner', 'admin'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const ds = await tenantManager.getDataSourceInstance(req.tenantId, req.params.id);

    // Determine table name from request or filename
    let tableName = req.body.tableName;
    if (!tableName) {
      // Generate from filename (remove extension, sanitize)
      tableName = path.basename(req.file.originalname, path.extname(req.file.originalname))
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/^(\d)/, '_$1')
        .replace(/_+/g, '_')
        .substring(0, 64);
    }

    // Import the file
    const result = await ds.importFromBuffer(
      req.file.buffer,
      req.file.originalname,
      tableName,
      { sheet: req.body.sheet }
    );

    res.json({
      success: true,
      message: `Imported ${result.imported} rows into table "${result.table}"`,
      table: result.table,
      imported: result.imported,
      columns: result.columns,
      sheets: result.sheets
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete a table from a data source
app.delete('/api/datasources/:id/tables/:table', requireAuth, requireTenant, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const ds = await tenantManager.getDataSourceInstance(req.tenantId, req.params.id);
    const table = req.params.table;

    // Validate table exists
    const tables = await ds.getTables();
    if (!tables.includes(table)) {
      return res.status(404).json({ error: `Table '${table}' not found` });
    }

    await ds.execute(`DROP TABLE "${table}"`);

    res.json({ success: true, message: `Table "${table}" deleted` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================
// Natural Language Query API
// ============================================

// Ask a question about the data
app.post('/api/query', requireAuth, requireTenant, async (req, res) => {
  try {
    const { question } = req.body;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({ error: 'Question is required' });
    }

    // Get the default data source for the tenant
    const defaultDs = tenantManager.getDefaultDataSource(req.tenantId);
    if (!defaultDs) {
      return res.status(400).json({
        error: true,
        errorType: 'no_datasource',
        message: 'No data source found. Please upload some data first.'
      });
    }

    // Get connected data source instance
    const ds = await tenantManager.getDataSourceInstance(req.tenantId, defaultDs.id);

    // Ask the question
    const result = await askQuestion(ds, question.trim(), {
      timeout: 30000
    });

    // Return appropriate status code based on error type
    if (result.error) {
      const statusCode = result.errorType === 'no_data' ? 400 :
                         result.errorType === 'configuration_error' ? 500 :
                         result.errorType === 'api_error' ? 502 : 400;
      return res.status(statusCode).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error('Query error:', err);
    res.status(500).json({
      error: true,
      errorType: 'server_error',
      message: 'An unexpected error occurred. Please try again.'
    });
  }
});

// ============================================
// Team Management API Routes
// ============================================

// List users in tenant
app.get('/api/team', requireAuth, requireTenant, (req, res) => {
  const users = tenantManager.getUsersForTenant(req.tenantId);
  res.json(users);
});

// Invite user to tenant
app.post('/api/team/invite', requireAuth, requireTenant, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { email, name, password, role = 'member' } = req.body;

    if (!email || !name || !password) {
      return res.status(400).json({ error: 'Email, name, and password are required' });
    }

    const user = await tenantManager.createUser(req.tenantId, { email, name, password });

    // Set role
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);

    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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

// Start server after seeding database
async function start() {
  // Seed default user if database is empty
  await seedDefaultUser();

  app.listen(PORT, () => {
    console.log(`Affix running on port ${PORT}`);
    console.log(`  Main site: http://localhost:${PORT}`);
    console.log(`  App: http://localhost:${PORT}/app`);
    console.log(`  Login: http://localhost:${PORT}/login`);
  });
}

start();
