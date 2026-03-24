const express = require("express");
const controller = require("../controllers/adminInvoiceController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin", "soporte"]), controller.listAdministrativeInvoices);
router.get("/:id", requireRole(["superusuario", "superadmin", "admin", "soporte"]), controller.idValidation, controller.getAdministrativeInvoice);
router.get("/:id/export/pdf", requireRole(["superusuario", "superadmin", "admin", "soporte"]), controller.idValidation, controller.exportAdministrativeInvoicePdf);
router.get("/:id/export/docx", requireRole(["superusuario", "superadmin", "admin", "soporte"]), controller.idValidation, controller.exportAdministrativeInvoiceDocx);
router.put("/:id", requireRole(["superusuario", "superadmin", "admin"]), controller.updateValidation, controller.updateAdministrativeInvoice);

module.exports = router;
