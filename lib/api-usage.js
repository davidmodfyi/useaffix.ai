/**
 * API Usage Tracking Module
 *
 * Tracks Anthropic API usage and costs per tenant per month.
 */

const { v4: uuidv4 } = require('uuid');

// Anthropic Claude pricing (as of 2025)
// Claude 3.5 Sonnet: $3 per million input tokens, $15 per million output tokens
const PRICING = {
  'claude-sonnet-4-20250514': {
    inputPerMillion: 3.00,
    outputPerMillion: 15.00
  }
};

/**
 * Calculate cost based on token usage
 * @param {number} inputTokens - Number of input tokens
 * @param {number} outputTokens - Number of output tokens
 * @param {string} model - Model name (default: claude-sonnet-4-20250514)
 * @returns {number} Cost in dollars
 */
function calculateCost(inputTokens, outputTokens, model = 'claude-sonnet-4-20250514') {
  const pricing = PRICING[model] || PRICING['claude-sonnet-4-20250514'];

  const inputCost = (inputTokens / 1000000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1000000) * pricing.outputPerMillion;

  return inputCost + outputCost;
}

/**
 * Get the first day of the current month
 * @returns {string} Date string in YYYY-MM-01 format
 */
function getCurrentMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

/**
 * Track API usage for a tenant
 * @param {object} db - Database instance
 * @param {string} tenantId - Tenant ID
 * @param {number} inputTokens - Number of input tokens
 * @param {number} outputTokens - Number of output tokens
 * @param {string} purpose - Purpose of the API call ('query_sql', 'query_insights', 'background_analysis')
 * @returns {object} Updated usage record
 */
function trackApiUsage(db, tenantId, inputTokens, outputTokens, purpose) {
  if (!inputTokens && !outputTokens) {
    return null;
  }

  const cost = calculateCost(inputTokens, outputTokens);
  const month = getCurrentMonth();

  // Try to update existing record
  const updateResult = db.prepare(`
    UPDATE credits_usage
    SET credits_used = credits_used + ?,
        query_count = query_count + ?,
        background_analysis_count = background_analysis_count + ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ? AND month = ?
  `).run(
    cost,
    purpose === 'query_sql' || purpose === 'query_insights' ? 1 : 0,
    purpose === 'background_analysis' ? 1 : 0,
    tenantId,
    month
  );

  // If no record exists, create one
  if (updateResult.changes === 0) {
    const id = uuidv4();
    db.prepare(`
      INSERT INTO credits_usage (id, tenant_id, month, credits_used, query_count, background_analysis_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      tenantId,
      month,
      cost,
      purpose === 'query_sql' || purpose === 'query_insights' ? 1 : 0,
      purpose === 'background_analysis' ? 1 : 0
    );
  }

  // Return updated record
  return db.prepare(`
    SELECT * FROM credits_usage WHERE tenant_id = ? AND month = ?
  `).get(tenantId, month);
}

/**
 * Get current month's usage for a tenant
 * @param {object} db - Database instance
 * @param {string} tenantId - Tenant ID
 * @returns {object|null} Usage record or null
 */
function getCurrentUsage(db, tenantId) {
  const month = getCurrentMonth();
  return db.prepare(`
    SELECT * FROM credits_usage WHERE tenant_id = ? AND month = ?
  `).get(tenantId, month);
}

/**
 * Get usage history for a tenant
 * @param {object} db - Database instance
 * @param {string} tenantId - Tenant ID
 * @param {number} months - Number of months to retrieve (default: 12)
 * @returns {Array} Array of usage records
 */
function getUsageHistory(db, tenantId, months = 12) {
  return db.prepare(`
    SELECT * FROM credits_usage
    WHERE tenant_id = ?
    ORDER BY month DESC
    LIMIT ?
  `).all(tenantId, months);
}

/**
 * Check if tenant has budget remaining
 * @param {object} db - Database instance
 * @param {string} tenantId - Tenant ID
 * @param {number} estimatedCost - Estimated cost of the operation
 * @returns {boolean} True if budget allows the operation
 */
function hasBudget(db, tenantId, estimatedCost = 0) {
  const usage = getCurrentUsage(db, tenantId);

  // If no usage record, allow (new tenant)
  if (!usage) {
    return true;
  }

  // If no budget allocated, allow (free tier / unlimited)
  if (!usage.credits_allocated || usage.credits_allocated === 0) {
    return true;
  }

  // Check if remaining budget covers estimated cost
  const remaining = usage.credits_allocated - usage.credits_used;
  return remaining >= estimatedCost;
}

/**
 * Set monthly budget allocation for a tenant
 * @param {object} db - Database instance
 * @param {string} tenantId - Tenant ID
 * @param {number} budget - Monthly budget in dollars
 * @returns {object} Updated usage record
 */
function setMonthlyBudget(db, tenantId, budget) {
  const month = getCurrentMonth();

  const existing = db.prepare(`
    SELECT id FROM credits_usage WHERE tenant_id = ? AND month = ?
  `).get(tenantId, month);

  if (existing) {
    db.prepare(`
      UPDATE credits_usage SET credits_allocated = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(budget, existing.id);
  } else {
    const id = uuidv4();
    db.prepare(`
      INSERT INTO credits_usage (id, tenant_id, month, credits_allocated)
      VALUES (?, ?, ?, ?)
    `).run(id, tenantId, month, budget);
  }

  return getCurrentUsage(db, tenantId);
}

module.exports = {
  calculateCost,
  trackApiUsage,
  getCurrentUsage,
  getUsageHistory,
  hasBudget,
  setMonthlyBudget,
  getCurrentMonth
};
