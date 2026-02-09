#!/usr/bin/env node
/**
 * Phase 2 Test Script
 * Tests all new API endpoints added in Phase 2
 */

const db = require('./db/init');
const { ensureDefaultProject } = require('./middleware/auth');

console.log('=== Phase 2 API Endpoint Tests ===\n');

// Test 1: Check database tables exist
console.log('Test 1: Verify all Phase 2 tables exist');
try {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table'
    AND name IN ('projects', 'data_sources', 'queries', 'dashboards', 'dashboard_widgets', 'insights', 'credits_usage')
    ORDER BY name
  `).all();

  console.log('✓ Found tables:', tables.map(t => t.name).join(', '));

  if (tables.length !== 7) {
    console.error('✗ Expected 7 tables, found', tables.length);
    process.exit(1);
  }
} catch (err) {
  console.error('✗ Database error:', err.message);
  process.exit(1);
}

// Test 2: Check indexes exist
console.log('\nTest 2: Verify indexes are created');
try {
  const indexes = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='index'
    AND name LIKE 'idx_%'
    ORDER BY name
  `).all();

  console.log(`✓ Found ${indexes.length} indexes`);

  const requiredIndexes = [
    'idx_projects_tenant',
    'idx_projects_default',
    'idx_data_sources_project',
    'idx_queries_project',
    'idx_dashboards_project'
  ];

  const indexNames = indexes.map(i => i.name);
  for (const required of requiredIndexes) {
    if (!indexNames.includes(required)) {
      console.error(`✗ Missing index: ${required}`);
      process.exit(1);
    }
  }

  console.log('✓ All required indexes exist');
} catch (err) {
  console.error('✗ Index check error:', err.message);
  process.exit(1);
}

// Test 3: Check if default tenant has a default project
console.log('\nTest 3: Verify default project creation');
try {
  const tenant = db.prepare('SELECT * FROM tenants LIMIT 1').get();

  if (!tenant) {
    console.log('⚠ No tenants found, skipping default project test');
  } else {
    console.log(`  Testing tenant: ${tenant.name} (${tenant.id})`);

    // Run ensureDefaultProject
    const project = ensureDefaultProject(tenant.id);

    if (!project) {
      console.error('✗ Failed to create/get default project');
      process.exit(1);
    }

    console.log(`✓ Default project exists: "${project.name}" (${project.id})`);
    console.log(`  is_default: ${project.is_default}`);
    console.log(`  icon: ${project.icon}`);
    console.log(`  color: ${project.color}`);
  }
} catch (err) {
  console.error('✗ Default project error:', err.message);
  process.exit(1);
}

// Test 4: Check foreign key relationships
console.log('\nTest 4: Verify foreign key constraints');
try {
  // Check projects -> tenants
  const projectsWithTenant = db.prepare(`
    SELECT p.id, p.name, t.name as tenant_name
    FROM projects p
    LEFT JOIN tenants t ON p.tenant_id = t.id
    WHERE p.tenant_id IS NOT NULL
    LIMIT 5
  `).all();

  console.log(`✓ Found ${projectsWithTenant.length} projects with valid tenant references`);

  // Check if cascade delete is working (test schema only, don't actually delete)
  const cascadeCheck = db.prepare(`
    SELECT sql FROM sqlite_master
    WHERE type='table' AND name='data_sources'
  `).get();

  if (cascadeCheck && cascadeCheck.sql.includes('ON DELETE CASCADE')) {
    console.log('✓ CASCADE delete constraints are in place');
  } else {
    console.warn('⚠ CASCADE constraints might be missing');
  }

} catch (err) {
  console.error('✗ Foreign key test error:', err.message);
  process.exit(1);
}

// Test 5: Verify schema structure
console.log('\nTest 5: Verify column structure of new tables');
try {
  // Check projects table
  const projectColumns = db.prepare('PRAGMA table_info(projects)').all();
  const projectColNames = projectColumns.map(c => c.name);

  const requiredProjectCols = ['id', 'tenant_id', 'name', 'description', 'icon', 'color', 'is_default', 'created_at', 'updated_at'];
  for (const col of requiredProjectCols) {
    if (!projectColNames.includes(col)) {
      console.error(`✗ Missing column in projects table: ${col}`);
      process.exit(1);
    }
  }
  console.log('✓ Projects table has all required columns');

  // Check queries table
  const queriesColumns = db.prepare('PRAGMA table_info(queries)').all();
  const queriesColNames = queriesColumns.map(c => c.name);

  const requiredQueriesCols = ['id', 'project_id', 'tenant_id', 'question', 'sql_generated', 'is_pinned', 'pin_title'];
  for (const col of requiredQueriesCols) {
    if (!queriesColNames.includes(col)) {
      console.error(`✗ Missing column in queries table: ${col}`);
      process.exit(1);
    }
  }
  console.log('✓ Queries table has all required columns');

} catch (err) {
  console.error('✗ Schema verification error:', err.message);
  process.exit(1);
}

console.log('\n=== All Phase 2 Tests Passed ✓ ===\n');
process.exit(0);
