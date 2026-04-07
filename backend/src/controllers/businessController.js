const { body } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const businessService = require("../services/businessService");
const {
  BUSINESS_TYPE_OPTIONS,
  POS_TYPE_OPTIONS,
  normalizePosType
} = require("../utils/business");

const normalizeClassificationPayload = (req, _res, next) => {
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

const listBusinesses = asyncHandler(async (req, res) => {
  res.json(await businessService.listBusinesses(req.user));
});

const createBusiness = asyncHandler(async (req, res) => {
  res.status(201).json(await businessService.createBusiness(req.body, req.user));
});

module.exports = { createValidation, listBusinesses, createBusiness };
