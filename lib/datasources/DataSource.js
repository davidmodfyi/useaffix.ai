/**
 * Abstract DataSource Interface
 *
 * All data source implementations must implement this interface.
 * This provides a clean abstraction for connecting to different data sources:
 * - FileDataSource: Local file-based databases (SQLite/DuckDB)
 * - CloudDBDataSource: Direct connections to cloud databases (Postgres, MySQL, etc.)
 * - GatewayDataSource: Tunneled connections through a secure gateway
 */
class DataSource {
  constructor(config) {
    if (new.target === DataSource) {
      throw new Error('DataSource is abstract and cannot be instantiated directly');
    }
    this.config = config;
    this.connected = false;
  }

  /**
   * Connect to the data source
   * @returns {Promise<void>}
   */
  async connect() {
    throw new Error('connect() must be implemented by subclass');
  }

  /**
   * Disconnect from the data source
   * @returns {Promise<void>}
   */
  async disconnect() {
    throw new Error('disconnect() must be implemented by subclass');
  }

  /**
   * Execute a SQL query
   * @param {string} sql - The SQL query to execute
   * @param {any[]} params - Query parameters (for prepared statements)
   * @returns {Promise<{rows: any[], columns: string[]}>}
   */
  async execute(sql, params = []) {
    throw new Error('execute() must be implemented by subclass');
  }

  /**
   * Get the database schema information
   * @returns {Promise<{tables: string[], views: string[]}>}
   */
  async getSchema() {
    throw new Error('getSchema() must be implemented by subclass');
  }

  /**
   * Get list of all tables
   * @returns {Promise<string[]>}
   */
  async getTables() {
    throw new Error('getTables() must be implemented by subclass');
  }

  /**
   * Get column information for a specific table
   * @param {string} table - The table name
   * @returns {Promise<{name: string, type: string, nullable: boolean, primaryKey: boolean}[]>}
   */
  async getColumns(table) {
    throw new Error('getColumns() must be implemented by subclass');
  }

  /**
   * Check if connected to the data source
   * @returns {boolean}
   */
  isConnected() {
    return this.connected;
  }

  /**
   * Get data source type
   * @returns {string}
   */
  getType() {
    throw new Error('getType() must be implemented by subclass');
  }
}

module.exports = DataSource;
