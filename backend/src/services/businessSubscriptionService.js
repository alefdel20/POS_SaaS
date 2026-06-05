const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { saveAuditLog } = require("./auditLogService");
const { isSuperUser, requireActorBusinessId } = require("../utils/tenant");
const { normalizeRole } = require("../utils/roles");
const { getMexicoCityDate } = require("../utils/timezone");

const DUE_SOON_DAYS = 7;
const BLOCKED_BUSINESS_MESSAGE = "Tu cuenta está temporalmente bloqueada, contacta al proveedor o realiza el pago para reanudar tu servicio.";
const CANCELLED_SUBSCRIPTION_MESSAGE = "Tu suscripción fue cancelada. Reactiva tu plan para continuar.";

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

function maxDateOnly(leftDate, rightDate) {
  const left = parseDateOnly(leftDate);
  const right = parseDateOnly(rightDate);
  if (left && right) {
    return left >= right ? formatDateOnly(left) : formatDateOnly(right);
  }
  if (left) return formatDateOnly(left);
  if (right) return formatDateOnly(right);
  return null;
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
  if (row?.trial_ends_at != null) {
    const trialEnd = new Date(row.trial_ends_at);
    const todayDate = today instanceof Date ? today : new Date(today);
    const diffMs = trialEnd - todayDate;
    const trialDaysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (trialDaysRemaining > 0) {
      return {
        subscription_status: "trial",
        is_trial: true,
        trial_days_remaining: trialDaysRemaining,
        trial_ends_at: row.trial_ends_at,
        should_block: false,
        is_configured: true,
        due_in_days: null,
        overdue_days: null
      };
    } else {
      return {
        subscription_status: "trial_expired",
        is_trial: true,
        trial_days_remaining: 0,
        trial_ends_at: row.trial_ends_at,
        should_block: true,
        is_configured: true,
        due_in_days: null,
        overdue_days: null
      };
    }
  }

  if (row?.subscription_status === "cancelled") {
    return {
      subscription_status: "cancelled",
      is_configured: Boolean(row?.plan_type),
      due_in_days: null,
      overdue_days: null,
      should_block: false
    };
  }

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
    plan_name: row.plan_name || null,
    billing_anchor_date: row.billing_anchor_date || null,
    next_payment_date: row.next_payment_date || null,
    grace_period_days: Number(row.grace_period_days || 0),
    enforcement_enabled: Boolean(row.enforcement_enabled),
    manual_adjustment_reason: row.manual_adjustment_reason || "",
    last_payment_date: row.last_payment_date || null,
    last_payment_note: row.last_payment_note || "",
    openpay_subscription_id: row.openpay_subscription_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    report_hour: row.report_hour ?? null,
    report_whatsapp_enabled: row.report_whatsapp_enabled ?? true,
    report_email_enabled: row.report_email_enabled ?? false,
    stock_alert_hour_morning: row.stock_alert_hour_morning ?? null,
    stock_alert_hour_evening: row.stock_alert_hour_evening ?? null,
    inventory_alert_hour: row.inventory_alert_hour ?? null,
    inventory_alert_hour_evening: row.inventory_alert_hour_evening ?? null,
    ...derived,
    is_trial: derived.is_trial ?? false,
    trial_days_remaining: derived.trial_days_remaining ?? null,
    trial_ends_at: row.trial_ends_at ?? null
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

async function initializeBusinessSubscriptionForNewBusiness(business, actorId, isTrial = false, client = pool) {
  const anchorDate = formatDateOnly(business.created_at);
  const nextPaymentDate = calculateNextPaymentDate(anchorDate, "monthly", anchorDate);
  let rows;

  if (isTrial) {
    ({ rows } = await client.query(
      `INSERT INTO business_subscriptions (
         business_id,
         plan_type,
         billing_anchor_date,
         next_payment_date,
         grace_period_days,
         enforcement_enabled,
         manual_adjustment_reason,
         trial_started_at,
         trial_ends_at,
         created_by,
         updated_by,
         report_hour,
         stock_alert_hour_morning,
         stock_alert_hour_evening,
         inventory_alert_hour,
         inventory_alert_hour_evening,
         report_whatsapp_enabled,
         report_email_enabled
       )
       VALUES ($1, 'monthly', $2, $3, 0, FALSE, 'Alta inicial del negocio - período de prueba', NOW(), NOW() + INTERVAL '7 days', $4, $4,
               NULL, NULL, NULL, NULL, NULL, TRUE, FALSE)
       ON CONFLICT (business_id) DO UPDATE
         SET plan_type = EXCLUDED.plan_type,
             billing_anchor_date = EXCLUDED.billing_anchor_date,
             next_payment_date = EXCLUDED.next_payment_date,
             enforcement_enabled = EXCLUDED.enforcement_enabled,
             manual_adjustment_reason = EXCLUDED.manual_adjustment_reason,
             trial_started_at = EXCLUDED.trial_started_at,
             trial_ends_at = EXCLUDED.trial_ends_at,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
       RETURNING *`,
      [business.id, anchorDate, nextPaymentDate, actorId || null]
    ));
  } else {
    ({ rows } = await client.query(
      `INSERT INTO business_subscriptions (
         business_id,
         plan_type,
         billing_anchor_date,
         next_payment_date,
         grace_period_days,
         enforcement_enabled,
         manual_adjustment_reason,
         trial_started_at,
         trial_ends_at,
         created_by,
         updated_by,
         report_hour,
         stock_alert_hour_morning,
         stock_alert_hour_evening,
         inventory_alert_hour,
         inventory_alert_hour_evening,
         report_whatsapp_enabled,
         report_email_enabled
       )
       VALUES ($1, 'monthly', $2, $3, 0, TRUE, 'Alta inicial del negocio', NULL, NULL, $4, $4,
               NULL, NULL, NULL, NULL, NULL, TRUE, FALSE)
       ON CONFLICT (business_id) DO UPDATE
         SET plan_type = EXCLUDED.plan_type,
             billing_anchor_date = EXCLUDED.billing_anchor_date,
             next_payment_date = EXCLUDED.next_payment_date,
             enforcement_enabled = EXCLUDED.enforcement_enabled,
             manual_adjustment_reason = EXCLUDED.manual_adjustment_reason,
             trial_started_at = EXCLUDED.trial_started_at,
             trial_ends_at = EXCLUDED.trial_ends_at,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
       RETURNING *`,
      [business.id, anchorDate, nextPaymentDate, actorId || null]
    ));
  }

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

function calculateNextPaymentAfterManualPayment(currentRow, paidAtDate) {
  const paidAt = normalizeDateInput(paidAtDate) || getMexicoCityDate();
  const planType = currentRow?.plan_type || null;
  const anchorDate = currentRow?.billing_anchor_date || currentRow?.next_payment_date || paidAt;
  if (!planType || !anchorDate) {
    return null;
  }

  const currentNextDate = currentRow?.next_payment_date || null;
  const nextCycleReference = currentNextDate ? addDays(currentNextDate, 1) : null;
  const effectiveReferenceDate = maxDateOnly(nextCycleReference, paidAt) || paidAt;
  return calculateNextPaymentDate(anchorDate, planType, effectiveReferenceDate);
}

async function registerBusinessSubscriptionPayment(businessId, payload = {}, actor) {
  if (!isSuperUser(actor)) {
    throw new ApiError(403, "Forbidden");
  }

  const business = await getBusinessRow(businessId);
  if (!business) {
    throw new ApiError(404, "Business not found");
  }

  const current = await ensureBusinessSubscriptionRow(businessId);
  if (!current?.plan_type) {
    throw new ApiError(409, "Subscription plan is not configured");
  }

  const paidAt = normalizeDateInput(payload.paid_at) || getMexicoCityDate();
  const note = String(payload.note || "").trim();
  const previousSummary = mapBusinessSubscription(current);
  const nextPaymentDate = calculateNextPaymentAfterManualPayment(current, paidAt);
  if (!nextPaymentDate) {
    throw new ApiError(409, "Unable to recalculate next payment date");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE business_subscriptions
       SET next_payment_date = $1,
           last_payment_date = $2,
           last_payment_note = $3,
           updated_by = $4,
           updated_at = NOW()
       WHERE business_id = $5
       RETURNING *`,
      [nextPaymentDate, paidAt, note, actor.id, Number(businessId)]
    );

    const updatedSummary = mapBusinessSubscription(rows[0]);
    await syncBusinessPaymentReminder(businessId, client);
    await saveAuditLog({
      business_id: Number(businessId),
      usuario_id: actor.id,
      modulo: "business_subscriptions",
      accion: "register_subscription_payment",
      entidad_tipo: "business_subscription",
      entidad_id: String(businessId),
      detalle_anterior: { snapshot: previousSummary, business_name: business.name },
      detalle_nuevo: {
        snapshot: updatedSummary,
        business_name: business.name,
        payment_registered_at: paidAt
      },
      motivo: note,
      metadata: { business_slug: business.slug, payment_date: paidAt }
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

  if (subscription?.subscription_status === "cancelled") {
    const npd = subscription?.next_payment_date;
    const today = getMexicoCityDate();
    if (!npd || today > npd) {
      throw new ApiError(403, CANCELLED_SUBSCRIPTION_MESSAGE);
    }
    return { blocked: false, subscription };
  }

  if (subscription?.should_block) {
    throw new ApiError(403, BLOCKED_BUSINESS_MESSAGE);
  }

  return { blocked: false, subscription };
}

const PLAN_CATALOG = {
  basico:     { plan_name: 'Básico',     subscription_amount: 349.00, max_branches: 1 },
  premium:    { plan_name: 'Premium',    subscription_amount: 699.00, max_branches: 3 },
  enterprise: { plan_name: 'Enterprise', subscription_amount: 999.00, max_branches: 5 },
};

const OPENPAY_PLAN_IDS = {
  basico:           process.env.OPENPAY_PLAN_ID_BASICO,
  premium:          process.env.OPENPAY_PLAN_ID_PREMIUM,
  enterprise:       process.env.OPENPAY_PLAN_ID_ENTERPRISE,
  basico_anual:     process.env.OPENPAY_PLAN_ID_BASICO_ANUAL,
  premium_anual:    process.env.OPENPAY_PLAN_ID_PREMIUM_ANUAL,
  enterprise_anual: process.env.OPENPAY_PLAN_ID_ENTERPRISE_ANUAL,
};

const TEST_BUSINESS_ID = 6;
const OPENPAY_PLAN_IDS_TEST = {
  basico: process.env.OPENPAY_PLAN_ID_BASICO_TEST ?? process.env.OPENPAY_PLAN_ID_BASICO,
};

async function changePlan(businessId, targetPlanKey) {
  const plan = PLAN_CATALOG[targetPlanKey];
  if (!plan) throw new ApiError(400, 'Plan no válido. Planes disponibles: basico, premium, enterprise');

  const { rows: subRows } = await pool.query(
    `SELECT plan_name, extra_branches_count
     FROM business_subscriptions
     WHERE business_id = $1`,
    [businessId]
  );
  if (!subRows.length) throw new ApiError(404, 'Suscripción no encontrada');

  const current = subRows[0];
  const extraBranches = Number(current.extra_branches_count ?? 0);
  const effectiveLimit = plan.max_branches + extraBranches;

  const { rows: branchRows } = await pool.query(
    `SELECT COUNT(*) AS count FROM branches
     WHERE business_id = $1 AND is_active = TRUE`,
    [businessId]
  );
  const activeBranches = Number(branchRows[0].count);

  if (activeBranches > effectiveLimit) {
    throw new ApiError(400,
      `No puedes cambiar a ${plan.plan_name}: tienes ${activeBranches} sucursales activas ` +
      `y este plan permite ${effectiveLimit}. Desactiva ${activeBranches - effectiveLimit} sucursal(es) primero.`
    );
  }

  await pool.query(
    `UPDATE business_subscriptions
     SET plan_name = $1, subscription_amount = $2
     WHERE business_id = $3`,
    [plan.plan_name, plan.subscription_amount, businessId]
  );

  return {
    plan_name: plan.plan_name,
    subscription_amount: plan.subscription_amount,
    max_branches: effectiveLimit,
  };
}

const openPayService = require('./openPayService');

async function upgradePlan(businessId, targetPlanKey, planType, cardToken) {
  // 1. Validar plan destino
  const plan = PLAN_CATALOG[targetPlanKey];
  if (!plan) throw new ApiError(400, 'Plan no válido. Usa: basico, premium, enterprise');

  const openpayPlanKey = planType === 'yearly'
    ? `${targetPlanKey}_anual`
    : targetPlanKey;
  const planIdMap = Number(businessId) === TEST_BUSINESS_ID
    ? { ...OPENPAY_PLAN_IDS, ...OPENPAY_PLAN_IDS_TEST }
    : OPENPAY_PLAN_IDS;
  const newOpenpayPlanId = planIdMap[openpayPlanKey];
  if (!newOpenpayPlanId) throw new ApiError(500, `Plan ID de OpenPay no configurado para ${openpayPlanKey}`);

  // 2. Leer suscripción actual
  const { rows } = await pool.query(
    `SELECT openpay_customer_id, openpay_subscription_id, plan_name, extra_branches_count
     FROM business_subscriptions
     WHERE business_id = $1`,
    [businessId]
  );
  if (!rows.length) throw new ApiError(404, 'Suscripción no encontrada');

  const current = rows[0];

  // 3. Validar sucursales activas (bloquear downgrade con sucursales de más)
  const { rows: branchRows } = await pool.query(
    `SELECT COUNT(*) AS count FROM branches
     WHERE business_id = $1 AND is_active = TRUE`,
    [businessId]
  );
  const activeBranches = Number(branchRows[0].count);
  const extraBranches = Number(current.extra_branches_count ?? 0);
  const effectiveLimit = plan.max_branches + extraBranches;

  if (activeBranches > effectiveLimit) {
    throw new ApiError(400,
      `No puedes cambiar a ${plan.plan_name}: tienes ${activeBranches} sucursales activas ` +
      `y este plan permite ${effectiveLimit}. Desactiva ${activeBranches - effectiveLimit} sucursal(es) primero.`
    );
  }

  // 4. Cancelar suscripción anterior en OpenPay (solo si existe)
  if (current.openpay_customer_id && current.openpay_subscription_id) {
    try {
      await openPayService.cancelSubscription(
        current.openpay_customer_id,
        current.openpay_subscription_id
      );
    } catch (err) {
      // Si ya estaba cancelada en OpenPay, continuar
      console.warn('[upgradePlan] cancelSubscription warning:', err?.message);
    }
  }

  // 5. Crear nueva suscripción en OpenPay
  const newSubscriptionId = await openPayService.createSubscription(
    current.openpay_customer_id,
    newOpenpayPlanId,
    cardToken
  );

  // 6. Actualizar DB
  const subscriptionAmount = planType === 'yearly'
    ? plan.subscription_amount * 10
    : plan.subscription_amount;

  await pool.query(
    `UPDATE business_subscriptions
     SET plan_name = $1,
         subscription_amount = $2,
         openpay_plan_id = $3,
         openpay_subscription_id = $4,
         plan_type = $5,
         subscription_status = 'active'
     WHERE business_id = $6`,
    [plan.plan_name, subscriptionAmount, newOpenpayPlanId, newSubscriptionId, planType, businessId]
  );

  return {
    plan_name: plan.plan_name,
    subscription_amount: subscriptionAmount,
    plan_type: planType,
    max_branches: effectiveLimit,
  };
}

module.exports = {
  BLOCKED_BUSINESS_MESSAGE,
  CANCELLED_SUBSCRIPTION_MESSAGE,
  mapBusinessSubscription,
  calculateNextPaymentDate,
  ensureBusinessSubscriptionRow,
  initializeBusinessSubscriptionForNewBusiness,
  getBusinessSubscriptionSummary,
  updateBusinessSubscription,
  registerBusinessSubscriptionPayment,
  listSubscriptionCalendarEvents,
  syncBusinessPaymentReminder,
  assertBusinessAccessAllowed,
  PLAN_CATALOG,
  OPENPAY_PLAN_IDS,
  changePlan,
  upgradePlan
};
