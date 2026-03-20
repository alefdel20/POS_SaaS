const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { jwtSecret } = require("../config/env");
const ApiError = require("../utils/ApiError");
const userService = require("./userService");

function signToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      businessId: user.business_id
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
