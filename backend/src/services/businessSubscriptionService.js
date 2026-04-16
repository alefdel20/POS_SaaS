const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { saveAuditLog } = require("./auditLogService");
const { isSuperUser, requireActorBusinessId } = require("../utils/tenant");
const { normalizeRole } = require("../utils/roles");
const { getMexicoCityDate } = require("../utils/timezone");

const DUE_SOON_DAYS = 7;
const BLOCKED_BUSINESS_MESSAGE = "Tu cuenta está temporalmente bloqueada, contacta al proveedor o realiza el pago para reanudar tu servicio.";

function parseDateOnly(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCHours(12, 0, 0, 0);
  return parsed;
}

function formatDateOnly(value) {
  return value ? getMexicoCityDate(value) : null;
}

function addDays(dateString, days) {
  const baseDate = parseDateOnly(dateString);
  if (!baseDate) return null;
  baseDate.setUTCDate(baseDate.getUTCDate() + days);
  return formatDateOnly(baseDate);
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function addMonthsClamped(baseDate, months, desiredDay) {
  const cursor = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth() + months, 1, 12, 0, 0));
  const targetDay = Math.min(Math.max(desiredDay, 1), daysInMonth(cursor.getUTCFullYear(), cursor.getUTCMonth()));
  return new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), targetDay, 12, 0, 0));
}

function normalizePlanType(value, { allowNull = true } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === "") {
    return allowNull ? null : undefined;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!["monthly", "yearly"].includes(normalized)) {
    throw new ApiError(400, "Invalid subscription plan type");
  }
  return normalized;
}

function normalizeDateInput(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = parseDateOnly(value);
  if (!parsed) {
    throw new ApiError(400, "Invalid subscription date");
  }
  return formatDateOnly(parsed);
}

function toDayDiff(fromDate, toDate) {
  const left = parseDateOnly(fromDate);
  const right = parseDateOnly(toDate);
  if (!left || !right) return null;
  return Math.round((right.getTime() - left.getTime()) / (24 * 60 * 60 * 1000));
}

function calculateNextPaymentDate(anchorDate, planType, referenceDate = getMexicoCityDate()) {
  const parsedAnchor = parseDateOnly(anchorDate);
  const parsedReference = parseDateOnly(referenceDate);
  if (!parsedAnchor || !parsedReference || !planType) {
    return null;
  }

  const desiredDay = parsedAnchor.getUTCDate();
  let cursor = planType === "yearly"
    ? addMonthsClamped(parsedAnchor, 12, desiredDay)
    : addMonthsClamped(parsedAnchor, 1, desiredDay);

  const step = planType === "yearly" ? 12 : 1;
  while (cursor < parsedReference) {
    cursor = addMonthsClamped(cursor, step, desiredDay);
  }
  return formatDateOnly(cursor);
}

function isConfigured(row) {
  return Boolean(row?.plan_type && (row?.next_payment_date || row?.billing_anchor_date));
}

function deriveSubscriptionState(row, today = getMexicoCityDate()) {
  if (!row || !isConfigured(row)) {
    return {
      subscription_status: "active",
      is_configured: false,
      due_in_days: null,
      overdue_days: null,
      should_block: false
    };
  }

  const nextPaymentDate = row.next_payment_date || calculateNextPaymentDate(row.billing_anchor_date, row.plan_type, today);
  if (!nextPaymentDate) {
    return {
      subscription_status: "active",
      is_configured: false,
      due_in_days: null,
      overdue_days: null,
      should_block: false
    };
  }

  const gracePeriodDays = Number(row.grace_period_days || 0);
  const dueInDays = toDayDiff(today, nextPaymentDate);
  if (dueInDays !== null && dueInDays < 0) {
    const overdueDays = Math.abs(dueInDays);
    const shouldBlock = Boolean(row.enforcement_enabled) && overdueDays > gracePeriodDays;
    return {
      subscription_status: shouldBlock ? "blocked" : "overdue",
      is_configured: true,
      due_in_days: dueInDays,
      overdue_days: overdueDays,
      should_block: shouldBlock
    };
  }

  return {
    subscription_status: dueInDays !== null && dueInDays <= DUE_SOON_DAYS ? "due_soon" : "active",
    is_configured: true,
    due_in_days: dueInDays,
    overdue_days: null,
    should_block: false
  };
}

function mapBusinessSubscription(row, today = getMexicoCityDate()) {
  if (!row) return null;
  const derived = deriveSubscriptionState(row, today);
  return {
    business_id: Number(row.business_id),
    plan_type: row.plan_type || null,
    billing_anchor_date: row.billing_anchor_date || null,
    next_payment_date: row.next_payment_date || null,
    grace_period_days: Number(row.grace_period_days || 0),
    enforcement_enabled: Boolean(row.enforcement_enabled),
    manual_adjustment_reason: row.manual_adjustment_reason || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...derived
  };
}

async function getBusinessRow(businessId, client = pool) {
  const { rows } = await client.query(
    `SELECT id, name, slug, pos_type, is_active, created_at
     FROM businesses
     WHERE id = $1
     LIMIT 1`,
    [Number(businessId)]
  );
  return rows[0] || null;
}

async function getBusinessSubscriptionRow(businessId, client = pool) {
  const { rows } = await client.query(
    `SELECT *
     FROM business_subscriptions
     WHERE business_id = $1
     LIMIT 1`,
    [Number(businessId)]
  );
  return rows[0] || null;
}

async function ensureBusinessSubscriptionRow(businessId, client = pool) {
  const existing = await getBusinessSubscriptionRow(businessId, client);
  if (existing) {
    return existing;
  }

  const business = await getBusinessRow(businessId, client);
  if (!business) {
    throw new ApiError(404, "Business not found");
  }

  const { rows } = await client.query(
    `INSERT INTO business_subscriptions (
       business_id,
       billing_anchor_date,
       grace_period_days,
       enforcement_enabled,
       manual_adjustment_reason
     )
     VALUES ($1, $2, 0, FALSE, '')
     ON CONFLICT (business_id) DO UPDATE SET business_id = EXCLUDED.business_id
     RETURNING *`,
    [Number(businessId), formatDateOnly(business.created_at)]
  );
  return rows[0];
}

async function syncBusinessPaymentReminder(businessId, client = pool) {
  const business = await getBusinessRow(businessId, client);
  if (!business) {
    throw new ApiError(404, "Business not found");
  }

  const subscription = mapBusinessSubscription(await ensureBusinessSubscriptionRow(businessId, client));
  const sourceKey = `auto:subscription-payment:${businessId}`;

  if (!subscription?.next_payment_date) {
    await client.query(
      `DELETE FROM reminders
       WHERE business_id = $1
         AND source_key = $2`,
      [Number(businessId), sourceKey]
    );
    return null;
  }

  const reminderDate = addDays(subscription.next_payment_date, -7) || subscription.next_payment_date;
  const metadata = {
    source_module: "business_subscriptions",
    reminder_category: "subscription",
    reminder_label: "Suscripción",
    priority: 100,
    plan_type: subscription.plan_type,
    business_id: Number(businessId),
    business_name: business.name,
    next_payment_date: subscription.next_payment_date
  };

  const { rows: existingRows } = await client.query(
    `SELECT id
     FROM reminders
     WHERE business_id = $1
       AND source_key = $2
     LIMIT 1`,
    [Number(businessId), sourceKey]
  );

  if (existingRows[0]) {
    const { rows } = await client.query(
      `UPDATE reminders
       SET title = $1,
           notes = $2,
           due_date = $3,
           status = 'pending',
           is_completed = FALSE,
           reminder_type = 'subscription_payment',
           category = 'administrative',
           patient_id = NULL,
           metadata = $4,
           updated_at = NOW()
       WHERE business_id = $5
         AND source_key = $6
       RETURNING *`,
      [
        "Tu mensualidad está por vencer",
        "Tu mensualidad está a punto de vencer, recuerda pagar el servicio.",
        reminderDate,
        JSON.stringify(metadata),
        Number(businessId),
        sourceKey
      ]
    );
    return rows[0];
  }

  const { rows } = await client.query(
    `INSERT INTO reminders (
       title,
       notes,
       status,
       due_date,
       source_key,
       assigned_to,
       created_by,
       is_completed,
       business_id,
       reminder_type,
       category,
       patient_id,
       metadata
     )
     VALUES ($1, $2, 'pending', $3, $4, NULL, NULL, FALSE, $5, 'subscription_payment', 'administrative', NULL, $6)
     RETURNING *`,
    [
      "Tu mensualidad está por vencer",
      "Tu mensualidad está a punto de vencer, recuerda pagar el servicio.",
      reminderDate,
      sourceKey,
      Number(businessId),
      JSON.stringify(metadata)
    ]
  );
  return rows[0];
}

async function initializeBusinessSubscriptionForNewBusiness(business, actorId, client = pool) {
  const anchorDate = formatDateOnly(business.created_at);
  const nextPaymentDate = calculateNextPaymentDate(anchorDate, "monthly", anchorDate);
  const { rows } = await client.query(
    `INSERT INTO business_subscriptions (
       business_id,
       plan_type,
       billing_anchor_date,
       next_payment_date,
       grace_period_days,
       enforcement_enabled,
       manual_adjustment_reason,
       created_by,
       updated_by
     )
     VALUES ($1, 'monthly', $2, $3, 0, TRUE, 'Alta inicial del negocio', $4, $4)
     ON CONFLICT (business_id) DO UPDATE
       SET plan_type = EXCLUDED.plan_type,
           billing_anchor_date = EXCLUDED.billing_anchor_date,
           next_payment_date = EXCLUDED.next_payment_date,
           enforcement_enabled = EXCLUDED.enforcement_enabled,
           manual_adjustment_reason = EXCLUDED.manual_adjustment_reason,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
     RETURNING *`,
    [business.id, anchorDate, nextPaymentDate, actorId || null]
  );
  await syncBusinessPaymentReminder(business.id, client);
  return mapBusinessSubscription(rows[0]);
}

async function getBusinessSubscriptionSummary(businessId, client = pool) {
  return mapBusinessSubscription(await ensureBusinessSubscriptionRow(businessId, client));
}

async function updateBusinessSubscription(businessId, payload, actor) {
  if (!isSuperUser(actor)) {
    throw new ApiError(403, "Forbidden");
  }

  const business = await getBusinessRow(businessId);
  if (!business) {
    throw new ApiError(404, "Business not found");
  }

  const current = await ensureBusinessSubscriptionRow(businessId);
  const currentSummary = mapBusinessSubscription(current);
  const nextPlanType = normalizePlanType(payload.plan_type) ?? current.plan_type ?? null;
  const nextAnchorDate = normalizeDateInput(payload.billing_anchor_date) ?? current.billing_anchor_date ?? null;
  const requestedNextPaymentDate = normalizeDateInput(payload.next_payment_date);
  let nextPaymentDate = requestedNextPaymentDate !== undefined
    ? requestedNextPaymentDate
    : (current.next_payment_date || null);

  if ((requestedNextPaymentDate === undefined || requestedNextPaymentDate === null) && nextPlanType && nextAnchorDate) {
    nextPaymentDate = calculateNextPaymentDate(nextAnchorDate, nextPlanType);
  }

  const gracePeriodDays = payload.grace_period_days === undefined
    ? Number(current.grace_period_days || 0)
    : Number(payload.grace_period_days);
  if (!Number.isInteger(gracePeriodDays) || gracePeriodDays < 0) {
    throw new ApiError(400, "Invalid grace period");
  }

  const enforcementEnabled = payload.enforcement_enabled === undefined
    ? Boolean(current.enforcement_enabled)
    : Boolean(payload.enforcement_enabled);
  const manualAdjustmentReason = String(payload.manual_adjustment_reason || "").trim();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE business_subscriptions
       SET plan_type = $1,
           billing_anchor_date = $2,
           next_payment_date = $3,
           grace_period_days = $4,
           enforcement_enabled = $5,
           manual_adjustment_reason = $6,
           updated_by = $7,
           updated_at = NOW()
       WHERE business_id = $8
       RETURNING *`,
      [
        nextPlanType,
        nextAnchorDate,
        nextPaymentDate,
        gracePeriodDays,
        enforcementEnabled,
        manualAdjustmentReason,
        actor.id,
        Number(businessId)
      ]
    );

    const updatedSummary = mapBusinessSubscription(rows[0]);
    await syncBusinessPaymentReminder(businessId, client);
    await saveAuditLog({
      business_id: Number(businessId),
      usuario_id: actor.id,
      modulo: "business_subscriptions",
      accion: "update_business_subscription",
      entidad_tipo: "business_subscription",
      entidad_id: String(businessId),
      detalle_anterior: { snapshot: currentSummary, business_name: business.name },
      detalle_nuevo: { snapshot: updatedSummary, business_name: business.name },
      motivo: manualAdjustmentReason,
      metadata: { business_slug: business.slug }
    }, { client });
    await client.query("COMMIT");
    return updatedSummary;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listSubscriptionCalendarEvents(actor, startDate, endDate, client = pool) {
  const role = normalizeRole(actor?.role);
  const params = [startDate, endDate];
  let whereClause = "WHERE bs.next_payment_date BETWEEN $1::date AND $2::date";
  if (role !== "superusuario") {
    params.push(requireActorBusinessId(actor));
    whereClause += ` AND b.id = $${params.length}`;
  }

  const { rows } = await client.query(
    `SELECT
       b.id AS business_id,
       b.name AS business_name,
       bs.plan_type,
       bs.next_payment_date,
       bs.grace_period_days,
       bs.enforcement_enabled,
       bs.manual_adjustment_reason,
       bs.created_at,
       bs.updated_at
     FROM business_subscriptions bs
     INNER JOIN businesses b ON b.id = bs.business_id
     ${whereClause}
     ORDER BY bs.next_payment_date ASC, b.name ASC`,
    params
  );

  return rows.map((row) => {
    const mapped = mapBusinessSubscription(row);
    const sourceKey = `subscription:due:${row.business_id}:${row.next_payment_date}`;
    return {
      id: Number(String(row.business_id) + String(row.next_payment_date || "").replace(/-/g, "")),
      title: role === "superusuario"
        ? `Vencimiento: ${row.business_name}`
        : "Vencimiento de servicio",
      notes: `Plan ${row.plan_type || "sin definir"} · proximo pago ${row.next_payment_date}.`,
      source_key: sourceKey,
      status: mapped?.subscription_status === "blocked" ? "cancelled" : "pending",
      due_date: row.next_payment_date,
      assigned_to: null,
      reminder_type: "subscription_due",
      category: "administrative",
      patient_id: null,
      patient_name: null,
      is_completed: false,
      metadata: {
        source_module: "business_subscriptions",
        reminder_category: "subscription",
        reminder_label: "Suscripción",
        priority: 90,
        business_id: Number(row.business_id),
        business_name: row.business_name,
        plan_type: row.plan_type || null,
        next_payment_date: row.next_payment_date,
        subscription_status: mapped?.subscription_status || "active"
      }
    };
  });
}

async function assertBusinessAccessAllowed(user, client = pool) {
  const role = normalizeRole(user?.role);
  if (["superusuario", "soporte"].includes(role || "")) {
    return { blocked: false, subscription: null };
  }

  const businessId = requireActorBusinessId(user);
  const subscription = await getBusinessSubscriptionSummary(businessId, client);
  if (subscription?.should_block) {
    throw new ApiError(403, BLOCKED_BUSINESS_MESSAGE);
  }

  return { blocked: false, subscription };
}

module.exports = {
  BLOCKED_BUSINESS_MESSAGE,
  mapBusinessSubscription,
  calculateNextPaymentDate,
  ensureBusinessSubscriptionRow,
  initializeBusinessSubscriptionForNewBusiness,
  getBusinessSubscriptionSummary,
  updateBusinessSubscription,
  listSubscriptionCalendarEvents,
  syncBusinessPaymentReminder,
  assertBusinessAccessAllowed
};
