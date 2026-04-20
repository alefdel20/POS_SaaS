const crypto = require("crypto");

module.exports = function webhookAuth(req, res, next) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ message: "Webhook secret not configured." });
  }

  const rawSignature = req.headers["x-webhook-signature"];
  if (!rawSignature) {
    return res.status(401).json({ message: "Missing webhook signature." });
  }

  // Strip optional "sha256=" prefix so both "abc123" and "sha256=abc123" are accepted
  const signature = rawSignature.startsWith("sha256=")
    ? rawSignature.slice(7)
    : rawSignature;

  // Prefer raw body buffer captured via express.json verify callback (req.rawBody).
  // Falls back to re-serializing the parsed body — requires n8n to sign the
  // JSON.stringify output. See docs for the express.json verify approach.
  const payload =
    req.rawBody instanceof Buffer
      ? req.rawBody
      : Buffer.from(
          typeof req.body === "string" ? req.body : JSON.stringify(req.body)
        );

  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  let provided;
  try {
    provided = Buffer.from(signature, "hex");
    if (provided.length !== 32) throw new Error("bad length");
  } catch {
    return res.status(401).json({ message: "Invalid webhook signature format." });
  }

  if (!crypto.timingSafeEqual(provided, Buffer.from(expected, "hex"))) {
    return res.status(401).json({ message: "Invalid webhook signature." });
  }

  next();
};
