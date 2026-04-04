const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");

const SUPPORTED_EVENT_TYPES = new Set([
  "sale_created",
  "low_stock_detected",
  "credit_payment_received",
  "product_created"
]);

async function emitAutomationEvent({ businessId, eventType, payload }, options = {}) {
  const client = options.client || pool;
  if (!businessId) {
    throw new ApiError(400, "businessId is required for automation events");
  }
  if (!SUPPORTED_EVENT_TYPES.has(eventType)) {
    throw new ApiError(400, "Unsupported automation event type");
  }

  const { rows } = await client.query(
    `INSERT INTO automation_events (business_id, event_type, payload, processed)
     VALUES ($1, $2, $3, FALSE)
     RETURNING *`,
    [businessId, eventType, JSON.stringify(payload || {})]
  );

  return rows[0];
}

async function emitActorAutomationEvent(actor, eventType, payload, options = {}) {
  return emitAutomationEvent({
    businessId: requireActorBusinessId(actor),
    eventType,
    payload
  }, options);
}

module.exports = {
  emitAutomationEvent,
  emitActorAutomationEvent
};
