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
//
// Trial policy: business_subscriptions.plan_name is set to 'Premium' for the
// whole 7-day trial (initializeBusinessSubscriptionForNewBusiness) so trial
// businesses get full Premium access while the trial is live. Once
// trial_ends_at passes without the business activating a paid plan, this
// must degrade back to Básico for gating purposes.
//
// Resolved at READ TIME here (trial_expired computed in SQL, same
// `trial_ends_at IS NOT NULL AND trial_ends_at < NOW()` shape already used by
// paymentProvisioningService.js:210 and adminMetricsService.js:58-59) rather
// than by a cron that overwrites plan_name in the row. Two reasons:
//   1. Consistency — deriveSubscriptionState/mapBusinessSubscription
//      (businessSubscriptionService.js:107-191) already derive
//      subscription_status/should_block from trial_ends_at on every read,
//      never by mutating the row. A cron here would be a second, divergent
//      way of answering the same "is this business still on its trial"
//      question.
//   2. This is the ONLY place that needs the degrade-at-expiry behavior:
//      assertBusinessAccessAllowed (businessSubscriptionService.js:686-709,
//      wired into every authenticated request via authMiddleware.js:84)
//      already hard-blocks (403) normal user sessions the instant a trial
//      expires — plan_name never actually gets read for an expired-trial
//      user through that path. The real gap is /internal/* (ankode-agent):
//      those routes use requireInternalToken, never requireAuth, so they
//      never hit assertBusinessAccessAllowed and would otherwise keep
//      treating an expired trial as Premium forever. A cron degrading
//      plan_name would also lose the historical record of which tier the
//      business was actually trialing; resolving it at read time keeps
//      plan_name = 'Premium' as that record while still gating correctly.
// trial_ends_at is left untouched either way — it stays the source of truth
// for "was/is this business on a trial", same as everywhere else reads it.
async function requirePremiumPlan(businessId) {
  const { rows } = await pool.query(
    `SELECT plan_name,
            (trial_ends_at IS NOT NULL AND trial_ends_at < NOW()) AS trial_expired
     FROM business_subscriptions
     WHERE business_id = $1
     LIMIT 1`,
    [businessId]
  );
  const row = rows[0];
  const effectivePlanName = row?.trial_expired ? null : row?.plan_name;
  const planKey = resolvePlanKey(effectivePlanName);
  if (planKey !== "premium" && planKey !== "enterprise") {
    throw new ApiError(403, "Esta función requiere un plan Premium o superior");
  }
  return planKey;
}

module.exports = { PLAN_FEATURES, resolvePlanKey, getPlanFeatures, requirePremiumPlan };
