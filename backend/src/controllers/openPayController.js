const { body } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const ApiError = require("../utils/ApiError");
const pool = require("../db/pool");
const { saveAuditLog } = require("../services/auditLogService");
const { registerBusinessSubscriptionPayment } = require("../services/businessSubscriptionService");
const openPayService = require("../services/openPayService");
const { getMexicoCityDate } = require("../utils/timezone");

// Synthetic actor for system-triggered operations (webhook, automated charges).
// isSuperUser() only checks actor.role — id: null sets updated_by/usuario_id to NULL,
// which is the correct representation for a non-human system action.
const SYSTEM_ACTOR = { id: null, role: "superusuario" };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const checkoutValidation = [
  body("businessId").isInt({ min: 1 }),
  body("planType").isIn(["monthly", "yearly"]),
  body("amount").isFloat({ min: 0.01 }),
  body("cardToken").trim().notEmpty(),
  body("email").isEmail().normalizeEmail(),
  body("name").trim().notEmpty(),
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

    if (!["charge.succeeded", "charge.failed", "subscription.charge.failed"].includes(eventType)) {
      return res.status(200).json({ received: true });
    }

    const businessId = await resolveBusinessIdFromTransaction(transaction);

    if (!businessId) {
      console.warn(`[OPENPAY-WEBHOOK] Could not resolve business_id for event ${eventType}`, {
        customer_id: transaction.customer_id,
        order_id: transaction.order_id
      });
      return res.status(200).json({ received: true, warning: "unresolved_business" });
    }

    const transactionId = transaction.id || null;
    const orderId = transaction.order_id || null;
    const amount = Number(transaction.amount || 0);
    const currency = transaction.currency || "MXN";
    const card = transaction.card || {};
    const cardLast4 = card.card_number ? String(card.card_number).slice(-4) : null;
    const cardBrand = card.brand || null;
    const creationDate = transaction.creation_date || null;

    if (eventType === "charge.succeeded") {
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

      // Step 2: advance subscription dates — registerBusinessSubscriptionPayment
      // manages its own transaction; called after history is committed
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
    } else {
      // charge.failed or subscription.charge.failed
      const errorDesc = transaction.error_message
        || event.error_message
        || `Cargo fallido (${eventType})`;

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
  } catch (unexpectedError) {
    // Last-resort catch — should not normally be reached
    console.error("[OPENPAY-WEBHOOK] Unexpected error:", unexpectedError);
  }

  return res.status(200).json({ received: true });
});

// ---------------------------------------------------------------------------
// Checkout session: customer → plan → subscription
// Called by an authenticated admin user to initiate a recurring subscription.
// ---------------------------------------------------------------------------

const createCheckoutSession = asyncHandler(async (req, res) => {
  const { businessId, planType, amount, cardToken, email, name } = req.body;
  const normalized = String(planType).toLowerCase();

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
         updated_at              = NOW()
     WHERE business_id = $6`,
    [customerId, planId, subscriptionId, Number(amount), normalized, Number(businessId)]
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

module.exports = {
  checkoutValidation,
  handleWebhook,
  createCheckoutSession
};
