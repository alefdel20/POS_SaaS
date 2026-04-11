const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const productService = require("../services/productService");
const { getProductBarcodeSvg } = require("../services/adminInvoiceService");
const { PRODUCT_CATALOG_TYPES } = require("../utils/domainEnums");

const listValidation = [
  query("search").optional().trim(),
  query("category").optional({ values: "falsy" }).trim(),
  query("catalog_scope").optional().isIn(["food-accessories", "medications-supplies"]),
  query("activeOnly").optional().isBoolean(),
  query("page").optional({ values: "falsy" }).isInt({ min: 1 }),
  query("pageSize").optional({ values: "falsy" }).isIn(["10", "15"]),
  validateRequest
];
const categoryListValidation = [
  query("search").optional().trim(),
  query("catalog_scope").optional().isIn(["food-accessories", "medications-supplies"]),
  validateRequest
];
const restockValidation = [
  query("search").optional().trim(),
  query("category").optional({ values: "falsy" }).trim(),
  query("catalog_scope").optional().isIn(["food-accessories", "medications-supplies"]),
  query("supplier").optional({ values: "falsy" }).trim(),
  query("page").optional({ values: "falsy" }).isInt({ min: 1 }),
  query("pageSize").optional({ values: "falsy" }).isIn(["10", "15"]),
  query("includeMeta").optional({ values: "falsy" }).isBoolean(),
  validateRequest
];
const restockHistoryValidation = [
  query("date").optional({ values: "falsy" }).isISO8601(),
  query("product").optional().trim(),
  query("supplier").optional().trim(),
  query("category").optional().trim(),
  query("page").optional({ values: "falsy" }).isInt({ min: 1 }),
  query("pageSize").optional({ values: "falsy" }).isIn(["10", "15"]),
  validateRequest
];
const restockUpdateValidation = [
  body("stock").isFloat({ min: 0 }),
  body("reason").optional({ values: "falsy" }).trim(),
  validateRequest
];
const idValidation = [param("id").isInt(), validateRequest];
const importConfirmValidation = [
  body("rows").isArray({ min: 1 }),
  body("rows.*.payload").optional().isObject(),
  validateRequest
];
const createValidation = [
  body("name").trim().notEmpty(),
  body("reason").optional({ values: "falsy" }).trim(),
  body("sku").optional().trim(),
  body("barcode").optional({ values: "falsy" }).trim().matches(/^\d+$/),
  body("category").optional({ values: "falsy" }).trim(),
  body("catalog_type").optional({ values: "falsy" }).isIn(PRODUCT_CATALOG_TYPES),
  body("unidad_de_venta").optional({ values: "falsy" }).isIn(["pieza", "kg", "litro", "caja"]),
  body("porcentaje_ganancia").optional({ values: "falsy" }).isFloat(),
  body("ieps").optional({ values: "falsy" }).isFloat({ min: 0 }),
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
  body("suppliers.*.purchase_cost").optional({ values: "falsy" }).isFloat({ min: 0, maxDecimalPlaces: 5 }),
  body("suppliers.*.is_primary").optional().isBoolean(),
  body("price").isFloat({ gt: 0, maxDecimalPlaces: 5 }),
  body("cost_price").optional().isFloat({ min: 0, maxDecimalPlaces: 5 }),
  body("liquidation_price").optional({ values: "falsy" }).isFloat({ min: 0, maxDecimalPlaces: 5 }),
  body("stock").optional().isFloat({ min: 0 }),
  body("expires_at").optional({ values: "falsy" }).isISO8601(),
  body("is_active").optional().isBoolean(),
  body("status").optional().isIn(["activo", "inactivo"]),
  body("discount_type").optional({ values: "falsy" }).isIn(["percentage", "fixed"]),
  body("discount_value").optional({ values: "falsy" }).isFloat({ min: 0, maxDecimalPlaces: 5 }),
  body("discount_start").optional({ values: "falsy" }).isISO8601(),
  body("discount_end").optional({ values: "falsy" }).isISO8601(),
  validateRequest
];
const updateValidation = [
  body("name").optional().trim().notEmpty(),
  body("reason").optional({ values: "falsy" }).trim(),
  body("sku").optional().trim(),
  body("barcode").optional({ values: "falsy" }).trim().matches(/^\d+$/),
  body("category").optional({ values: "falsy" }).trim(),
  body("catalog_type").optional({ values: "falsy" }).isIn(PRODUCT_CATALOG_TYPES),
  body("unidad_de_venta").optional({ values: "falsy" }).isIn(["pieza", "kg", "litro", "caja"]),
  body("porcentaje_ganancia").optional({ values: "falsy" }).isFloat(),
  body("ieps").optional({ values: "falsy" }).isFloat({ min: 0 }),
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
  body("suppliers.*.purchase_cost").optional({ values: "falsy" }).isFloat({ min: 0, maxDecimalPlaces: 5 }),
  body("suppliers.*.is_primary").optional().isBoolean(),
  body("price").optional().isFloat({ gt: 0, maxDecimalPlaces: 5 }),
  body("cost_price").optional().isFloat({ min: 0, maxDecimalPlaces: 5 }),
  body("liquidation_price").optional({ values: "falsy" }).isFloat({ min: 0, maxDecimalPlaces: 5 }),
  body("stock").optional().isFloat({ min: 0 }),
  body("expires_at").optional({ values: "falsy" }).isISO8601(),
  body("is_active").optional().isBoolean(),
  body("status").optional().isIn(["activo", "inactivo"]),
  body("discount_type").optional({ values: "falsy" }).isIn(["percentage", "fixed"]),
  body("discount_value").optional({ values: "falsy" }).isFloat({ min: 0, maxDecimalPlaces: 5 }),
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
    category: req.query.category,
    catalog_scope: req.query.catalog_scope,
    activeOnly: req.query.activeOnly === "true",
    page: req.query.page,
    pageSize: req.query.pageSize
  }, req.user));
});

const listSuppliers = asyncHandler(async (req, res) => {
  res.json(await productService.listSuppliers(req.query.search, req.user));
});

const listCategories = asyncHandler(async (req, res) => {
  res.json(await productService.listCategories({
    search: req.query.search,
    catalog_scope: req.query.catalog_scope
  }, req.user));
});

const listRestockProducts = asyncHandler(async (req, res) => {
  const response = await productService.listRestockProducts({
    search: req.query.search,
    category: req.query.category,
    catalog_scope: req.query.catalog_scope,
    supplier: req.query.supplier,
    page: req.query.page,
    pageSize: req.query.pageSize,
    includeMeta: req.query.includeMeta === "true"
  }, req.user);
  res.json(req.query.includeMeta === "true" ? response : response.items);
});

const listRestockHistory = asyncHandler(async (req, res) => {
  res.json(await productService.listRestockHistory(req.query, req.user));
});

const getRestockHistoryMetrics = asyncHandler(async (req, res) => {
  res.json(await productService.getRestockHistoryMetrics(req.query, req.user));
});

const restockProduct = asyncHandler(async (req, res) => {
  res.json(await productService.restockProduct(Number(req.params.id), req.body, req.user));
});

const previewProductImport = asyncHandler(async (req, res) => {
  res.json(await productService.previewProductImport(req.file, req.user));
});

const confirmProductImport = asyncHandler(async (req, res) => {
  res.json(await productService.confirmProductImport(req.body.rows, req.user));
});

const getProductBarcode = asyncHandler(async (req, res) => {
  const result = await getProductBarcodeSvg(Number(req.params.id), req.user);
  res.setHeader("Content-Type", "image/svg+xml");
  res.send(result.svg);
});

const getProductDetail = asyncHandler(async (req, res) => {
  res.json(await productService.getProductDetail(Number(req.params.id), req.user));
});

const createProduct = asyncHandler(async (req, res) => {
  res.status(201).json(await productService.createProduct(req.body, req.user));
});

const updateProduct = asyncHandler(async (req, res) => {
  res.json(await productService.updateProduct(Number(req.params.id), req.body, req.user));
});

const uploadProductImage = asyncHandler(async (req, res) => {
  res.json(await productService.uploadProductImage(Number(req.params.id), req.file, req.user));
});

const removeProductImage = asyncHandler(async (req, res) => {
  res.json(await productService.removeProductImage(Number(req.params.id), req.user));
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
  restockValidation,
  restockHistoryValidation,
  restockUpdateValidation,
  idValidation,
  importConfirmValidation,
  createValidation,
  updateValidation,
  statusValidation,
  supplierListValidation,
  bulkDiscountValidation,
  deleteValidation,
  listProducts,
  listSuppliers,
  listCategories,
  listRestockProducts,
  listRestockHistory,
  getRestockHistoryMetrics,
  restockProduct,
  previewProductImport,
  confirmProductImport,
  getProductDetail,
  getProductBarcode,
  createProduct,
  updateProduct,
  uploadProductImage,
  removeProductImage,
  updateProductStatus,
  deleteProduct,
  applyBulkDiscount
};
