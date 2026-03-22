const { body } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const businessService = require("../services/businessService");
const { BUSINESS_TYPE_OPTIONS, POS_TYPE_OPTIONS } = require("../utils/business");

const createValidation = [
  body("name").trim().notEmpty(),
  body("slug").optional({ values: "falsy" }).trim(),
  body("business_type").optional({ values: "falsy" }).isIn(BUSINESS_TYPE_OPTIONS),
  body("pos_type").optional({ values: "falsy" }).isIn(POS_TYPE_OPTIONS),
  body("pos_type_manual").optional({ values: "falsy" }).trim(),
  validateRequest
];

const listBusinesses = asyncHandler(async (req, res) => {
  res.json(await businessService.listBusinesses(req.user));
});

const createBusiness = asyncHandler(async (req, res) => {
  res.status(201).json(await businessService.createBusiness(req.body, req.user));
});

module.exports = { createValidation, listBusinesses, createBusiness };
