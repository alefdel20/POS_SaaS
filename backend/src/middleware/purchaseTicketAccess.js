// Gate for "Cargar ticket" (restock ticket extraction). Runs after
// requireRole/requireStockControl and before the AI quota, in this order:
// plan Premium or higher, the business switch, and for cajero also
// cashier_direct_stock. Reads only, always scoped to the actor's business.
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { normalizeRole } = require("../utils/roles");
const { requireActorBusinessId } = require("../utils/tenant");
const { requirePremiumPlan } = require("../config/planFeatures");
const profileService = require("../services/profileService");

const requirePurchaseTicketAccess = asyncHandler(async (req, res, next) => {
  const businessId = requireActorBusinessId(req.user);

  // Same rule as everywhere else: an expired trial counts as Básico.
  await requirePremiumPlan(businessId);

  if (!(await profileService.isTicketAiEnabled(req.user))) {
    throw new ApiError(403, "La carga de tickets con IA no está activada para este negocio.");
  }

  if (normalizeRole(req.user.role) === "cajero" && !(await profileService.isCashierDirectStockEnabled(req.user))) {
    throw new ApiError(403, "El cajero no tiene permitido ajustar existencias en este negocio.");
  }

  next();
});

// Gate for confirming / voiding a ticket (moves stock, costs and an expense).
// Cajero is already out by requireRole. Same plan and switch as extract, plus
// the business switch general_settings.ticket_ai_confirm_enabled. No AI quota:
// confirming makes no model call.
const requirePurchaseTicketConfirmAccess = asyncHandler(async (req, res, next) => {
  const businessId = requireActorBusinessId(req.user);

  await requirePremiumPlan(businessId);

  if (!(await profileService.isTicketAiEnabled(req.user))) {
    throw new ApiError(403, "La carga de tickets con IA no está activada para este negocio.");
  }

  if (!(await profileService.isTicketAiConfirmEnabled(req.user))) {
    throw new ApiError(403, "La confirmación de tickets de compra no está activada para este negocio.");
  }

  next();
});

module.exports = { requirePurchaseTicketAccess, requirePurchaseTicketConfirmAccess };
