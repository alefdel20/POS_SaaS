const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const reminderService = require("../services/reminderService");
const { REMINDER_CATEGORIES, REMINDER_STATUSES } = require("../utils/domainEnums");

const idValidation = [param("id").isInt(), validateRequest];
const listValidation = [
  query("category").optional().isIn(REMINDER_CATEGORIES),
  query("status").optional().isIn(REMINDER_STATUSES),
  validateRequest
];
const createValidation = [
  body("title").trim().notEmpty(),
  body("status").optional().isIn(REMINDER_STATUSES),
  body("due_date").optional({ nullable: true }).isISO8601(),
  body("assigned_to").optional({ nullable: true }).isInt(),
  body("reminder_type").optional().trim(),
  body("category").optional().isIn(REMINDER_CATEGORIES),
  body("patient_id").optional({ nullable: true }).isInt(),
  validateRequest
];
const updateValidation = [
  body("title").optional().trim().notEmpty(),
  body("status").optional().isIn(REMINDER_STATUSES),
  body("due_date").optional({ nullable: true }).isISO8601(),
  body("assigned_to").optional({ nullable: true }).isInt(),
  body("reminder_type").optional().trim(),
  body("category").optional().isIn(REMINDER_CATEGORIES),
  body("patient_id").optional({ nullable: true }).isInt(),
  validateRequest
];
const sendValidation = [
  body("sale_id").optional().isInt(),
  body("phone").optional({ values: "falsy" }).trim(),
  body("message").optional({ values: "falsy" }).trim(),
  validateRequest
];
const webhookValidation = [
  body("event").optional({ values: "falsy" }).trim(),
  body("type").optional({ values: "falsy" }).trim(),
  validateRequest
];

const listReminders = asyncHandler(async (req, res) => {
  res.json(await reminderService.listReminders(req.user, req.query));
});

const createReminder = asyncHandler(async (req, res) => {
  res.status(201).json(await reminderService.createReminder({ ...req.body, created_by: req.user.id }, req.user));
});

const updateReminder = asyncHandler(async (req, res) => {
  res.json(await reminderService.updateReminder(Number(req.params.id), req.body, req.user));
});

const completeReminder = asyncHandler(async (req, res) => {
  res.json(await reminderService.completeReminder(Number(req.params.id), req.user));
});

const deleteReminder = asyncHandler(async (req, res) => {
  res.json(await reminderService.deleteReminder(Number(req.params.id), req.user));
});

const sendReminder = asyncHandler(async (req, res) => {
  res.json(await reminderService.sendReminder(req.body, req.user));
});

const receiveAutomationWebhook = asyncHandler(async (req, res) => {
  res.status(202).json(await reminderService.receiveAutomationWebhook(req.body));
});

module.exports = {
  idValidation,
  listValidation,
  createValidation,
  updateValidation,
  sendValidation,
  webhookValidation,
  listReminders,
  createReminder,
  updateReminder,
  completeReminder,
  deleteReminder,
  sendReminder,
  receiveAutomationWebhook
};
