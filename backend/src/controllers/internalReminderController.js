const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const internalReminderService = require("../services/internalReminderService");

const listDueValidation = [
  query("business_id").optional().isInt(),
  validateRequest
];

const eventIdValidation = [
  param("eventId").isInt(),
  validateRequest
];

const markSentValidation = [
  param("eventId").isInt(),
  body("stage").isIn(["7d", "0d"]),
  body("status").isIn(["sent", "not_applicable"]),
  validateRequest
];

const rescheduleValidation = [
  param("eventId").isInt(),
  body("date").isISO8601(),
  body("time").matches(/^\d{2}:\d{2}(:\d{2})?$/),
  body("doctor_id").optional({ values: "falsy" }).isInt(),
  body("duration_minutes").optional({ values: "falsy" }).isInt({ min: 5, max: 240 }),
  validateRequest
];

const dailyDigestValidation = [
  query("business_id").isInt(),
  validateRequest
];

const listDueReminders = asyncHandler(async (req, res) => {
  const businessId = req.query.business_id ? Number(req.query.business_id) : null;
  res.json(await internalReminderService.listDueReminders({ businessId }));
});

const markReminderSent = asyncHandler(async (req, res) => {
  res.json(await internalReminderService.markReminderSent(Number(req.params.eventId), req.body));
});

const cancelReminderEvent = asyncHandler(async (req, res) => {
  res.json(await internalReminderService.cancelReminderEvent(Number(req.params.eventId)));
});

const rescheduleReminderEvent = asyncHandler(async (req, res) => {
  res.json(await internalReminderService.rescheduleReminderEvent(Number(req.params.eventId), req.body));
});

const getDailyDigest = asyncHandler(async (req, res) => {
  res.json(await internalReminderService.getDailyDigest(Number(req.query.business_id)));
});

module.exports = {
  listDueValidation,
  eventIdValidation,
  markSentValidation,
  rescheduleValidation,
  dailyDigestValidation,
  listDueReminders,
  markReminderSent,
  cancelReminderEvent,
  rescheduleReminderEvent,
  getDailyDigest
};
