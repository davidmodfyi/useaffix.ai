const { v4: uuidv4 } = require('uuid');

/**
 * Rate Limiting Module
 * Controls API request rates per tenant
 */

// Rate limit configurations per endpoint
const RATE_LIMITS = {
  query: { maxRequests: 30, windowMs: 60 * 1000 },        // 30 queries per minute
  backgroundAnalysis: { maxConcurrent: 3 },               // 3 concurrent jobs per tenant
  suggestions: { maxRequests: 10, windowMs: 60 * 1000 },  // 10 suggestions per minute
  export: { maxRequests: 20, windowMs: 60 * 1000 }        // 20 exports per minute
};

class RateLimiter {
  constructor(db) {
    this.db = db;
    this.concurrentJobs = new Map(); // Track concurrent jobs in memory
  }

  /**
   * Get the current window start time (floored to the minute)
   * @param {number} windowMs - Window size in milliseconds
   * @returns {string} ISO timestamp of window start
   */
  getWindowStart(windowMs) {
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    return new Date(windowStart).toISOString();
  }

  /**
   * Check if a request is allowed and increment the counter
   * @param {string} tenantId - Tenant ID
   * @param {string} endpoint - Endpoint name
   * @returns {object} { allowed: boolean, remaining: number, resetAt: Date }
   */
  checkLimit(tenantId, endpoint) {
    const config = RATE_LIMITS[endpoint];
    if (!config || !config.maxRequests) {
      return { allowed: true, remaining: Infinity, resetAt: null };
    }

    const windowStart = this.getWindowStart(config.windowMs);
    const windowEnd = new Date(new Date(windowStart).getTime() + config.windowMs);

    try {
      // Get or create rate limit record
      let record = this.db.prepare(`
        SELECT * FROM rate_limits
        WHERE tenant_id = ? AND endpoint = ? AND window_start = ?
      `).get(tenantId, endpoint, windowStart);

      if (!record) {
        // Create new window
        const id = uuidv4();
        this.db.prepare(`
          INSERT INTO rate_limits (id, tenant_id, endpoint, window_start, request_count)
          VALUES (?, ?, ?, ?, 1)
        `).run(id, tenantId, endpoint, windowStart);

        return {
          allowed: true,
          remaining: config.maxRequests - 1,
          resetAt: windowEnd
        };
      }

      if (record.request_count >= config.maxRequests) {
        return {
          allowed: false,
          remaining: 0,
          resetAt: windowEnd
        };
      }

      // Increment counter
      this.db.prepare(`
        UPDATE rate_limits
        SET request_count = request_count + 1
        WHERE id = ?
      `).run(record.id);

      return {
        allowed: true,
        remaining: config.maxRequests - record.request_count - 1,
        resetAt: windowEnd
      };
    } catch (err) {
      console.error('Rate limit check error:', err);
      // Fail open - allow the request
      return { allowed: true, remaining: -1, resetAt: null };
    }
  }

  /**
   * Check concurrent job limit for background analysis
   * @param {string} tenantId - Tenant ID
   * @returns {object} { allowed: boolean, current: number, max: number }
   */
  checkConcurrentJobs(tenantId) {
    const config = RATE_LIMITS.backgroundAnalysis;

    try {
      const count = this.db.prepare(`
        SELECT COUNT(*) as count FROM background_jobs
        WHERE tenant_id = ? AND status IN ('queued', 'running')
      `).get(tenantId);

      return {
        allowed: count.count < config.maxConcurrent,
        current: count.count,
        max: config.maxConcurrent
      };
    } catch (err) {
      console.error('Concurrent jobs check error:', err);
      return { allowed: true, current: 0, max: config.maxConcurrent };
    }
  }

  /**
   * Clean up old rate limit records
   */
  cleanup() {
    try {
      // Delete records older than 1 hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const result = this.db.prepare(`
        DELETE FROM rate_limits WHERE window_start < ?
      `).run(oneHourAgo);

      if (result.changes > 0) {
        console.log(`Cleaned up ${result.changes} old rate limit records`);
      }
    } catch (err) {
      console.error('Rate limit cleanup error:', err);
    }
  }
}

/**
 * Express middleware for rate limiting
 * @param {RateLimiter} limiter - RateLimiter instance
 * @param {string} endpoint - Endpoint name for config lookup
 */
function rateLimitMiddleware(limiter, endpoint) {
  return (req, res, next) => {
    if (!req.tenantId) {
      return next();
    }

    const result = limiter.checkLimit(req.tenantId, endpoint);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    if (result.resetAt) {
      res.setHeader('X-RateLimit-Reset', result.resetAt.toISOString());
    }

    if (!result.allowed) {
      return res.status(429).json({
        error: true,
        errorType: 'rate_limit_exceeded',
        message: 'Too many requests. Please wait before trying again.',
        resetAt: result.resetAt
      });
    }

    next();
  };
}

module.exports = { RateLimiter, rateLimitMiddleware, RATE_LIMITS };
