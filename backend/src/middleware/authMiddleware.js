const jwt = require("jsonwebtoken");
const { jwtSecret } = require("../config/env");
const ApiError = require("../utils/ApiError");
const userService = require("../services/userService");
const { normalizeRole } = require("../utils/roles");

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
    const user = await userService.getUserById(payload.userId);

    if (!user || !user.is_active) {
      return next(new ApiError(401, "Invalid session"));
    }

    req.user = userService.sanitizeUser(user);
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
