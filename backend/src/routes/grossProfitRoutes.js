const express = require("express");
const controller = require("../controllers/grossProfitController");
const { requireRole } = require("../middleware/authMiddleware");
const { exportLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

const allowed = requireRole(["superadmin", "admin", "gerente"]);

router.get("/",             allowed, controller.getReport);
router.get("/export/excel", allowed, exportLimiter, controller.exportExcel);
router.get("/export/pdf",   allowed, exportLimiter, controller.exportPdf);

module.exports = router;
