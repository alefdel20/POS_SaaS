const { body } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const authService = require("../services/authService");
const userService = require("../services/userService");
const { BUSINESS_TYPE_OPTIONS } = require("../utils/business");

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
const registerBusinessValidation = [
  body("full_name").trim().notEmpty(),
  body("business_name").trim().notEmpty(),
  body("username").trim().notEmpty(),
  body("email").isEmail(),
  body("password").isLength({ min: 8 }),
  body("role").isIn(["superusuario", "superadmin", "admin"]),
  body("business_type").isIn(BUSINESS_TYPE_OPTIONS),
  body("pos_type").optional({ values: "falsy" }).trim(),
  validateRequest
];

const login = asyncHandler(async (req, res) => {
  res.json(await authService.login(req.body.identifier, req.body.password));
});

const registerBusiness = asyncHandler(async (req, res) => {
  res.status(201).json(await authService.registerBusiness(req.body));
});

const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user });
});

const changePassword = asyncHandler(async (req, res) => {
  res.json(await userService.changeOwnPassword(req.user.id, { ...req.body, actor: req.user }));
});

module.exports = {
  loginValidation,
  changePasswordValidation,
  registerBusinessValidation,
  login,
  registerBusiness,
  me
  ,
  changePassword
};
