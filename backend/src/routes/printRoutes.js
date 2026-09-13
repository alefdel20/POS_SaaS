const express = require("express");
const controller = require("../controllers/printController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

// Same roles allowed to create a sale (saleRoutes.js:14) — only users who can
// ring up a sale should be able to trigger a signed, silent print of one.
router.post("/sign", requireRole(["superadmin", "admin", "gerente", "user", "cajero", "cashier"]), controller.signValidation, controller.signRequest);

module.exports = router;
