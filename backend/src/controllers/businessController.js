const { body, param } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const businessService = require("../services/businessService");
const {
  BUSINESS_TYPE_OPTIONS,
  POS_TYPE_OPTIONS,
  normalizePosType
} = require("../utils/business");

const normalizeClassificationPayload = (req, _res, next) => {
  console.log("[BEFORE_NORMALIZE]", req.body);

  if (req.body?.business_type) {
    const normalizedBusinessType = normalizePosType(req.body.business_type);
    if (normalizedBusinessType) {
      req.body.business_type = normalizedBusinessType;
    }
  }

  if (req.body?.pos_type) {
    const normalizedPosType = normalizePosType(req.body.pos_type);
    if (normalizedPosType) {
      req.body.pos_type = normalizedPosType;
    }
  }

  console.log("[AFTER_NORMALIZE]", req.body);

  next();
};

const createValidation = [
  normalizeClassificationPayload,
  body("name").trim().notEmpty().withMessage("El nombre es obligatorio"),
  body("slug").optional({ values: "falsy" }).trim(),
  body("business_type")
    .optional({ values: "falsy" })
    .isIn(BUSINESS_TYPE_OPTIONS)
    .withMessage("El tipo de negocio no es válido"),
  body("pos_type")
    .optional({ values: "falsy" })
    .isIn(POS_TYPE_OPTIONS)
    .withMessage("El tipo de POS no es válido"),
  validateRequest
];

const businessIdValidation = [
  param("id").isInt(),
  validateRequest
];

const subscriptionValidation = [
  param("id").isInt(),
  body("plan_type").optional({ nullable: true }).isIn(["monthly", "yearly"]),
  body("billing_anchor_date").optional({ nullable: true }).isISO8601(),
  body("next_payment_date").optional({ nullable: true }).isISO8601(),
  body("grace_period_days").optional().isInt({ min: 0 }),
  body("enforcement_enabled").optional().isBoolean(),
  body("manual_adjustment_reason").optional({ values: "falsy" }).trim(),
  validateRequest
];

const registerSubscriptionPaymentValidation = [
  param("id").isInt(),
  body("paid_at").optional({ values: "falsy" }).isISO8601(),
  body("note").optional({ values: "falsy" }).trim(),
  validateRequest
];

const stampLoadValidation = [
  param("id").isInt(),
  body("quantity").isInt({ min: 1 }),
  body("note").optional({ values: "falsy" }).trim(),
  validateRequest
];

const listBusinesses = asyncHandler(async (req, res) => {
  res.json(await businessService.listBusinesses(req.user));
});

const createBusiness = asyncHandler(async (req, res) => {
  console.log("[BUSINESS_CREATE_BODY]", JSON.stringify(req.body, null, 2));

  res.status(201).json(await businessService.createBusiness(req.body, req.user));
});

const updateBusinessSubscription = asyncHandler(async (req, res) => {
  res.json(await businessService.updateBusinessSubscriptionSettings(Number(req.params.id), req.body, req.user));
});

const registerBusinessSubscriptionPayment = asyncHandler(async (req, res) => {
  res.json(await businessService.registerBusinessSubscriptionPaymentAction(Number(req.params.id), req.body, req.user));
});

const loadBusinessStamps = asyncHandler(async (req, res) => {
  res.status(201).json(await businessService.manualLoadBusinessStamps(Number(req.params.id), req.body, req.user));
});

const listBusinessStampMovements = asyncHandler(async (req, res) => {
  res.json(await businessService.listBusinessStampMovements(Number(req.params.id), req.user));
});

module.exports = {
  createValidation,
  businessIdValidation,
  subscriptionValidation,
  registerSubscriptionPaymentValidation,
  stampLoadValidation,
  listBusinesses,
  createBusiness,
  updateBusinessSubscription,
  registerBusinessSubscriptionPayment,
  loadBusinessStamps,
  listBusinessStampMovements
};


