const express = require("express");
const { requireRole } = require("../middleware/authMiddleware");
const controller = require("../controllers/adminMetricsController");

const router = express.Router();

router.get("/summary", requireRole(["superusuario"]), controller.getMetricsSummary);

module.exports = router;
