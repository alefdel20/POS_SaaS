const express = require("express");
const controller = require("../controllers/userController");
const { requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", requireRole(["superusuario", "superadmin", "admin", "soporte"]), controller.listUsers);
router.post("/", requireRole(["superusuario", "superadmin", "admin"]), controller.createValidation, controller.createUser);
router.put("/:id", requireRole(["superusuario", "superadmin", "admin"]), controller.idValidation, controller.updateValidation, controller.updateUser);
router.patch("/:id/status", requireRole(["superusuario", "superadmin", "admin"]), controller.idValidation, controller.statusValidation, controller.updateUserStatus);
router.post("/:id/reset-password", requireRole(["superusuario", "superadmin"]), controller.resetPasswordValidation, controller.resetPassword);
router.post("/:id/support-access", requireRole(["superusuario", "superadmin", "soporte"]), controller.supportAccessValidation, controller.supportAccess);
router.post("/:id/support-mode/activate", requireRole(["superusuario", "superadmin", "soporte"]), controller.supportModeValidation, controller.activateSupportMode);
router.post("/:id/support-mode/deactivate", requireRole(["superusuario", "superadmin", "soporte"]), controller.supportModeValidation, controller.deactivateSupportMode);

module.exports = router;
