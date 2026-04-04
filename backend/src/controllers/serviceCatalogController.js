const { body } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const serviceCatalogService = require("../services/serviceCatalogService");

const listServices = asyncHandler(async (req, res) => {
  res.json(await serviceCatalogService.listServices(req.user));
});

const createValidation = [
  body("name").trim().notEmpty(),
  body("description").optional().trim(),
  body("category").optional().trim(),
  body("price").isFloat({ min: 0 }),
  validateRequest
];

const createService = asyncHandler(async (req, res) => {
  res.status(201).json(await serviceCatalogService.createService(req.body, req.user));
});

module.exports = {
  createValidation,
  listServices,
  createService
};
