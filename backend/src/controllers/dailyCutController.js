const { body, query } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const dailyCutService = require("../services/dailyCutService");

const listValidation = [
  query("date").optional().isISO8601(),
  query("date_from").optional().isISO8601(),
  query("date_to").optional().isISO8601(),
  query("user_id").optional().isInt(),
  query("month").optional().matches(/^\d{4}-\d{2}$/),
  validateRequest
];

const exportValidation = [
  query("period").optional().isIn(["daily", "monthly"]),
  query("date").optional().isISO8601(),
  query("date_from").optional().isISO8601(),
  query("date_to").optional().isISO8601(),
  query("user_id").optional().isInt(),
  query("month").optional().matches(/^\d{4}-\d{2}$/),
  validateRequest
];

const manualCutValidation = [
  body("cut_date").optional({ values: "falsy" }).isISO8601(),
  body("notes").optional({ values: "falsy" }).trim(),
  validateRequest
];

const listDailyCuts = asyncHandler(async (req, res) => {
  res.json(await dailyCutService.listDailyCuts(req.query, req.user));
});

const getTodayDailyCut = asyncHandler(async (req, res) => {
  res.json(await dailyCutService.getTodayDailyCut(req.user));
});

const exportDailyCuts = asyncHandler(async (req, res) => {
  const { buffer, filename } = await dailyCutService.exportDailyCutsExcel(req.query.period || "daily", req.query, req.user);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(Buffer.from(buffer));
});

const listManualCuts = asyncHandler(async (req, res) => {
  res.json(await dailyCutService.listManualCuts(req.query, req.user));
});

const createManualCut = asyncHandler(async (req, res) => {
  res.status(201).json(await dailyCutService.createManualCut(req.body, req.user));
});

module.exports = {
  listValidation,
  exportValidation,
  manualCutValidation,
  listDailyCuts,
  getTodayDailyCut,
  exportDailyCuts,
  listManualCuts,
  createManualCut
};
