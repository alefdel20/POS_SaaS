const asyncHandler = require("../utils/asyncHandler");
const dailyCutService = require("../services/dailyCutService");

const listDailyCuts = asyncHandler(async (req, res) => {
  res.json(await dailyCutService.listDailyCuts());
});

const getTodayDailyCut = asyncHandler(async (req, res) => {
  res.json(await dailyCutService.getTodayDailyCut());
});

module.exports = {
  listDailyCuts,
  getTodayDailyCut
};
