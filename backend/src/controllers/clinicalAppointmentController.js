const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const clinicalService = require("../services/clinicalService");

const listValidation = [
  query("date").optional().isISO8601(),
  query("patient_id").optional().isInt(),
  query("client_id").optional().isInt(),
  query("area").optional().isIn(["CLINICA", "ESTETICA"]),
  query("active").optional().isBoolean(),
  validateRequest
];

const createValidation = [
  body("patient_id").isInt(),
  body("client_id").isInt(),
  body("appointment_date").optional({ values: "falsy" }).isISO8601(),
  body("fecha").optional({ values: "falsy" }).isISO8601(),
  body("start_time").optional({ values: "falsy" }).matches(/^\d{2}:\d{2}/),
  body("hora_inicio").optional({ values: "falsy" }).matches(/^\d{2}:\d{2}/),
  body("end_time").optional({ values: "falsy" }).matches(/^\d{2}:\d{2}/),
  body("hora_fin").optional({ values: "falsy" }).matches(/^\d{2}:\d{2}/),
  body("area").isIn(["CLINICA", "ESTETICA"]),
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
  getAppointmentDetail,
  createAppointment,
  updateAppointment
};
