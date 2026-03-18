const { body } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const authService = require("../services/authService");
const userService = require("../services/userService");

const loginValidation = [
  body("identifier").trim().notEmpty(),
  body("password").trim().notEmpty(),
  validateRequest
];
const changePasswordValidation = [
  body("current_password").trim().notEmpty(),
  body("new_password").isLength({ min: 8 }),
  validateRequest
];

const login = asyncHandler(async (req, res) => {
  res.json(await authService.login(req.body.identifier, req.body.password));
});

const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user });
});

const changePassword = asyncHandler(async (req, res) => {
  res.json(await userService.changeOwnPassword(req.user.id, req.body));
});

module.exports = {
  loginValidation,
  changePasswordValidation,
  login,
  me
  ,
  changePassword
};
