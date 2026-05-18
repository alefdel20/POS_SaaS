const rateLimit = require("express-rate-limit");

const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => String(req.user?.id || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown"),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Demasiadas solicitudes de IA. Intenta en un momento." }
});

module.exports = aiRateLimiter;
