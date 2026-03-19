const express = require("express");
const reminderController = require("../controllers/reminderController");

const router = express.Router();

router.post("/n8n/webhook", reminderController.webhookValidation, reminderController.receiveAutomationWebhook);

module.exports = router;
