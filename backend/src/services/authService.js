const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { jwtSecret } = require("../config/env");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");
const userService = require("./userService");

function signToken(user) {
  const businessId = requireActorBusinessId(user);
  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      businessId
    },
    jwtSecret,
    { expiresIn: "12h" }
  );
}

async function login(identifier, password) {
  const user = await userService.getUserByLogin(identifier);

  if (!user || !user.is_active) {
    throw new ApiError(401, "Invalid credentials");
  }

  requireActorBusinessId(user);

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    throw new ApiError(401, "Invalid credentials");
  }

  return {
    token: signToken(user),
    user: userService.sanitizeUser(user)
  };
}

module.exports = {
  login
};
