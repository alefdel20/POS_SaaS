const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const healthcarePreventiveEventService = require("../services/healthcarePreventiveEventService");
const { PREVENTIVE_EVENT_STATUSES, PREVENTIVE_EVENT_TYPES } = require("../utils/domainEnums");

const listValidation = [
  query("patient_id").optional().isInt(),
  query("event_type").optional().isIn(PREVENTIVE_EVENT_TYPES),
  validateRequest
];

const createValidation = [
  body("patient_id").isInt(),
  body("event_type").isIn(PREVENTIVE_EVENT_TYPES),
  body("product_id").optional({ values: "falsy" }).isInt(),
  body("product_name_snapshot").optional().trim(),
  body("dose").optional().trim(),
  body("date_administered").optional({ values: "falsy" }).isISO8601(),
  body("next_due_date").optional({ values: "falsy" }).isISO8601(),
  body("status").optional().isIn(PREVENTIVE_EVENT_STATUSES),
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
  body("status").isIn(PREVENTIVE_EVENT_STATUSES),
  validateRequest
];

const listPreventiveEvents = asyncHandler(async (req, res) => {
  res.json(await healthcarePreventiveEventService.listPreventiveEvents(req.query, req.user));
});

const getPreventiveEventDetail = asyncHandler(async (req, res) => {
  res.json(await healthcarePreventiveEventService.getPreventiveEventDetail(Number(req.params.id), req.user));
});

const createPreventiveEvent = asyncHandler(async (req, res) => {
  res.status(201).json(await healthcarePreventiveEventService.createPreventiveEvent(req.body, req.user));
});

const updatePreventiveEvent = asyncHandler(async (req, res) => {
  res.json(await healthcarePreventiveEventService.updatePreventiveEvent(Number(req.params.id), req.body, req.user));
});

const updatePreventiveEventStatus = asyncHandler(async (req, res) => {
  res.json(await healthcarePreventiveEventService.setPreventiveEventStatus(Number(req.params.id), req.body.status, req.user));
});

module.exports = {
  listValidation,
  createValidation,
  updateValidation,
  idValidation,
  statusValidation,
  listPreventiveEvents,
  getPreventiveEventDetail,
  createPreventiveEvent,
  updatePreventiveEvent,
  updatePreventiveEventStatus
};
