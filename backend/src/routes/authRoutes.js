const express = require("express");
const controller = require("../controllers/authController");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/login", controller.loginValidation, controller.login);
router.post("/register-business", controller.registerBusinessValidation, controller.registerBusiness);
router.get("/me", requireAuth, controller.me);
router.post("/change-password", requireAuth, controller.changePasswordValidation, controller.changePassword);

module.exports = router;
