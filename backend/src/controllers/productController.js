const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const productService = require("../services/productService");

const listValidation = [query("search").optional().trim(), query("activeOnly").optional().isBoolean(), validateRequest];
const idValidation = [param("id").isInt(), validateRequest];
const createValidation = [
  body("name").trim().notEmpty(),
  body("sku").trim().notEmpty(),
  body("barcode").optional({ values: "falsy" }).trim(),
  body("category").optional({ values: "falsy" }).trim(),
  body("supplier_id").optional({ values: "falsy" }).isInt(),
  body("supplier_name").optional({ values: "falsy" }).trim(),
  body("price").isFloat({ min: 0 }),
  body("cost_price").optional().isFloat({ min: 0 }),
  body("liquidation_price").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("stock").optional().isFloat(),
  body("expires_at").optional({ values: "falsy" }).isISO8601(),
  body("is_active").optional().isBoolean(),
  body("status").optional().isIn(["activo", "inactivo"]),
  body("discount_type").optional({ values: "falsy" }).isIn(["percentage", "fixed"]),
  body("discount_value").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("discount_start").optional({ values: "falsy" }).isISO8601(),
  body("discount_end").optional({ values: "falsy" }).isISO8601(),
  validateRequest
];
const updateValidation = [
  body("name").optional().trim().notEmpty(),
  body("sku").optional().trim().notEmpty(),
  body("barcode").optional({ values: "falsy" }).trim(),
  body("category").optional({ values: "falsy" }).trim(),
  body("supplier_id").optional({ values: "falsy" }).isInt(),
  body("supplier_name").optional({ values: "falsy" }).trim(),
  body("price").optional().isFloat({ min: 0 }),
  body("cost_price").optional().isFloat({ min: 0 }),
  body("liquidation_price").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("stock").optional().isFloat(),
  body("expires_at").optional({ values: "falsy" }).isISO8601(),
  body("is_active").optional().isBoolean(),
  body("status").optional().isIn(["activo", "inactivo"]),
  body("discount_type").optional({ values: "falsy" }).isIn(["percentage", "fixed"]),
  body("discount_value").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("discount_start").optional({ values: "falsy" }).isISO8601(),
  body("discount_end").optional({ values: "falsy" }).isISO8601(),
  validateRequest
];
const statusValidation = [
  body("is_active").optional().isBoolean(),
  body("status").optional().isIn(["activo", "inactivo"]),
  validateRequest
];
const supplierListValidation = [query("search").optional().trim(), validateRequest];
const bulkDiscountValidation = [
  body("product_ids").isArray({ min: 1 }),
  body("product_ids.*").isInt(),
  body("discount_type").optional({ values: "falsy" }).isIn(["percentage", "fixed"]),
  body("discount_value").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("discount_start").optional({ values: "falsy" }).isISO8601(),
  body("discount_end").optional({ values: "falsy" }).isISO8601(),
  body("clear_discount").optional().isBoolean(),
  validateRequest
];
const deleteValidation = [
  param("id").isInt(),
  body("action").optional().isIn(["deactivate", "delete"]),
  validateRequest
];

const listProducts = asyncHandler(async (req, res) => {
  res.json(await productService.listProducts(req.query.search, req.query.activeOnly === "true"));
});

const listSuppliers = asyncHandler(async (req, res) => {
  res.json(await productService.listSuppliers(req.query.search));
});

const createProduct = asyncHandler(async (req, res) => {
  res.status(201).json(await productService.createProduct(req.body));
});

const updateProduct = asyncHandler(async (req, res) => {
  res.json(await productService.updateProduct(Number(req.params.id), req.body));
});

const updateProductStatus = asyncHandler(async (req, res) => {
  res.json(await productService.updateProductStatus(Number(req.params.id), req.body.is_active, req.body.status));
});

const deleteProduct = asyncHandler(async (req, res) => {
  res.json(await productService.deleteProduct(Number(req.params.id), req.body.action));
});

const applyBulkDiscount = asyncHandler(async (req, res) => {
  res.json(await productService.applyBulkDiscount(req.body.product_ids, req.body));
});

module.exports = {
  listValidation,
  idValidation,
  createValidation,
  updateValidation,
  statusValidation,
  supplierListValidation,
  bulkDiscountValidation,
  deleteValidation,
  listProducts,
  listSuppliers,
  createProduct,
  updateProduct,
  updateProductStatus,
  deleteProduct,
  applyBulkDiscount
};
