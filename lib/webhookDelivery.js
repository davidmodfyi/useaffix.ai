const { v4: uuidv4 } = require('uuid');

/**
 * Webhook Delivery
 * Handles firing webhooks for events asynchronously
 */

/**
 * Fire webhooks for a specific event
 * @param {object} db - Database instance
 * @param {string} tenantId - Tenant ID
 * @param {string} eventType - Event type (e.g., 'insight.critical', 'background_analysis.completed', 'dashboard.updated')
 * @param {object} payload - Event data to send
 * @param {string} projectId - Optional project ID filter
 */
async function fireWebhooks(db, tenantId, eventType, payload, projectId = null) {
  try {
    // Get active webhooks for this tenant that match the event
    let query = `
      SELECT * FROM webhooks
      WHERE tenant_id = ? AND is_active = 1
    `;
    const params = [tenantId];

    if (projectId) {
      query += ` AND (project_id = ? OR project_id IS NULL)`;
      params.push(projectId);
    }

    const webhooks = db.prepare(query).all(...params);

    // Filter webhooks that have this event in their triggers
    const matchingWebhooks = webhooks.filter(webhook => {
      const triggers = JSON.parse(webhook.triggers || '[]');
      return triggers.includes(eventType) || triggers.includes('*');
    });

    // Fire each webhook asynchronously
    for (const webhook of matchingWebhooks) {
      // Don't await - fire and forget
      deliverWebhook(db, webhook, eventType, payload).catch(err => {
        console.error(`Webhook delivery failed for ${webhook.id}:`, err.message);
      });
    }
  } catch (err) {
    console.error('Error firing webhooks:', err);
  }
}

/**
 * Deliver a single webhook
 * @private
 */
async function deliverWebhook(db, webhook, eventType, payload) {
  const deliveryId = uuidv4();
  const timestamp = new Date().toISOString();

  const fullPayload = {
    event: eventType,
    timestamp,
    data: payload
  };

  let status = 'failed';
  let responseStatus = null;
  let responseBody = null;
  let errorMessage = null;

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Affix-Webhook/1.0'
      },
      body: JSON.stringify(fullPayload),
      // 10 second timeout
      signal: AbortSignal.timeout(10000)
    });

    responseStatus = response.status;
    responseBody = await response.text();

    if (response.ok) {
      status = 'success';
    } else {
      errorMessage = `HTTP ${response.status}: ${responseBody}`;
    }
  } catch (err) {
    errorMessage = err.message;
  }

  // Log delivery attempt
  db.prepare(`
    INSERT INTO webhook_deliveries (
      id, webhook_id, event_type, payload, status,
      response_status, response_body, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    deliveryId,
    webhook.id,
    eventType,
    JSON.stringify(fullPayload),
    status,
    responseStatus,
    responseBody ? responseBody.substring(0, 1000) : null, // Truncate long responses
    errorMessage
  );

  // Update webhook last triggered status
  db.prepare(`
    UPDATE webhooks
    SET last_triggered_at = CURRENT_TIMESTAMP,
        last_status = ?
    WHERE id = ?
  `).run(status, webhook.id);
}

module.exports = {
  fireWebhooks
};
