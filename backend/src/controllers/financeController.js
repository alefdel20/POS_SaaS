const { body, param } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const financeService = require("../services/financeService");
const FIXED_EXPENSE_FREQUENCIES = ["weekly", "biweekly", "monthly", "bimonthly", "quarterly", "semiannual", "annual", "custom", "semanal", "quincenal", "mensual"];

const expenseIdValidation = [param("id").isInt(), validateRequest];
const fixedExpenseIdValidation = [param("id").isInt(), validateRequest];
const ownerLoanIdValidation = [param("id").isInt(), validateRequest];

const createExpenseValidation = [
  body("concept").trim().notEmpty(),
  body("category").optional({ values: "falsy" }).trim(),
  body("amount").isFloat({ gt: 0 }),
  body("date").optional({ values: "falsy" }).isISO8601(),
  body("notes").optional({ values: "falsy" }).trim(),
  body("payment_method").optional().isIn(["cash", "card", "credit", "transfer"]),
  body("fixed_expense_id").optional({ values: "falsy" }).isInt(),
  validateRequest
];

const updateExpenseValidation = [
  param("id").isInt(),
  body("concept").optional().trim().notEmpty(),
  body("category").optional({ values: "falsy" }).trim(),
  body("amount").optional().isFloat({ gt: 0 }),
  body("date").optional({ values: "falsy" }).isISO8601(),
  body("notes").optional({ values: "falsy" }).trim(),
  body("payment_method").optional().isIn(["cash", "card", "credit", "transfer"]),
  body("fixed_expense_id").optional({ values: "falsy" }).isInt(),
  body("reason").optional({ values: "falsy" }).trim(),
  validateRequest
];

const voidExpenseValidation = [
  param("id").isInt(),
  body("reason").trim().notEmpty(),
  validateRequest
];

const createOwnerLoanValidation = [
  body("amount").isFloat({ gt: 0 }),
  body("type").isIn(["entrada", "abono"]),
  body("date").optional({ values: "falsy" }).isISO8601(),
  body("notes").trim().notEmpty(),
  validateRequest
];

const voidOwnerLoanValidation = [
  param("id").isInt(),
  body("reason").trim().notEmpty(),
  validateRequest
];

const createFixedExpenseValidation = [
  body("name").trim().notEmpty(),
  body("category").optional({ values: "falsy" }).trim(),
  body("default_amount").isFloat({ min: 0 }),
  body("frequency").optional().isIn(FIXED_EXPENSE_FREQUENCIES),
  body("payment_method").optional().isIn(["cash", "card", "credit", "transfer"]),
  body("due_day").optional({ values: "falsy" }).isInt({ min: 1, max: 31 }),
  body("base_date").optional({ values: "falsy" }).isISO8601(),
  body("notes").optional({ values: "falsy" }).trim(),
  validateRequest
];

const updateFixedExpenseValidation = [
  param("id").isInt(),
  body("name").optional().trim().notEmpty(),
  body("category").optional({ values: "falsy" }).trim(),
  body("default_amount").optional().isFloat({ min: 0 }),
  body("frequency").optional().isIn(FIXED_EXPENSE_FREQUENCIES),
  body("payment_method").optional().isIn(["cash", "card", "credit", "transfer"]),
  body("due_day").optional({ values: "falsy" }).isInt({ min: 1, max: 31 }),
  body("base_date").optional({ values: "falsy" }).isISO8601(),
  body("notes").optional({ values: "falsy" }).trim(),
  body("is_active").optional().isBoolean(),
  validateRequest
];

const listExpenses = asyncHandler(async (req, res) => {
  res.json(await financeService.listExpenses(req.user));
});

const createExpense = asyncHandler(async (req, res) => {
  res.status(201).json(await financeService.createExpense(req.body, req.user));
});

const updateExpense = asyncHandler(async (req, res) => {
  res.json(await financeService.updateExpense(Number(req.params.id), req.body, req.user));
});

const voidExpense = asyncHandler(async (req, res) => {
  res.json(await financeService.voidExpense(Number(req.params.id), req.body, req.user));
});

const listOwnerLoans = asyncHandler(async (req, res) => {
  res.json(await financeService.listOwnerLoans(req.user));
});

const createOwnerLoan = asyncHandler(async (req, res) => {
  res.status(201).json(await financeService.createOwnerLoan(req.body, req.user));
});

const voidOwnerLoan = asyncHandler(async (req, res) => {
  res.json(await financeService.voidOwnerLoan(Number(req.params.id), req.body, req.user));
});

const listFixedExpenses = asyncHandler(async (req, res) => {
  res.json(await financeService.listFixedExpenses(req.user));
});

const createFixedExpense = asyncHandler(async (req, res) => {
  res.status(201).json(await financeService.createFixedExpense(req.body, req.user));
});

const updateFixedExpense = asyncHandler(async (req, res) => {
  res.json(await financeService.updateFixedExpense(Number(req.params.id), req.body, req.user));
});

const getDashboard = asyncHandler(async (req, res) => {
  res.json(await financeService.getDashboard(req.user));
});

module.exports = {
  expenseIdValidation,
  fixedExpenseIdValidation,
  ownerLoanIdValidation,
  createExpenseValidation,
  updateExpenseValidation,
  voidExpenseValidation,
  createOwnerLoanValidation,
  voidOwnerLoanValidation,
  createFixedExpenseValidation,
  updateFixedExpenseValidation,
  listExpenses,
  createExpense,
  updateExpense,
  voidExpense,
  listOwnerLoans,
  createOwnerLoan,
  voidOwnerLoan,
  listFixedExpenses,
  createFixedExpense,
  updateFixedExpense,
  getDashboard
};
