const rateLimit = require("express-rate-limit");

// Messages with an attachment only (req.chatAttachment, set by
// chatAttachmentUpload): 5 per minute per user, on top of aiRateLimiter.
// Requests without an attachment are skipped and never counted.
const aiAttachmentRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  skip: (req) => !req.chatAttachment,
  keyGenerator: (req) => String(req.user?.id || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown"),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Demasiados mensajes con archivo adjunto. Espera un minuto e intenta de nuevo." }
});

module.exports = aiAttachmentRateLimiter;
