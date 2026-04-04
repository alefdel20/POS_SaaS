const { query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const clinicalService = require("../services/clinicalService");

const listValidation = [
  query("patient_id").optional().isInt(),
  query("client_id").optional().isInt(),
  query("date_from").optional().isISO8601(),
  query("date_to").optional().isISO8601(),
  validateRequest
];

const exportValidation = [
  query("patient_id").isInt(),
  query("client_id").optional().isInt(),
  query("date_from").optional().isISO8601(),
  query("date_to").optional().isISO8601(),
  validateRequest
];

const getClinicalHistory = asyncHandler(async (req, res) => {
  res.json(await clinicalService.getClinicalHistory(req.query, req.user));
});

const exportClinicalHistoryPdf = asyncHandler(async (req, res) => {
  const { buffer, filename } = await clinicalService.exportClinicalHistoryPdf(req.query, req.user);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

module.exports = {
  listValidation,
  exportValidation,
  getClinicalHistory,
  exportClinicalHistoryPdf
};
