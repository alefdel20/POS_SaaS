const { body, param } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const userService = require("../services/userService");

const idValidation = [param("id").isInt(), validateRequest];
const createValidation = [
  body("username").trim().notEmpty(),
  body("email").isEmail(),
  body("full_name").trim().notEmpty(),
  body("role").isIn(["superadmin", "user"]),
  body("password").isLength({ min: 8 }),
  body("is_active").optional().isBoolean(),
  validateRequest
];
const updateValidation = [
  body("username").optional().trim().notEmpty(),
  body("email").optional().isEmail(),
  body("full_name").optional().trim().notEmpty(),
  body("role").optional().isIn(["superadmin", "user"]),
  body("password").optional().isLength({ min: 8 }),
  body("is_active").optional().isBoolean(),
  validateRequest
];
const statusValidation = [body("is_active").isBoolean(), validateRequest];

const listUsers = asyncHandler(async (req, res) => {
  res.json(await userService.listUsers());
});

const createUser = asyncHandler(async (req, res) => {
  res.status(201).json(await userService.createUser(req.body));
});

const updateUser = asyncHandler(async (req, res) => {
  res.json(await userService.updateUser(Number(req.params.id), req.body));
});

const updateUserStatus = asyncHandler(async (req, res) => {
  res.json(await userService.updateUserStatus(Number(req.params.id), req.body.is_active));
});

module.exports = {
  idValidation,
  createValidation,
  updateValidation,
  statusValidation,
  listUsers,
  createUser,
  updateUser,
  updateUserStatus
};
