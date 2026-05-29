const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const grossProfitService = require("../services/grossProfitService");

function parseAndValidateDates(from, to) {
  if (!from || !to) {
    throw new ApiError(400, "Los parámetros from y to son requeridos");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new ApiError(400, "Los parámetros from y to deben tener formato YYYY-MM-DD");
  }
  if (from > to) {
    throw new ApiError(400, "El parámetro from debe ser anterior o igual a to");
  }
  const diffMs = new Date(to) - new Date(from);
  if (diffMs > 366 * 24 * 60 * 60 * 1000) {
    throw new ApiError(400, "El rango máximo permitido es 366 días");
  }
  return { from, to };
}

const getReport = asyncHandler(async (req, res) => {
  const { from, to } = parseAndValidateDates(req.query.from, req.query.to);
  const { data, summary } = await grossProfitService.getGrossProfitReport(req.user, from, to);
  res.json({ data, summary, period: { from, to } });
});

const exportExcel = asyncHandler(async (req, res) => {
  const { from, to } = parseAndValidateDates(req.query.from, req.query.to);
  const { buffer, filename } = await grossProfitService.exportGrossProfitExcel(req.user, from, to);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(Buffer.from(buffer));
});

const exportPdf = asyncHandler(async (req, res) => {
  const { from, to } = parseAndValidateDates(req.query.from, req.query.to);
  const { buffer, filename } = await grossProfitService.exportGrossProfitPdf(req.user, from, to);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
});

module.exports = { getReport, exportExcel, exportPdf };
