const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const prescriptionCheckoutRequestService = require("../services/prescriptionCheckoutRequestService");
const { requireActorBusinessId } = require("../utils/tenant");

const listValidation = [
  query("status").optional({ values: "falsy" }).isIn(["pending", "completed", "cancelled"]),
  query("page").optional({ values: "falsy" }).isInt({ min: 1 }),
  query("pageSize").optional({ values: "falsy" }).isInt({ min: 5, max: 25 }),
  validateRequest
];

const createValidation = [
  body("consultation_id").isInt(),
  body("prescription_id").optional().isInt(),
  body("charge_consultation").isBoolean(),
  body("consultation_amount").optional().isFloat({ min: 0 }),
  validateRequest
];

const getByIdValidation = [
  param("id").isInt({ min: 1 }),
  validateRequest
];

const completeValidation = [
  param("id").isInt({ min: 1 }),
  body("sale_id").isInt(),
  validateRequest
];

const cancelValidation = [
  param("id").isInt({ min: 1 }),
  body("reason").optional().isString(),
  validateRequest
];

const listPrescriptionCheckoutRequests = asyncHandler(async (req, res) => {
  const businessId = requireActorBusinessId(req.user);
  res.json(await prescriptionCheckoutRequestService.listPrescriptionCheckoutRequests(businessId, {
    status: req.query.status,
    page: req.query.page,
    pageSize: req.query.pageSize
  }));
});

const getPendingSummary = asyncHandler(async (req, res) => {
  const businessId = requireActorBusinessId(req.user);
  res.json(await prescriptionCheckoutRequestService.getPendingPrescriptionCheckoutSummary(businessId));
});

const getPrescriptionCheckoutRequestById = asyncHandler(async (req, res) => {
  const businessId = requireActorBusinessId(req.user);
  res.json(await prescriptionCheckoutRequestService.getPrescriptionCheckoutRequestById(Number(req.params.id), businessId));
});

const createPrescriptionCheckoutRequest = asyncHandler(async (req, res) => {
  res.status(201).json(await prescriptionCheckoutRequestService.createPrescriptionCheckoutRequest(req.body, req.user));
});

const completePrescriptionCheckoutRequest = asyncHandler(async (req, res) => {
  res.json(await prescriptionCheckoutRequestService.completePrescriptionCheckoutRequest(Number(req.params.id), req.body, req.user));
});

const cancelPrescriptionCheckoutRequest = asyncHandler(async (req, res) => {
  res.json(await prescriptionCheckoutRequestService.cancelPrescriptionCheckoutRequest(Number(req.params.id), req.body, req.user));
});

module.exports = {
  listValidation,
  createValidation,
  getByIdValidation,
  completeValidation,
  cancelValidation,
  listPrescriptionCheckoutRequests,
  getPendingSummary,
  getPrescriptionCheckoutRequestById,
  createPrescriptionCheckoutRequest,
  completePrescriptionCheckoutRequest,
  cancelPrescriptionCheckoutRequest
};
