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
  body("price").isFloat({ min: 0 }),
  body("cost_price").optional().isFloat({ min: 0 }),
  body("liquidation_price").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("stock").optional().isFloat(),
  body("expires_at").optional({ values: "falsy" }).isISO8601(),
  body("is_active").optional().isBoolean(),
  validateRequest
];
const updateValidation = [
  body("name").optional().trim().notEmpty(),
  body("sku").optional().trim().notEmpty(),
  body("barcode").optional({ values: "falsy" }).trim(),
  body("category").optional({ values: "falsy" }).trim(),
  body("price").optional().isFloat({ min: 0 }),
  body("cost_price").optional().isFloat({ min: 0 }),
  body("liquidation_price").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("stock").optional().isFloat(),
  body("expires_at").optional({ values: "falsy" }).isISO8601(),
  body("is_active").optional().isBoolean(),
  validateRequest
];
const statusValidation = [body("is_active").isBoolean(), validateRequest];

const listProducts = asyncHandler(async (req, res) => {
  res.json(await productService.listProducts(req.query.search, req.query.activeOnly === "true"));
});

const createProduct = asyncHandler(async (req, res) => {
  res.status(201).json(await productService.createProduct(req.body));
});

const updateProduct = asyncHandler(async (req, res) => {
  res.json(await productService.updateProduct(Number(req.params.id), req.body));
});

const updateProductStatus = asyncHandler(async (req, res) => {
  res.json(await productService.updateProductStatus(Number(req.params.id), req.body.is_active));
});

const deleteProduct = asyncHandler(async (req, res) => {
  res.json(await productService.deleteProduct(Number(req.params.id)));
});

module.exports = {
  listValidation,
  idValidation,
  createValidation,
  updateValidation,
  statusValidation,
  listProducts,
  createProduct,
  updateProduct,
  updateProductStatus,
  deleteProduct
};
