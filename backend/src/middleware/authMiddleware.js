const jwt = require("jsonwebtoken");
const { jwtSecret } = require("../config/env");
const ApiError = require("../utils/ApiError");
const userService = require("../services/userService");
const { normalizeRole } = require("../utils/roles");
const { requireActorBusinessId } = require("../utils/tenant");

async function requireAuth(req, res, next) {
    if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(new ApiError(401, "Authentication required"));
  }

  try {
    const token = authHeader.split(" ")[1];
    const payload = jwt.verify(token, jwtSecret);
    if (payload.businessId === null || payload.businessId === undefined) {
      return next(new ApiError(401, "Session business context is missing"));
    }

    const user = await userService.getUserById(payload.userId, payload.businessId);

    if (!user || !user.is_active) {
      return next(new ApiError(401, "Invalid session"));
    }

    const userBusinessId = requireActorBusinessId(user);

    if (Number(payload.businessId) !== userBusinessId) {
      return next(new ApiError(401, "Session business context is invalid"));
    }

    req.user = userService.sanitizeUser(user);
    req.auth = {
      user_id: payload.userId,
      role: payload.role,
      business_id: userBusinessId
    };
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

module.exports = {
  requireAuth,
  requireRole
};
