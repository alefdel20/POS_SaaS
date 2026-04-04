const express = require("express");
const controller = require("../controllers/dashboardController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/summary", requireRole(["superusuario", "superadmin", "admin"]), controller.getSummary);

module.exports = router;
