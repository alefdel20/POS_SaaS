const { body } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const saleService = require("../services/saleService");

const createValidation = [
  body("payment_method").isIn(["cash", "card", "credit", "transfer"]),
  body("sale_type").optional().isIn(["ticket", "invoice"]),
  body("items").isArray({ min: 1 }),
  body("items.*.product_id").isInt(),
  body("items.*.quantity").isFloat({ gt: 0 }),
  body("items.*.unit_price").optional().isFloat({ min: 0 }),
  validateRequest
];

const listSales = asyncHandler(async (req, res) => {
  res.json(await saleService.listSales());
});

const listRecentSales = asyncHandler(async (req, res) => {
  res.json(await saleService.listRecentSales());
});

const createSale = asyncHandler(async (req, res) => {
  res.status(201).json(await saleService.createSale(req.body, req.user));
});

module.exports = {
  createValidation,
  listSales,
  listRecentSales,
  createSale
};
