const https = require("https");
const crypto = require("crypto");
const { body } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const ApiError = require("../utils/ApiError");
const pool = require("../db/pool");
const { saveAuditLog } = require("../services/auditLogService");
const { registerBusinessSubscriptionPayment } = require("../services/businessSubscriptionService");
const openPayService = require("../services/openPayService");
const { getMexicoCityDate } = require("../utils/timezone");
const {
  createPendingOnboarding,
  provisionBusinessFromOnboarding,
  markOnboardingFailed,
  getPendingOnboarding
} = require("../services/paymentProvisioningService");
const { sendPaymentConfirmationEmail, sendSpeiInstructionsEmail } = require("../services/emailService");

// URL for the n8n workflow that sends the welcome email after a business is provisioned.
// Override per environment via N8N_WELCOME_EMAIL_URL.
const N8N_WELCOME_EMAIL_URL =
  process.env.N8N_WELCOME_EMAIL_URL || "https://chatbotsn8n.com/webhook/ankode-welcome-email";

// Fire-and-forget POST to n8n. Resolves with the HTTP status (or null on error/timeout).
// Never throws — a failed n8n call must never block the webhook response.
function notifyN8nWelcomeEmail(data) {
  return new Promise((resolve) => {
    try {
      const body = JSON.stringify(data);
      const url = new URL(N8N_WELCOME_EMAIL_URL);
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        }
      };
      const req = https.request(options, (res) => {
        res.resume();
        console.info(`[N8N] Welcome email webhook responded: ${res.statusCode}`);
        resolve({ status: res.statusCode });
      });
      req.on("error", (err) => {
        console.error("[N8N] Welcome email webhook request error:", err.message);
        resolve(null);
      });
      req.setTimeout(8000, () => {
        req.destroy();
        console.error("[N8N] Welcome email webhook timed out after 8 s");
        resolve(null);
      });
      req.write(body);
      req.end();
    } catch (setupError) {
      console.error("[N8N] Welcome email webhook setup error:", setupError.message);
      resolve(null);
    }
  });
}

// Synthetic actor for system-triggered operations (webhook, automated charges).
// isSuperUser() only checks actor.role — id: null sets updated_by/usuario_id to NULL,
// which is the correct representation for a non-human system action.
const SYSTEM_ACTOR = { id: null, role: "superusuario" };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const checkoutValidation = [
  // businessId is required for existing-business renewals; absent for new signups
  body("businessId").optional().isInt({ min: 1 }),
  body("planType").isIn(["monthly", "yearly"]),
  body("amount").isFloat({ min: 0.01 }),
  body("cardToken").if(body("paymentMethod").not().equals("spei")).trim().notEmpty(),
  body("email").isEmail().normalizeEmail(),
  body("name").optional({ nullable: true, checkFalsy: true }).trim().notEmpty(),
  // New-signup fields (required when creating a new business; absent for renewals)
  body("businessName").optional({ nullable: true, checkFalsy: true }).trim().notEmpty()
    .withMessage("businessName is required for new signups"),
  body("ownerName").optional({ nullable: true, checkFalsy: true }).trim().notEmpty()
    .withMessage("ownerName is required for new signups"),
  body("password").optional({ nullable: true, checkFalsy: true }).isLength({ min: 8 })
    .withMessage("password must be at least 8 characters"),
  body("posType").optional({ nullable: true }).trim().notEmpty()
    .withMessage("posType is required for new signups"),
  body("planName").optional({ nullable: true }).trim(),
  validateRequest
];

// ---------------------------------------------------------------------------
// Internal: resolve business_id from an OpenPay transaction object.
// 1. Looks up openpay_customer_id in business_subscriptions (most reliable).
// 2. Falls back to parsing "biz-{businessId}" prefix from order_id.
// ---------------------------------------------------------------------------

async function resolveBusinessIdFromTransaction(transaction) {
  if (!transaction) return null;

  const customerId = transaction.customer_id
    || (transaction.customer && transaction.customer.id)
    || null;

  if (customerId) {
    const { rows } = await pool.query(
      `SELECT business_id
       FROM business_subscriptions
       WHERE openpay_customer_id = $1
       LIMIT 1`,
      [String(customerId)]
    );
    if (rows[0]?.business_id) return Number(rows[0].business_id);
  }

  const orderId = String(transaction.order_id || "");
  const match = orderId.match(/^biz-(\d+)/);
  if (match) return Number(match[1]);

  return null;
}

// ---------------------------------------------------------------------------
// Internal: insert a row into subscription_payment_history.
// Always called with a transaction client so the history insert is atomic
// with any surrounding audit log writes.
// ---------------------------------------------------------------------------

async function insertPaymentHistory(client, {
  businessId,
  transactionId,
  orderId,
  provider,
  amount,
  currency,
  status,
  paymentMethod,
  cardLast4,
  cardBrand,
  errorMessage,
  rawPayload,
  paidAt
}) {
  const { rows } = await client.query(
    `INSERT INTO subscription_payment_history (
       business_id,
       openpay_transaction_id,
       openpay_order_id,
       payment_provider,
       amount,
       currency,
       status,
       payment_method,
       card_last4,
       card_brand,
       error_message,
       raw_webhook_payload,
       paid_at,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
     RETURNING id`,
    [
      Number(businessId),
      transactionId || null,
      orderId || null,
      provider || "openpay",
      Number(amount) || 0,
      currency || "MXN",
      status,
      paymentMethod || null,
      cardLast4 || null,
      cardBrand || null,
      errorMessage || null,
      rawPayload ? JSON.stringify(rawPayload) : null,
      paidAt || null
    ]
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Webhook handler
//
// OpenPay requires HTTP 200 for every event or it retries indefinitely.
// The outer try/catch ensures we NEVER propagate an error to asyncHandler
// (which would trigger errorHandler.js and return a 4xx/5xx response).
// All failures are logged and swallowed — the 200 response is always sent.
// ---------------------------------------------------------------------------

const handleWebhook = asyncHandler(async (req, res) => {
  try {
    const rawSignature = req.headers["x-openpay-signature"];
    const isSignatureValid = openPayService.verifyWebhookSignature(
      req.rawBody instanceof Buffer ? req.rawBody : req.body,
      rawSignature
    );

    if (!isSignatureValid) {
      console.warn("[OPENPAY-WEBHOOK] Invalid or missing signature — acknowledging without processing");
      return res.status(200).json({ received: true, warning: "invalid_signature" });
    }

    const event = req.body || {};
    const eventType = String(event.type || "");
    const transaction = event.transaction || {};

    console.info(`[OPENPAY-WEBHOOK] Event received: ${eventType}`);

    if (eventType === "verification") {
      const code = event.verification_code ||
                   req.body.verification_code ||
                   null;
      if (code) {
        console.log('[OPENPAY-WEBHOOK] Verification code:', code);
        return res.status(200).send(String(code));
      }
      return res.status(200).json({ status: "ok" });
    }

    if (!["charge.succeeded", "charge.failed", "subscription.charge.failed", "spei.received"].includes(eventType)) {
      return res.status(200).json({ received: true });
    }

    // SPEI payment received — send confirmation email and return immediately
    if (eventType === "spei.received") {
      console.log('[SPEI-WEBHOOK] transaction completa:', JSON.stringify(transaction));
      console.log('[SPEI-WEBHOOK] customer:', JSON.stringify(transaction?.customer));
      console.log('[SPEI-WEBHOOK] email encontrado:', transaction?.customer?.email);
      console.log('[SPEI-WEBHOOK] intentando enviar correo:', !!(transaction?.customer?.email));
      const custEmail = (transaction.customer && transaction.customer.email) || null;
      const custName = (transaction.customer && transaction.customer.name) || custEmail || "";
      if (custEmail) {
        sendPaymentConfirmationEmail(custEmail, {
          name: custName,
          amount: Number(transaction.amount || 0),
          currency: transaction.currency || "MXN",
          method: "SPEI"
        }).catch(() => {});
      }
      console.info(`[OPENPAY-WEBHOOK] SPEI received, confirmation email queued for ${custEmail}`);
      return res.status(200).json({ received: true });
    }

    const businessId = await resolveBusinessIdFromTransaction(transaction);

    // Extract orderId and rawCustomerId early — needed to look up pending onboardings
    // before deciding whether to bail out (new signups have no businessId yet).
    const orderId = transaction.order_id || null;
    const rawCustomerId = transaction.customer_id
      || (transaction.customer && transaction.customer.id)
      || null;

    // Resolve pending onboarding for new-signup charges where no business_id exists yet.
    // Primary lookup: order_id (set by createCheckoutSession for new signups).
    // Fallback: openpay_customer_id (subscription webhooks may omit order_id).
    let pendingOnboarding = null;
    if (orderId) {
      pendingOnboarding = await getPendingOnboarding(orderId);
    }
    if (!pendingOnboarding && rawCustomerId) {
      const { rows: pobRows } = await pool.query(
        `SELECT * FROM pending_onboardings WHERE openpay_customer_id = $1 LIMIT 1`,
        [String(rawCustomerId)]
      );
      pendingOnboarding = pobRows[0] || null;
    }

    if (!businessId && !pendingOnboarding) {
      console.warn(`[OPENPAY-WEBHOOK] Could not resolve business_id or pending onboarding for event ${eventType}`, {
        customer_id: rawCustomerId,
        order_id: orderId
      });
      return res.status(200).json({ received: true, warning: "unresolved_business" });
    }

    const transactionId = transaction.id || null;
    const amount = Number(transaction.amount || 0);
    const currency = transaction.currency || "MXN";
    const card = transaction.card || {};
    const cardLast4 = card.card_number ? String(card.card_number).slice(-4) : null;
    const cardBrand = card.brand || null;
    const creationDate = transaction.creation_date || null;

    if (eventType === "charge.succeeded") {
      // Step 1 + 2: payment history and subscription advance (existing-business path only)
      if (businessId) {
        // Step 1: persist payment history in its own committed transaction
        const historyClient = await pool.connect();
        try {
          await historyClient.query("BEGIN");
          await insertPaymentHistory(historyClient, {
            businessId,
            transactionId,
            orderId,
            provider: "openpay",
            amount,
            currency,
            status: "succeeded",
            paymentMethod: transaction.method || "card",
            cardLast4,
            cardBrand,
            errorMessage: null,
            rawPayload: event,
            paidAt: creationDate ? new Date(creationDate).toISOString() : null
          });
          await historyClient.query("COMMIT");
        } catch (historyError) {
          await historyClient.query("ROLLBACK").catch(() => {});
          console.error("[OPENPAY-WEBHOOK] Failed to insert payment history:", historyError);
          return res.status(200).json({ received: true, warning: "history_insert_failed" });
        } finally {
          historyClient.release();
        }

        // Step 2: advance subscription dates — manages its own transaction
        try {
          const paidAtDate = creationDate
            ? getMexicoCityDate(new Date(creationDate))
            : null;

          await registerBusinessSubscriptionPayment(
            businessId,
            {
              paid_at: paidAtDate,
              note: `Cobro automático OpenPay | txn: ${transactionId || "—"}`
            },
            SYSTEM_ACTOR
          );

          console.info(
            `[OPENPAY-WEBHOOK] Subscription advanced for business ${businessId}, txn ${transactionId}`
          );
        } catch (subError) {
          // History is already committed — payment is recorded. Log for manual follow-up.
          console.error(
            `[OPENPAY-WEBHOOK] Payment history saved but subscription dates not advanced for business ${businessId}:`,
            subError
          );
        }
      }

      // Send payment confirmation to existing business customer
      if (businessId) {
        const custEmail = (transaction.customer && transaction.customer.email) || null;
        const custName = (transaction.customer && transaction.customer.name) || custEmail || "";
        if (custEmail) {
          sendPaymentConfirmationEmail(custEmail, {
            name: custName,
            amount,
            currency,
            method: "tarjeta"
          }).catch(() => {});
        }
      }

      // Step 3: provision a new business if this charge belongs to a new signup
      if (pendingOnboarding && pendingOnboarding.status === "pending") {
        try {
          const provisionResult = await provisionBusinessFromOnboarding(pendingOnboarding.order_id);
          if (provisionResult && !provisionResult.alreadyProvisioned) {
            console.info(
              `[OPENPAY-WEBHOOK] Business provisioned for order_id=${pendingOnboarding.order_id}`
            );
            try {
              await notifyN8nWelcomeEmail({
                email: pendingOnboarding.email,
                owner_name: pendingOnboarding.owner_name,
                business_name: pendingOnboarding.business_name,
                frontend_url: process.env.FRONTEND_URL || ""
              });
            } catch (n8nError) {
              console.error(
                "[OPENPAY-WEBHOOK] n8n welcome email notification failed:", n8nError.message
              );
            }
          }
        } catch (provisionError) {
          console.error(
            `[OPENPAY-WEBHOOK] Business provisioning failed for order_id=${pendingOnboarding.order_id}:`,
            provisionError
          );
        }
      }
    } else {
      // charge.failed or subscription.charge.failed
      const errorDesc = transaction.error_message
        || event.error_message
        || `Cargo fallido (${eventType})`;

      // Log payment failure for existing businesses (subscription_payment_history requires business_id)
      if (businessId) {
        const failClient = await pool.connect();
        try {
          await failClient.query("BEGIN");

          await insertPaymentHistory(failClient, {
            businessId,
            transactionId,
            orderId,
            provider: "openpay",
            amount,
            currency,
            status: "failed",
            paymentMethod: transaction.method || "card",
            cardLast4,
            cardBrand,
            errorMessage: errorDesc,
            rawPayload: event,
            paidAt: null
          });

          await saveAuditLog({
            business_id: businessId,
            usuario_id: null,
            modulo: "business_subscriptions",
            accion: "subscription_charge_failed",
            entidad_tipo: "subscription_payment_history",
            entidad_id: transactionId,
            detalle_anterior: {},
            detalle_nuevo: { event_type: eventType, amount, currency, error: errorDesc },
            motivo: errorDesc,
            metadata: { openpay_transaction_id: transactionId, event_type: eventType }
          }, { client: failClient });

          await failClient.query("COMMIT");
          console.warn(
            `[OPENPAY-WEBHOOK] Charge failed for business ${businessId}, txn ${transactionId}: ${errorDesc}`
          );
        } catch (failError) {
          await failClient.query("ROLLBACK").catch(() => {});
          console.error("[OPENPAY-WEBHOOK] Failed to log charge failure:", failError);
        } finally {
          failClient.release();
        }
      }

      // Mark pending onboarding as failed (new-signup path)
      if (pendingOnboarding) {
        try {
          await markOnboardingFailed(pendingOnboarding.order_id, errorDesc);
        } catch (onboardingFailError) {
          console.error(
            `[OPENPAY-WEBHOOK] markOnboardingFailed error for order_id=${pendingOnboarding.order_id}:`,
            onboardingFailError
          );
        }
      }
    }
  } catch (unexpectedError) {
    // Last-resort catch — should not normally be reached
    console.error("[OPENPAY-WEBHOOK] Unexpected error:", unexpectedError);
  }

  return res.status(200).json({ received: true });
});

// ---------------------------------------------------------------------------
// Webhook verification: OpenPay sends GET or POST with verification_code
// ---------------------------------------------------------------------------
const verifyWebhook = asyncHandler(async (req, res) => {
  console.log('[OPENPAY-VERIFY] method:', req.method);
  console.log('[OPENPAY-VERIFY] headers:', req.headers);
  console.log('[OPENPAY-VERIFY] query:', req.query);
  console.log('[OPENPAY-VERIFY] body:', req.body);

  const verificationCode =
    req.query.verification_code ||
    (req.body && req.body.verification_code) ||
    null;

  if (verificationCode) {
    console.log('[OPENPAY-VERIFY] Responding with code:', verificationCode);
    return res.status(200).send(String(verificationCode));
  }

  console.log('[OPENPAY-VERIFY] No verification_code found');
  return res.status(200).json({ status: "ok" });
});

// ---------------------------------------------------------------------------
// Checkout session: customer → plan → subscription
// Called by an authenticated admin user to initiate a recurring subscription.
// ---------------------------------------------------------------------------

const createCheckoutSession = asyncHandler(async (req, res) => {
  const {
    planType,
    cardToken,
    email,
    name,
    paymentMethod,
    deviceSessionId,
    // New-signup fields
    businessName,
    ownerName,
    password,
    posType,
    planName
  } = req.body;

  const businessId = parseInt(req.body.businessId) || null;
  const amount = parseFloat(req.body.amount) || 0;

  // ---------------------------------------------------------------------------
  // SPEI path — generate a bank_account charge and return the CLABE
  // ---------------------------------------------------------------------------
  if (paymentMethod === "spei") {
    const charge = await openPayService.createSpeiCharge({ amount, email, name, planName });
    const clabe = charge.payment_method?.clabe || null;
    const bank_name = charge.payment_method?.bank_name || null;
    const due_date = charge.due_date || null;

    // Fire-and-forget — never blocks the response
    sendSpeiInstructionsEmail(email, {
      name: name || email,
      amount,
      currency: 'MXN',
      clabe,
      bank_name,
      due_date,
      plan_name: planName || 'Ankode POS',
    }).catch((err) => console.error('[SPEI-EMAIL] Failed to send instructions email:', err));

    return res.status(201).json({
      success: true,
      paymentMethod: "spei",
      clabe,
      bank_name,
      due_date,
      orderId: charge.id
    });
  }

  const normalized = String(planType).toLowerCase();
  const isCartCheckout = planName === 'Carrito' || posType === 'cart';
  const isNewSignup = Boolean(password && businessName && ownerName && posType);

  console.log("[CHECKOUT] Request received:", {
    paymentMethod,
    isNewSignup,
    businessId,
    email,
    passwordPresent: Boolean(password),
    businessName,
    ownerName,
    posType
  });

  // ---------------------------------------------------------------------------
  // Path C — Cargo único (accesorios/hardware sin suscripción)
  // ---------------------------------------------------------------------------
  if (isCartCheckout) {
    try {
      const customerId = await openPayService.createCustomer(null, name || email, email);

      const charge = await openPayService.createCharge({
        customerId,
        amount,
        cardToken,
        deviceSessionId,
        description: `Compra Ankode - ${planName || 'Accesorios'}`,
        email,
      });

      return res.json({
        success: true,
        orderId: charge.id,
        message: 'Pago procesado correctamente',
      });
    } catch (err) {
      console.error('[CHECKOUT PATH C ERROR]', err?.message || err);
      return res.status(500).json({
        message: err?.message || 'Error al procesar el pago',
        details: err?.details || null,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Path A — New business signup (no existing businessId)
  // Order: createPendingOnboarding → OpenPay customer → plan → subscription
  // ---------------------------------------------------------------------------
  if (isNewSignup) {
    console.log("[CHECKOUT] Taking Path A — new business signup");
    // Generate a unique order_id that the webhook will use to find this pending row
    const orderId = `onb-${crypto.randomBytes(8).toString("hex")}`;

    // 1. Persist the pending onboarding BEFORE charging the card.
    //    Password is bcrypt-hashed inside createPendingOnboarding — never stored plain.
    let pendingRow;
    try {
      pendingRow = await createPendingOnboarding({
        order_id: orderId,
        business_name: businessName,
        owner_name: ownerName,
        email: String(email).trim(),
        password,
        pos_type: posType,
        plan_type: normalized,
        plan_name: planName || normalized,
        amount: Number(amount),
        raw_checkout_payload: {
          planType: normalized,
          amount: Number(amount),
          posType,
          planName: planName || normalized
        }
      });
    } catch (onboardingError) {
      console.error("[CHECKOUT] createPendingOnboarding failed:", onboardingError);
      throw new ApiError(400, "Could not create onboarding record");
    }

    // 2. Create OpenPay customer (no existing businessId — pass null)
    const customerId = await openPayService.createCustomer(null, name || ownerName, email);

    // 3. Store customer_id on the pending row so the webhook can find it via customer_id
    //    (subscription webhooks may not include order_id)
    await pool.query(
      `UPDATE pending_onboardings
       SET openpay_customer_id = $1, updated_at = NOW()
       WHERE order_id = $2`,
      [customerId, orderId]
    );

    // 4. Always create a new plan (no existing business_subscriptions to check)
    const planId = await openPayService.createPlan(normalized, amount);

    // 5. Create OpenPay subscription — card token linked to the recurring plan
    const subscriptionId = await openPayService.createSubscription(customerId, planId, cardToken);

    // 6. Update pending row with all OpenPay IDs for reference
    await pool.query(
      `UPDATE pending_onboardings
       SET openpay_plan_id = $1,
           openpay_subscription_id = $2,
           updated_at = NOW()
       WHERE order_id = $3`,
      [planId, subscriptionId, orderId]
    );

    return res.status(201).json({
      success: true,
      subscriptionId,
      customerId,
      planId,
      orderId
    });
  }

  // ---------------------------------------------------------------------------
  // Path B — Existing business renewal (businessId present, no password)
  // Preserved exactly from the original implementation.
  // ---------------------------------------------------------------------------
  console.log("[CHECKOUT] Taking Path B — existing business renewal");

  // 1. Ensure OpenPay customer exists for this business (idempotent)
  const customerId = await openPayService.createCustomer(businessId, name, email);

  // 2. Ensure OpenPay plan exists — check DB first, create only if missing
  const { rows: subRows } = await pool.query(
    `SELECT openpay_plan_id
     FROM business_subscriptions
     WHERE business_id = $1
     LIMIT 1`,
    [Number(businessId)]
  );

  let planId = subRows[0]?.openpay_plan_id || null;
  if (!planId) {
    planId = await openPayService.createPlan(normalized, amount);
  }

  // 3. Create OpenPay subscription — links the card token to the recurring plan
  const subscriptionId = await openPayService.createSubscription(customerId, planId, cardToken);

  // 4. Persist all OpenPay IDs back to business_subscriptions
  await pool.query(
    `UPDATE business_subscriptions
     SET openpay_customer_id     = $1,
         openpay_plan_id         = $2,
         openpay_subscription_id = $3,
         payment_provider        = 'openpay',
         subscription_amount     = $4,
         subscription_currency   = 'MXN',
         plan_type               = $5,
         plan_name               = COALESCE($6, plan_name),
         updated_at              = NOW()
     WHERE business_id = $7`,
    [customerId, planId, subscriptionId, Number(amount), normalized, planName || null, Number(businessId)]
  );

  await saveAuditLog({
    business_id: Number(businessId),
    usuario_id: req.user?.id || null,
    modulo: "business_subscriptions",
    accion: "openpay_checkout_created",
    entidad_tipo: "business_subscription",
    entidad_id: String(businessId),
    detalle_anterior: {},
    detalle_nuevo: {
      openpay_customer_id: customerId,
      openpay_plan_id: planId,
      openpay_subscription_id: subscriptionId,
      plan_type: normalized,
      amount: Number(amount)
    },
    motivo: "OpenPay subscription initiated",
    metadata: { plan_type: normalized, payment_provider: "openpay" }
  });

  res.status(201).json({
    success: true,
    subscriptionId,
    customerId,
    planId
  });
});

// ---------------------------------------------------------------------------
// Anti-fraud middleware — runs before createCheckoutSession
// ---------------------------------------------------------------------------

const _ipAttempts = new Map();
const _DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "tempmail.com", "throwam.com", "yopmail.com"
]);

const antifraudCheck = (req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;

  const record = _ipAttempts.get(ip);
  if (record && now < record.resetAt) {
    if (record.count >= 5) {
      return res.status(429).json({ error: "Demasiados intentos, intenta más tarde" });
    }
    record.count += 1;
  } else {
    _ipAttempts.set(ip, { count: 1, resetAt: now + windowMs });
  }

  const email = String(req.body?.email || "");
  const domain = email.split("@")[1]?.toLowerCase();
  if (domain && _DISPOSABLE_DOMAINS.has(domain)) {
    return res.status(400).json({ error: "Email no válido" });
  }

  const amount = parseFloat(req.body?.amount) || 0;
  if (amount > 15000) {
    return res.status(400).json({ error: "Monto fuera de rango permitido" });
  }

  next();
};

module.exports = {
  checkoutValidation,
  handleWebhook,
  verifyWebhook,
  createCheckoutSession,
  antifraudCheck
};
