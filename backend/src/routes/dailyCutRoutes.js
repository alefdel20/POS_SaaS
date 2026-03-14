const express = require("express");
const controller = require("../controllers/dailyCutController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superadmin", "admin"]), controller.listDailyCuts);
router.get("/today", requireRole(["superadmin", "admin"]), controller.getTodayDailyCut);

module.exports = router;
