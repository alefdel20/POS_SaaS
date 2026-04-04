const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const creditCollectionService = require("../services/creditCollectionService");

const listDebtorsValidation = [
  query("search").optional({ values: "falsy" }).trim(),
  query("status").optional({ values: "falsy" }).isIn(["pending", "overdue"]),
  validateRequest
];
const saleIdValidation = [param("saleId").isInt(), validateRequest];
const createPaymentValidation = [
  param("saleId").isInt(),
  body("amount").isFloat({ gt: 0 }),
  body("payment_method").isIn(["cash", "card", "credit", "transfer"]),
  body("payment_date").optional({ values: "falsy" }).isISO8601(),
  body("notes").optional({ values: "falsy" }).trim(),
  validateRequest
];
const reminderPreferenceValidation = [
  param("saleId").isInt(),
  body("send_reminder").isBoolean(),
  validateRequest
];

const listDebtors = asyncHandler(async (req, res) => {
  res.json(await creditCollectionService.listDebtors(req.user, {
    search: req.query.search,
    status: req.query.status
  }));
});

const listPaymentsBySale = asyncHandler(async (req, res) => {
  res.json(await creditCollectionService.listPaymentsBySale(Number(req.params.saleId), req.user));
});

const createPayment = asyncHandler(async (req, res) => {
  res.status(201).json(await creditCollectionService.createPayment(Number(req.params.saleId), req.body, req.user));
});

const updateReminderPreference = asyncHandler(async (req, res) => {
  res.json(await creditCollectionService.updateReminderPreference(Number(req.params.saleId), req.body.send_reminder, req.user));
});

module.exports = {
  listDebtorsValidation,
  saleIdValidation,
  createPaymentValidation,
  reminderPreferenceValidation,
  listDebtors,
  listPaymentsBySale,
  createPayment,
  updateReminderPreference
};
