const express = require("express");
const { requireAiAccess } = require("../middleware/aiAuth");
const aiRateLimiter = require("../middleware/aiRateLimiter");
const controller = require("../controllers/aiChatController");

const router = express.Router();

router.use(requireAiAccess, aiRateLimiter);

router.post("/sessions", controller.createSessionValidation, controller.createSession);
router.get("/sessions", controller.getSessions);
router.get("/sessions/:sessionId", controller.getSession);
router.delete("/sessions/:sessionId", controller.deleteSession);
router.post("/sessions/:sessionId/messages", controller.sendMessageValidation, controller.sendMessage);
router.post("/quick", controller.chatQuickValidation, controller.chatQuick);
router.get("/quota", controller.getQuota);

module.exports = router;
