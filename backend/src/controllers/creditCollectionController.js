const { body, param, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const creditCollectionService = require("../services/creditCollectionService");

const listDebtorsValidation = [
  query("search").optional({ values: "falsy" }).trim(),
  query("status").optional({ values: "falsy" }).isIn(["pending", "overdue"]),
  validateRequest
];
const suggestionValidation = [
  query("search").optional({ values: "falsy" }).trim(),
  validateRequest
];
const saleIdValidation = [param("saleId").isInt(), validateRequest];
const createPaymentValidation = [
  param("saleId").isInt(),
  body("amount").isFloat({ gt: 0 }),
  body("payment_method").isIn(["cash", "card", "credit", "transfer"]),
  body("payment_date").optional({ values: "falsy" }).isISO8601(),
  body("notes").optional({ values: "falsy" }).trim(),
  validateRequest
];
const reminderPreferenceValidation = [
  param("saleId").isInt(),
  body("send_reminder").isBoolean(),
  validateRequest
];

const listDebtors = asyncHandler(async (req, res) => {
  const write_off = req.query.write_off === "true";
  res.json(await creditCollectionService.listDebtors(req.user, {
    search: req.query.search,
    status: req.query.status,
    write_off
  }));
});

const listDebtorSuggestions = asyncHandler(async (req, res) => {
  res.json(await creditCollectionService.listDebtorSuggestions(req.user, req.query.search));
});

const listPaymentsBySale = asyncHandler(async (req, res) => {
  res.json(await creditCollectionService.listPaymentsBySale(Number(req.params.saleId), req.user));
});

const getCreditSaleSummary = asyncHandler(async (req, res) => {
  res.json(await creditCollectionService.getCreditSaleSummary(Number(req.params.saleId), req.user));
});

const createPayment = asyncHandler(async (req, res) => {
  res.status(201).json(await creditCollectionService.createPayment(Number(req.params.saleId), req.body, req.user));
});

const updateReminderPreference = asyncHandler(async (req, res) => {
  res.json(await creditCollectionService.updateReminderPreference(Number(req.params.saleId), req.body.send_reminder, req.user));
});

const settleGroup = asyncHandler(async (req, res) => {
  const { saleIds } = req.body;
  if (!Array.isArray(saleIds) || saleIds.length === 0) {
    return res.status(400).json({ message: "saleIds must be a non-empty array" });
  }
  res.json(await creditCollectionService.settleGroup(saleIds, req.user));
});

const exportDebtorsExcel = asyncHandler(async (req, res) => {
  const filters = {
    search: req.query.search || undefined,
    status: req.query.status || undefined,
    includeSettled: req.query.includeSettled === "true"
  };
  const { buffer, filename } = await creditCollectionService.exportDebtorsExcel(req.user, filters);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(Buffer.from(buffer));
});

const exportDebtorsPdf = asyncHandler(async (req, res) => {
  const filters = {
    search: req.query.search || undefined,
    status: req.query.status || undefined,
    includeSettled: req.query.includeSettled === "true"
  };
  const { buffer, filename } = await creditCollectionService.exportDebtorsPdf(req.user, filters);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

const updateDebtorContact = asyncHandler(async (req, res) => {
  const saleId = parseInt(req.params.saleId);
  const actor = req.user;
  const result = await creditCollectionService.updateDebtorContact(
    saleId, actor.business_id, req.body
  );
  res.json({ success: true, data: result });
});

const cancelDebt = asyncHandler(async (req, res) => {
  const saleId = parseInt(req.params.saleId);
  const actor = req.user;
  const result = await creditCollectionService.cancelDebt(
    saleId, actor.business_id, actor.id
  );
  res.json({ success: true, data: result });
});

const writeOffDebt = asyncHandler(async (req, res) => {
  const saleId = parseInt(req.params.saleId);
  const actor = req.user;
  const result = await creditCollectionService.writeOffDebt(
    saleId, actor.business_id
  );
  res.json({ success: true, data: result });
});

const listCancelledWriteOffClientIds = asyncHandler(async (req, res) => {
  const actor = req.user;
  const ids = await creditCollectionService.listCancelledWriteOffClientIds(actor.business_id);
  res.json({ success: true, data: ids });
});

module.exports = {
  listDebtorsValidation,
  suggestionValidation,
  saleIdValidation,
  createPaymentValidation,
  reminderPreferenceValidation,
  listDebtors,
  listDebtorSuggestions,
  listPaymentsBySale,
  getCreditSaleSummary,
  createPayment,
  updateReminderPreference,
  settleGroup,
  exportDebtorsExcel,
  exportDebtorsPdf,
  updateDebtorContact,
  cancelDebt,
  writeOffDebt,
  listCancelledWriteOffClientIds
};
