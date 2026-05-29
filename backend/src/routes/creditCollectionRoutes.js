const express = require("express");
const controller = require("../controllers/creditCollectionController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superadmin", "admin", "gerente"]), controller.listDebtorsValidation, controller.listDebtors);
router.get("/suggestions", requireRole(["superadmin", "admin", "gerente", "user", "cajero", "cashier"]), controller.suggestionValidation, controller.listDebtorSuggestions);
router.get("/export/excel", requireRole(["superadmin", "admin", "gerente"]), controller.exportDebtorsExcel);
router.get("/export/pdf", requireRole(["superadmin", "admin", "gerente"]), controller.exportDebtorsPdf);
router.get("/:saleId/summary", requireRole(["superadmin", "admin", "gerente"]), controller.saleIdValidation, controller.getCreditSaleSummary);
router.get("/:saleId/payments", requireRole(["superadmin", "admin", "gerente"]), controller.saleIdValidation, controller.listPaymentsBySale);
router.post("/:saleId/payments", requireRole(["superadmin", "admin", "gerente"]), controller.createPaymentValidation, controller.createPayment);
router.patch("/:saleId/reminder", requireRole(["superadmin", "admin", "gerente"]), controller.reminderPreferenceValidation, controller.updateReminderPreference);
router.post("/settle-group", requireRole(["superadmin", "admin", "gerente"]), controller.settleGroup);

module.exports = router;
