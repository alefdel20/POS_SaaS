const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const productService = require("../services/productService");

const listValidation = [query("search").optional().trim(), validateRequest];
const idValidation = [param("id").isInt(), validateRequest];
const createValidation = [
  body("name").trim().notEmpty(),
  body("sku").trim().notEmpty(),
  body("barcode").trim().notEmpty(),
  body("price").isFloat({ min: 0 }),
  body("cost_price").isFloat({ min: 0 }),
  body("stock").optional().isFloat(),
  body("is_active").optional().isBoolean(),
  validateRequest
];
const updateValidation = [
  body("name").optional().trim().notEmpty(),
  body("sku").optional().trim().notEmpty(),
  body("barcode").optional().trim().notEmpty(),
  body("price").optional().isFloat({ min: 0 }),
  body("cost_price").optional().isFloat({ min: 0 }),
  body("stock").optional().isFloat(),
  body("is_active").optional().isBoolean(),
  validateRequest
];
const statusValidation = [body("is_active").isBoolean(), validateRequest];

const listProducts = asyncHandler(async (req, res) => {
  res.json(await productService.listProducts(req.query.search));
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

module.exports = {
  listValidation,
  idValidation,
  createValidation,
  updateValidation,
  statusValidation,
  listProducts,
  createProduct,
  updateProduct,
  updateProductStatus
};
