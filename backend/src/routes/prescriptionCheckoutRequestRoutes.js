const express = require("express");
const controller = require("../controllers/prescriptionCheckoutRequestController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin", "gerente", "cajero"]), controller.listValidation, controller.listPrescriptionCheckoutRequests);
// Nota deliberada: a diferencia de product-update-requests (que excluye cajero
// del summary), aqui SI se incluye cajero porque es quien necesita ver el
// conteo de pendientes en su propia cola de trabajo (caja).
router.get("/pending-summary", requireRole(["superusuario", "superadmin", "admin", "gerente", "cajero"]), controller.getPendingSummary);
// Debe ir DESPUES de "/pending-summary" — Express matchea rutas en orden y
// "/:id" antes capturaria "pending-summary" como si fuera un id.
router.get("/:id", requireRole(["superusuario", "superadmin", "admin", "gerente", "cajero"]), controller.getByIdValidation, controller.getPrescriptionCheckoutRequestById);
router.post("/", requireRole(["clinico"]), controller.createValidation, controller.createPrescriptionCheckoutRequest);
router.post("/:id/complete", requireRole(["superusuario", "superadmin", "admin", "gerente", "cajero"]), controller.completeValidation, controller.completePrescriptionCheckoutRequest);
router.post("/:id/cancel", requireRole(["clinico", "superusuario", "superadmin", "admin", "gerente"]), controller.cancelValidation, controller.cancelPrescriptionCheckoutRequest);

module.exports = router;
