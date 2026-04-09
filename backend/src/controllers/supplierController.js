const { param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const supplierService = require("../services/supplierService");

const listValidation = [
  query("search").optional().trim(),
  validateRequest
];

const idValidation = [
  param("id").isInt(),
  validateRequest
];

const listSuppliers = asyncHandler(async (req, res) => {
  res.json(await supplierService.listSuppliers(req.query.search || "", req.user));
});

const getSupplierDetail = asyncHandler(async (req, res) => {
  res.json(await supplierService.getSupplierDetail(Number(req.params.id), req.user));
});

const downloadSupplierCatalogTemplate = asyncHandler(async (_req, res) => {
  const { buffer, filename } = await supplierService.buildSupplierCatalogTemplate();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

module.exports = {
  listValidation,
  idValidation,
  listSuppliers,
  getSupplierDetail,
  downloadSupplierCatalogTemplate
};
