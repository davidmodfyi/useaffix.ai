const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db = require('./init');

const SALT_ROUNDS = 12;

async function seedDefaultUser() {
  // Check if any users exist
  const count = db.prepare('SELECT COUNT(*) as count FROM users').get();

  if (count.count === 0) {
    console.log('No users found, creating default user with tenant...');

    const email = process.env.DEFAULT_USER_EMAIL || 'david@useaffix.ai';
    const password = process.env.DEFAULT_USER_PASSWORD || 'AffixAdmin2024!';
    const name = process.env.DEFAULT_USER_NAME || 'David';

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    try {
      // Create default tenant first
      const tenantId = uuidv4();
      const tenantSlug = 'default';
      const tenantName = 'Default Workspace';

      db.prepare(`
        INSERT INTO tenants (id, name, slug, plan, settings)
        VALUES (?, ?, ?, 'free', '{}')
      `).run(tenantId, tenantName, tenantSlug);
      console.log(`Default tenant created: ${tenantName} (ID: ${tenantId})`);

      // Create default FileDataSource for the tenant
      const dataSourceId = uuidv4();
      const dsConfig = JSON.stringify({ tenantId, name: 'Default', type: 'file', isDefault: true });
      db.prepare(`
        INSERT INTO tenant_data_sources (id, tenant_id, name, type, config, is_default)
        VALUES (?, ?, 'Default', 'file', ?, 1)
      `).run(dataSourceId, tenantId, dsConfig);
      console.log(`Default data source created for tenant`);

      // Create user with tenant association
      const result = db.prepare(`
        INSERT INTO users (email, password_hash, name, tenant_id, role)
        VALUES (?, ?, ?, ?, 'owner')
      `).run(email, passwordHash, name, tenantId);
      console.log(`Default user created: ${email} (ID: ${result.lastInsertRowid})`);

    } catch (err) {
      console.error('Failed to create default user:', err.message);
    }
  } else {
    console.log(`Database has ${count.count} user(s), skipping seed.`);

    // Check if existing users have tenants, if not, create one
    const usersWithoutTenant = db.prepare('SELECT * FROM users WHERE tenant_id IS NULL').all();
    if (usersWithoutTenant.length > 0) {
      console.log(`Found ${usersWithoutTenant.length} user(s) without tenant, fixing...`);

      // Check if default tenant exists
      let tenant = db.prepare('SELECT * FROM tenants WHERE slug = ?').get('default');

      if (!tenant) {
        const tenantId = uuidv4();
        db.prepare(`
          INSERT INTO tenants (id, name, slug, plan, settings)
          VALUES (?, 'Default Workspace', 'default', 'free', '{}')
        `).run(tenantId);
        tenant = { id: tenantId };
        console.log(`Created default tenant: ${tenantId}`);

        // Create default FileDataSource for the tenant
        const dataSourceId = uuidv4();
        const dsConfig = JSON.stringify({ tenantId, name: 'Default', type: 'file', isDefault: true });
        db.prepare(`
          INSERT INTO tenant_data_sources (id, tenant_id, name, type, config, is_default)
          VALUES (?, ?, 'Default', 'file', ?, 1)
        `).run(dataSourceId, tenantId, dsConfig);
        console.log(`Default data source created for tenant`);
      }

      // Associate users with tenant
      for (const user of usersWithoutTenant) {
        db.prepare('UPDATE users SET tenant_id = ?, role = ? WHERE id = ?')
          .run(tenant.id, 'owner', user.id);
        console.log(`Associated user ${user.email} with default tenant`);
      }
    }
  }
}

module.exports = { seedDefaultUser };
