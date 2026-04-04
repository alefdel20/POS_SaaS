const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const clinicalService = require("../services/clinicalService");

const listValidation = [
  query("search").optional().trim(),
  query("patient_id").optional().isInt(),
  query("client_id").optional().isInt(),
  query("active").optional().isBoolean(),
  validateRequest
];

const createValidation = [
  body("patient_id").isInt(),
  body("client_id").isInt(),
  body("consultation_date").optional({ values: "falsy" }).isISO8601(),
  body("fecha").optional({ values: "falsy" }).isISO8601(),
  body("motivo_consulta").trim().notEmpty(),
  body("diagnostico").trim().notEmpty(),
  body("tratamiento").trim().notEmpty(),
  body("notas").optional().trim(),
  body("notes").optional().trim(),
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
