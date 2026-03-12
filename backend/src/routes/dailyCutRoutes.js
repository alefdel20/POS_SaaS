const express = require("express");
const controller = require("../controllers/dailyCutController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superadmin"]), controller.listDailyCuts);
router.get("/today", requireRole(["superadmin"]), controller.getTodayDailyCut);

module.exports = router;
