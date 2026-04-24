const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const controller = require("../controllers/openPayController");
const webhookAuth = require("../middleware/webhookAuth");

const router = express.Router();
router.get("/webhook", controller.verifyWebhook);
router.post("/webhook", webhookAuth, controller.handleWebhook);
router.post("/checkout", requireAuth, controller.checkoutValidation, controller.createCheckoutSession);

module.exports = router;
