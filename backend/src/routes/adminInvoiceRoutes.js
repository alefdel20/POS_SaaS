const express = require("express");
const controller = require("../controllers/adminInvoiceController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

// Wrapper para manejar errores async sin romper Express
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// 🔍 LISTAR FACTURAS
router.get(
  "/",
  requireRole(["superusuario", "superadmin", "admin", "soporte"]),
  asyncHandler(controller.listAdministrativeInvoices)
);

// 🔍 OBTENER POR ID
router.get(
  "/:id",
  requireRole(["superusuario", "superadmin", "admin", "soporte"]),
  controller.idValidation,
  asyncHandler(controller.getAdministrativeInvoice)
);

// 📄 EXPORTAR PDF
router.get(
  "/:id/export/pdf",
  requireRole(["superusuario", "superadmin", "admin", "soporte"]),
  controller.idValidation,
  asyncHandler(controller.exportAdministrativeInvoicePdf)
);

// 📄 EXPORTAR DOCX
router.get(
  "/:id/export/docx",
  requireRole(["superusuario", "superadmin", "admin", "soporte"]),
  controller.idValidation,
  asyncHandler(controller.exportAdministrativeInvoiceDocx)
);

// ✏️ ACTUALIZAR (solo admin)
router.put(
  "/:id",
  requireRole(["superusuario", "superadmin", "admin"]),
  controller.updateValidation,
  asyncHandler(controller.updateAdministrativeInvoice)
);

module.exports = router;
