const rateLimit = require("express-rate-limit");

const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => String(req.user?.id || req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Demasiadas solicitudes de IA. Intenta en un momento." }
});

module.exports = aiRateLimiter;
