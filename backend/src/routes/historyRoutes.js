const express = require("express");
const controller = require("../controllers/historyController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin"]), controller.listValidation, controller.listHistory);

module.exports = router;
