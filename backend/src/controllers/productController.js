const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const productService = require("../services/productService");

const listValidation = [
  query("search").optional().trim(),
  query("activeOnly").optional().isBoolean(),
  query("page").optional({ values: "falsy" }).isInt({ min: 1 }),
  query("pageSize").optional({ values: "falsy" }).isIn(["10", "15"]),
  validateRequest
];
const categoryListValidation = [query("search").optional().trim(), validateRequest];
const idValidation = [param("id").isInt(), validateRequest];
const createValidation = [
  body("name").trim().notEmpty(),
  body("sku").optional().trim(),
  body("barcode").optional({ values: "falsy" }).trim(),
  body("category").optional({ values: "falsy" }).trim(),
  body("stock_minimo").isFloat({ min: 0 }),
  body("stock_maximo").optional().isFloat({ min: 0 }),
  body("supplier_id").optional({ values: "falsy" }).isInt(),
  body("supplier_name").optional({ values: "falsy" }).trim(),
  body("supplier_email").optional({ values: "falsy" }).isEmail(),
  body("supplier_phone").optional({ values: "falsy" }).trim(),
  body("supplier_whatsapp").optional({ values: "falsy" }).trim(),
  body("supplier_observations").optional().trim(),
  body("suppliers").optional().isArray({ min: 1 }),
  body("suppliers.*.supplier_id").optional({ values: "falsy" }).isInt(),
  body("suppliers.*.supplier_name").optional({ values: "falsy" }).trim(),
  body("suppliers.*.supplier_email").optional({ values: "falsy" }).isEmail(),
  body("suppliers.*.supplier_phone").optional({ values: "falsy" }).trim(),
  body("suppliers.*.supplier_whatsapp").optional({ values: "falsy" }).trim(),
  body("suppliers.*.supplier_observations").optional().trim(),
  body("suppliers.*.purchase_cost").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("suppliers.*.is_primary").optional().isBoolean(),
  body("price").isFloat({ gt: 0 }),
  body("cost_price").optional().isFloat({ min: 0 }),
  body("liquidation_price").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("stock").optional().isFloat({ min: 0 }),
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
  body("sku").optional().trim(),
  body("barcode").optional({ values: "falsy" }).trim(),
  body("category").optional({ values: "falsy" }).trim(),
  body("stock_minimo").optional().isFloat({ min: 0 }),
  body("stock_maximo").optional().isFloat({ min: 0 }),
  body("supplier_id").optional({ values: "falsy" }).isInt(),
  body("supplier_name").optional({ values: "falsy" }).trim(),
  body("supplier_email").optional({ values: "falsy" }).isEmail(),
  body("supplier_phone").optional({ values: "falsy" }).trim(),
  body("supplier_whatsapp").optional({ values: "falsy" }).trim(),
  body("supplier_observations").optional().trim(),
  body("suppliers").optional().isArray({ min: 1 }),
  body("suppliers.*.supplier_id").optional({ values: "falsy" }).isInt(),
  body("suppliers.*.supplier_name").optional({ values: "falsy" }).trim(),
  body("suppliers.*.supplier_email").optional({ values: "falsy" }).isEmail(),
  body("suppliers.*.supplier_phone").optional({ values: "falsy" }).trim(),
  body("suppliers.*.supplier_whatsapp").optional({ values: "falsy" }).trim(),
  body("suppliers.*.supplier_observations").optional().trim(),
  body("suppliers.*.purchase_cost").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("suppliers.*.is_primary").optional().isBoolean(),
  body("price").optional().isFloat({ gt: 0 }),
  body("cost_price").optional().isFloat({ min: 0 }),
  body("liquidation_price").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("stock").optional().isFloat({ min: 0 }),
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
  res.json(await productService.listProducts(req.query.search, {
    activeOnly: req.query.activeOnly === "true",
    page: req.query.page,
    pageSize: req.query.pageSize
  }, req.user));
});

const listSuppliers = asyncHandler(async (req, res) => {
  res.json(await productService.listSuppliers(req.query.search, req.user));
});

const listCategories = asyncHandler(async (req, res) => {
  res.json(await productService.listCategories(req.query.search, req.user));
});

const createProduct = asyncHandler(async (req, res) => {
  res.status(201).json(await productService.createProduct(req.body, req.user));
});

const updateProduct = asyncHandler(async (req, res) => {
  res.json(await productService.updateProduct(Number(req.params.id), req.body, req.user));
});

const updateProductStatus = asyncHandler(async (req, res) => {
  res.json(await productService.updateProductStatus(Number(req.params.id), req.body.is_active, req.body.status, req.user));
});

const deleteProduct = asyncHandler(async (req, res) => {
  res.json(await productService.deleteProduct(Number(req.params.id), req.body.action, req.user));
});

const applyBulkDiscount = asyncHandler(async (req, res) => {
  res.json(await productService.applyBulkDiscount(req.body.product_ids, req.body, req.user));
});

module.exports = {
  listValidation,
  categoryListValidation,
  idValidation,
  createValidation,
  updateValidation,
  statusValidation,
  supplierListValidation,
  bulkDiscountValidation,
  deleteValidation,
  listProducts,
  listSuppliers,
  listCategories,
  createProduct,
  updateProduct,
  updateProductStatus,
  deleteProduct,
  applyBulkDiscount
};
