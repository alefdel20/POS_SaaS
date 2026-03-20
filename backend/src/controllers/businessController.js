const { body } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const businessService = require("../services/businessService");

const createValidation = [
  body("name").trim().notEmpty(),
  body("slug").optional({ values: "falsy" }).trim(),
  body("pos_type").isIn(["Tlapaleria", "Tienda", "Farmacia", "Papeleria", "Otro"]),
  validateRequest
];

const listBusinesses = asyncHandler(async (req, res) => {
  res.json(await businessService.listBusinesses(req.user));
});

const createBusiness = asyncHandler(async (req, res) => {
  res.status(201).json(await businessService.createBusiness(req.body, req.user));
});

module.exports = { createValidation, listBusinesses, createBusiness };
