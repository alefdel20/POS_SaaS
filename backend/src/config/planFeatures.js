const PLAN_FEATURES = {
  basico: {
    ai_chat: false,
    ai_agents: false,
    sales_reports: false,
    stock_alerts: false,
    whatsapp_agent: false,
    max_branches: 1,
  },
  premium: {
    ai_chat: true,
    ai_agents: true,
    sales_reports: true,
    stock_alerts: false,
    whatsapp_agent: false,
    max_branches: 3,
  },
  enterprise: {
    ai_chat: true,
    ai_agents: true,
    sales_reports: true,
    stock_alerts: true,
    whatsapp_agent: true,
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

module.exports = { PLAN_FEATURES, resolvePlanKey, getPlanFeatures };
