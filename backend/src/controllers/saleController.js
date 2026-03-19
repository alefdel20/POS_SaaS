const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const saleService = require("../services/saleService");

const listValidation = [
  query("date").optional({ values: "falsy" }).isISO8601(),
  query("date_from").optional({ values: "falsy" }).isISO8601(),
  query("date_to").optional({ values: "falsy" }).isISO8601(),
  query("user_id").optional({ values: "falsy" }).isInt(),
  query("cashier").optional({ values: "falsy" }).trim(),
  query("payment_method").optional().isIn(["cash", "card", "credit", "transfer"]),
  query("total").optional({ values: "falsy" }).isFloat({ min: 0 }),
  query("total_min").optional({ values: "falsy" }).isFloat({ min: 0 }),
  query("total_max").optional({ values: "falsy" }).isFloat({ min: 0 }),
  query("folio").optional({ values: "falsy" }).trim(),
  validateRequest
];
const saleIdValidation = [param("id").isInt(), validateRequest];
const trendsValidation = [
  query("period").isIn(["week", "month", "year"]),
  validateRequest
];
const createValidation = [
  body("payment_method").isIn(["cash", "card", "credit", "transfer"]),
  body("sale_type").optional().isIn(["ticket", "invoice"]),
  body("customer.name").optional({ values: "falsy" }).trim(),
  body("customer.phone").optional({ values: "falsy" }).trim(),
  body("initial_payment").optional().isFloat({ min: 0 }),
  body("invoice_data").optional().isObject(),
  body("items").isArray({ min: 1 }),
  body("items.*.product_id").isInt(),
  body("items.*.quantity").isFloat({ gt: 0 }),
  body("items.*.unit_price").optional().isFloat({ min: 0 }),
  validateRequest
];

const listSales = asyncHandler(async (req, res) => {
  res.json(await saleService.listSales(req.query));
});

const listRecentSales = asyncHandler(async (req, res) => {
  res.json(await saleService.listRecentSales());
});

const getSaleDetail = asyncHandler(async (req, res) => {
  res.json(await saleService.getSaleDetail(Number(req.params.id)));
});

const getSalesTrends = asyncHandler(async (req, res) => {
  res.json(await saleService.getSalesTrends(req.query.period));
});

const createSale = asyncHandler(async (req, res) => {
  res.status(201).json(await saleService.createSale(req.body, req.user));
});

module.exports = {
  listValidation,
  saleIdValidation,
  trendsValidation,
  createValidation,
  listSales,
  listRecentSales,
  getSaleDetail,
  getSalesTrends,
  createSale
};
