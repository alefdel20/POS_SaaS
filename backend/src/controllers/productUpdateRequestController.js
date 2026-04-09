const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const productUpdateRequestService = require("../services/productUpdateRequestService");

const listValidation = [
  query("status").optional({ values: "falsy" }).isIn(["pending", "approved", "rejected"]),
  query("requested_by_user_id").optional({ values: "falsy" }).isInt({ min: 1 }),
  query("product_id").optional({ values: "falsy" }).isInt({ min: 1 }),
  query("search").optional({ values: "falsy" }).trim(),
  query("date_from").optional({ values: "falsy" }).isISO8601(),
  query("date_to").optional({ values: "falsy" }).isISO8601(),
  query("page").optional({ values: "falsy" }).isInt({ min: 1 }),
  query("pageSize").optional({ values: "falsy" }).isInt({ min: 5, max: 25 }),
  query("includeMeta").optional({ values: "falsy" }).isBoolean(),
  validateRequest
];

const createValidation = [
  body("product_id").isInt({ min: 1 }),
  body("business_id").optional({ values: "falsy" }).isInt({ min: 1 }),
  body("reason").optional({ values: "falsy" }).trim(),
  body("new_values").optional().isObject(),
  body("requested_price").optional({ values: "falsy" }).isFloat({ gt: 0, maxDecimalPlaces: 5 }),
  body("requested_stock").optional({ values: "falsy" }).isFloat({ min: 0, maxDecimalPlaces: 3 }),
  body("new_stock").optional({ values: "falsy" }).isFloat({ min: 0, maxDecimalPlaces: 3 }),
  validateRequest
];

const reviewValidation = [
  param("id").isInt({ min: 1 }),
  body("decision").isIn(["approve", "reject"]),
  body("review_note").optional().trim(),
  validateRequest
];

const listProductUpdateRequests = asyncHandler(async (req, res) => {
  const response = await productUpdateRequestService.listProductUpdateRequests({
    status: req.query.status
  ,
    requested_by_user_id: req.query.requested_by_user_id,
    product_id: req.query.product_id,
    search: req.query.search,
    date_from: req.query.date_from,
    date_to: req.query.date_to,
    page: req.query.page,
    pageSize: req.query.pageSize
  }, req.user);
  res.json(req.query.includeMeta === "true" ? response : response.items);
});

const getPendingSummary = asyncHandler(async (req, res) => {
  res.json(await productUpdateRequestService.getPendingProductUpdateSummary(req.user));
});

const getRequestSummary = asyncHandler(async (req, res) => {
  res.json(await productUpdateRequestService.getProductUpdateRequestSummary(req.user));
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
  getRequestSummary,
  createProductUpdateRequest,
  reviewProductUpdateRequest
};
