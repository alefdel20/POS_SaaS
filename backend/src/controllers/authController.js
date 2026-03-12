const { body } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const authService = require("../services/authService");

const loginValidation = [
  body("identifier").trim().notEmpty(),
  body("password").trim().notEmpty(),
  validateRequest
];

const login = asyncHandler(async (req, res) => {
  res.json(await authService.login(req.body.identifier, req.body.password));
});

const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user });
});

module.exports = {
  loginValidation,
  login,
  me
};
