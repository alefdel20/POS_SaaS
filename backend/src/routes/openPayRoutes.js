const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const controller = require("../controllers/openPayController");

const router = express.Router();

router.get("/webhook", controller.verifyWebhook);
router.post("/webhook", controller.handleWebhook);
router.post("/checkout", controller.checkoutValidation, controller.createCheckoutSession);
router.get("/verify-3ds", controller.verify3DS);

module.exports = router;
