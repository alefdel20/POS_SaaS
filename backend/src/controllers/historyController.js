const { query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const historyService = require("../services/historyService");

const MOVEMENT_TYPES = ["all", "sales", "credit_collections", "invoice_payments", "expenses", "inventory_restock", "fixed_expenses", "owner_debt"];

const listValidation = [
  query("type").optional({ values: "falsy" }).isIn(MOVEMENT_TYPES),
  query("date").optional({ values: "falsy" }).isISO8601(),
  query("date_from").optional({ values: "falsy" }).isISO8601(),
  query("date_to").optional({ values: "falsy" }).isISO8601(),
  query("folio").optional({ values: "falsy" }).trim(),
  query("payment_method").optional({ values: "falsy" }).isIn(["cash", "card", "credit", "transfer"]),
  query("cashier").optional({ values: "falsy" }).trim(),
  query("total").optional({ values: "falsy" }).isFloat({ min: 0 }),
  validateRequest
];

const listHistory = asyncHandler(async (req, res) => {
  res.json(await historyService.listHistory(req.query, req.user));
});

const exportHistoryExcel = asyncHandler(async (req, res) => {
  const { buffer, filename } = await historyService.exportHistoryExcel(req.query, req.user);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(Buffer.from(buffer));
});

module.exports = {
  listValidation,
  listHistory,
  exportHistoryExcel
};
