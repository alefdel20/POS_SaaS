const jwt = require("jsonwebtoken");
const { jwtSecret } = require("../config/env");
const ApiError = require("../utils/ApiError");
const userService = require("../services/userService");
const { normalizeRole } = require("../utils/roles");
const { requireActorBusinessId } = require("../utils/tenant");
const { assertBusinessAccessAllowed } = require("../services/businessSubscriptionService");

async function requireAuth(req, res, next) {
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader) {
    return next(new ApiError(401, "Authentication required"));
  }

  const [scheme, token] = String(authHeader).trim().split(/\s+/);

  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return next(new ApiError(401, "Authentication required"));
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    const user = await userService.getUserByAuthId(payload.userId);

    if (!user || !user.is_active) {
      return next(new ApiError(401, "Invalid session"));
    }

    const userBusinessId = requireActorBusinessId(user);
    if (Number(payload.businessId) !== userBusinessId) {
      return next(new ApiError(401, "Session business context is invalid"));
    }

    let effectiveUser = userService.sanitizeUser(user);
    let effectiveBusinessId = userBusinessId;

    if (payload.supportSessionId !== null && payload.supportSessionId !== undefined) {
      if (normalizeRole(user.role) !== "superusuario") {
        return next(new ApiError(403, "Forbidden"));
      }

      const supportSession = await userService.getSupportSessionById(Number(payload.supportSessionId), user.id);
      if (!supportSession) {
        return next(new ApiError(401, "Support session is invalid or expired"));
      }

      effectiveBusinessId = Number(supportSession.target_business_id);
      effectiveUser = {
        ...effectiveUser,
        business_id: effectiveBusinessId,
        business_name: supportSession.target_business_name,
        business_slug: supportSession.target_business_slug,
        pos_type: supportSession.target_business_pos_type,
        support_session_id: Number(supportSession.id),
        support_context: {
          session_id: Number(supportSession.id),
          actor_user_id: Number(supportSession.actor_user_id),
          target_user_id: Number(supportSession.target_user_id),
          actor_business_id: Number(supportSession.actor_business_id),
          business_id: effectiveBusinessId,
          business_name: supportSession.target_business_name,
          business_slug: supportSession.target_business_slug,
          pos_type: supportSession.target_business_pos_type,
          reason: supportSession.reason || "",
          started_at: supportSession.started_at,
          expires_at: supportSession.expires_at
        }
      };
    }

    req.user = effectiveUser;
    req.auth = {
      user_id: payload.userId,
      role: payload.role,
      business_id: effectiveBusinessId,
    };

    await assertBusinessAccessAllowed(effectiveUser);

    next();
  } catch (error) {
    next(error.statusCode ? error : new ApiError(401, "Invalid or expired token"));
  }
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, "Authentication required"));
    }

    const allowedRoles = roles.map(normalizeRole);
    const userRole = normalizeRole(req.user.role);

    if (!allowedRoles.includes(userRole)) {
      return next(new ApiError(403, "Forbidden"));
    }

    next();
  };
}

function requireClinicalAccess(req, res, next) {
  if (!req.user) {
    return next(new ApiError(401, "Authentication required"));
  }

  const userRole = normalizeRole(req.user.role);
  if (!["superusuario", "admin", "clinico"].includes(userRole || "")) {
    return next(new ApiError(403, "Forbidden"));
  }

  next();
}

module.exports = {
  requireAuth,
  requireRole,
  requireClinicalAccess,
};
