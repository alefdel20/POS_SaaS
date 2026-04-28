const crypto = require("crypto");
const https = require("https");
const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getBaseUrl() {
  const isSandbox = process.env.OPENPAY_SANDBOX === "true";
  const merchantId = process.env.OPENPAY_MERCHANT_ID || "";
  const host = isSandbox
    ? "https://sandbox-api.openpay.mx"
    : "https://api.openpay.mx";
  return `${host}/v1/${merchantId}`;
}

function getAuthHeader() {
  const privateKey = process.env.OPENPAY_PRIVATE_KEY || "";
  return "Basic " + Buffer.from(`${privateKey}:`).toString("base64");
}

// ---------------------------------------------------------------------------
// HTTP helper — uses Node built-in https, no external dependencies
// ---------------------------------------------------------------------------

function openpayRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const fullUrl = new URL(getBaseUrl() + path);
    const bodyData = body ? JSON.stringify(body) : null;

    const options = {
      hostname: fullUrl.hostname,
      path: fullUrl.pathname + (fullUrl.search || ""),
      method: method.toUpperCase(),
      headers: {
        "Authorization": getAuthHeader(),
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(bodyData ? { "Content-Length": Buffer.byteLength(bodyData) } : {})
      }
    };

    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = {}; }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
        } else {
          const msg = parsed.description || parsed.error_code
            || `OpenPay API error ${res.statusCode}`;
          const err = new ApiError(res.statusCode >= 500 ? 502 : res.statusCode, msg);
          err.openpayDetails = parsed;
          reject(err);
        }
      });
    });

    req.on("error", (err) =>
      reject(new ApiError(502, `OpenPay connection failed: ${err.message}`))
    );

    if (bodyData) req.write(bodyData);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

async function createCustomer(businessId, name, email) {
  const { rows } = await pool.query(
    `SELECT openpay_customer_id
     FROM business_subscriptions
     WHERE business_id = $1
     LIMIT 1`,
    [Number(businessId)]
  );

  if (rows[0]?.openpay_customer_id) {
    return rows[0].openpay_customer_id;
  }

  const result = await openpayRequest("POST", "/customers", {
    name: String(name || "").trim(),
    email: String(email || "").trim(),
    requires_account: false
  });

  await pool.query(
    `UPDATE business_subscriptions
     SET openpay_customer_id = $1,
         payment_provider    = 'openpay',
         updated_at          = NOW()
     WHERE business_id = $2`,
    [result.id, Number(businessId)]
  );

  return result.id;
}

// ---------------------------------------------------------------------------
// Plan
// OpenPay plan amounts are in MXN pesos (decimal), not cents.
// ---------------------------------------------------------------------------

async function createPlan(planType, amount) {
  const normalized = String(planType || "").toLowerCase();
  if (!["monthly", "yearly"].includes(normalized)) {
    throw new ApiError(400, "Invalid plan type for OpenPay plan creation");
  }

  const amountMxn = Number(amount);
  if (!Number.isFinite(amountMxn) || amountMxn <= 0) {
    throw new ApiError(400, "Invalid subscription amount");
  }

  const result = await openpayRequest("POST", "/plans", {
    amount: amountMxn,
    status_after_retry: "unpaid",
    retry_times: 3,
    name: `Ankode POS - ${normalized === "monthly" ? "Mensual" : "Anual"}`,
    repeat_every: 1,
    repeat_unit: normalized === "yearly" ? "year" : "month",
    trial_days: 0,
    currency: "MXN"
  });

  return result.id;
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

async function createSubscription(customerId, planId, cardToken) {
  const result = await openpayRequest(
    "POST",
    `/customers/${encodeURIComponent(customerId)}/subscriptions`,
    {
      plan_id: planId,
      source_id: cardToken
    }
  );

  return result.id;
}

async function cancelSubscription(customerId, subscriptionId) {
  return openpayRequest(
    "DELETE",
    `/customers/${encodeURIComponent(customerId)}/subscriptions/${encodeURIComponent(subscriptionId)}`
  );
}

async function getSubscription(customerId, subscriptionId) {
  return openpayRequest(
    "GET",
    `/customers/${encodeURIComponent(customerId)}/subscriptions/${encodeURIComponent(subscriptionId)}`
  );
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// Same HMAC-SHA256 hex pattern used in webhookAuth.js
// ---------------------------------------------------------------------------

function verifyWebhookSignature(payload, signature) {
  const secret = process.env.OPENPAY_WEBHOOK_SECRET;
  if (!secret) {
    throw new ApiError(500, "OpenPay webhook secret not configured");
  }

  if (!signature) return false;

  const rawSig = String(signature).startsWith("sha256=")
    ? String(signature).slice(7)
    : String(signature);

  const body =
    payload instanceof Buffer
      ? payload
      : Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload));

  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  let provided;
  try {
    provided = Buffer.from(rawSig, "hex");
    if (provided.length !== 32) return false;
  } catch {
    return false;
  }

  return crypto.timingSafeEqual(provided, Buffer.from(expected, "hex"));
}

module.exports = {
  getBaseUrl,
  getAuthHeader,
  createCustomer,
  createPlan,
  createSubscription,
  cancelSubscription,
  getSubscription,
  verifyWebhookSignature
};
