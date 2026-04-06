const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const clinicalService = require("../services/clinicalService");
const { PRESCRIPTION_STATUSES } = require("../utils/domainEnums");

const prescriptionItemValidation = [
  body("items").optional().isArray(),
  body("items.*.product_id").optional({ values: "falsy" }).isInt(),
  body("items.*.presentation_snapshot").optional({ values: "falsy" }).trim(),
  body("items.*.dose").optional({ values: "falsy" }).trim(),
  body("items.*.frequency").optional({ values: "falsy" }).trim(),
  body("items.*.duration").optional({ values: "falsy" }).trim(),
  body("items.*.route_of_administration").optional({ values: "falsy" }).trim(),
  body("items.*.notes").optional().trim()
];

const listValidation = [
  query("patient_id").optional().isInt(),
  query("consultation_id").optional().isInt(),
  query("status").optional().isIn(PRESCRIPTION_STATUSES),
  validateRequest
];

const createValidation = [
  body("patient_id").isInt(),
  body("consultation_id").optional({ values: "falsy" }).isInt(),
  body("diagnosis").optional().trim(),
  body("indications").optional().trim(),
  body("status").optional().isIn(PRESCRIPTION_STATUSES),
  ...prescriptionItemValidation,
  validateRequest
];

const updateValidation = [
  param("id").isInt(),
  ...createValidation
];

const idValidation = [
  param("id").isInt(),
  validateRequest
];

const statusValidation = [
  param("id").isInt(),
  body("status").isIn(PRESCRIPTION_STATUSES),
  validateRequest
];

const listPrescriptions = asyncHandler(async (req, res) => {
  res.json(await clinicalService.listPrescriptions(req.query, req.user));
});

const getPrescriptionDetail = asyncHandler(async (req, res) => {
  res.json(await clinicalService.getPrescriptionDetail(Number(req.params.id), req.user));
});

const createPrescription = asyncHandler(async (req, res) => {
  res.status(201).json(await clinicalService.createPrescription(req.body, req.user));
});

const updatePrescription = asyncHandler(async (req, res) => {
  res.json(await clinicalService.updatePrescription(Number(req.params.id), req.body, req.user));
});

const updatePrescriptionStatus = asyncHandler(async (req, res) => {
  res.json(await clinicalService.setPrescriptionStatus(Number(req.params.id), req.body.status, req.user));
});

const exportPrescriptionPdf = asyncHandler(async (req, res) => {
  const { buffer, filename } = await clinicalService.exportPrescriptionPdf(Number(req.params.id), req.user);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

module.exports = {
  listValidation,
  createValidation,
  updateValidation,
  idValidation,
  statusValidation,
  listPrescriptions,
  getPrescriptionDetail,
  createPrescription,
  updatePrescription,
  updatePrescriptionStatus,
  exportPrescriptionPdf
};
