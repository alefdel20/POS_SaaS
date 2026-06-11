const express = require("express");
const controller = require("../controllers/userController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin", "soporte", "gerente"]), controller.listUsers);
// gerente puede crear usuarios; el servicio (canAssignRole + businessPosType) limita qué roles puede asignar (cajero / cocina en restaurante).
router.post("/", requireRole(["superusuario", "superadmin", "admin", "gerente"]), controller.createValidation, controller.createUser);
router.put("/:id", requireRole(["superusuario", "superadmin", "admin"]), controller.idValidation, controller.updateValidation, controller.updateUser);
router.patch("/:id/status", requireRole(["superusuario", "superadmin", "admin"]), controller.idValidation, controller.statusValidation, controller.updateUserStatus);
router.post("/:id/reset-password", requireRole(["superusuario", "superadmin"]), controller.resetPasswordValidation, controller.resetPassword);
router.post("/:id/support-access", requireRole(["superusuario", "superadmin", "soporte"]), controller.supportAccessValidation, controller.supportAccess);
router.post("/:id/support-mode/activate", requireRole(["superusuario", "superadmin"]), controller.supportModeValidation, controller.activateSupportMode);
router.post("/:id/support-mode/deactivate", requireRole(["superusuario", "superadmin"]), controller.supportModeValidation, controller.deactivateSupportMode);

module.exports = router;
