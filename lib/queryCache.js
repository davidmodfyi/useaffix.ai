const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// Cache TTL in milliseconds (1 hour)
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Hash a string for cache lookup
 * @param {string} str - String to hash
 * @returns {string} SHA-256 hash
 */
function hashString(str) {
  return crypto.createHash('sha256').update(str.toLowerCase().trim()).digest('hex');
}

/**
 * Query Cache Module
 * Caches NL query results to avoid redundant Claude API calls
 */
class QueryCache {
  constructor(db) {
    this.db = db;
  }

  /**
   * Generate a cache key from the question
   * @param {string} question - User's question
   * @returns {string} Hash of the question
   */
  getQuestionHash(question) {
    // Normalize the question: lowercase, trim, collapse whitespace
    const normalized = question.toLowerCase().trim().replace(/\s+/g, ' ');
    return hashString(normalized);
  }

  /**
   * Generate a schema hash to detect data changes
   * @param {string} schemaContext - Schema context string
   * @returns {string} Hash of schema
   */
  getSchemaHash(schemaContext) {
    // Extract table names and row counts from schema
    // This changes when data is refreshed or new tables are added
    const tablePattern = /Table: (\S+).*?(\d+) rows/g;
    let match;
    const tableInfo = [];

    while ((match = tablePattern.exec(schemaContext)) !== null) {
      tableInfo.push(`${match[1]}:${match[2]}`);
    }

    return hashString(tableInfo.sort().join('|'));
  }

  /**
   * Look up a cached result
   * @param {string} tenantId - Tenant ID
   * @param {string} questionHash - Hash of the question
   * @param {string} schemaHash - Hash of the schema
   * @returns {object|null} Cached result or null
   */
  get(tenantId, questionHash, schemaHash) {
    try {
      const cached = this.db.prepare(`
        SELECT * FROM query_cache
        WHERE tenant_id = ?
          AND question_hash = ?
          AND schema_hash = ?
          AND expires_at > datetime('now')
      `).get(tenantId, questionHash, schemaHash);

      if (cached) {
        // Increment hit count
        this.db.prepare(`
          UPDATE query_cache
          SET hit_count = hit_count + 1
          WHERE id = ?
        `).run(cached.id);

        return JSON.parse(cached.result);
      }

      return null;
    } catch (err) {
      console.error('Query cache get error:', err);
      return null;
    }
  }

  /**
   * Store a result in the cache
   * @param {string} tenantId - Tenant ID
   * @param {string} projectId - Project ID
   * @param {string} question - Original question
   * @param {string} questionHash - Hash of the question
   * @param {string} schemaHash - Hash of the schema
   * @param {object} result - Query result to cache
   */
  set(tenantId, projectId, question, questionHash, schemaHash, result) {
    try {
      const id = uuidv4();
      const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();

      this.db.prepare(`
        INSERT OR REPLACE INTO query_cache
        (id, tenant_id, project_id, question_hash, schema_hash, question, result, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        tenantId,
        projectId,
        questionHash,
        schemaHash,
        question,
        JSON.stringify(result),
        expiresAt
      );
    } catch (err) {
      console.error('Query cache set error:', err);
      // Fail silently - caching is optional
    }
  }

  /**
   * Invalidate cache for a project (when data changes)
   * @param {string} projectId - Project ID
   */
  invalidateProject(projectId) {
    try {
      this.db.prepare(`
        DELETE FROM query_cache WHERE project_id = ?
      `).run(projectId);
    } catch (err) {
      console.error('Query cache invalidate error:', err);
    }
  }

  /**
   * Invalidate cache for a tenant (when data changes)
   * @param {string} tenantId - Tenant ID
   */
  invalidateTenant(tenantId) {
    try {
      this.db.prepare(`
        DELETE FROM query_cache WHERE tenant_id = ?
      `).run(tenantId);
    } catch (err) {
      console.error('Query cache invalidate error:', err);
    }
  }

  /**
   * Clean up expired cache entries
   */
  cleanup() {
    try {
      const result = this.db.prepare(`
        DELETE FROM query_cache WHERE expires_at < datetime('now')
      `).run();

      if (result.changes > 0) {
        console.log(`Cleaned up ${result.changes} expired cache entries`);
      }
    } catch (err) {
      console.error('Query cache cleanup error:', err);
    }
  }

  /**
   * Get cache statistics for a tenant
   * @param {string} tenantId - Tenant ID
   * @returns {object} Cache statistics
   */
  getStats(tenantId) {
    try {
      const stats = this.db.prepare(`
        SELECT
          COUNT(*) as entries,
          SUM(hit_count) as total_hits,
          MAX(created_at) as last_cached
        FROM query_cache
        WHERE tenant_id = ? AND expires_at > datetime('now')
      `).get(tenantId);

      return stats || { entries: 0, total_hits: 0, last_cached: null };
    } catch (err) {
      console.error('Query cache stats error:', err);
      return { entries: 0, total_hits: 0, last_cached: null };
    }
  }
}

module.exports = QueryCache;
