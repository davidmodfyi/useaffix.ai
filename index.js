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
const { generateInsights } = require('./lib/insights');
const { trackApiUsage, getCurrentUsage, setMonthlyBudget } = require('./lib/api-usage');
const backgroundAnalysis = require('./lib/backgroundAnalysis');

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
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
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

    // Create default project for new tenant
    const { ensureDefaultProject } = require('./middleware/auth');
    ensureDefaultProject(tenant.id);

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
// Projects API Routes
// ============================================

// List all projects for the current tenant
app.get('/api/projects', requireAuth, requireTenant, (req, res) => {
  try {
    const projects = db.prepare(`
      SELECT * FROM projects
      WHERE tenant_id = ?
      ORDER BY is_default DESC, created_at DESC
    `).all(req.tenantId);
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new project
app.post('/api/projects', requireAuth, requireTenant, requireRole('owner', 'admin'), (req, res) => {
  try {
    const { name, description, icon, color } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const { v4: uuidv4 } = require('uuid');
    const projectId = uuidv4();

    const stmt = db.prepare(`
      INSERT INTO projects (id, tenant_id, name, description, icon, color, is_default)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `);

    stmt.run(projectId, req.tenantId, name.trim(), description || null, icon || null, color || null);

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    res.json({ success: true, project });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update a project
app.put('/api/projects/:id', requireAuth, requireTenant, requireRole('owner', 'admin'), (req, res) => {
  try {
    const { name, description, icon, color } = req.body;
    const projectId = req.params.id;

    // Verify project belongs to tenant
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND tenant_id = ?').get(projectId, req.tenantId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const stmt = db.prepare(`
      UPDATE projects
      SET name = COALESCE(?, name),
          description = COALESCE(?, description),
          icon = COALESCE(?, icon),
          color = COALESCE(?, color),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tenant_id = ?
    `);

    stmt.run(name || null, description || null, icon || null, color || null, projectId, req.tenantId);

    const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    res.json({ success: true, project: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete a project (and all its data)
app.delete('/api/projects/:id', requireAuth, requireTenant, requireRole('owner', 'admin'), (req, res) => {
  try {
    const projectId = req.params.id;

    // Verify project belongs to tenant
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND tenant_id = ?').get(projectId, req.tenantId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Prevent deletion of default project
    if (project.is_default === 1) {
      return res.status(400).json({ error: 'Cannot delete the default project' });
    }

    // Delete will cascade to data_sources, queries, dashboards, etc.
    db.prepare('DELETE FROM projects WHERE id = ? AND tenant_id = ?').run(projectId, req.tenantId);

    res.json({ success: true, message: 'Project deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get project summary
app.get('/api/projects/:id/summary', requireAuth, requireTenant, (req, res) => {
  try {
    const projectId = req.params.id;

    // Verify project belongs to tenant
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND tenant_id = ?').get(projectId, req.tenantId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get counts
    const dataSourceCount = db.prepare('SELECT COUNT(*) as count FROM data_sources WHERE project_id = ?').get(projectId).count;
    const queryCount = db.prepare('SELECT COUNT(*) as count FROM queries WHERE project_id = ?').get(projectId).count;
    const dashboardCount = db.prepare('SELECT COUNT(*) as count FROM dashboards WHERE project_id = ?').get(projectId).count;

    // Get latest activity
    const latestQuery = db.prepare('SELECT created_at FROM queries WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').get(projectId);
    const latestUpload = db.prepare('SELECT uploaded_at FROM data_sources WHERE project_id = ? ORDER BY uploaded_at DESC LIMIT 1').get(projectId);

    let latestActivity = null;
    if (latestQuery && latestUpload) {
      latestActivity = new Date(latestQuery.created_at) > new Date(latestUpload.uploaded_at)
        ? latestQuery.created_at
        : latestUpload.uploaded_at;
    } else if (latestQuery) {
      latestActivity = latestQuery.created_at;
    } else if (latestUpload) {
      latestActivity = latestUpload.uploaded_at;
    }

    res.json({
      project,
      summary: {
        dataSourceCount,
        queryCount,
        dashboardCount,
        latestActivity
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// Data Sources API Routes (for projects)
// ============================================

// Upload file to a specific project
app.post('/api/projects/:id/upload', requireAuth, requireTenant, requireRole('owner', 'admin'), upload.single('file'), async (req, res) => {
  try {
    const projectId = req.params.id;

    // Verify project belongs to tenant
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND tenant_id = ?').get(projectId, req.tenantId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Get or create the default data source for this tenant
    let defaultDs = tenantManager.getDefaultDataSource(req.tenantId);
    if (!defaultDs) {
      defaultDs = tenantManager.createDataSourceForTenant(req.tenantId, {
        name: 'Default Storage',
        type: 'file'
      });
    }

    const ds = await tenantManager.getDataSourceInstance(req.tenantId, defaultDs.id);

    // Determine table name from request or filename
    let tableName = req.body.tableName;
    if (!tableName) {
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

    // Gather schema context for caching
    const schemaContext = await ds.gatherSchemaContext();

    // Parse the schema context to extract info about this specific table
    const tablePattern = new RegExp(`Table: ${result.table}[\\s\\S]*?(?=\\nTable:|$)`, 'i');
    const tableMatch = schemaContext.match(tablePattern);
    const tableSchema = tableMatch ? tableMatch[0] : '';

    // Create schema snapshot
    const schemaSnapshot = {
      tableName: result.table,
      columns: result.columns,
      rowCount: result.imported,
      schemaContext: tableSchema,
      gatheredAt: new Date().toISOString()
    };

    // Create entry in data_sources table
    const { v4: uuidv4 } = require('uuid');
    const dataSourceId = uuidv4();
    const fileType = path.extname(req.file.originalname).substring(1).toLowerCase();

    db.prepare(`
      INSERT INTO data_sources
      (id, project_id, tenant_id, name, original_filename, file_type, row_count, column_count, size_bytes, schema_snapshot, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')
    `).run(
      dataSourceId,
      projectId,
      req.tenantId,
      result.table,
      req.file.originalname,
      fileType,
      result.imported,
      result.columns.length,
      req.file.size,
      JSON.stringify(schemaSnapshot)
    );

    res.json({
      success: true,
      message: `Imported ${result.imported} rows into table "${result.table}"`,
      dataSource: {
        id: dataSourceId,
        name: result.table,
        table: result.table,
        originalFilename: req.file.originalname,
        fileType,
        rowCount: result.imported,
        columnCount: result.columns.length,
        columns: result.columns,
        sheets: result.sheets
      }
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(400).json({ error: err.message });
  }
});

// List data sources in a project
app.get('/api/projects/:id/sources', requireAuth, requireTenant, (req, res) => {
  try {
    const projectId = req.params.id;

    // Verify project belongs to tenant
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND tenant_id = ?').get(projectId, req.tenantId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const sources = db.prepare(`
      SELECT * FROM data_sources
      WHERE project_id = ?
      ORDER BY uploaded_at DESC
    `).all(projectId);

    // Parse schema_snapshot JSON
    const sourcesWithParsed = sources.map(s => ({
      ...s,
      schema_snapshot: s.schema_snapshot ? JSON.parse(s.schema_snapshot) : null
    }));

    res.json(sourcesWithParsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a data source
app.delete('/api/sources/:id', requireAuth, requireTenant, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const sourceId = req.params.id;

    // Verify source belongs to tenant
    const source = db.prepare('SELECT * FROM data_sources WHERE id = ? AND tenant_id = ?').get(sourceId, req.tenantId);
    if (!source) {
      return res.status(404).json({ error: 'Data source not found' });
    }

    // Drop the table from the actual database
    const defaultDs = tenantManager.getDefaultDataSource(req.tenantId);
    if (defaultDs) {
      const ds = await tenantManager.getDataSourceInstance(req.tenantId, defaultDs.id);
      try {
        await ds.execute(`DROP TABLE IF EXISTS "${source.name}"`);
      } catch (err) {
        console.error('Error dropping table:', err);
      }
    }

    // Delete the record
    db.prepare('DELETE FROM data_sources WHERE id = ?').run(sourceId);

    res.json({ success: true, message: 'Data source deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================
// Queries API Routes
// ============================================

// Ask a question about data in a project (NL query)
app.post('/api/projects/:id/query', requireAuth, requireTenant, async (req, res) => {
  try {
    const projectId = req.params.id;
    const { question, parentQueryId } = req.body;

    // Verify project belongs to tenant
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND tenant_id = ?').get(projectId, req.tenantId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

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

    // Build conversation context if this is a follow-up query
    let conversationContext = null;
    if (parentQueryId) {
      const parentQuery = db.prepare('SELECT * FROM queries WHERE id = ? AND tenant_id = ?').get(parentQueryId, req.tenantId);
      if (parentQuery) {
        conversationContext = {
          parentQuestion: parentQuery.question,
          parentSql: parentQuery.sql_generated,
          parentExplanation: parentQuery.explanation,
          parentResultSummary: parentQuery.result_summary ? JSON.parse(parentQuery.result_summary) : null
        };
      }
    }

    const startTime = Date.now();

    // Ask the question
    const result = await askQuestion(ds, question.trim(), {
      timeout: 30000,
      conversationContext
    });

    const executionTime = Date.now() - startTime;

    // Save query to database
    const { v4: uuidv4 } = require('uuid');
    const queryId = uuidv4();

    if (!result.error) {
      // Create result summary (first 5 rows)
      const resultSummary = {
        rowCount: result.rows?.length || 0,
        columnNames: result.columns || [],
        sampleRows: result.rows?.slice(0, 5) || []
      };

      db.prepare(`
        INSERT INTO queries
        (id, project_id, tenant_id, question, sql_generated, explanation, assumptions,
         visualization_type, visualization_config, result_summary, execution_time_ms, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'success')
      `).run(
        queryId,
        projectId,
        req.tenantId,
        question.trim(),
        result.sql || null,
        result.explanation || null,
        result.assumptions || null,
        result.visualizationType || null,
        result.chartConfig ? JSON.stringify(result.chartConfig) : null,
        JSON.stringify(resultSummary),
        executionTime
      );

      // Track API usage for SQL generation (estimate based on prompt size)
      // The actual token counts would come from the nlquery module if exposed
      // For now, we'll track when insights are generated

      // Send response immediately (chart first!)
      res.json({
        ...result,
        queryId,
        insightsLoading: true // Frontend knows to poll for insights
      });

      // Generate insights asynchronously (don't block the response)
      setImmediate(async () => {
        try {
          // Get schema context for insight generation
          let schemaContext = '';
          try {
            schemaContext = await ds.gatherSchemaContext();
          } catch (err) {
            console.error('Failed to gather schema for insights:', err);
          }

          const insightResult = await generateInsights({
            question: question.trim(),
            sql: result.sql,
            columns: result.columns || [],
            rows: result.rows || [],
            schemaContext
          });

          // Track API usage for insight generation
          if (insightResult.usage) {
            trackApiUsage(
              db,
              req.tenantId,
              insightResult.usage.inputTokens,
              insightResult.usage.outputTokens,
              'query_insights'
            );
          }

          // Save insights to database
          if (insightResult.insights && insightResult.insights.length > 0) {
            const insertInsight = db.prepare(`
              INSERT INTO insights
              (id, project_id, tenant_id, query_id, insight_type, title, description, severity, data_evidence, source)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto_chart')
            `);

            for (const insight of insightResult.insights) {
              insertInsight.run(
                uuidv4(),
                projectId,
                req.tenantId,
                queryId,
                insight.type,
                insight.title,
                insight.description,
                insight.severity,
                JSON.stringify(insight.evidence)
              );
            }
          }
        } catch (err) {
          console.error('Insight generation error:', err);
          // Fail silently - insights are optional
        }
      });

    } else {
      // Save error query
      db.prepare(`
        INSERT INTO queries
        (id, project_id, tenant_id, question, execution_time_ms, status, error_message)
        VALUES (?, ?, ?, ?, ?, 'error', ?)
      `).run(
        queryId,
        projectId,
        req.tenantId,
        question.trim(),
        executionTime,
        result.message || 'Unknown error'
      );

      const statusCode = result.errorType === 'no_data' ? 400 :
                         result.errorType === 'configuration_error' ? 500 :
                         result.errorType === 'api_error' ? 502 : 400;
      return res.status(statusCode).json(result);
    }
  } catch (err) {
    console.error('Query error:', err);
    res.status(500).json({
      error: true,
      errorType: 'server_error',
      message: 'An unexpected error occurred. Please try again.'
    });
  }
});

// List query history for a project
app.get('/api/projects/:id/queries', requireAuth, requireTenant, (req, res) => {
  try {
    const projectId = req.params.id;

    // Verify project belongs to tenant
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND tenant_id = ?').get(projectId, req.tenantId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Pagination
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const queries = db.prepare(`
      SELECT * FROM queries
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(projectId, limit, offset);

    const total = db.prepare('SELECT COUNT(*) as count FROM queries WHERE project_id = ?').get(projectId).count;

    res.json({
      queries: queries.map(q => ({
        ...q,
        result_summary: q.result_summary ? JSON.parse(q.result_summary) : null,
        visualization_config: q.visualization_config ? JSON.parse(q.visualization_config) : null
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle pin status for a query
app.put('/api/queries/:id/pin', requireAuth, requireTenant, (req, res) => {
  try {
    const queryId = req.params.id;
    const { isPinned, pinTitle } = req.body;

    // Verify query belongs to tenant
    const query = db.prepare('SELECT * FROM queries WHERE id = ? AND tenant_id = ?').get(queryId, req.tenantId);
    if (!query) {
      return res.status(404).json({ error: 'Query not found' });
    }

    const newPinStatus = isPinned ? 1 : 0;

    db.prepare(`
      UPDATE queries
      SET is_pinned = ?, pin_title = ?
      WHERE id = ?
    `).run(newPinStatus, pinTitle || null, queryId);

    const updated = db.prepare('SELECT * FROM queries WHERE id = ?').get(queryId);

    res.json({
      success: true,
      query: {
        ...updated,
        result_summary: updated.result_summary ? JSON.parse(updated.result_summary) : null,
        visualization_config: updated.visualization_config ? JSON.parse(updated.visualization_config) : null
      }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get all pinned queries across all projects
app.get('/api/queries/pinned', requireAuth, requireTenant, (req, res) => {
  try {
    const queries = db.prepare(`
      SELECT q.*, p.name as project_name
      FROM queries q
      JOIN projects p ON q.project_id = p.id
      WHERE q.tenant_id = ? AND q.is_pinned = 1
      ORDER BY q.created_at DESC
    `).all(req.tenantId);

    res.json(queries.map(q => ({
      ...q,
      result_summary: q.result_summary ? JSON.parse(q.result_summary) : null,
      visualization_config: q.visualization_config ? JSON.parse(q.visualization_config) : null
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// Insights API Routes
// ============================================

// Get insights for a specific query (used after query returns to poll for insights)
app.get('/api/queries/:id/insights', requireAuth, requireTenant, (req, res) => {
  try {
    const queryId = req.params.id;

    // Verify query belongs to tenant
    const query = db.prepare('SELECT id FROM queries WHERE id = ? AND tenant_id = ?').get(queryId, req.tenantId);
    if (!query) {
      return res.status(404).json({ error: 'Query not found' });
    }

    const insights = db.prepare(`
      SELECT * FROM insights
      WHERE query_id = ?
      ORDER BY
        CASE severity
          WHEN 'critical' THEN 1
          WHEN 'warning' THEN 2
          WHEN 'opportunity' THEN 3
          ELSE 4
        END,
        created_at DESC
    `).all(queryId);

    res.json(insights.map(i => ({
      ...i,
      data_evidence: i.data_evidence ? JSON.parse(i.data_evidence) : null
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all insights for a project
app.get('/api/projects/:id/insights', requireAuth, requireTenant, (req, res) => {
  try {
    const projectId = req.params.id;
    const { type, severity, dismissed } = req.query;

    // Verify project belongs to tenant
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND tenant_id = ?').get(projectId, req.tenantId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Build query with optional filters
    let sql = `
      SELECT i.*, q.question, q.visualization_type
      FROM insights i
      LEFT JOIN queries q ON i.query_id = q.id
      WHERE i.project_id = ?
    `;
    const params = [projectId];

    if (type) {
      sql += ' AND i.insight_type = ?';
      params.push(type);
    }

    if (severity) {
      sql += ' AND i.severity = ?';
      params.push(severity);
    }

    if (dismissed === 'false') {
      sql += ' AND i.is_dismissed = 0';
    } else if (dismissed === 'true') {
      sql += ' AND i.is_dismissed = 1';
    }

    sql += ` ORDER BY
      CASE i.severity
        WHEN 'critical' THEN 1
        WHEN 'warning' THEN 2
        WHEN 'opportunity' THEN 3
        ELSE 4
      END,
      i.created_at DESC
    `;

    const insights = db.prepare(sql).all(...params);

    res.json(insights.map(i => ({
      ...i,
      data_evidence: i.data_evidence ? JSON.parse(i.data_evidence) : null
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get insight summary for a project (counts by severity)
app.get('/api/projects/:id/insights/summary', requireAuth, requireTenant, (req, res) => {
  try {
    const projectId = req.params.id;

    // Verify project belongs to tenant
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND tenant_id = ?').get(projectId, req.tenantId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const summary = db.prepare(`
      SELECT
        severity,
        COUNT(*) as count
      FROM insights
      WHERE project_id = ? AND is_dismissed = 0
      GROUP BY severity
    `).all(projectId);

    const counts = {
      critical: 0,
      warning: 0,
      opportunity: 0,
      info: 0,
      total: 0
    };

    for (const row of summary) {
      counts[row.severity] = row.count;
      counts.total += row.count;
    }

    res.json(counts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dismiss an insight
app.put('/api/insights/:id/dismiss', requireAuth, requireTenant, (req, res) => {
  try {
    const insightId = req.params.id;

    // Verify insight belongs to tenant
    const insight = db.prepare('SELECT * FROM insights WHERE id = ? AND tenant_id = ?').get(insightId, req.tenantId);
    if (!insight) {
      return res.status(404).json({ error: 'Insight not found' });
    }

    db.prepare('UPDATE insights SET is_dismissed = 1 WHERE id = ?').run(insightId);

    res.json({ success: true, message: 'Insight dismissed' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Restore a dismissed insight
app.put('/api/insights/:id/restore', requireAuth, requireTenant, (req, res) => {
  try {
    const insightId = req.params.id;

    // Verify insight belongs to tenant
    const insight = db.prepare('SELECT * FROM insights WHERE id = ? AND tenant_id = ?').get(insightId, req.tenantId);
    if (!insight) {
      return res.status(404).json({ error: 'Insight not found' });
    }

    db.prepare('UPDATE insights SET is_dismissed = 0 WHERE id = ?').run(insightId);

    res.json({ success: true, message: 'Insight restored' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================
// AI Suggestions & Explanations API Routes
// ============================================

// Generate AI-powered suggested questions for a project
app.post('/api/projects/:id/suggestions', requireAuth, requireTenant, async (req, res) => {
  try {
    const projectId = req.params.id;

    // Verify project belongs to tenant
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND tenant_id = ?').get(projectId, req.tenantId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get the default data source for the tenant
    const defaultDs = tenantManager.getDefaultDataSource(req.tenantId);
    if (!defaultDs) {
      return res.json({ suggestions: [] });
    }

    // Get connected data source instance
    const ds = await tenantManager.getDataSourceInstance(req.tenantId, defaultDs.id);

    // Gather schema context
    let schemaContext;
    try {
      schemaContext = await ds.gatherSchemaContext();
    } catch (err) {
      console.error('Failed to gather schema:', err);
      return res.json({ suggestions: [] });
    }

    if (!schemaContext || schemaContext.includes('No tables found')) {
      return res.json({ suggestions: [] });
    }

    // Call Anthropic API to generate suggestions
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.json({ suggestions: [] });
    }

    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey });

    const systemPrompt = `You are analyzing a business database to suggest the most valuable questions a user should ask. Given the following data schema, generate exactly 6 suggested questions.

SCHEMA:
${schemaContext}

Generate questions in this exact JSON format:
[
  {
    "question": "What are the top 10 customers by total revenue?",
    "category": "ranking",
    "complexity": "simple",
    "business_value": "Brief note on why this question matters"
  }
]

RULES:
1. Mix categories: include at least one ranking, one trend, and one summary question. Valid categories: ranking|trend|comparison|summary|anomaly|prediction
2. Reference actual column names and tables from the schema.
3. Start with simple questions, escalate to more complex ones. Valid complexity: simple|moderate|complex
4. Frame questions as a business user would ask them, not a data engineer.
5. If there are date columns, include at least one time-trend question.
6. If there are multiple tables with joinable keys, include at least one cross-table question.
7. Return ONLY valid JSON, no additional text.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      temperature: 0.3,
      system: systemPrompt,
      messages: [
        { role: 'user', content: 'Generate 6 suggested questions for this data.' }
      ]
    });

    // Parse the JSON response
    let suggestions = [];
    try {
      const responseText = message.content[0].text.trim();
      // Extract JSON from response (in case Claude wraps it in markdown)
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        suggestions = JSON.parse(jsonMatch[0]);
      }
    } catch (err) {
      console.error('Failed to parse suggestions:', err);
    }

    res.json({ suggestions });
  } catch (err) {
    console.error('Suggestions error:', err);
    res.json({ suggestions: [] });
  }
});

// Generate AI explanation for a chart
app.post('/api/queries/:id/explain', requireAuth, requireTenant, async (req, res) => {
  try {
    const queryId = req.params.id;

    // Verify query belongs to tenant
    const query = db.prepare('SELECT * FROM queries WHERE id = ? AND tenant_id = ?').get(queryId, req.tenantId);
    if (!query) {
      return res.status(404).json({ error: 'Query not found' });
    }

    const resultSummary = query.result_summary ? JSON.parse(query.result_summary) : null;
    if (!resultSummary) {
      return res.status(400).json({ error: 'No results to explain' });
    }

    // Call Anthropic API to generate explanation
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'AI service not configured' });
    }

    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey });

    const prompt = `You are presenting data insights to a CEO. Explain these results concisely (3-5 sentences). Focus on the key takeaway, any surprises, and what action might be warranted. Use specific numbers.

ORIGINAL QUESTION:
${query.question}

SQL QUERY:
${query.sql_generated || 'N/A'}

RESULTS:
${JSON.stringify(resultSummary, null, 2)}

Provide a concise executive summary of what this data shows and what it means for the business.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      temperature: 0.3,
      messages: [
        { role: 'user', content: prompt }
      ]
    });

    const explanation = message.content[0].text.trim();

    res.json({ explanation });
  } catch (err) {
    console.error('Explanation error:', err);
    res.status(500).json({ error: 'Failed to generate explanation' });
  }
});

// ============================================
// Dashboards API Routes
// ============================================

// List dashboards in a project
app.get('/api/projects/:id/dashboards', requireAuth, requireTenant, (req, res) => {
  try {
    const projectId = req.params.id;

    // Verify project belongs to tenant
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND tenant_id = ?').get(projectId, req.tenantId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const dashboards = db.prepare(`
      SELECT
        d.*,
        (SELECT COUNT(*) FROM dashboard_widgets WHERE dashboard_id = d.id) as widget_count
      FROM dashboards d
      WHERE d.project_id = ?
      ORDER BY d.created_at DESC
    `).all(projectId);

    res.json(dashboards.map(d => ({
      ...d,
      layout: d.layout ? JSON.parse(d.layout) : null,
      widget_count: d.widget_count || 0
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new dashboard
app.post('/api/projects/:id/dashboards', requireAuth, requireTenant, requireRole('owner', 'admin', 'member'), (req, res) => {
  try {
    const projectId = req.params.id;
    const { name, description, layout } = req.body;

    // Verify project belongs to tenant
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND tenant_id = ?').get(projectId, req.tenantId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Dashboard name is required' });
    }

    const { v4: uuidv4 } = require('uuid');
    const dashboardId = uuidv4();

    db.prepare(`
      INSERT INTO dashboards (id, project_id, tenant_id, name, description, layout)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      dashboardId,
      projectId,
      req.tenantId,
      name.trim(),
      description || null,
      layout ? JSON.stringify(layout) : null
    );

    const dashboard = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(dashboardId);
    res.json({
      success: true,
      dashboard: {
        ...dashboard,
        layout: dashboard.layout ? JSON.parse(dashboard.layout) : null
      }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get a single dashboard by ID
app.get('/api/dashboards/:id', requireAuth, requireTenant, (req, res) => {
  try {
    const dashboardId = req.params.id;

    const dashboard = db.prepare(`
      SELECT d.*, p.name as project_name, p.icon as project_icon, p.color as project_color
      FROM dashboards d
      JOIN projects p ON d.project_id = p.id
      WHERE d.id = ? AND d.tenant_id = ?
    `).get(dashboardId, req.tenantId);

    if (!dashboard) {
      return res.status(404).json({ error: 'Dashboard not found' });
    }

    res.json({
      ...dashboard,
      layout: dashboard.layout ? JSON.parse(dashboard.layout) : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a dashboard
app.put('/api/dashboards/:id', requireAuth, requireTenant, requireRole('owner', 'admin', 'member'), (req, res) => {
  try {
    const dashboardId = req.params.id;
    const { name, description, layout } = req.body;

    // Verify dashboard belongs to tenant
    const dashboard = db.prepare('SELECT * FROM dashboards WHERE id = ? AND tenant_id = ?').get(dashboardId, req.tenantId);
    if (!dashboard) {
      return res.status(404).json({ error: 'Dashboard not found' });
    }

    db.prepare(`
      UPDATE dashboards
      SET name = COALESCE(?, name),
          description = COALESCE(?, description),
          layout = COALESCE(?, layout),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name || null,
      description || null,
      layout ? JSON.stringify(layout) : null,
      dashboardId
    );

    const updated = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(dashboardId);
    res.json({
      success: true,
      dashboard: {
        ...updated,
        layout: updated.layout ? JSON.parse(updated.layout) : null
      }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete a dashboard
app.delete('/api/dashboards/:id', requireAuth, requireTenant, requireRole('owner', 'admin', 'member'), (req, res) => {
  try {
    const dashboardId = req.params.id;

    // Verify dashboard belongs to tenant
    const dashboard = db.prepare('SELECT * FROM dashboards WHERE id = ? AND tenant_id = ?').get(dashboardId, req.tenantId);
    if (!dashboard) {
      return res.status(404).json({ error: 'Dashboard not found' });
    }

    // Delete will cascade to widgets
    db.prepare('DELETE FROM dashboards WHERE id = ?').run(dashboardId);

    res.json({ success: true, message: 'Dashboard deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Duplicate a dashboard
app.post('/api/dashboards/:id/duplicate', requireAuth, requireTenant, requireRole('owner', 'admin', 'member'), (req, res) => {
  try {
    const dashboardId = req.params.id;

    // Verify dashboard belongs to tenant
    const dashboard = db.prepare('SELECT * FROM dashboards WHERE id = ? AND tenant_id = ?').get(dashboardId, req.tenantId);
    if (!dashboard) {
      return res.status(404).json({ error: 'Dashboard not found' });
    }

    // Create new dashboard with same properties
    const newDashboardId = uuid.v4();
    const newName = `${dashboard.name} (Copy)`;

    db.prepare(`
      INSERT INTO dashboards (id, project_id, tenant_id, name, description, layout, is_pinned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(newDashboardId, dashboard.project_id, req.tenantId, newName, dashboard.description, dashboard.layout);

    // Copy all widgets
    const widgets = db.prepare('SELECT * FROM dashboard_widgets WHERE dashboard_id = ?').all(dashboardId);

    const insertWidget = db.prepare(`
      INSERT INTO dashboard_widgets (id, dashboard_id, query_id, widget_type, position, config_overrides, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    for (const widget of widgets) {
      insertWidget.run(uuid.v4(), newDashboardId, widget.query_id, widget.widget_type, widget.position, widget.config_overrides);
    }

    res.json({ success: true, dashboard: { id: newDashboardId, name: newName } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================
// Dashboard Widgets API Routes
// ============================================

// Get all widgets for a dashboard (with query data)
app.get('/api/dashboards/:id/widgets', requireAuth, requireTenant, (req, res) => {
  try {
    const dashboardId = req.params.id;

    // Verify dashboard belongs to tenant
    const dashboard = db.prepare('SELECT * FROM dashboards WHERE id = ? AND tenant_id = ?').get(dashboardId, req.tenantId);
    if (!dashboard) {
      return res.status(404).json({ error: 'Dashboard not found' });
    }

    // Get widgets with associated query data
    const widgets = db.prepare(`
      SELECT
        w.id,
        w.dashboard_id,
        w.query_id,
        w.widget_type,
        w.position,
        w.config_overrides,
        w.created_at,
        q.question,
        q.sql_generated,
        q.explanation,
        q.visualization_type,
        q.visualization_config,
        q.result_summary,
        q.pin_title
      FROM dashboard_widgets w
      JOIN queries q ON w.query_id = q.id
      WHERE w.dashboard_id = ?
      ORDER BY w.created_at ASC
    `).all(dashboardId);

    res.json(widgets.map(w => ({
      ...w,
      position: w.position ? JSON.parse(w.position) : null,
      config_overrides: w.config_overrides ? JSON.parse(w.config_overrides) : null,
      visualization_config: w.visualization_config ? JSON.parse(w.visualization_config) : null,
      result_summary: w.result_summary ? JSON.parse(w.result_summary) : null
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a widget to a dashboard
app.post('/api/dashboards/:id/widgets', requireAuth, requireTenant, requireRole('owner', 'admin', 'member'), (req, res) => {
  try {
    const dashboardId = req.params.id;
    const { queryId, widgetType, position, configOverrides } = req.body;

    // Verify dashboard belongs to tenant
    const dashboard = db.prepare('SELECT * FROM dashboards WHERE id = ? AND tenant_id = ?').get(dashboardId, req.tenantId);
    if (!dashboard) {
      return res.status(404).json({ error: 'Dashboard not found' });
    }

    // Verify query belongs to tenant
    const query = db.prepare('SELECT * FROM queries WHERE id = ? AND tenant_id = ?').get(queryId, req.tenantId);
    if (!query) {
      return res.status(404).json({ error: 'Query not found' });
    }

    if (!widgetType) {
      return res.status(400).json({ error: 'Widget type is required' });
    }

    const { v4: uuidv4 } = require('uuid');
    const widgetId = uuidv4();

    db.prepare(`
      INSERT INTO dashboard_widgets (id, dashboard_id, query_id, widget_type, position, config_overrides)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      widgetId,
      dashboardId,
      queryId,
      widgetType,
      position ? JSON.stringify(position) : null,
      configOverrides ? JSON.stringify(configOverrides) : null
    );

    const widget = db.prepare('SELECT * FROM dashboard_widgets WHERE id = ?').get(widgetId);
    res.json({
      success: true,
      widget: {
        ...widget,
        position: widget.position ? JSON.parse(widget.position) : null,
        config_overrides: widget.config_overrides ? JSON.parse(widget.config_overrides) : null
      }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update a widget
app.put('/api/widgets/:id', requireAuth, requireTenant, requireRole('owner', 'admin', 'member'), (req, res) => {
  try {
    const widgetId = req.params.id;
    const { position, configOverrides } = req.body;

    // Verify widget belongs to tenant's dashboard
    const widget = db.prepare(`
      SELECT w.* FROM dashboard_widgets w
      JOIN dashboards d ON w.dashboard_id = d.id
      WHERE w.id = ? AND d.tenant_id = ?
    `).get(widgetId, req.tenantId);

    if (!widget) {
      return res.status(404).json({ error: 'Widget not found' });
    }

    db.prepare(`
      UPDATE dashboard_widgets
      SET position = COALESCE(?, position),
          config_overrides = COALESCE(?, config_overrides)
      WHERE id = ?
    `).run(
      position ? JSON.stringify(position) : null,
      configOverrides ? JSON.stringify(configOverrides) : null,
      widgetId
    );

    const updated = db.prepare('SELECT * FROM dashboard_widgets WHERE id = ?').get(widgetId);
    res.json({
      success: true,
      widget: {
        ...updated,
        position: updated.position ? JSON.parse(updated.position) : null,
        config_overrides: updated.config_overrides ? JSON.parse(updated.config_overrides) : null
      }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete a widget
app.delete('/api/widgets/:id', requireAuth, requireTenant, requireRole('owner', 'admin', 'member'), (req, res) => {
  try {
    const widgetId = req.params.id;

    // Verify widget belongs to tenant's dashboard
    const widget = db.prepare(`
      SELECT w.* FROM dashboard_widgets w
      JOIN dashboards d ON w.dashboard_id = d.id
      WHERE w.id = ? AND d.tenant_id = ?
    `).get(widgetId, req.tenantId);

    if (!widget) {
      return res.status(404).json({ error: 'Widget not found' });
    }

    db.prepare('DELETE FROM dashboard_widgets WHERE id = ?').run(widgetId);

    res.json({ success: true, message: 'Widget deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================
// Credits Usage API Routes
// ============================================

// Get current month's credit usage for tenant
app.get('/api/credits', requireAuth, requireTenant, (req, res) => {
  try {
    const usage = getCurrentUsage(db, req.tenantId);

    if (!usage) {
      // Return default values for new tenants
      return res.json({
        creditsAllocated: 10.00,
        creditsUsed: 0,
        queryCount: 0,
        backgroundAnalysisCount: 0,
        percentUsed: 0
      });
    }

    const creditsAllocated = usage.credits_allocated || 10.00;
    const percentUsed = creditsAllocated > 0 ? (usage.credits_used / creditsAllocated) * 100 : 0;

    res.json({
      creditsAllocated: creditsAllocated,
      creditsUsed: usage.credits_used || 0,
      queryCount: usage.query_count || 0,
      backgroundAnalysisCount: usage.background_analysis_count || 0,
      percentUsed: Math.min(100, percentUsed),
      month: usage.month
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set monthly credit budget (owner/admin only)
app.put('/api/credits/budget', requireAuth, requireTenant, requireRole('owner', 'admin'), (req, res) => {
  try {
    const { budget } = req.body;

    if (typeof budget !== 'number' || budget < 0) {
      return res.status(400).json({ error: 'Invalid budget value' });
    }

    const usage = setMonthlyBudget(db, req.tenantId, budget);
    res.json({ success: true, usage });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================
// Background Analysis API Routes
// ============================================

// Start a background analysis job for a project
app.post('/api/projects/:id/background-analysis', requireAuth, requireTenant, async (req, res) => {
  try {
    const projectId = req.params.id;
    const { creditsBudget = 2.00 } = req.body;

    // Verify project belongs to tenant
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND tenant_id = ?').get(projectId, req.tenantId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check if there's already a running job for this project
    const runningJob = db.prepare(`
      SELECT id FROM background_jobs
      WHERE project_id = ? AND status IN ('queued', 'running')
    `).get(projectId);

    if (runningJob) {
      return res.status(400).json({
        error: 'A background analysis is already running for this project',
        jobId: runningJob.id
      });
    }

    // Get the default data source for the tenant
    const defaultDs = tenantManager.getDefaultDataSource(req.tenantId);
    if (!defaultDs) {
      return res.status(400).json({
        error: 'No data source found. Please upload some data first.'
      });
    }

    // Get connected data source instance
    const dataSource = await tenantManager.getDataSourceInstance(req.tenantId, defaultDs.id);

    // Gather schema context
    const schemaContext = await dataSource.gatherSchemaContext();

    if (!schemaContext || schemaContext.includes('No tables found')) {
      return res.status(400).json({
        error: 'No data found. Please upload some data first.'
      });
    }

    // Validate budget range
    const validBudget = Math.max(0.50, Math.min(5.00, creditsBudget));

    // Start the background analysis
    const jobId = await backgroundAnalysis.startBackgroundAnalysis({
      db,
      tenantId: req.tenantId,
      projectId,
      creditsBudget: validBudget,
      dataSource,
      schemaContext
    });

    res.json({
      success: true,
      jobId,
      message: 'Background analysis started'
    });

  } catch (err) {
    console.error('Background analysis start error:', err);
    res.status(400).json({ error: err.message });
  }
});

// Get active background jobs for current tenant (for sidebar)
// NOTE: This route must come BEFORE /api/background-jobs/:id to avoid matching "active" as an ID
app.get('/api/background-jobs/active', requireAuth, requireTenant, (req, res) => {
  try {
    const jobs = backgroundAnalysis.getActiveJobs(db, req.tenantId);
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get recent completed jobs for current tenant (for sidebar)
// NOTE: This route must come BEFORE /api/background-jobs/:id to avoid matching "recent" as an ID
app.get('/api/background-jobs/recent', requireAuth, requireTenant, (req, res) => {
  try {
    const limit = Math.min(10, parseInt(req.query.limit) || 5);
    const jobs = backgroundAnalysis.getRecentCompletedJobs(db, req.tenantId, limit);
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a specific background job
app.get('/api/background-jobs/:id', requireAuth, requireTenant, (req, res) => {
  try {
    const jobId = req.params.id;
    const job = backgroundAnalysis.getJob(db, jobId, req.tenantId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get queries generated by a background job
app.get('/api/background-jobs/:id/queries', requireAuth, requireTenant, (req, res) => {
  try {
    const jobId = req.params.id;

    // Verify job belongs to tenant
    const job = backgroundAnalysis.getJob(db, jobId, req.tenantId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const queries = backgroundAnalysis.getJobQueries(db, jobId, req.tenantId);
    res.json(queries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel a running background job
app.post('/api/background-jobs/:id/cancel', requireAuth, requireTenant, (req, res) => {
  try {
    const jobId = req.params.id;

    // Verify job belongs to tenant
    const job = backgroundAnalysis.getJob(db, jobId, req.tenantId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'running' && job.status !== 'queued') {
      return res.status(400).json({ error: 'Job is not running' });
    }

    const cancelled = backgroundAnalysis.cancelJob(jobId);

    if (cancelled) {
      res.json({ success: true, message: 'Job cancelled' });
    } else {
      // Job might have just finished
      res.json({ success: true, message: 'Job cancellation requested' });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// List all background jobs for a project
app.get('/api/projects/:id/background-jobs', requireAuth, requireTenant, (req, res) => {
  try {
    const projectId = req.params.id;

    // Verify project belongs to tenant
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND tenant_id = ?').get(projectId, req.tenantId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const jobs = backgroundAnalysis.getJobsForProject(db, projectId, req.tenantId);
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
