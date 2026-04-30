const branchService = require("../services/branchService");
const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");

const BRANCH_LIMITS = {
  basic: 1,
  starter: 1,
  duo: 1,
  "pro-caja": 1,
  monthly: 1,
  yearly: 1,
  premium: 3,
  "all-inclusive": 5,
  enterprise: 5
};

function getBranchLimit({ planType, planName }) {
  const name = String(planName || "").toLowerCase().trim();
  if (name.includes("premium")) return 3;
  if (name.includes("enterprise") || name.includes("all-inclusive") || name.includes("all inclusive")) return 5;
  if (
    name.includes("básico") || name.includes("basico") || name.includes("starter") ||
    name.includes("dúo") || name.includes("duo") || name.includes("pro-caja")
  ) return 1;
  const type = String(planType || "").toLowerCase();
  return BRANCH_LIMITS[type] ?? 1;
}

async function getPlanType(businessId) {
  const { rows } = await pool.query(
    `SELECT plan_type, plan_name FROM business_subscriptions WHERE business_id = $1 LIMIT 1`,
    [Number(businessId)]
  );
  return {
    planType: rows[0]?.plan_type || null,
    planName: rows[0]?.plan_name || null
  };
}

async function getBranches(req, res, next) {
  try {
    const businessId = req.auth.business_id;
    const branches = await branchService.getBranchesByBusiness(businessId);
    res.json({ branches });
  } catch (error) {
    next(error);
  }
}

async function getBranchById(req, res, next) {
  try {
    const businessId = req.auth.business_id;
    const { branchId } = req.params;
    const branch = await branchService.getBranchById(branchId, businessId);
    if (!branch) throw new ApiError(404, "Sucursal no encontrada");
    res.json({ branch });
  } catch (error) {
    next(error);
  }
}

async function createBranch(req, res, next) {
  try {
    const businessId = req.auth.business_id;
    const { name, pos_type, address, phone } = req.body;

    if (!name || !pos_type) {
      throw new ApiError(400, "name y pos_type son requeridos");
    }

    const planInfo = await getPlanType(businessId);
    const limit = getBranchLimit(planInfo);
    const current = await branchService.countActiveBranches(businessId);

    if (current >= limit) {
      throw new ApiError(403, `Tu plan permite un máximo de ${limit} sucursal(es) activa(s)`);
    }

    const branch = await branchService.createBranch(businessId, { name, pos_type, address, phone });
    res.status(201).json({ branch });
  } catch (error) {
    next(error);
  }
}

async function updateBranch(req, res, next) {
  try {
    const businessId = req.auth.business_id;
    const { branchId } = req.params;
    const branch = await branchService.updateBranch(branchId, businessId, req.body);
    if (!branch) throw new ApiError(404, "Sucursal no encontrada");
    res.json({ branch });
  } catch (error) {
    next(error);
  }
}

async function deactivateBranch(req, res, next) {
  try {
    const businessId = req.auth.business_id;
    const { branchId } = req.params;

    const existing = await branchService.getBranchById(branchId, businessId);
    if (!existing) throw new ApiError(404, "Sucursal no encontrada");
    if (existing.is_default) throw new ApiError(400, "No se puede desactivar la sucursal predeterminada");

    const branch = await branchService.deactivateBranch(branchId, businessId);
    if (!branch) throw new ApiError(404, "Sucursal no encontrada");
    res.json({ branch });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getBranches,
  getBranchById,
  createBranch,
  updateBranch,
  deactivateBranch
};
