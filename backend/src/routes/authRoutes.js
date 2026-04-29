const express = require("express");
const controller = require("../controllers/authController");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/login", controller.loginValidation, controller.login);
router.post(
  "/register-business",
  requireAuth,
  requireRole(["superusuario"]),
  controller.registerBusinessValidation,
  controller.registerBusiness
);
router.get("/me", requireAuth, controller.me);
router.post("/change-password", requireAuth, controller.changePasswordValidation, controller.changePassword);
router.post("/forgot-password", controller.forgotPasswordValidation, controller.forgotPassword);
router.post("/reset-password", controller.resetPasswordValidation, controller.resetPassword);

module.exports = router;
