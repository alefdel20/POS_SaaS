const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const clinicalService = require("../services/clinicalService");

const listValidation = [
  query("date").optional().isISO8601(),
  query("date_from").optional().isISO8601(),
  query("date_to").optional().isISO8601(),
  query("patient_id").optional().isInt(),
  query("client_id").optional().isInt(),
  query("doctor_user_id").optional().isInt(),
  query("specialty").optional({ values: "falsy" }).trim(),
  query("status").optional({ values: "falsy" }).isIn(["scheduled", "confirmed", "completed", "cancelled", "no_show"]),
  query("area").optional().isIn(["CLINICA", "ESTETICA"]),
  query("active").optional().isBoolean(),
  validateRequest
];

const createValidation = [
  // patient_id/client_id are each optional here — they can arrive instead as
  // patient_name/client_name (NameAutocomplete free text), resolved/created
  // by clinicalService inside the same transaction. buildAppointmentPayload
  // enforces that at least one of patient_id/patient_name is present.
  body("patient_id").optional({ values: "falsy" }).isInt(),
  body("patient_name").optional({ values: "falsy" }).trim(),
  // Only used when patient_name creates a brand-new patient inline — see
  // resolveOrCreatePatientId in clinicalService.js.
  body("patient_sex").optional({ values: "falsy" }).isIn(["Macho", "Hembra"]),
  body("client_id").optional({ values: "falsy" }).isInt(),
  body("client_name").optional({ values: "falsy" }).trim(),
  body("doctor_user_id").optional({ values: "falsy" }).isInt(),
  body("appointment_date").optional({ values: "falsy" }).isISO8601(),
  body("fecha").optional({ values: "falsy" }).isISO8601(),
  body("start_time").optional({ values: "falsy" }).matches(/^\d{2}:\d{2}/),
  body("hora_inicio").optional({ values: "falsy" }).matches(/^\d{2}:\d{2}/),
  body("end_time").optional({ values: "falsy" }).matches(/^\d{2}:\d{2}/),
  body("hora_fin").optional({ values: "falsy" }).matches(/^\d{2}:\d{2}/),
  body("area").isIn(["CLINICA", "ESTETICA"]),
  body("specialty").optional({ values: "falsy" }).trim(),
  body("status").isIn(["scheduled", "confirmed", "completed", "cancelled", "no_show"]),
  body("notes").optional().trim(),
  body("notas").optional().trim(),
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

const listAppointments = asyncHandler(async (req, res) => {
  res.json(await clinicalService.listAppointments(req.query, req.user));
});

const listDoctors = asyncHandler(async (req, res) => {
  res.json(await clinicalService.listDoctors(req.user));
});

const getAppointmentDetail = asyncHandler(async (req, res) => {
  res.json(await clinicalService.getAppointmentDetail(Number(req.params.id), req.user));
});

const createAppointment = asyncHandler(async (req, res) => {
  res.status(201).json(await clinicalService.createAppointment(req.body, req.user));
});

const updateAppointment = asyncHandler(async (req, res) => {
  res.json(await clinicalService.updateAppointment(Number(req.params.id), req.body, req.user));
});

module.exports = {
  listValidation,
  createValidation,
  updateValidation,
  idValidation,
  listAppointments,
  listDoctors,
  getAppointmentDetail,
  createAppointment,
  updateAppointment
};
