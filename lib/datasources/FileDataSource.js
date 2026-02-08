const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const DataSource = require('./DataSource');
const XLSX = require('xlsx');

/**
 * FileDataSource - Local file-based database using SQLite
 *
 * Each tenant gets their own isolated SQLite database file.
 * In the future, this can be extended to support DuckDB for analytics workloads.
 *
 * Config options:
 * - tenantId: Required. The tenant identifier
 * - basePath: Optional. Base directory for database files (defaults to /var/data/tenants or ./data/tenants)
 * - filename: Optional. Custom database filename (defaults to data.db)
 */
class FileDataSource extends DataSource {
  constructor(config) {
    super(config);

    if (!config.tenantId) {
      throw new Error('FileDataSource requires tenantId in config');
    }

    this.tenantId = config.tenantId;
    this.db = null;

    // Determine base path
    const isProduction = process.env.NODE_ENV === 'production';
    const persistentPath = process.env.PERSISTENT_DISK_PATH || '/var/data';
    this.basePath = config.basePath ||
      (isProduction ? path.join(persistentPath, 'tenants') : path.join(__dirname, '../../data/tenants'));

    this.filename = config.filename || 'data.db';
  }

  /**
   * Get the full path to this tenant's database
   */
  getDbPath() {
    return path.join(this.basePath, this.tenantId, this.filename);
  }

  /**
   * Get the tenant's data directory
   */
  getTenantDir() {
    return path.join(this.basePath, this.tenantId);
  }

  async connect() {
    if (this.connected) {
      return;
    }

    // Ensure tenant directory exists
    const tenantDir = this.getTenantDir();
    if (!fs.existsSync(tenantDir)) {
      fs.mkdirSync(tenantDir, { recursive: true });
    }

    const dbPath = this.getDbPath();
    this.db = new Database(dbPath);

    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');

    this.connected = true;
  }

  async disconnect() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.connected = false;
  }

  async execute(sql, params = []) {
    if (!this.connected) {
      throw new Error('Not connected. Call connect() first.');
    }

    try {
      // Determine if this is a SELECT query
      const isSelect = sql.trim().toUpperCase().startsWith('SELECT') ||
                       sql.trim().toUpperCase().startsWith('WITH') ||
                       sql.trim().toUpperCase().startsWith('PRAGMA');

      if (isSelect) {
        const stmt = this.db.prepare(sql);
        const rows = stmt.all(...params);
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        return { rows, columns };
      } else {
        const stmt = this.db.prepare(sql);
        const result = stmt.run(...params);
        return {
          rows: [],
          columns: [],
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid
        };
      }
    } catch (err) {
      throw new Error(`SQL execution error: ${err.message}`);
    }
  }

  async getSchema() {
    if (!this.connected) {
      throw new Error('Not connected. Call connect() first.');
    }

    const tables = await this.getTables();

    // Get views
    const viewsResult = this.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'view'
      ORDER BY name
    `).all();
    const views = viewsResult.map(r => r.name);

    return { tables, views };
  }

  async getTables() {
    if (!this.connected) {
      throw new Error('Not connected. Call connect() first.');
    }

    const result = this.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all();

    return result.map(r => r.name);
  }

  async getColumns(table) {
    if (!this.connected) {
      throw new Error('Not connected. Call connect() first.');
    }

    // Validate table name to prevent SQL injection
    const tables = await this.getTables();
    if (!tables.includes(table)) {
      throw new Error(`Table '${table}' not found`);
    }

    const result = this.db.prepare(`PRAGMA table_info("${table}")`).all();

    return result.map(col => ({
      name: col.name,
      type: col.type,
      nullable: col.notnull === 0,
      primaryKey: col.pk === 1,
      defaultValue: col.dflt_value
    }));
  }

  /**
   * Import data from a file (CSV, JSON, Excel, etc.)
   * @param {string} filePath - Path to the file to import
   * @param {string} tableName - Name of the table to create/import into
   * @param {object} options - Import options
   */
  async importFile(filePath, tableName, options = {}) {
    if (!this.connected) {
      throw new Error('Not connected. Call connect() first.');
    }

    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.csv') {
      return this._importCsv(filePath, tableName, options);
    } else if (ext === '.json') {
      return this._importJson(filePath, tableName, options);
    } else if (ext === '.xlsx' || ext === '.xls') {
      return this._importExcel(filePath, tableName, options);
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }
  }

  /**
   * Import data from a buffer (for uploaded files)
   * @param {Buffer} buffer - File buffer
   * @param {string} originalName - Original filename (for extension detection)
   * @param {string} tableName - Name of the table to create/import into
   * @param {object} options - Import options
   */
  async importFromBuffer(buffer, originalName, tableName, options = {}) {
    if (!this.connected) {
      throw new Error('Not connected. Call connect() first.');
    }

    const ext = path.extname(originalName).toLowerCase();

    if (ext === '.csv') {
      const content = buffer.toString('utf-8');
      return this._importCsvContent(content, tableName, options);
    } else if (ext === '.json') {
      const content = buffer.toString('utf-8');
      return this._importJsonContent(content, tableName, options);
    } else if (ext === '.xlsx' || ext === '.xls') {
      return this._importExcelBuffer(buffer, tableName, options);
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }
  }

  async _importCsv(filePath, tableName, options) {
    const content = fs.readFileSync(filePath, 'utf-8');
    return this._importCsvContent(content, tableName, options);
  }

  async _importCsvContent(content, tableName, options) {
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      throw new Error('CSV file is empty');
    }

    // Parse header
    const delimiter = options.delimiter || ',';
    const headers = this._parseCsvLine(lines[0], delimiter);

    // Sanitize headers for SQL
    const sanitizedHeaders = headers.map(h => this._sanitizeColumnName(h));

    // Parse all data rows first
    const dataRows = lines.slice(1).map(line => this._parseCsvLine(line, delimiter));

    // Auto-detect column types from data
    const columnTypes = this._detectColumnTypes(sanitizedHeaders, dataRows);

    // Create table with detected types
    const columns = sanitizedHeaders.map((h, i) => `"${h}" ${columnTypes[i]}`).join(', ');
    this.db.exec(`DROP TABLE IF EXISTS "${tableName}"`);
    this.db.exec(`CREATE TABLE "${tableName}" (${columns})`);

    // Insert data with type conversion
    const placeholders = sanitizedHeaders.map(() => '?').join(', ');
    const insertStmt = this.db.prepare(`INSERT INTO "${tableName}" VALUES (${placeholders})`);

    const insertMany = this.db.transaction((rows) => {
      for (const row of rows) {
        const convertedRow = row.map((val, i) => this._convertValue(val, columnTypes[i]));
        insertStmt.run(...convertedRow);
      }
    });

    insertMany(dataRows);

    return {
      imported: dataRows.length,
      table: tableName,
      columns: sanitizedHeaders.map((name, i) => ({ name, type: columnTypes[i] }))
    };
  }

  _parseCsvLine(line, delimiter) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());

    return result;
  }

  async _importJson(filePath, tableName, options) {
    const content = fs.readFileSync(filePath, 'utf-8');
    return this._importJsonContent(content, tableName, options);
  }

  async _importJsonContent(content, tableName, options) {
    let data = JSON.parse(content);

    // Handle array of objects
    if (!Array.isArray(data)) {
      if (data.data && Array.isArray(data.data)) {
        data = data.data;
      } else {
        data = [data];
      }
    }

    if (data.length === 0) {
      throw new Error('JSON file has no records');
    }

    // Get all unique keys from all objects
    const allKeys = new Set();
    data.forEach(obj => Object.keys(obj).forEach(key => allKeys.add(key)));
    const headers = Array.from(allKeys).map(h => this._sanitizeColumnName(h));

    // Create table
    const columns = headers.map(h => `"${h}" TEXT`).join(', ');
    this.db.exec(`DROP TABLE IF EXISTS "${tableName}"`);
    this.db.exec(`CREATE TABLE "${tableName}" (${columns})`);

    // Insert data
    const placeholders = headers.map(() => '?').join(', ');
    const insertStmt = this.db.prepare(`INSERT INTO "${tableName}" VALUES (${placeholders})`);

    const insertMany = this.db.transaction((rows) => {
      for (const row of rows) {
        const values = headers.map((h, i) => {
          const originalKey = Array.from(allKeys)[i];
          const val = row[originalKey];
          return val === undefined ? null : (typeof val === 'object' ? JSON.stringify(val) : String(val));
        });
        insertStmt.run(...values);
      }
    });

    insertMany(data);

    return { imported: data.length, table: tableName, columns: headers.map(name => ({ name, type: 'TEXT' })) };
  }

  async _importExcel(filePath, tableName, options) {
    const buffer = fs.readFileSync(filePath);
    return this._importExcelBuffer(buffer, tableName, options);
  }

  async _importExcelBuffer(buffer, tableName, options) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    // Use first sheet by default, or specified sheet
    const sheetName = options.sheet || workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    if (!worksheet) {
      throw new Error(`Sheet "${sheetName}" not found`);
    }

    // Convert to JSON array
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (data.length < 2) {
      throw new Error('Excel file must have a header row and at least one data row');
    }

    // First row is headers
    const rawHeaders = data[0].map(h => String(h || 'column'));
    const headers = rawHeaders.map(h => this._sanitizeColumnName(h));

    // Remaining rows are data
    const dataRows = data.slice(1).filter(row => row.some(cell => cell !== undefined && cell !== ''));

    // Auto-detect column types
    const columnTypes = this._detectColumnTypes(headers, dataRows);

    // Create table
    const columns = headers.map((h, i) => `"${h}" ${columnTypes[i]}`).join(', ');
    this.db.exec(`DROP TABLE IF EXISTS "${tableName}"`);
    this.db.exec(`CREATE TABLE "${tableName}" (${columns})`);

    // Insert data
    const placeholders = headers.map(() => '?').join(', ');
    const insertStmt = this.db.prepare(`INSERT INTO "${tableName}" VALUES (${placeholders})`);

    const insertMany = this.db.transaction((rows) => {
      for (const row of rows) {
        // Ensure row has correct number of columns
        const paddedRow = headers.map((_, i) => row[i] !== undefined ? row[i] : null);
        const convertedRow = paddedRow.map((val, i) => this._convertValue(val, columnTypes[i]));
        insertStmt.run(...convertedRow);
      }
    });

    insertMany(dataRows);

    return {
      imported: dataRows.length,
      table: tableName,
      columns: headers.map((name, i) => ({ name, type: columnTypes[i] })),
      sheets: workbook.SheetNames
    };
  }

  /**
   * Sanitize a string to be a valid SQL column name
   */
  _sanitizeColumnName(name) {
    // Remove or replace invalid characters
    let sanitized = String(name)
      .trim()
      .replace(/[^a-zA-Z0-9_]/g, '_')  // Replace invalid chars with underscore
      .replace(/^(\d)/, '_$1')          // Prefix with underscore if starts with digit
      .replace(/_+/g, '_')              // Collapse multiple underscores
      .replace(/^_|_$/g, '');           // Trim leading/trailing underscores

    // Ensure not empty
    if (!sanitized) {
      sanitized = 'column';
    }

    return sanitized;
  }

  /**
   * Detect column types from data
   */
  _detectColumnTypes(headers, rows) {
    const types = headers.map(() => ({ isNumber: true, isInteger: true, hasData: false }));

    for (const row of rows) {
      for (let i = 0; i < headers.length; i++) {
        const val = row[i];
        if (val === null || val === undefined || val === '') continue;

        types[i].hasData = true;
        const strVal = String(val).trim();

        // Check if numeric
        if (types[i].isNumber) {
          const num = Number(strVal);
          if (isNaN(num)) {
            types[i].isNumber = false;
            types[i].isInteger = false;
          } else if (!Number.isInteger(num)) {
            types[i].isInteger = false;
          }
        }
      }
    }

    return types.map(t => {
      if (!t.hasData) return 'TEXT';
      if (t.isInteger) return 'INTEGER';
      if (t.isNumber) return 'REAL';
      return 'TEXT';
    });
  }

  /**
   * Convert a value to the appropriate type
   */
  _convertValue(val, type) {
    if (val === null || val === undefined || val === '') return null;

    const strVal = String(val).trim();

    if (type === 'INTEGER') {
      const num = parseInt(strVal, 10);
      return isNaN(num) ? null : num;
    } else if (type === 'REAL') {
      const num = parseFloat(strVal);
      return isNaN(num) ? null : num;
    }

    return strVal;
  }

  getType() {
    return 'file';
  }
}

module.exports = FileDataSource;
