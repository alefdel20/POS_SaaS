const express = require("express");
const reminderController = require("../controllers/reminderController");
const webhookAuth = require("../middleware/webhookAuth");

const router = express.Router();

router.post("/n8n/webhook", webhookAuth, reminderController.webhookValidation, reminderController.receiveAutomationWebhook);

module.exports = router;
