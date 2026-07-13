const crypto = require("crypto");

// Bearer-token auth for internal service-to-service calls (ankode-agent).
// Same timingSafeEqual comparison pattern as webhookAuth.js, but a plain
// shared-secret bearer check instead of an HMAC-signed payload — there is no
// webhook body to sign here, just "is the caller ankode-agent".
module.exports = function requireInternalToken(req, res, next) {
  const token = process.env.ANKODE_INTERNAL_TOKEN;
  if (!token) {
    return res.status(500).json({ message: "Internal token not configured." });
  }

  const authHeader = req.headers.authorization || req.headers.Authorization;
  const [scheme, provided] = String(authHeader || "").trim().split(/\s+/);

  if (!scheme || scheme.toLowerCase() !== "bearer" || !provided) {
    return res.status(401).json({ message: "Missing internal token." });
  }

  const expectedBuffer = Buffer.from(token);
  const providedBuffer = Buffer.from(provided);

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return res.status(401).json({ message: "Invalid internal token." });
  }

  next();
};
