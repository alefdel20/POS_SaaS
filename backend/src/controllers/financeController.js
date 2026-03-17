const { body } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const financeService = require("../services/financeService");

const createExpenseValidation = [
  body("concept").trim().notEmpty(),
  body("category").optional({ values: "falsy" }).trim(),
  body("amount").isFloat({ gt: 0 }),
  body("date").optional({ values: "falsy" }).isISO8601(),
  body("notes").optional({ values: "falsy" }).trim(),
  body("payment_method").optional().isIn(["cash", "card", "credit", "transfer"]),
  validateRequest
];

const createOwnerLoanValidation = [
  body("amount").isFloat({ gt: 0 }),
  body("type").isIn(["entrada", "abono"]),
  body("date").optional({ values: "falsy" }).isISO8601(),
  validateRequest
];

const listExpenses = asyncHandler(async (_req, res) => {
  res.json(await financeService.listExpenses());
});

const createExpense = asyncHandler(async (req, res) => {
  res.status(201).json(await financeService.createExpense(req.body));
});

const listOwnerLoans = asyncHandler(async (_req, res) => {
  res.json(await financeService.listOwnerLoans());
});

const createOwnerLoan = asyncHandler(async (req, res) => {
  res.status(201).json(await financeService.createOwnerLoan(req.body));
});

const getDashboard = asyncHandler(async (_req, res) => {
  res.json(await financeService.getDashboard());
});

module.exports = {
  createExpenseValidation,
  createOwnerLoanValidation,
  listExpenses,
  createExpense,
  listOwnerLoans,
  createOwnerLoan,
  getDashboard
};
