const express = require("express");
const controller = require("../controllers/dailyCutController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/export", requireRole(["superadmin", "superusuario", "admin"]), controller.exportValidation, controller.exportDailyCuts);
router.get("/", requireRole(["superadmin", "superusuario", "admin", "cajero", "cashier"]), controller.listValidation, controller.listDailyCuts);
router.get("/today", requireRole(["superadmin", "superusuario", "admin", "cajero", "cashier"]), controller.getTodayDailyCut);

module.exports = router;
