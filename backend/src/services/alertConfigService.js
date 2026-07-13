const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");
// requirePremiumPlan moved to planFeatures.js — it's plan-generic, not
// alert-specific (see internalReminderService.js for the other consumer).
// Re-exported below unchanged so any existing import of it from this module
// keeps working.
const { requirePremiumPlan } = require("../config/planFeatures");

async function getAlertConfig(actor) {
  const businessId = requireActorBusinessId(actor);
  await requirePremiumPlan(businessId);

  const { rows } = await pool.query(
    `SELECT id, business_id, alert_type, threshold_days, notification_channels, enabled, created_at, updated_at
     FROM alert_configs
     WHERE business_id = $1 AND alert_type = 'low_rotation'
     LIMIT 1`,
    [businessId]
  );

  if (rows.length === 0) {
    return {
      business_id: businessId,
      alert_type: "low_rotation",
      threshold_days: 21,
      notification_channels: ["whatsapp"],
      enabled: true,
      persisted: false
    };
  }

  return { ...rows[0], persisted: true };
}

async function upsertAlertConfig(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  await requirePremiumPlan(businessId);

  const { alertType = "low_rotation", thresholdDays, notificationChannels, enabled } = payload;

  const days = Number(thresholdDays);
  if (!Number.isInteger(days) || days < 7 || days > 60) {
    throw new ApiError(400, "El umbral de días debe estar entre 7 y 60");
  }

  const validChannels = ["whatsapp", "email", "in_app"];
  const channels = Array.isArray(notificationChannels) ? notificationChannels.filter((c) => validChannels.includes(c)) : ["whatsapp"];
  if (channels.length === 0) {
    throw new ApiError(400, "Debe seleccionar al menos un canal de notificación");
  }

  const isEnabled = enabled !== false;

  const { rows } = await pool.query(
    `INSERT INTO alert_configs (business_id, alert_type, threshold_days, notification_channels, enabled, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (business_id, alert_type)
     DO UPDATE SET threshold_days = $3, notification_channels = $4, enabled = $5, updated_at = NOW()
     RETURNING *`,
    [businessId, alertType, days, JSON.stringify(channels), isEnabled]
  );

  return rows[0];
}

module.exports = { getAlertConfig, upsertAlertConfig, requirePremiumPlan };
