const DataSource = require('./DataSource');
const FileDataSource = require('./FileDataSource');
const CloudDBDataSource = require('./CloudDBDataSource');
const GatewayDataSource = require('./GatewayDataSource');

/**
 * Create a data source based on configuration
 * @param {object} config - Data source configuration
 * @returns {DataSource}
 */
function createDataSource(config) {
  const { type, ...rest } = config;

  switch (type) {
    case 'file':
      return new FileDataSource(rest);
    case 'cloud':
      return new CloudDBDataSource(rest);
    case 'gateway':
      return new GatewayDataSource(rest);
    default:
      throw new Error(`Unknown data source type: ${type}`);
  }
}

module.exports = {
  DataSource,
  FileDataSource,
  CloudDBDataSource,
  GatewayDataSource,
  createDataSource
};
