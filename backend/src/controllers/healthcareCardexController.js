const { body, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const healthcareCardexService = require("../services/healthcareCardexService");
const { CARDEX_EVENT_TYPES, CARDEX_STATUSES } = require("../utils/domainEnums");

const listValidation = [
  query("patient_id").isInt({ min: 1 }),
  validateRequest
];

const createValidation = [
  body("patient_id").isInt({ min: 1 }),
  body("event_type").isIn(CARDEX_EVENT_TYPES),
  body("event_date").isISO8601(),
  body("status").optional().isIn(CARDEX_STATUSES),
  body("weight_kg").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("temperature_c").optional({ values: "falsy" }).isFloat(),
  body("heart_rate_bpm").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("respiratory_rate_bpm").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("diagnosis").optional().trim(),
  body("notes").optional().trim(),
  body("veterinarian_user_id").optional({ values: "falsy" }).isInt({ min: 1 }),
  validateRequest
];

const listCardexEntries = asyncHandler(async (req, res) => {
  res.json(await healthcareCardexService.listCardexEntries(req.query, req.user));
});

const createCardexEntry = asyncHandler(async (req, res) => {
  res.status(201).json(await healthcareCardexService.createCardexEntry(req.body, req.user));
});

module.exports = {
  listValidation,
  createValidation,
  listCardexEntries,
  createCardexEntry
};
