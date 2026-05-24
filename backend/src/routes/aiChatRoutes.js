const express = require("express");
const multer = require("multer");
const { requireAiAccess } = require("../middleware/aiAuth");
const aiRateLimiter = require("../middleware/aiRateLimiter");
const controller = require("../controllers/aiChatController");

const router = express.Router();

const ticketImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    allowed.has(file.mimetype)
      ? cb(null, true)
      : cb(new Error("Solo se permiten imágenes jpeg, png o webp."));
  }
}).single("image");

router.use(requireAiAccess, aiRateLimiter);

router.post("/sessions", controller.createSessionValidation, controller.createSession);
router.get("/sessions", controller.getSessions);
router.get("/sessions/:sessionId", controller.getSession);
router.delete("/sessions/:sessionId", controller.deleteSession);
router.post("/sessions/:sessionId/messages", controller.sendMessageValidation, controller.sendMessage);
router.post("/quick", controller.chatQuickValidation, controller.chatQuick);
router.get("/quota", controller.getQuota);
router.post(
  "/sessions/:sessionId/analyze-image",
  (req, res, next) =>
    ticketImageUpload(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.message || "Archivo inválido." });
      next();
    }),
  controller.analyzeTicketImage
);

module.exports = router;
