const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const controller = require("../controllers/openPayController");
const webhookAuth = require("../middleware/webhookAuth");

const router = express.Router();
router.get("/webhook", controller.verifyWebhook);
router.post("/webhook", (req, res, next) => {
  // Route verification requests before webhookAuth (no signature on verify calls)
  if (req.body && req.body.verification_code) return controller.verifyWebhook(req, res, next);
  return webhookAuth(req, res, next);
}, controller.handleWebhook);
router.post("/checkout", controller.checkoutValidation, controller.createCheckoutSession);

module.exports = router;
