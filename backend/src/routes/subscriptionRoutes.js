const express = require("express");
const { requireRole } = require("../middleware/authMiddleware");
const controller = require("../controllers/subscriptionController");

const router = express.Router();

// Tenant self-service cancellation — only the business admin can cancel their own subscription.
router.post(
  "/cancel",
  requireRole(["admin"]),
  controller.cancelValidation,
  controller.cancelSubscription
);

module.exports = router;
