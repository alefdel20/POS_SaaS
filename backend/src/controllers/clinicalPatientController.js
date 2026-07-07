const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const clinicalService = require("../services/clinicalService");

const listValidation = [
  query("search").optional().trim(),
  query("active").optional().isBoolean(),
  validateRequest
];

const createValidation = [
  body("name").trim().notEmpty(),
  // client_id is optional — a rescued animal pending adoption has no
  // responsible party yet (migration 25 dropped the NOT NULL). It becomes
  // mandatory only at billing time (see saleService.createSale), not here.
  body("client_id").optional({ values: "falsy" }).isInt({ min: 1 }),
  // client_name is the NameAutocomplete free-text alternative to client_id —
  // resolved (created if needed) inside createPatient's own transaction.
  body("client_name").optional({ values: "falsy" }).trim(),
  body("phone").optional({ values: "falsy" }).trim(),
  body("species").optional().trim(),
  body("breed").optional().trim(),
  body("sex").optional().trim(),
  body("birth_date").optional({ values: "falsy" }).isISO8601(),
  body("weight").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("allergies").optional().trim(),
  body("notes").optional().trim(),
  validateRequest
];

const updateValidation = [
  param("id").isInt(),
  // name stays optional here (unlike createValidation) so a partial payload
  // like { client_id } — the "asignar responsable despues" quick action —
  // can go straight through; clinicalService.updatePatient always merges
  // against the current row server-side, so a partial body is safe.
  body("name").optional().trim().notEmpty(),
  body("client_id").optional({ values: "falsy" }).isInt({ min: 1 }),
  body("client_name").optional({ values: "falsy" }).trim(),
  body("phone").optional({ values: "falsy" }).trim(),
  body("species").optional().trim(),
  body("breed").optional().trim(),
  body("sex").optional().trim(),
  body("birth_date").optional({ values: "falsy" }).isISO8601(),
  body("weight").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("allergies").optional().trim(),
  body("notes").optional().trim(),
  body("is_active").optional().isBoolean(),
  validateRequest
];

const idValidation = [
  param("id").isInt(),
  validateRequest
];

const statusValidation = [
  param("id").isInt(),
  body("is_active").isBoolean(),
  validateRequest
];

const listPatients = asyncHandler(async (req, res) => {
  res.json(await clinicalService.listPatients(req.query, req.user));
});

const getPatientDetail = asyncHandler(async (req, res) => {
  res.json(await clinicalService.getPatientDetail(Number(req.params.id), req.user));
});

const createPatient = asyncHandler(async (req, res) => {
  res.status(201).json(await clinicalService.createPatient(req.body, req.user));
});

const updatePatient = asyncHandler(async (req, res) => {
  res.json(await clinicalService.updatePatient(Number(req.params.id), req.body, req.user));
});

const updatePatientStatus = asyncHandler(async (req, res) => {
  res.json(await clinicalService.setPatientStatus(Number(req.params.id), Boolean(req.body.is_active), req.user));
});

module.exports = {
  listValidation,
  createValidation,
  updateValidation,
  idValidation,
  statusValidation,
  listPatients,
  getPatientDetail,
  createPatient,
  updatePatient,
  updatePatientStatus
};
