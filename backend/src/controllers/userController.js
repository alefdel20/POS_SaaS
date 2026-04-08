const { body, param } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const userService = require("../services/userService");
const { normalizeRole } = require("../utils/roles");
const { USER_ROLES } = require("../utils/domainEnums");

const idValidation = [param("id").isInt(), validateRequest];
const createValidation = [
  body("username").trim().notEmpty(),
  body("email").isEmail(),
  body("full_name").trim().notEmpty(),
  body("phone").optional({ values: "falsy" }).trim(),
  body("professional_license").optional({ values: "falsy" }).trim(),
  body("specialty").optional({ values: "falsy" }).trim(),
  body("theme_preference").optional().isIn(["light", "dark"]),
  body("role").custom((value) => Boolean(value && USER_ROLES.includes(normalizeRole(value)))),
  body("password").isLength({ min: 8 }),
  body("is_active").optional().isBoolean(),
  body("must_change_password").optional().isBoolean(),
  validateRequest
];
const updateValidation = [
  body("username").optional().trim().notEmpty(),
  body("email").optional().isEmail(),
  body("full_name").optional().trim().notEmpty(),
  body("phone").optional({ values: "falsy" }).trim(),
  body("professional_license").optional({ values: "falsy" }).trim(),
  body("specialty").optional({ values: "falsy" }).trim(),
  body("theme_preference").optional().isIn(["light", "dark"]),
  body("role").optional().custom((value) => Boolean(value && USER_ROLES.includes(normalizeRole(value)))),
  body("password").optional().isLength({ min: 8 }),
  body("is_active").optional().isBoolean(),
  body("must_change_password").optional().isBoolean(),
  validateRequest
];
const statusValidation = [body("is_active").isBoolean(), validateRequest];
const resetPasswordValidation = [
  param("id").isInt(),
  body("new_password").optional({ values: "falsy" }).isLength({ min: 8 }),
  body("force_change").optional().isBoolean(),
  validateRequest
];
const supportAccessValidation = [
  param("id").isInt(),
  body("reason").optional({ values: "falsy" }).trim(),
  validateRequest
];
const supportModeValidation = [
  param("id").isInt(),
  body("reason").trim().notEmpty(),
  validateRequest
];

const listUsers = asyncHandler(async (req, res) => {
  res.json(await userService.listUsersWithFilters(req.user, {
    role: req.query.role,
    active: req.query.active === undefined ? undefined : req.query.active === "true"
  }));
});

const createUser = asyncHandler(async (req, res) => {
  res.status(201).json(await userService.createUser(req.body, req.user));
});

const updateUser = asyncHandler(async (req, res) => {
  res.json(await userService.updateUser(Number(req.params.id), req.body, req.user));
});

const updateUserStatus = asyncHandler(async (req, res) => {
  res.json(await userService.updateUserStatus(Number(req.params.id), req.body.is_active, req.user));
});

const resetPassword = asyncHandler(async (req, res) => {
  res.json(await userService.resetUserPassword(Number(req.params.id), req.body, req.user));
});

const supportAccess = asyncHandler(async (req, res) => {
  res.json(await userService.logSupportAccess(Number(req.params.id), req.user, req.body.reason));
});

const activateSupportMode = asyncHandler(async (req, res) => {
  res.json(await userService.activateSupportMode(Number(req.params.id), req.user, req.body.reason));
});

const deactivateSupportMode = asyncHandler(async (req, res) => {
  res.json(await userService.deactivateSupportMode(Number(req.params.id), req.user, req.body.reason));
});

module.exports = {
  idValidation,
  createValidation,
  updateValidation,
  statusValidation,
  resetPasswordValidation,
  supportAccessValidation,
  supportModeValidation,
  listUsers,
  createUser,
  updateUser,
  updateUserStatus,
  resetPassword,
  supportAccess,
  activateSupportMode,
  deactivateSupportMode
};
