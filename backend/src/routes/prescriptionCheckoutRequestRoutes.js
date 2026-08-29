const express = require("express");
const controller = require("../controllers/prescriptionCheckoutRequestController");
const { requireRole, requirePosType } = require("../middleware/authMiddleware");

const router = express.Router();

// El modulo de recetas pendientes de cobro es exclusivo de Veterinaria - sin este
// gate, cualquier negocio (incluyendo retail) puede pegarle directo al endpoint
// aunque el sidebar ya lo oculte (navigation.ts) para otros pos_type.
const requireVeterinaria = requirePosType(["Veterinaria"]);

router.get("/", requireRole(["superusuario", "superadmin", "admin", "gerente", "cajero"]), requireVeterinaria, controller.listValidation, controller.listPrescriptionCheckoutRequests);
// Nota deliberada: a diferencia de product-update-requests (que excluye cajero
// del summary), aqui SI se incluye cajero porque es quien necesita ver el
// conteo de pendientes en su propia cola de trabajo (caja).
router.get("/pending-summary", requireRole(["superusuario", "superadmin", "admin", "gerente", "cajero"]), requireVeterinaria, controller.getPendingSummary);
// Debe ir DESPUES de "/pending-summary" — Express matchea rutas en orden y
// "/:id" antes capturaria "pending-summary" como si fuera un id.
router.get("/:id", requireRole(["superusuario", "superadmin", "admin", "gerente", "cajero"]), requireVeterinaria, controller.getByIdValidation, controller.getPrescriptionCheckoutRequestById);
// Mismo set que requireClinicalAccess (authMiddleware.js) / ROUTE_ROLES.clinical
// (frontend/src/utils/roles.ts) — quien puede operar el modulo clinico en
// general, no solo "clinico". MedicalConsultationsPage.tsx (origen del boton
// "Pasar a cobro") ya es accesible a superusuario/admin/clinico.
router.post("/", requireRole(["superusuario", "admin", "clinico"]), requireVeterinaria, controller.createValidation, controller.createPrescriptionCheckoutRequest);
router.post("/:id/complete", requireRole(["superusuario", "superadmin", "admin", "gerente", "cajero"]), requireVeterinaria, controller.completeValidation, controller.completePrescriptionCheckoutRequest);
router.post("/:id/cancel", requireRole(["clinico", "superusuario", "superadmin", "admin", "gerente"]), requireVeterinaria, controller.cancelValidation, controller.cancelPrescriptionCheckoutRequest);

module.exports = router;
