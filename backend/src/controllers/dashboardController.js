const asyncHandler = require("../utils/asyncHandler");
const dashboardService = require("../services/dashboardService");

const getSummary = asyncHandler(async (req, res) => {
  res.json(await dashboardService.getSummary());
});

module.exports = {
  getSummary
};
