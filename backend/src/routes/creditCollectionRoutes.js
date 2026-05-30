const express = require("express");
const controller = require("../controllers/creditCollectionController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superadmin", "admin", "gerente"]), controller.listDebtorsValidation, controller.listDebtors);
router.get("/suggestions", requireRole(["superadmin", "admin", "gerente", "user", "cajero", "cashier"]), controller.suggestionValidation, controller.listDebtorSuggestions);
router.get("/export/excel", requireRole(["superadmin", "admin", "gerente"]), controller.exportDebtorsExcel);
router.get("/export/pdf", requireRole(["superadmin", "admin", "gerente"]), controller.exportDebtorsPdf);
router.get("/cancelled-write-offs", requireRole(["superadmin", "admin", "gerente"]), controller.listCancelledWriteOffClientIds);
router.get("/:saleId/summary", requireRole(["superadmin", "admin", "gerente"]), controller.saleIdValidation, controller.getCreditSaleSummary);
router.get("/:saleId/payments", requireRole(["superadmin", "admin", "gerente"]), controller.saleIdValidation, controller.listPaymentsBySale);
router.post("/:saleId/payments", requireRole(["superadmin", "admin", "gerente"]), controller.createPaymentValidation, controller.createPayment);
router.patch("/:saleId/reminder", requireRole(["superadmin", "admin", "gerente"]), controller.reminderPreferenceValidation, controller.updateReminderPreference);
router.post("/settle-group", requireRole(["superadmin", "admin", "gerente"]), controller.settleGroup);
router.patch("/:saleId/contact", requireRole(["superadmin", "admin", "gerente"]), controller.updateDebtorContact);
router.delete("/:saleId", requireRole(["superadmin", "admin", "gerente"]), controller.cancelDebt);
router.patch("/:saleId/write-off", requireRole(["superadmin", "admin", "gerente"]), controller.writeOffDebt);

module.exports = router;
