const { body, param } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const creditCollectionService = require("../services/creditCollectionService");

const saleIdValidation = [param("saleId").isInt(), validateRequest];
const createPaymentValidation = [
  param("saleId").isInt(),
  body("amount").isFloat({ gt: 0 }),
  body("payment_method").isIn(["cash", "card", "credit", "transfer"]),
  body("payment_date").optional({ values: "falsy" }).isISO8601(),
  body("notes").optional({ values: "falsy" }).trim(),
  validateRequest
];

const listDebtors = asyncHandler(async (_req, res) => {
  res.json(await creditCollectionService.listDebtors());
});

const listPaymentsBySale = asyncHandler(async (req, res) => {
  res.json(await creditCollectionService.listPaymentsBySale(Number(req.params.saleId)));
});

const createPayment = asyncHandler(async (req, res) => {
  res.status(201).json(await creditCollectionService.createPayment(Number(req.params.saleId), req.body));
});

module.exports = {
  saleIdValidation,
  createPaymentValidation,
  listDebtors,
  listPaymentsBySale,
  createPayment
};
