const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const supplierCatalogService = require("../services/supplierCatalogService");

const supplierIdValidation = [param("id").isInt(), validateRequest];

const listCatalogValidation = [
  param("id").isInt(),
  query("search").optional({ values: "falsy" }).trim(),
  query("status").optional({ values: "falsy" }).isIn(["new", "pending", "linked", "cost_changed", "cost_applied", "inactive"]),
  query("linked").optional({ values: "falsy" }).isIn(["linked", "unlinked"]),
  query("cost_changed").optional({ values: "falsy" }).isIn(["true", "false"]),
  query("active").optional({ values: "falsy" }).isIn(["active", "inactive"]),
  query("category").optional({ values: "falsy" }).trim(),
  query("supplier_product_code").optional({ values: "falsy" }).trim(),
  validateRequest
];

const confirmImportValidation = [
  param("id").isInt(),
  body("rows").isArray({ min: 1 }),
  body("rows.*.payload").optional().isObject(),
  body("source_file").optional({ values: "falsy" }).trim(),
  validateRequest
];

const itemValidation = [
  param("id").isInt(),
  param("itemId").isInt(),
  validateRequest
];

const linkProductValidation = [
  param("id").isInt(),
  param("itemId").isInt(),
  body("product_id").isInt(),
  validateRequest
];

const createProductValidation = [
  param("id").isInt(),
  param("itemId").isInt(),
  body("name").optional({ values: "falsy" }).trim(),
  body("description").optional().trim(),
  body("category").optional({ values: "falsy" }).trim(),
  body("unidad_de_venta").optional({ values: "falsy" }).isIn(["pieza", "kg", "litro", "caja"]),
  body("price").isFloat({ gt: 0, maxDecimalPlaces: 5 }),
  body("cost_price").optional().isFloat({ min: 0, maxDecimalPlaces: 5 }),
  body("stock").optional().isFloat({ min: 0 }),
  body("stock_minimo").optional().isFloat({ min: 0 }),
  body("stock_maximo").optional().isFloat({ min: 0 }),
  validateRequest
];

const listSupplierCatalog = asyncHandler(async (req, res) => {
  res.json(await supplierCatalogService.listSupplierCatalog(Number(req.params.id), req.query, req.user));
});

const previewSupplierCatalogImport = asyncHandler(async (req, res) => {
  res.json(await supplierCatalogService.previewSupplierCatalogImport(Number(req.params.id), req.file, req.user));
});

const confirmSupplierCatalogImport = asyncHandler(async (req, res) => {
  res.json(await supplierCatalogService.confirmSupplierCatalogImport(
    Number(req.params.id),
    req.body.rows,
    req.user,
    req.body.source_file || null
  ));
});

const linkCatalogItemToProduct = asyncHandler(async (req, res) => {
  res.json(await supplierCatalogService.linkCatalogItemToProduct(
    Number(req.params.id),
    Number(req.params.itemId),
    Number(req.body.product_id),
    req.user
  ));
});

const createInternalProductFromCatalogItem = asyncHandler(async (req, res) => {
  res.status(201).json(await supplierCatalogService.createInternalProductFromCatalogItem(
    Number(req.params.id),
    Number(req.params.itemId),
    req.body,
    req.user
  ));
});

const applyCatalogCostToProduct = asyncHandler(async (req, res) => {
  res.json(await supplierCatalogService.applyCatalogCostToProduct(
    Number(req.params.id),
    Number(req.params.itemId),
    req.user
  ));
});

module.exports = {
  supplierIdValidation,
  listCatalogValidation,
  confirmImportValidation,
  itemValidation,
  linkProductValidation,
  createProductValidation,
  listSupplierCatalog,
  previewSupplierCatalogImport,
  confirmSupplierCatalogImport,
  linkCatalogItemToProduct,
  createInternalProductFromCatalogItem,
  applyCatalogCostToProduct
};
