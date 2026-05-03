const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const controller = require("../controllers/openPayController");

const router = express.Router();

router.get("/webhook", controller.verifyWebhook);
router.post("/webhook", controller.handleWebhook);
router.post("/checkout", controller.checkoutValidation, controller.antifraudCheck, controller.createCheckoutSession);

module.exports = router;
