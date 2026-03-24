const { body, param } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const adminInvoiceService = require("../services/adminInvoiceService");

const idValidation = [param("id").isInt(), validateRequest];
const updateValidation = [
  param("id").isInt(),
  body("status").optional({ values: "falsy" }).isIn(["pending", "in_progress", "completed", "cancelled"]),
  body("customer_name").optional().trim(),
  body("rfc").optional().trim(),
  body("email").optional({ values: "falsy" }).isEmail(),
  body("phone").optional().trim(),
  body("fiscal_regime").optional().trim(),
  body("fiscal_data").optional().isObject(),
  body("cantidad_clave").optional().trim(),
  body("observations").optional().trim(),
  body("assigned_to_user_id").optional({ values: "falsy" }).isInt(),
  validateRequest
];

const listAdministrativeInvoices = asyncHandler(async (req, res) => {
  res.json(await adminInvoiceService.listAdministrativeInvoices(req.user));
});

const getAdministrativeInvoice = asyncHandler(async (req, res) => {
  res.json(await adminInvoiceService.getAdministrativeInvoice(Number(req.params.id), req.user));
});

const updateAdministrativeInvoice = asyncHandler(async (req, res) => {
  res.json(await adminInvoiceService.updateAdministrativeInvoice(Number(req.params.id), req.body, req.user));
});

const exportAdministrativeInvoicePdf = asyncHandler(async (req, res) => {
  const { buffer, filename } = await adminInvoiceService.exportAdministrativeInvoicePdf(Number(req.params.id), req.user);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

const exportAdministrativeInvoiceDocx = asyncHandler(async (req, res) => {
  const { buffer, filename } = await adminInvoiceService.exportAdministrativeInvoiceDocx(Number(req.params.id), req.user);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

module.exports = {
  idValidation,
  updateValidation,
  listAdministrativeInvoices,
  getAdministrativeInvoice,
  updateAdministrativeInvoice,
  exportAdministrativeInvoicePdf,
  exportAdministrativeInvoiceDocx
};
