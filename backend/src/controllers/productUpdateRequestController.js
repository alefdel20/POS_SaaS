const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const productUpdateRequestService = require("../services/productUpdateRequestService");

const listValidation = [
  query("status").optional({ values: "falsy" }).isIn(["pending", "approved", "rejected"]),
  validateRequest
];

const createValidation = [
  body("product_id").isInt({ min: 1 }),
  body("reason").trim().notEmpty(),
  validateRequest
];

const reviewValidation = [
  param("id").isInt({ min: 1 }),
  body("decision").isIn(["approve", "reject"]),
  body("review_note").optional().trim(),
  validateRequest
];

const listProductUpdateRequests = asyncHandler(async (req, res) => {
  res.json(await productUpdateRequestService.listProductUpdateRequests({
    status: req.query.status
  }, req.user));
});

const getPendingSummary = asyncHandler(async (req, res) => {
  res.json(await productUpdateRequestService.getPendingProductUpdateSummary(req.user));
});

const createProductUpdateRequest = asyncHandler(async (req, res) => {
  res.status(201).json(await productUpdateRequestService.createProductUpdateRequest(req.body, req.user));
});

const reviewProductUpdateRequest = asyncHandler(async (req, res) => {
  res.json(await productUpdateRequestService.reviewProductUpdateRequest(Number(req.params.id), req.body, req.user));
});

module.exports = {
  listValidation,
  createValidation,
  reviewValidation,
  listProductUpdateRequests,
  getPendingSummary,
  createProductUpdateRequest,
  reviewProductUpdateRequest
};
