const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { requireActorBusinessId } = require("../utils/tenant");
const { getMexicoCityDate } = require("../utils/timezone");

const LIMIT_MONTHLY = parseInt(process.env.AI_MONTHLY_LIMIT_PLUS) || 4000000;
const LIMIT_YEARLY = parseInt(process.env.AI_MONTHLY_LIMIT_ENTERPRISE) || 6000000;

const requireAiAccess = asyncHandler(async (req, res, next) => {
  const actor = req.user;
  const businessId = requireActorBusinessId(actor);

  const { rows: subRows } = await pool.query(
    `SELECT plan_type FROM business_subscriptions WHERE business_id = $1 LIMIT 1`,
    [businessId]
  );

  if (!subRows[0]) {
    throw new ApiError(403, "Tu plan no incluye asistente IA. Actualiza a Plus para acceder.");
  }

  const planType = subRows[0].plan_type;
  const tokensLimit = planType === "yearly" ? LIMIT_YEARLY : LIMIT_MONTHLY;

  const today = getMexicoCityDate();
  const [yearStr, monthStr] = today.split("-");
  const currentYear = Number(yearStr);
  const currentMonth = Number(monthStr);

  const { rows: usageRows } = await pool.query(
    `SELECT total_tokens_used FROM ai_token_usage
     WHERE business_id = $1 AND month = $2 AND year = $3
     LIMIT 1`,
    [businessId, currentMonth, currentYear]
  );

  const tokensUsed = usageRows[0] ? Number(usageRows[0].total_tokens_used) : 0;

  if (tokensUsed >= tokensLimit) {
    throw new ApiError(429, "Has alcanzado tu límite mensual de consultas IA.");
  }

  req.aiQuota = {
    used: tokensUsed,
    limit: tokensLimit,
    remaining: tokensLimit - tokensUsed
  };

  next();
});

module.exports = { requireAiAccess };
