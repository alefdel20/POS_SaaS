const { body, param } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const returnService = require("../services/returnService");

const saleIdValidation = [param("id").isInt({ min: 1 }), validateRequest];

const returnIdValidation = [param("returnId").isInt({ min: 1 }), validateRequest];

const createReturnValidation = [
  param("id").isInt({ min: 1 }),
  body("return_reason").trim().notEmpty(),
  body("resolution_type").isIn(["refund_cash", "credit_note", "exchange"]),
  body("notes").optional({ values: "falsy" }).trim(),
  body("items").isArray({ min: 1 }),
  body("items.*.sale_item_id").isInt({ min: 1 }),
  body("items.*.product_id").isInt({ min: 1 }),
  body("items.*.quantity_returned").isFloat({ gt: 0 }),
  body("items.*.unit_price").isFloat({ min: 0 }),
  body("items.*.subtotal_returned").isFloat({ min: 0 }),
  body("items.*.restock").optional().isBoolean(),
  validateRequest
];

const createReturn = asyncHandler(async (req, res) => {
  const result = await returnService.createReturn(
    Number(req.params.id),
    req.body,
    req.user
  );
  res.status(201).json(result);
});

const approveReturn = asyncHandler(async (req, res) => {
  res.json(await returnService.approveReturn(Number(req.params.returnId), req.user));
});

const rejectReturn = asyncHandler(async (req, res) => {
  res.json(await returnService.rejectReturn(Number(req.params.returnId), req.user));
});

const getReturnsBySale = asyncHandler(async (req, res) => {
  res.json(await returnService.getReturnsBySale(Number(req.params.id), req.user));
});

module.exports = {
  saleIdValidation,
  returnIdValidation,
  createReturnValidation,
  createReturn,
  approveReturn,
  rejectReturn,
  getReturnsBySale
};
