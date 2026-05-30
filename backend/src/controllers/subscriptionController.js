const { body } = require("express-validator");
const asyncHandler = require("../utils/asyncHandler");
const validateRequest = require("../middleware/validateRequest");
const ApiError = require("../utils/ApiError");
const pool = require("../db/pool");
const { requireActorBusinessId } = require("../utils/tenant");
const openPayService = require("../services/openPayService");
const { saveAuditLog } = require("../services/auditLogService");
const { sendCancellationEmail } = require("../services/emailService");
const subscriptionService = require("../services/businessSubscriptionService");

const cancelValidation = [
  body("reason").optional({ nullable: true, checkFalsy: false }).trim(),
  validateRequest
];

const cancelSubscription = asyncHandler(async (req, res) => {
  const businessId = requireActorBusinessId(req.user);
  const reason = String(req.body?.reason || "").trim();

  const { rows } = await pool.query(
    `SELECT business_id,
            subscription_status,
            openpay_customer_id,
            openpay_subscription_id,
            next_payment_date
     FROM business_subscriptions
     WHERE business_id = $1
     LIMIT 1`,
    [Number(businessId)]
  );

  const sub = rows[0];
  if (!sub) {
    throw new ApiError(404, "Suscripción no encontrada");
  }

  if (sub.subscription_status === "cancelled") {
    throw new ApiError(409, "La suscripción ya fue cancelada");
  }

  // Fire-and-forget OpenPay cancellation — a failure must NOT block the DB update.
  // The tenant must stop being charged regardless of OpenPay's response.
  if (sub.openpay_customer_id && sub.openpay_subscription_id) {
    try {
      await openPayService.cancelSubscription(
        sub.openpay_customer_id,
        sub.openpay_subscription_id
      );
    } catch (openpayError) {
      console.error(
        `[CANCEL-SUB] OpenPay cancelSubscription failed for business ${businessId}:`,
        openpayError.message
      );
    }
  } else {
    console.warn(
      `[CANCEL-SUB] No OpenPay IDs for business ${businessId} — cancelling in DB only`
    );
  }

  const { rows: updated } = await pool.query(
    `UPDATE business_subscriptions
     SET subscription_status = 'cancelled',
         cancelled_at        = NOW(),
         cancellation_reason = $1,
         enforcement_enabled = FALSE,
         updated_at          = NOW()
     WHERE business_id = $2
     RETURNING next_payment_date`,
    [reason, Number(businessId)]
  );

  await saveAuditLog({
    business_id: Number(businessId),
    usuario_id: req.user.id,
    modulo: "business_subscriptions",
    accion: "cancel_subscription",
    entidad_tipo: "business_subscription",
    entidad_id: String(businessId),
    detalle_anterior: { subscription_status: sub.subscription_status },
    detalle_nuevo: {
      subscription_status: "cancelled",
      cancellation_reason: reason
    },
    motivo: reason || "Cancelación solicitada por el tenant",
    metadata: { openpay_customer_id: sub.openpay_customer_id }
  });

  const accessUntil = updated[0]?.next_payment_date || null;

  // Fire-and-forget — email failure must never affect the cancellation response
  pool.query(
    `SELECT u.email, u.full_name, b.name AS business_name
     FROM users u
     JOIN businesses b ON b.id = u.business_id
     WHERE u.business_id = $1 AND u.role IN ('admin', 'superadmin', 'superusuario')
     ORDER BY u.id LIMIT 1`,
    [Number(businessId)]
  ).then(({ rows }) => {
    const owner = rows[0];
    if (owner?.email) {
      sendCancellationEmail(owner.email, {
        businessName: owner.business_name || "",
        ownerName: owner.full_name || "",
        accessUntil
      }).catch(() => {});
    }
  }).catch((err) => {
    console.error("[CANCEL-SUB] Failed to fetch owner for cancellation email:", err.message);
  });

  return res.json({
    success: true,
    access_until: accessUntil
  });
});

const reportHourValidation = [
  body("report_hour")
    .optional({ nullable: true })
    .custom((value) => {
      if (value === null || value === undefined || value === "") return true;
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 23) {
        throw new Error("report_hour debe ser un entero entre 0 y 23, o null");
      }
      return true;
    }),
  validateRequest
];

const updateReportHour = asyncHandler(async (req, res) => {
  const businessId = requireActorBusinessId(req.user);
  const rawValue = req.body.report_hour;
  const reportHour =
    rawValue === null || rawValue === undefined || rawValue === ""
      ? null
      : Number(rawValue);

  await pool.query(
    `UPDATE business_subscriptions SET report_hour = $1, updated_at = NOW() WHERE business_id = $2`,
    [reportHour, Number(businessId)]
  );

  return res.json({ success: true, report_hour: reportHour });
});

const alertHoursValidation = [
  body("stock_alert_hour_morning")
    .optional({ nullable: true })
    .custom((value) => {
      if (value === null || value === undefined || value === "") return true;
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 23)
        throw new Error("stock_alert_hour_morning debe ser un entero entre 0 y 23, o null");
      return true;
    }),
  body("stock_alert_hour_evening")
    .optional({ nullable: true })
    .custom((value) => {
      if (value === null || value === undefined || value === "") return true;
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 23)
        throw new Error("stock_alert_hour_evening debe ser un entero entre 0 y 23, o null");
      return true;
    }),
  body("inventory_alert_hour")
    .optional({ nullable: true })
    .custom((value) => {
      if (value === null || value === undefined || value === "") return true;
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0 || n > 23)
        throw new Error("inventory_alert_hour debe ser un entero entre 0 y 23, o null");
      return true;
    }),
  validateRequest
];

const updateAlertHours = asyncHandler(async (req, res) => {
  const businessId = requireActorBusinessId(req.user);
  const norm = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
  const stockMorning = norm(req.body.stock_alert_hour_morning);
  const stockEvening = norm(req.body.stock_alert_hour_evening);
  const inventoryHour = norm(req.body.inventory_alert_hour);

  await pool.query(
    `UPDATE business_subscriptions
     SET stock_alert_hour_morning = $1,
         stock_alert_hour_evening = $2,
         inventory_alert_hour     = $3,
         updated_at               = NOW()
     WHERE business_id = $4`,
    [stockMorning, stockEvening, inventoryHour, Number(businessId)]
  );

  return res.json({
    success: true,
    stock_alert_hour_morning: stockMorning,
    stock_alert_hour_evening: stockEvening,
    inventory_alert_hour: inventoryHour
  });
});

const changePlan = asyncHandler(async (req, res) => {
  const actor = req.user;
  const { plan } = req.body;
  if (!plan) throw new ApiError(400, 'El campo plan es requerido (basico, premium, enterprise)');
  const result = await subscriptionService.changePlan(actor.business_id, plan);
  res.json({ success: true, data: result });
});

module.exports = { cancelValidation, cancelSubscription, reportHourValidation, updateReportHour, alertHoursValidation, updateAlertHours, changePlan };
