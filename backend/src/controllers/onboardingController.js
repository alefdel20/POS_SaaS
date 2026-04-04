const { body } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const onboardingService = require("../services/onboardingService");
const { POS_TYPE_OPTIONS } = require("../utils/business");

const setupValidation = [
  body("business_name").trim().notEmpty(),
  body("pos_type").isIn(POS_TYPE_OPTIONS),
  validateRequest
];

const setupOnboarding = asyncHandler(async (req, res) => {
  res.status(201).json(await onboardingService.setupOnboarding(req.body, req.user));
});

module.exports = {
  setupValidation,
  setupOnboarding
};
