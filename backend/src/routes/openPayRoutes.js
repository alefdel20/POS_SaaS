const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const controller = require("../controllers/openPayController");
const { openpayCheckoutLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

router.get("/webhook", controller.verifyWebhook);
router.post("/webhook", controller.handleWebhook);
router.post("/checkout", openpayCheckoutLimiter, controller.checkoutValidation, controller.antifraudCheck, controller.createCheckoutSession);

module.exports = router;
