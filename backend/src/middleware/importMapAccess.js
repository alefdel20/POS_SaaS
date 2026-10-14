// Gate for "Mapear columnas con IA": plan Premium or higher, with the same
// rule as everywhere else (an expired trial counts as Básico). Runs after
// requireRole and before the AI quota.
const asyncHandler = require("../utils/asyncHandler");
const { requireActorBusinessId } = require("../utils/tenant");
const { requirePremiumPlan } = require("../config/planFeatures");

const requireImportMapPlan = asyncHandler(async (req, res, next) => {
  await requirePremiumPlan(requireActorBusinessId(req.user));
  next();
});

module.exports = { requireImportMapPlan };
