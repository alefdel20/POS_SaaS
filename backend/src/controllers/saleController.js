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
const cancelValidation = [
  param("id").isInt(),
  body("reason").trim().notEmpty(),
  validateRequest
];
const createValidation = [
  body("payment_method").isIn(["cash", "card", "credit", "transfer"]),
  body("sale_type").optional().isIn(["ticket", "invoice"]),
  body("customer.name").optional({ values: "falsy" }).trim(),
  body("customer.phone").optional({ values: "falsy" }).trim(),
  body("initial_payment").optional().isFloat({ min: 0 }),
  body("requires_administrative_invoice").optional().isBoolean(),
  body("invoice_data").optional().isObject(),
  body("prescription_id").optional({ values: "falsy" }).isInt(),
  body("items").isArray({ min: 1 }),
  body("items.*.product_id").optional({ values: "falsy" }).isInt({ min: 1 }),
  body("items.*.kit_id").optional({ values: "falsy" }).isInt({ min: 1 }),
  body("items").custom((items) => {
    if (!Array.isArray(items)) return true;
    for (const item of items) {
      const hasProduct = item.product_id !== undefined && item.product_id !== null && item.product_id !== "";
      const hasKit = item.kit_id !== undefined && item.kit_id !== null && item.kit_id !== "";
      if (!hasProduct && !hasKit) {
        throw new Error("Cada item debe tener product_id o kit_id");
      }
      if (hasProduct && hasKit) {
        throw new Error("Un item no puede tener product_id y kit_id al mismo tiempo");
      }
    }
    return true;
  }),
  body("items.*.quantity").isFloat({ gt: 0 }),
  body("items.*.unit_price").optional().isFloat({ min: 0, maxDecimalPlaces: 5 }),
  body("cart_discount_type").optional({ values: "falsy" }).isIn(["percentage", "fixed"]),
  body("cart_discount_value").optional({ values: "falsy" }).isFloat({ min: 0 }),
  validateRequest
];

const listSales = asyncHandler(async (req, res) => {
  res.json(await saleService.listSales(req.query, req.user));
});

const listRecentSales = asyncHandler(async (req, res) => {
  res.json(await saleService.listRecentSales(req.user));
});

const getSaleDetail = asyncHandler(async (req, res) => {
  res.json(await saleService.getSaleDetail(Number(req.params.id), req.user));
});

const getSalesTrends = asyncHandler(async (req, res) => {
  res.json(await saleService.getSalesTrends(req.query.period, req.user));
});

const createSale = asyncHandler(async (req, res) => {
  const branchId = req.user.branch_id ?? req.auth?.branch_id ?? null;
  res.status(201).json(await saleService.createSale(req.body, req.user, branchId));
});

const cancelSale = asyncHandler(async (req, res) => {
  res.json(await saleService.cancelSale(Number(req.params.id), req.body.reason, req.user));
});

const getRecentProductsValidation = [validateRequest];

const getRecentProducts = asyncHandler(async (req, res) => {
  const actor = req.user;
  const businessId = actor.business_id;
  const products = await saleService.getRecentProductsByUser(actor.id, businessId, 9);
  res.json(products);
});

module.exports = {
  listValidation,
  saleIdValidation,
  trendsValidation,
  cancelValidation,
  createValidation,
  listSales,
  listRecentSales,
  getSaleDetail,
  getSalesTrends,
  createSale,
  cancelSale,
  getRecentProductsValidation,
  getRecentProducts
};
