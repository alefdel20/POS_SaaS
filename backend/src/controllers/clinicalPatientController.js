const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const clinicalService = require("../services/clinicalService");

const listValidation = [
  query("search").optional().trim(),
  query("client_id").optional().isInt(),
  query("active").optional().isBoolean(),
  validateRequest
];

const createValidation = [
  body("client_id").isInt(),
  body("name").trim().notEmpty(),
  body("species").optional().trim(),
  body("breed").optional().trim(),
  body("sex").optional().trim(),
  body("birth_date").optional({ values: "falsy" }).isISO8601(),
  body("notes").optional().trim(),
  validateRequest
];

const updateValidation = [
  param("id").isInt(),
  body("client_id").isInt(),
  body("name").trim().notEmpty(),
  body("species").optional().trim(),
  body("breed").optional().trim(),
  body("sex").optional().trim(),
  body("birth_date").optional({ values: "falsy" }).isISO8601(),
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
