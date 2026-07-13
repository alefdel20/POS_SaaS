const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");

const PLAN_FEATURES = {
  basico: {
    ai_chat: false,
    ai_agents: false,
    sales_reports: false,
    stock_alerts: false,
    whatsapp_agent: false,
    low_rotation_alerts: false,
    max_branches: 1,
  },
  premium: {
    ai_chat: true,
    ai_agents: true,
    sales_reports: true,
    stock_alerts: false,
    // Premium o superior: WhatsApp agent (recordatorios T-7/T-0, daily digest)
    // esta disponible desde Premium, no solo Enterprise. Enforcement real via
    // requirePremiumPlan() en internalReminderService.js — este flag es
    // documentacion, no se evalua directamente.
    whatsapp_agent: true,
    low_rotation_alerts: true,
    max_branches: 3,
  },
  enterprise: {
    ai_chat: true,
    ai_agents: true,
    sales_reports: true,
    stock_alerts: true,
    // Enforcement real via requirePremiumPlan() en internalReminderService.js
    // — este flag es documentacion, no se evalua directamente.
    whatsapp_agent: true,
    low_rotation_alerts: true,
    max_branches: 5,
  },
};

function resolvePlanKey(planName) {
  if (!planName) return "basico";
  const normalized = planName.toLowerCase().trim();
  if (normalized.includes("enterprise")) return "enterprise";
  if (normalized.includes("premium")) return "premium";
  return "basico";
}

function getPlanFeatures(planName) {
  return PLAN_FEATURES[resolvePlanKey(planName)] || PLAN_FEATURES.basico;
}

// Moved here from alertConfigService.js (originally written for the
// low-rotation alert gate) — this check is plan-generic, not alert-specific,
// so it belongs next to resolvePlanKey/getPlanFeatures. Also reused by
// internalReminderService.js (WhatsApp reminders / daily digest).
async function requirePremiumPlan(businessId) {
  const { rows } = await pool.query(
    `SELECT plan_name FROM business_subscriptions WHERE business_id = $1 LIMIT 1`,
    [businessId]
  );
  const planKey = resolvePlanKey(rows[0]?.plan_name);
  if (planKey !== "premium" && planKey !== "enterprise") {
    throw new ApiError(403, "Esta función requiere un plan Premium o superior");
  }
  return planKey;
}

module.exports = { PLAN_FEATURES, resolvePlanKey, getPlanFeatures, requirePremiumPlan };
