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
  res.json(await supplierService.listSuppliers(req.query.search || ""));
});

const getSupplierDetail = asyncHandler(async (req, res) => {
  res.json(await supplierService.getSupplierDetail(Number(req.params.id)));
});

module.exports = {
  listValidation,
  idValidation,
  listSuppliers,
  getSupplierDetail
};
