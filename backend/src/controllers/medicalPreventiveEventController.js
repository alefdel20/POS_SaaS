const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const clinicalService = require("../services/clinicalService");

const listValidation = [
  query("patient_id").optional().isInt(),
  query("event_type").optional().isIn(["vaccination", "deworming"]),
  validateRequest
];

const createValidation = [
  body("patient_id").isInt(),
  body("event_type").isIn(["vaccination", "deworming"]),
  body("product_id").optional({ values: "falsy" }).isInt(),
  body("product_name_snapshot").optional().trim(),
  body("dose").optional().trim(),
  body("date_administered").optional({ values: "falsy" }).isISO8601(),
  body("next_due_date").optional({ values: "falsy" }).isISO8601(),
  body("status").optional().isIn(["scheduled", "completed", "cancelled"]),
  body("notes").optional().trim(),
  validateRequest
];

const updateValidation = [
  param("id").isInt(),
  ...createValidation
];

const listPreventiveEvents = asyncHandler(async (req, res) => {
  res.json(await clinicalService.listPreventiveEvents(req.query, req.user));
});

const createPreventiveEvent = asyncHandler(async (req, res) => {
  res.status(201).json(await clinicalService.createPreventiveEvent(req.body, req.user));
});

const updatePreventiveEvent = asyncHandler(async (req, res) => {
  res.json(await clinicalService.updatePreventiveEvent(Number(req.params.id), req.body, req.user));
});

module.exports = {
  listValidation,
  createValidation,
  updateValidation,
  listPreventiveEvents,
  createPreventiveEvent,
  updatePreventiveEvent
};
