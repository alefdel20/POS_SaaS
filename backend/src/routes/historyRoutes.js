const express = require("express");
const controller = require("../controllers/historyController");
const { requireRole } = require("../middleware/authMiddleware");
const { exportLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin", "gerente"]), controller.listValidation, controller.listHistory);
router.get("/export/excel", requireRole(["superusuario", "superadmin", "admin", "gerente"]), exportLimiter, controller.listValidation, controller.exportHistoryExcel);

module.exports = router;
