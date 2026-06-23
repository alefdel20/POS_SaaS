const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const { body } = require("express-validator");
const alertConfigService = require("../services/alertConfigService");

const upsertValidation = [
  body("alertType").optional().isString(),
  body("thresholdDays").isInt({ min: 7, max: 60 }),
  body("notificationChannels").isArray({ min: 1 }),
  body("notificationChannels.*").isIn(["whatsapp", "email", "in_app"]),
  body("enabled").optional().isBoolean(),
  validateRequest
];

const getConfig = asyncHandler(async (req, res) => {
  res.json(await alertConfigService.getAlertConfig(req.user));
});

const upsertConfig = asyncHandler(async (req, res) => {
  res.json(await alertConfigService.upsertAlertConfig(req.body, req.user));
});

module.exports = { upsertValidation, getConfig, upsertConfig };
