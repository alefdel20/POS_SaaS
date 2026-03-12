const express = require("express");
const controller = require("../controllers/authController");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/login", controller.loginValidation, controller.login);
router.get("/me", requireAuth, controller.me);

module.exports = router;
