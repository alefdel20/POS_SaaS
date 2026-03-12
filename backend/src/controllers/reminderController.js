const { body, param } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const reminderService = require("../services/reminderService");

const idValidation = [param("id").isInt(), validateRequest];
const createValidation = [
  body("title").trim().notEmpty(),
  body("status").optional().isIn(["pending", "in_progress", "completed"]),
  body("due_date").optional({ nullable: true }).isISO8601(),
  body("assigned_to").optional({ nullable: true }).isInt(),
  validateRequest
];
const updateValidation = [
  body("title").optional().trim().notEmpty(),
  body("status").optional().isIn(["pending", "in_progress", "completed"]),
  body("due_date").optional({ nullable: true }).isISO8601(),
  body("assigned_to").optional({ nullable: true }).isInt(),
  validateRequest
];

const listReminders = asyncHandler(async (req, res) => {
  res.json(await reminderService.listReminders());
});

const createReminder = asyncHandler(async (req, res) => {
  res.status(201).json(await reminderService.createReminder({ ...req.body, created_by: req.user.id }));
});

const updateReminder = asyncHandler(async (req, res) => {
  res.json(await reminderService.updateReminder(Number(req.params.id), req.body));
});

const completeReminder = asyncHandler(async (req, res) => {
  res.json(await reminderService.completeReminder(Number(req.params.id)));
});

module.exports = {
  idValidation,
  createValidation,
  updateValidation,
  listReminders,
  createReminder,
  updateReminder,
  completeReminder
};
