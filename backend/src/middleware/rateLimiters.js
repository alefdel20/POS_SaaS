const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");

const DEFAULT_MESSAGE = "Demasiadas solicitudes. Intenta en un momento.";

// Authenticated routes: key by user id (same idea as aiRateLimiter), fall back to IP.
// Must be mounted after requireAuth so req.user is populated.
function buildAuthedLimiter({ windowMs, max, message = DEFAULT_MESSAGE }) {
  return rateLimit({
    windowMs,
    max,
    keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
    standardHeaders: true,
    legacyHeaders: false,
    message: { message }
  });
}

// Public routes: key by IP only.
function buildPublicLimiter({ windowMs, max, message = DEFAULT_MESSAGE }) {
  return rateLimit({
    windowMs,
    max,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    standardHeaders: true,
    legacyHeaders: false,
    message: { message }
  });
}

// Public forgot/reset password. Runs in addition to the shared /auth loginLimiter.
const passwordResetLimiter = buildPublicLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Demasiados intentos de restablecimiento de contraseña. Por favor intenta más tarde."
});

// Admin-initiated password reset (POST /users/:id/reset-password).
const authedResetLimiter = buildAuthedLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Demasiados restablecimientos de contraseña. Por favor intenta más tarde."
});

// POST /sales — legitimate high-frequency POS action.
const saleCreationLimiter = buildAuthedLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: "Demasiadas ventas en poco tiempo. Intenta en un momento."
});

// POST /openpay/checkout (public). Webhook routes must NOT use this.
const openpayCheckoutLimiter = buildPublicLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Demasiados intentos de pago. Intenta en un momento."
});

// Heavy bulk import/export and PDF/Excel generation. One shared per-user bucket.
const exportLimiter = buildAuthedLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Demasiadas exportaciones o importaciones. Intenta en un momento."
});

module.exports = {
  buildAuthedLimiter,
  buildPublicLimiter,
  passwordResetLimiter,
  authedResetLimiter,
  saleCreationLimiter,
  openpayCheckoutLimiter,
  exportLimiter
};
