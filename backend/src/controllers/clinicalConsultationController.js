const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const clinicalService = require("../services/clinicalService");
const { PRESCRIPTION_STATUSES } = require("../utils/domainEnums");

const listValidation = [
  query("search").optional().trim(),
  query("patient_id").optional().isInt(),
  query("client_id").optional().isInt(),
  query("appointment_id").optional().isInt(),
  query("active").optional().isBoolean(),
  validateRequest
];

const createValidation = [
  // patient_id/client_id are each optional here — they can arrive instead as
  // patient_name/client_name (NameAutocomplete free text), resolved/created
  // by clinicalService inside the same transaction. buildConsultationPayload
  // enforces that at least one of patient_id/patient_name is present.
  body("patient_id").optional({ values: "falsy" }).isInt(),
  body("patient_name").optional({ values: "falsy" }).trim(),
  // Only used when patient_name creates a brand-new patient inline — see
  // resolveOrCreatePatientId in clinicalService.js.
  body("patient_sex").optional({ values: "falsy" }).isIn(["Macho", "Hembra"]),
  // client_id is optional as of migration 47 — a patient attended before a
  // responsible party is resolved is a valid state, same criterion already
  // applied to appointments.client_id (migration 46).
  body("client_id").optional({ values: "falsy" }).isInt(),
  body("client_name").optional({ values: "falsy" }).trim(),
  // appointment_id is optional — declares which appointment this consultation
  // resulted from, if any (migration 47). No heuristics: omitted means the
  // consultation stays unlinked, same as a walk-in.
  body("appointment_id").optional({ values: "falsy" }).isInt(),
  body("consultation_date").optional({ values: "falsy" }).isISO8601(),
  body("fecha").optional({ values: "falsy" }).isISO8601(),
  body("motivo_consulta").trim().notEmpty(),
  body("diagnostico").trim().notEmpty(),
  body("tratamiento").trim().notEmpty(),
  body("notas").optional().trim(),
  body("notes").optional().trim(),
  // Optional prescription bundled with the same "Guardar" action (redesigned
  // Consultas page) — saved inside createConsultation/updateConsultation's
  // own transaction when it has at least one item (see
  // shouldSavePrescription in clinicalService.js).
  body("prescription").optional().isObject(),
  body("prescription.diagnosis").optional({ values: "falsy" }).trim(),
  body("prescription.indications").optional({ values: "falsy" }).trim(),
  body("prescription.status").optional({ values: "falsy" }).isIn(PRESCRIPTION_STATUSES),
  body("prescription.items").optional().isArray(),
  body("prescription.items.*.product_id").optional({ values: "falsy" }).isInt(),
  body("prescription.items.*.medication_name_snapshot").optional({ values: "falsy" }).trim(),
  body("prescription.items.*.presentation_snapshot").optional({ values: "falsy" }).trim(),
  body("prescription.items.*.dose").optional({ values: "falsy" }).trim(),
  body("prescription.items.*.frequency").optional({ values: "falsy" }).trim(),
  body("prescription.items.*.duration").optional({ values: "falsy" }).trim(),
  body("prescription.items.*.route_of_administration").optional({ values: "falsy" }).trim(),
  body("prescription.items.*.notes").optional().trim(),
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
  body("is_active").isBoolean(),
  validateRequest
];

const listConsultations = asyncHandler(async (req, res) => {
  res.json(await clinicalService.listConsultations(req.query, req.user));
});

const getConsultationDetail = asyncHandler(async (req, res) => {
  res.json(await clinicalService.getConsultationDetail(Number(req.params.id), req.user));
});

const createConsultation = asyncHandler(async (req, res) => {
  res.status(201).json(await clinicalService.createConsultation(req.body, req.user));
});

const updateConsultation = asyncHandler(async (req, res) => {
  res.json(await clinicalService.updateConsultation(Number(req.params.id), req.body, req.user));
});

const updateConsultationStatus = asyncHandler(async (req, res) => {
  res.json(await clinicalService.setConsultationStatus(Number(req.params.id), Boolean(req.body.is_active), req.user));
});

module.exports = {
  listValidation,
  createValidation,
  updateValidation,
  idValidation,
  statusValidation,
  listConsultations,
  getConsultationDetail,
  createConsultation,
  updateConsultation,
  updateConsultationStatus
};
