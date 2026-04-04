const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const clinicalService = require("../services/clinicalService");

const listValidation = [
  query("search").optional().trim(),
  validateRequest
];

const createValidation = [
  body("name").trim().notEmpty(),
  body("email").optional({ values: "falsy" }).isEmail(),
  body("phone").optional().trim(),
  body("tax_id").optional().trim(),
  body("address").optional().trim(),
  body("notes").optional().trim(),
  validateRequest
];

const updateValidation = [
  param("id").isInt(),
  body("name").trim().notEmpty(),
  body("email").optional({ values: "falsy" }).isEmail(),
  body("phone").optional().trim(),
  body("tax_id").optional().trim(),
  body("address").optional().trim(),
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

const listClients = asyncHandler(async (req, res) => {
  res.json(await clinicalService.listClients(req.query.search || "", req.user));
});

const getClientDetail = asyncHandler(async (req, res) => {
  res.json(await clinicalService.getClientDetail(Number(req.params.id), req.user));
});

const createClient = asyncHandler(async (req, res) => {
  res.status(201).json(await clinicalService.createClient(req.body, req.user));
});

const updateClient = asyncHandler(async (req, res) => {
  res.json(await clinicalService.updateClient(Number(req.params.id), req.body, req.user));
});

const updateClientStatus = asyncHandler(async (req, res) => {
  res.json(await clinicalService.setClientStatus(Number(req.params.id), Boolean(req.body.is_active), req.user));
});

module.exports = {
  listValidation,
  createValidation,
  updateValidation,
  idValidation,
  statusValidation,
  listClients,
  getClientDetail,
  createClient,
  updateClient,
  updateClientStatus
};
