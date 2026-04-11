const express = require("express");
const controller = require("../controllers/creditCollectionController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superadmin", "admin"]), controller.listDebtorsValidation, controller.listDebtors);
router.get("/suggestions", requireRole(["superadmin", "admin", "user", "cajero", "cashier"]), controller.suggestionValidation, controller.listDebtorSuggestions);
router.get("/:saleId/summary", requireRole(["superadmin", "admin"]), controller.saleIdValidation, controller.getCreditSaleSummary);
router.get("/:saleId/payments", requireRole(["superadmin", "admin"]), controller.saleIdValidation, controller.listPaymentsBySale);
router.post("/:saleId/payments", requireRole(["superadmin", "admin"]), controller.createPaymentValidation, controller.createPayment);
router.patch("/:saleId/reminder", requireRole(["superadmin", "admin"]), controller.reminderPreferenceValidation, controller.updateReminderPreference);

module.exports = router;
