const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const { FileDataSource } = require('../datasources');

/**
 * TenantManager - Manages multi-tenant operations
 *
 * Responsibilities:
 * - Tenant CRUD operations
 * - User management within tenants
 * - Data source management per tenant
 * - Tenant isolation enforcement
 */
class TenantManager {
  constructor(db) {
    this.db = db;
    this.dataSources = new Map(); // tenantId -> DataSource
  }

  /**
   * Initialize tenant-related tables in the main database
   */
  initializeTables() {
    // Tenants table
    this.db.exec(`
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

    // Add tenant_id to users table if it doesn't exist
    // First check if column exists
    const columns = this.db.prepare(`PRAGMA table_info(users)`).all();
    const hasTenantId = columns.some(col => col.name === 'tenant_id');

    if (!hasTenantId) {
      this.db.exec(`ALTER TABLE users ADD COLUMN tenant_id TEXT REFERENCES tenants(id)`);
    }

    // Tenant data sources table
    this.db.exec(`
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

    // Create index for tenant lookups
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_data_sources_tenant ON tenant_data_sources(tenant_id)
    `);
  }

  /**
   * Create a new tenant
   * @param {object} data - Tenant data
   * @returns {object} Created tenant
   */
  createTenant(data) {
    const { name, slug } = data;

    if (!name || !slug) {
      throw new Error('Tenant name and slug are required');
    }

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(slug)) {
      throw new Error('Slug must contain only lowercase letters, numbers, and hyphens');
    }

    const id = uuidv4();
    const settings = JSON.stringify(data.settings || {});

    const stmt = this.db.prepare(`
      INSERT INTO tenants (id, name, slug, plan, settings)
      VALUES (?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(id, name, slug, data.plan || 'free', settings);
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        throw new Error('A tenant with this slug already exists');
      }
      throw err;
    }

    // Create default file data source for the tenant
    this.createDataSourceForTenant(id, {
      name: 'Default',
      type: 'file',
      isDefault: true
    });

    return this.getTenant(id);
  }

  /**
   * Get a tenant by ID
   * @param {string} id - Tenant ID
   * @returns {object|null} Tenant or null
   */
  getTenant(id) {
    const stmt = this.db.prepare('SELECT * FROM tenants WHERE id = ?');
    const tenant = stmt.get(id);

    if (tenant) {
      tenant.settings = JSON.parse(tenant.settings || '{}');
    }

    return tenant;
  }

  /**
   * Get a tenant by slug
   * @param {string} slug - Tenant slug
   * @returns {object|null} Tenant or null
   */
  getTenantBySlug(slug) {
    const stmt = this.db.prepare('SELECT * FROM tenants WHERE slug = ?');
    const tenant = stmt.get(slug);

    if (tenant) {
      tenant.settings = JSON.parse(tenant.settings || '{}');
    }

    return tenant;
  }

  /**
   * List all tenants
   * @returns {object[]} Array of tenants
   */
  listTenants() {
    const stmt = this.db.prepare('SELECT * FROM tenants ORDER BY created_at DESC');
    return stmt.all().map(t => ({
      ...t,
      settings: JSON.parse(t.settings || '{}')
    }));
  }

  /**
   * Update a tenant
   * @param {string} id - Tenant ID
   * @param {object} data - Update data
   * @returns {object} Updated tenant
   */
  updateTenant(id, data) {
    const updates = [];
    const values = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.plan !== undefined) {
      updates.push('plan = ?');
      values.push(data.plan);
    }
    if (data.settings !== undefined) {
      updates.push('settings = ?');
      values.push(JSON.stringify(data.settings));
    }

    if (updates.length === 0) {
      return this.getTenant(id);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE tenants SET ${updates.join(', ')} WHERE id = ?
    `);
    stmt.run(...values);

    return this.getTenant(id);
  }

  /**
   * Delete a tenant and all associated data
   * @param {string} id - Tenant ID
   */
  deleteTenant(id) {
    // Close any open data sources
    const ds = this.dataSources.get(id);
    if (ds) {
      ds.disconnect();
      this.dataSources.delete(id);
    }

    // Delete data sources records
    this.db.prepare('DELETE FROM tenant_data_sources WHERE tenant_id = ?').run(id);

    // Update users to remove tenant association (or delete them)
    this.db.prepare('UPDATE users SET tenant_id = NULL WHERE tenant_id = ?').run(id);

    // Delete tenant
    this.db.prepare('DELETE FROM tenants WHERE id = ?').run(id);

    // TODO: Delete tenant's data files
  }

  // ==========================================
  // User Management (within tenants)
  // ==========================================

  /**
   * Create a user for a tenant
   * @param {string} tenantId - Tenant ID
   * @param {object} userData - User data
   * @returns {object} Created user
   */
  async createUser(tenantId, userData) {
    const { email, password, name } = userData;

    if (!email || !password || !name) {
      throw new Error('Email, password, and name are required');
    }

    // Verify tenant exists
    const tenant = this.getTenant(tenantId);
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const stmt = this.db.prepare(`
      INSERT INTO users (email, password_hash, name, tenant_id)
      VALUES (?, ?, ?, ?)
    `);

    try {
      const result = stmt.run(email, passwordHash, name, tenantId);
      return this.getUser(result.lastInsertRowid);
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        throw new Error('A user with this email already exists');
      }
      throw err;
    }
  }

  /**
   * Get a user by ID
   * @param {number} id - User ID
   * @returns {object|null} User without password hash
   */
  getUser(id) {
    const stmt = this.db.prepare(`
      SELECT id, email, name, tenant_id, created_at, updated_at, last_login
      FROM users WHERE id = ?
    `);
    return stmt.get(id);
  }

  /**
   * Get users for a tenant
   * @param {string} tenantId - Tenant ID
   * @returns {object[]} Array of users
   */
  getUsersForTenant(tenantId) {
    const stmt = this.db.prepare(`
      SELECT id, email, name, tenant_id, created_at, updated_at, last_login
      FROM users WHERE tenant_id = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(tenantId);
  }

  /**
   * Associate an existing user with a tenant
   * @param {number} userId - User ID
   * @param {string} tenantId - Tenant ID
   */
  associateUserWithTenant(userId, tenantId) {
    const stmt = this.db.prepare('UPDATE users SET tenant_id = ? WHERE id = ?');
    stmt.run(tenantId, userId);
  }

  // ==========================================
  // Data Source Management
  // ==========================================

  /**
   * Create a data source for a tenant
   * @param {string} tenantId - Tenant ID
   * @param {object} config - Data source config
   * @returns {object} Created data source record
   */
  createDataSourceForTenant(tenantId, config) {
    const { name, type, isDefault = false } = config;

    if (!name || !type) {
      throw new Error('Data source name and type are required');
    }

    const id = uuidv4();

    // Build the full config based on type
    let fullConfig = { ...config };
    if (type === 'file') {
      fullConfig.tenantId = tenantId;
    }

    // If this is default, unset other defaults first
    if (isDefault) {
      this.db.prepare(`
        UPDATE tenant_data_sources SET is_default = 0 WHERE tenant_id = ?
      `).run(tenantId);
    }

    const stmt = this.db.prepare(`
      INSERT INTO tenant_data_sources (id, tenant_id, name, type, config, is_default)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, tenantId, name, type, JSON.stringify(fullConfig), isDefault ? 1 : 0);

    return this.getDataSource(id);
  }

  /**
   * Get a data source by ID
   * @param {string} id - Data source ID
   * @returns {object|null} Data source record
   */
  getDataSource(id) {
    const stmt = this.db.prepare('SELECT * FROM tenant_data_sources WHERE id = ?');
    const ds = stmt.get(id);

    if (ds) {
      ds.config = JSON.parse(ds.config || '{}');
    }

    return ds;
  }

  /**
   * Get data sources for a tenant
   * @param {string} tenantId - Tenant ID
   * @returns {object[]} Array of data source records
   */
  getDataSourcesForTenant(tenantId) {
    const stmt = this.db.prepare(`
      SELECT * FROM tenant_data_sources WHERE tenant_id = ? ORDER BY is_default DESC, created_at ASC
    `);
    return stmt.all(tenantId).map(ds => ({
      ...ds,
      config: JSON.parse(ds.config || '{}')
    }));
  }

  /**
   * Get the default data source for a tenant
   * @param {string} tenantId - Tenant ID
   * @returns {object|null} Default data source record
   */
  getDefaultDataSource(tenantId) {
    const stmt = this.db.prepare(`
      SELECT * FROM tenant_data_sources WHERE tenant_id = ? AND is_default = 1
    `);
    const ds = stmt.get(tenantId);

    if (ds) {
      ds.config = JSON.parse(ds.config || '{}');
    }

    return ds;
  }

  /**
   * Get a connected DataSource instance for a tenant
   * @param {string} tenantId - Tenant ID
   * @param {string} dataSourceId - Optional specific data source ID
   * @returns {Promise<DataSource>} Connected data source
   */
  async getDataSourceInstance(tenantId, dataSourceId = null) {
    // Get the data source record
    let dsRecord;
    if (dataSourceId) {
      dsRecord = this.getDataSource(dataSourceId);
      if (!dsRecord || dsRecord.tenant_id !== tenantId) {
        throw new Error('Data source not found or does not belong to tenant');
      }
    } else {
      dsRecord = this.getDefaultDataSource(tenantId);
      if (!dsRecord) {
        throw new Error('No default data source found for tenant');
      }
    }

    // Check if we already have a connected instance
    const cacheKey = dsRecord.id;
    if (this.dataSources.has(cacheKey)) {
      const ds = this.dataSources.get(cacheKey);
      if (ds.isConnected()) {
        return ds;
      }
    }

    // Create and connect new instance
    let ds;
    switch (dsRecord.type) {
      case 'file':
        ds = new FileDataSource({
          ...dsRecord.config,
          tenantId
        });
        break;
      default:
        throw new Error(`Data source type ${dsRecord.type} not yet supported`);
    }

    await ds.connect();
    this.dataSources.set(cacheKey, ds);

    return ds;
  }

  /**
   * Delete a data source
   * @param {string} id - Data source ID
   */
  deleteDataSource(id) {
    // Disconnect if connected
    if (this.dataSources.has(id)) {
      this.dataSources.get(id).disconnect();
      this.dataSources.delete(id);
    }

    this.db.prepare('DELETE FROM tenant_data_sources WHERE id = ?').run(id);
  }
}

module.exports = TenantManager;
