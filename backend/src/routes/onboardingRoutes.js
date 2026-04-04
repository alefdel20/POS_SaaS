const express = require("express");
const { requireRole } = require("../middleware/authMiddleware");
const controller = require("../controllers/onboardingController");

const router = express.Router();

router.post("/setup", requireRole(["superusuario", "superadmin", "admin"]), controller.setupValidation, controller.setupOnboarding);

module.exports = router;
