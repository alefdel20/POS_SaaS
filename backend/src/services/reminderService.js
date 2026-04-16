const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { n8nWebhookUrl } = require("../config/env");
const { getReminderContext } = require("./creditCollectionService");
const { emitActorAutomationEvent } = require("./automationEventService");
const { requireActorBusinessId } = require("../utils/tenant");
const { TIME_ZONE, getMexicoCityDate, getMexicoCityDateTime } = require("../utils/timezone");
const { saveAuditLog } = require("./auditLogService");
const { normalizeRole } = require("../utils/roles");
const { normalizeFrequency } = require("../utils/fixedExpenseFrequency");
const {
  listSubscriptionCalendarEvents,
  syncBusinessPaymentReminder
} = require("./businessSubscriptionService");
const {
  normalizeReminderCategory,
  normalizeReminderStatus
} = require("../utils/domainEnums");

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function addDays(dateString, days) {
  const baseDate = parseDateOnly(dateString);
  if (!baseDate) return dateString;
  baseDate.setUTCDate(baseDate.getUTCDate() + days);
  return getMexicoCityDate(baseDate);
}

function getTodayLocalDate() {
  return getMexicoCityDate();
}

function getBusinessId(actor) {
  return requireActorBusinessId(actor);
}

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
  return getMexicoCityDate(value);
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function addMonthsClamped(baseDate, months, desiredDay) {
  const cursor = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth() + months, 1, 12, 0, 0));
  const targetDay = Math.min(Math.max(desiredDay, 1), daysInMonth(cursor.getUTCFullYear(), cursor.getUTCMonth()));
  return new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), targetDay, 12, 0, 0));
}

function toTimeLabel(value) {
  if (!value) return "";
  const text = String(value);
  if (text.includes("T")) {
    return text.slice(11, 16);
  }
  if (text.includes(" ")) {
    return text.slice(11, 16);
  }
  return "";
}

function toCalendarDate(value) {
  return value ? String(value).slice(0, 10) : null;
}

function toReminderCategoryLabel(reminder) {
  const metadata = reminder?.metadata || {};
  const categoryTag = String(metadata.reminder_category || "").toLowerCase();
  if (categoryTag === "providers") return "Proveedores";
  if (categoryTag === "expense") return "Gasto";
  if (categoryTag === "fixed_expense") return "Gasto fijo";
  if (categoryTag === "owner_debt") return "Deuda del dueño";
  return reminder?.category === "clinical" ? "Clinico" : "Administrativo";
}

function buildReminderDateSummary(reminder) {
  const metadata = reminder?.metadata || {};
  const startAt = metadata.start_at || metadata.calendar_start_at || null;
  const endAt = metadata.end_at || metadata.calendar_end_at || null;
  const startTime = toTimeLabel(startAt);
  const endTime = toTimeLabel(endAt);
  if (startTime && endTime) return `${startTime}-${endTime}`;
  if (startTime) return `Inicio ${startTime}`;
  return "";
}

function normalizeRangeBoundaries(filters = {}) {
  const startDate = toCalendarDate(filters.start_date);
  const endDate = toCalendarDate(filters.end_date);
  if (!startDate || !endDate) {
    throw new ApiError(400, "start_date and end_date are required");
  }
  if (startDate > endDate) {
    throw new ApiError(400, "Invalid date range");
  }
  return { startDate, endDate };
}

function extractReminderMeta(payload = {}, currentMetadata = {}) {
  const next = { ...(currentMetadata || {}), ...(payload.metadata || {}) };
  if (payload.start_date !== undefined) {
    next.start_at = payload.start_date || null;
    next.calendar_start_at = payload.start_date || null;
  }
  if (payload.end_date !== undefined) {
    next.end_at = payload.end_date || null;
    next.calendar_end_at = payload.end_date || null;
  }
  if (payload.provider_category !== undefined) {
    next.reminder_category = payload.provider_category || "administrative";
  }
  return next;
}

function sourceKeyHash(sourceKey, fallbackId = 0) {
  const text = String(sourceKey || fallbackId || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash || Number(fallbackId || 0);
}

function projectFixedExpenseDates(row, startDate, endDate) {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end || end < start) return [];

  const frequency = normalizeFrequency(row?.frequency);
  const baseDateText = toCalendarDate(row?.base_date) || toCalendarDate(row?.created_at) || null;
  let base = parseDateOnly(baseDateText);
  if (!base) {
    const dueDay = Number(row?.due_day);
    if (Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31) {
      base = addMonthsClamped(start, 0, dueDay);
    } else {
      base = new Date(start);
    }
  }
  base.setUTCHours(12, 0, 0, 0);

  const monthlyIntervals = {
    monthly: 1,
    custom: 1,
    bimonthly: 2,
    quarterly: 3,
    semiannual: 6,
    annual: 12
  };
  const dayIntervals = {
    weekly: 7,
    biweekly: 14
  };

  const result = [];
  if (dayIntervals[frequency]) {
    const intervalDays = dayIntervals[frequency];
    let cursor = new Date(base);
    if (cursor < start) {
      const diffDays = Math.floor((start.getTime() - cursor.getTime()) / (24 * 60 * 60 * 1000));
      const jumps = Math.floor(diffDays / intervalDays);
      cursor.setUTCDate(cursor.getUTCDate() + jumps * intervalDays);
      while (cursor < start) {
        cursor.setUTCDate(cursor.getUTCDate() + intervalDays);
      }
    }
    while (cursor <= end) {
      result.push(formatDateOnly(cursor));
      cursor = new Date(cursor);
      cursor.setUTCDate(cursor.getUTCDate() + intervalDays);
    }
    return result;
  }

  const monthInterval = monthlyIntervals[frequency] || 1;
  const desiredDay = base.getDate();
  let cursor = new Date(base);
  while (cursor < start) {
    cursor = addMonthsClamped(cursor, monthInterval, desiredDay);
  }
  while (cursor <= end) {
    result.push(formatDateOnly(cursor));
    cursor = addMonthsClamped(cursor, monthInterval, desiredDay);
  }
  return result;
}

function isSchemaError(error) {
  return ["42P01", "42703", "42704", "23505"].includes(String(error?.code || ""));
}

async function assertReminderPatientAccess(patientId, businessId, client = pool) {
  if (!patientId) {
    return;
  }
  const { rows } = await client.query(
    "SELECT id FROM patients WHERE id = $1 AND business_id = $2",
    [Number(patientId), businessId]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Patient not found");
  }
}

async function listReminders(actor, filters = {}) {
  const businessId = getBusinessId(actor);
  const params = [businessId];
  const conditions = ["reminders.business_id = $1"];
  const category = filters.category ? normalizeReminderCategory(filters.category) : null;
  const status = filters.status ? normalizeReminderStatus(filters.status) : null;
  if (filters.category && !category) throw new ApiError(400, "Invalid reminder category");
  if (filters.status && !status) throw new ApiError(400, "Invalid reminder status");
  if (category) {
    params.push(category);
    conditions.push(`reminders.category = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`reminders.status = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT reminders.*, users.full_name AS assigned_to_name, patients.name AS patient_name
     FROM reminders
     LEFT JOIN users ON users.id = reminders.assigned_to AND users.business_id = reminders.business_id
     LEFT JOIN patients ON patients.id = reminders.patient_id AND patients.business_id = reminders.business_id
     WHERE ${conditions.join(" AND ")}
       AND (reminders.source_key IS NULL OR reminders.source_key NOT LIKE 'finance:%')
       AND COALESCE(reminders.reminder_type, '') NOT IN ('finance_expense', 'finance_owner_loan', 'finance_fixed_expense')
     ORDER BY reminders.is_completed ASC,
              CASE
                WHEN COALESCE(reminders.metadata->>'priority', '') ~ '^[0-9]+$'
                  THEN (reminders.metadata->>'priority')::int
                ELSE 0
              END DESC,
              reminders.due_date ASC NULLS LAST,
              reminders.created_at DESC`,
    params
  );
  return rows;
}

async function listCalendarEvents(actor, filters = {}) {
  const businessId = getBusinessId(actor);
  const { startDate, endDate } = normalizeRangeBoundaries(filters);

  const [reminderRows, expenseRows, ownerLoanRows, fixedExpenseRows, subscriptionEvents] = await Promise.all([
    pool.query(
      `SELECT reminders.*, users.full_name AS assigned_to_name, patients.name AS patient_name
       FROM reminders
       LEFT JOIN users ON users.id = reminders.assigned_to AND users.business_id = reminders.business_id
       LEFT JOIN patients ON patients.id = reminders.patient_id AND patients.business_id = reminders.business_id
       WHERE reminders.business_id = $1
         AND reminders.due_date BETWEEN $2::date AND $3::date
         AND (reminders.source_key IS NULL OR reminders.source_key NOT LIKE 'finance:%')
         AND COALESCE(reminders.reminder_type, '') NOT IN ('finance_expense', 'finance_owner_loan', 'finance_fixed_expense')
       ORDER BY reminders.is_completed ASC, reminders.due_date ASC, reminders.created_at DESC`,
      [businessId, startDate, endDate]
    ),
    pool.query(
      `SELECT id, concept, category, amount, date, notes, payment_method
       FROM expenses
       WHERE business_id = $1
         AND is_voided = FALSE
         AND date BETWEEN $2::date AND $3::date
       ORDER BY date ASC, id ASC`,
      [businessId, startDate, endDate]
    ),
    pool.query(
      `SELECT id, amount, type, balance, date, notes
       FROM owner_loans
       WHERE business_id = $1
         AND is_voided = FALSE
         AND date BETWEEN $2::date AND $3::date
       ORDER BY date ASC, id ASC`,
      [businessId, startDate, endDate]
    ),
    pool.query(
      `SELECT id, name, category, default_amount, frequency, due_day, notes, base_date, created_at
       FROM fixed_expenses
       WHERE business_id = $1
         AND is_active = TRUE
       ORDER BY id ASC`,
      [businessId]
    ),
    listSubscriptionCalendarEvents(actor, startDate, endDate)
  ]);

  const unified = [];

  for (const reminder of reminderRows.rows) {
    const metadata = reminder.metadata || {};
    const mergedReminder = {
      ...reminder,
      metadata: {
        ...metadata,
        reminder_category: metadata.reminder_category || (reminder.category === "clinical" ? "clinical" : "administrative"),
        reminder_label: toReminderCategoryLabel(reminder),
        date_summary: buildReminderDateSummary(reminder)
      }
    };
    unified.push(mergedReminder);
  }

  for (const expense of expenseRows.rows) {
    const sourceKey = `finance:expense:${businessId}:${expense.id}`;
    unified.push({
      id: sourceKeyHash(sourceKey, expense.id),
      title: `Gasto: ${expense.concept}`,
      notes: expense.notes || "",
      source_key: sourceKey,
      status: "completed",
      due_date: expense.date,
      assigned_to: null,
      reminder_type: "finance_expense",
      category: "administrative",
      patient_id: null,
      patient_name: null,
      is_completed: true,
      metadata: {
        source_module: "expenses",
        reminder_category: "expense",
        reminder_label: "Gasto",
        expense_id: Number(expense.id),
        concept: expense.concept,
        amount: Number(expense.amount || 0),
        category: expense.category || "General",
        payment_method: expense.payment_method || "cash"
      }
    });
  }

  for (const loan of ownerLoanRows.rows) {
    const sourceKey = `finance:owner-loan:${businessId}:${loan.id}`;
    unified.push({
      id: sourceKeyHash(sourceKey, loan.id),
      title: `Deuda del dueño: ${loan.type === "entrada" ? "entrada" : "abono"}`,
      notes: loan.notes || "",
      source_key: sourceKey,
      status: "completed",
      due_date: loan.date,
      assigned_to: null,
      reminder_type: "finance_owner_loan",
      category: "administrative",
      patient_id: null,
      patient_name: null,
      is_completed: true,
      metadata: {
        source_module: "owner_loans",
        reminder_category: "owner_debt",
        reminder_label: "Deuda del dueño",
        owner_loan_id: Number(loan.id),
        movement_type: loan.type,
        amount: Number(loan.amount || 0),
        balance: Number(loan.balance || 0)
      }
    });
  }

  for (const fixedExpense of fixedExpenseRows.rows) {
    const dueDates = projectFixedExpenseDates(fixedExpense, startDate, endDate);
    for (const dueDate of dueDates) {
      const sourceKey = `finance:fixed-expense:${businessId}:${fixedExpense.id}:${dueDate}`;
      unified.push({
        id: sourceKeyHash(sourceKey, `${fixedExpense.id}${dueDate.replace(/-/g, "")}`),
        title: `Gasto fijo: ${fixedExpense.name}`,
        notes: fixedExpense.notes || "",
        source_key: sourceKey,
        status: "pending",
        due_date: dueDate,
        assigned_to: null,
        reminder_type: "finance_fixed_expense",
        category: "administrative",
        patient_id: null,
        patient_name: null,
        is_completed: false,
        metadata: {
          source_module: "fixed_expenses",
          reminder_category: "fixed_expense",
          reminder_label: "Gasto fijo",
          fixed_expense_id: Number(fixedExpense.id),
          concept: fixedExpense.name,
          amount: Number(fixedExpense.default_amount || 0),
          category: fixedExpense.category || "General",
          frequency: normalizeFrequency(fixedExpense.frequency),
          base_date: toCalendarDate(fixedExpense.base_date) || toCalendarDate(fixedExpense.created_at)
        }
      });
    }
  }

  unified.push(...subscriptionEvents);

  return unified.sort((left, right) => {
    const leftCompleted = Boolean(left.is_completed) ? 1 : 0;
    const rightCompleted = Boolean(right.is_completed) ? 1 : 0;
    if (leftCompleted !== rightCompleted) return leftCompleted - rightCompleted;
    const leftPriority = Number(left?.metadata?.priority || 0);
    const rightPriority = Number(right?.metadata?.priority || 0);
    if (leftPriority !== rightPriority) return rightPriority - leftPriority;
    const leftDate = String(left.due_date || "");
    const rightDate = String(right.due_date || "");
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    return String(left.title || "").localeCompare(String(right.title || ""));
  });
}

function assertClinicalReminderAccess(payload, actor) {
  const category = normalizeReminderCategory(payload?.category) || "administrative";
  if (category === "clinical" && !["superusuario", "admin", "clinico"].includes(normalizeRole(actor?.role) || "")) {
    throw new ApiError(403, "Forbidden");
  }
}

async function createReminder(payload, actor) {
  const businessId = getBusinessId(actor);
  assertClinicalReminderAccess(payload, actor);
  const category = normalizeReminderCategory(payload.category) || (payload.patient_id ? "clinical" : "administrative");
  const nextStatus = normalizeReminderStatus(payload.status) || "pending";
  const nextIsCompleted = nextStatus === "completed";
  const metadata = extractReminderMeta(payload);
  const nextDueDate = payload.due_date || toCalendarDate(payload.start_date) || null;
  await assertReminderPatientAccess(payload.patient_id, businessId);
  const { rows } = await pool.query(
    `INSERT INTO reminders (title, notes, status, due_date, source_key, assigned_to, created_by, is_completed, business_id, reminder_type, category, patient_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [String(payload.title || "").trim(), String(payload.notes || "").trim(), nextStatus, nextDueDate, payload.source_key || null, payload.assigned_to || null, payload.created_by, nextIsCompleted, businessId, payload.reminder_type || "general", category, payload.patient_id || null, JSON.stringify(metadata)]
  );
  await saveAuditLog({
    business_id: businessId,
    usuario_id: actor?.id || null,
    modulo: "reminders",
    accion: category === "clinical" ? "create_clinical_reminder" : "create_reminder",
    entidad_tipo: "reminder",
    entidad_id: rows[0].id,
    detalle_nuevo: { snapshot: rows[0] },
    metadata: { category, patient_id: payload.patient_id || null }
  }, { strict: false });
  return rows[0];
}

async function updateReminder(id, payload, actor) {
  const businessId = getBusinessId(actor);
  const { rows: existingRows } = await pool.query("SELECT * FROM reminders WHERE id = $1 AND business_id = $2", [id, businessId]);
  const current = existingRows[0];
  if (!current) throw new ApiError(404, "Reminder not found");
  const nextCategory = normalizeReminderCategory(payload.category) || normalizeReminderCategory(current.category) || "administrative";
  const nextStatus = normalizeReminderStatus(payload.status) || normalizeReminderStatus(current.status) || "pending";
  const nextIsCompleted = nextStatus === "completed";
  const metadata = extractReminderMeta(payload, current.metadata || {});
  const nextDueDate = payload.due_date !== undefined
    ? payload.due_date
    : (payload.start_date !== undefined ? toCalendarDate(payload.start_date) : current.due_date);
  assertClinicalReminderAccess({ category: nextCategory }, actor);
  await assertReminderPatientAccess(payload.patient_id ?? current.patient_id, businessId);

  const { rows } = await pool.query(
    `UPDATE reminders
     SET title = $1, notes = $2, status = $3, due_date = $4, assigned_to = $5, is_completed = $6, source_key = $7, reminder_type = $8, category = $9, patient_id = $10, metadata = $11, updated_at = NOW()
     WHERE id = $12 AND business_id = $13
     RETURNING *`,
    [String(payload.title ?? current.title ?? "").trim(), String(payload.notes ?? current.notes ?? "").trim(), nextStatus, nextDueDate, payload.assigned_to ?? current.assigned_to, nextIsCompleted, payload.source_key ?? current.source_key, payload.reminder_type ?? current.reminder_type, nextCategory, payload.patient_id ?? current.patient_id, JSON.stringify(metadata), id, businessId]
  );
  await saveAuditLog({
    business_id: businessId,
    usuario_id: actor?.id || null,
    modulo: "reminders",
    accion: nextCategory === "clinical" ? "update_clinical_reminder" : "update_reminder",
    entidad_tipo: "reminder",
    entidad_id: id,
    detalle_anterior: { snapshot: current },
    detalle_nuevo: { snapshot: rows[0] },
    metadata: { category: nextCategory, patient_id: payload.patient_id ?? current.patient_id ?? null }
  }, { strict: false });
  return rows[0];
}

async function completeReminder(id, actor) {
  const businessId = getBusinessId(actor);
  const { rows } = await pool.query(
    `UPDATE reminders
     SET is_completed = TRUE, status = 'completed', updated_at = NOW()
     WHERE id = $1 AND business_id = $2
     RETURNING *`,
    [id, businessId]
  );
  if (!rows[0]) throw new ApiError(404, "Reminder not found");
  return rows[0];
}

async function deleteReminder(id, actor) {
  const businessId = getBusinessId(actor);
  const { rows } = await pool.query("DELETE FROM reminders WHERE id = $1 AND business_id = $2 RETURNING *", [id, businessId]);
  if (!rows[0]) throw new ApiError(404, "Reminder not found");
  return rows[0];
}

async function upsertAutomaticReminder(payload, actor, options = {}) {
  const businessId = getBusinessId(actor);
  return upsertSystemReminder({ ...payload, business_id: businessId }, options);
}

async function upsertSystemReminder(payload, options = {}) {
  const businessId = Number(payload.business_id || options.businessId || 0);
  if (!businessId) {
    throw new ApiError(400, "Business id is required");
  }
  const client = options.client || pool;
  const nextStatus = normalizeReminderStatus(payload.status) || "pending";
  const isCompleted = payload.is_completed ?? (nextStatus === "completed");
  console.info("[REMINDERS] Upserting automatic reminder", { businessId, sourceKey: payload.source_key });
  const { rows: existingRows } = await client.query("SELECT * FROM reminders WHERE source_key = $1 AND business_id = $2 LIMIT 1", [payload.source_key, businessId]);
  if (existingRows[0]) {
    const { rows } = await client.query(
      `UPDATE reminders
       SET title = $1, notes = $2, due_date = $3, status = $4,
           is_completed = $5, reminder_type = $6, category = $7, patient_id = $8, metadata = $9, updated_at = NOW()
       WHERE source_key = $10 AND business_id = $11
       RETURNING *`,
      [
        payload.title,
        payload.notes || "",
        payload.due_date || null,
        nextStatus,
        Boolean(isCompleted),
        payload.reminder_type || "general",
        payload.category || "administrative",
        payload.patient_id || null,
        JSON.stringify(payload.metadata || {}),
        payload.source_key,
        businessId
      ]
    );
    return rows[0];
  }
  const { rows } = await client.query(
    `INSERT INTO reminders (title, notes, status, due_date, source_key, assigned_to, created_by, is_completed, business_id, reminder_type, category, patient_id, metadata)
     VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      payload.title,
      payload.notes || "",
      nextStatus,
      payload.due_date || null,
      payload.source_key,
      Boolean(isCompleted),
      businessId,
      payload.reminder_type || "general",
      payload.category || "administrative",
      payload.patient_id || null,
      JSON.stringify(payload.metadata || {})
    ]
  );
  return rows[0];
}

async function removeAutomaticReminder(sourceKey, actor, client = pool) {
  const businessId = getBusinessId(actor);
  console.info("[REMINDERS] Removing automatic reminder", { businessId, sourceKey });
  await client.query(
    `DELETE FROM reminders
     WHERE business_id = $1
       AND source_key = $2`,
    [businessId, sourceKey]
  );
}

async function cancelAutomaticReminder(sourceKey, actor, client = pool) {
  const businessId = getBusinessId(actor);
  console.info("[REMINDERS] Cancelling automatic reminder", { businessId, sourceKey });
  await client.query(
    `UPDATE reminders
     SET status = 'cancelled',
         is_completed = TRUE,
         updated_at = NOW()
     WHERE business_id = $1
       AND source_key = $2`,
    [businessId, sourceKey]
  );
}

async function removeLegacyLowStockReminders(businessId) {
  await pool.query(
    `DELETE FROM reminders
     WHERE business_id = $1
       AND source_key LIKE $2`,
    [businessId, `auto:stock-low:${businessId}:%`]
  );
}

function buildLowStockReminderPayload(businessId, products, dueDate) {
  return {
    source_key: `auto:stock-low:${businessId}`,
    title: "STOCK BAJO",
    notes: products
      .map((product) => {
        const stockMaximo = product.stock_maximo === null || product.stock_maximo === undefined || product.stock_maximo === ""
          ? "-"
          : Number(product.stock_maximo);
        return `• ${product.name}
  Stock actual: ${Number(product.stock)}
  Minimo: ${Number(product.stock_minimo)}
  Maximo: ${stockMaximo}`;
      })
      .join("\n\n"),
    due_date: dueDate
  };
}

async function syncConsolidatedLowStockReminder(products, actor) {
  const businessId = getBusinessId(actor);
  const sourceKey = `auto:stock-low:${businessId}`;
  const today = getTodayLocalDate();

  await removeLegacyLowStockReminders(businessId);

  if (!products.length) {
    await pool.query(
      `DELETE FROM reminders
       WHERE business_id = $1
         AND source_key = $2`,
      [businessId, sourceKey]
    );
    return null;
  }

  return upsertAutomaticReminder(buildLowStockReminderPayload(businessId, products, today), actor);
}

async function ensureAutomaticReminders(actor) {
  const businessId = getBusinessId(actor);
  const today = getTodayLocalDate();
  const upcomingDate = addDays(today, 3);
  await syncBusinessPaymentReminder(businessId);
  const [lowStockRows] = await Promise.all([
    pool.query(
      `SELECT id, name, stock, stock_minimo, stock_maximo
       FROM products
       WHERE business_id = $1 AND is_active = TRUE AND status = 'activo' AND stock_minimo > 0 AND stock <= stock_minimo`,
      [businessId]
    )
  ]);

  await syncConsolidatedLowStockReminder(lowStockRows.rows, actor);

  const [preventiveRows, appointmentRows] = await Promise.all([
    pool.query(
      `SELECT mpe.id, mpe.patient_id, mpe.event_type, mpe.product_name_snapshot, mpe.next_due_date, p.name AS patient_name
       FROM medical_preventive_events mpe
       INNER JOIN patients p ON p.id = mpe.patient_id AND p.business_id = mpe.business_id
       WHERE mpe.business_id = $1
         AND mpe.status <> 'cancelled'
         AND mpe.next_due_date BETWEEN $2::date AND $3::date`,
      [businessId, today, upcomingDate]
    ),
    pool.query(
      `SELECT ma.id, ma.patient_id, ma.appointment_date, ma.area, p.name AS patient_name
       FROM appointments ma
       INNER JOIN patients p ON p.id = ma.patient_id AND p.business_id = ma.business_id
       WHERE ma.business_id = $1
         AND ma.is_active = TRUE
         AND ma.status IN ('scheduled', 'confirmed')
         AND ma.appointment_date BETWEEN $2::date AND $3::date`,
      [businessId, today, upcomingDate]
    )
  ]);

  for (const event of preventiveRows.rows) {
    await upsertAutomaticReminder({
      source_key: `auto:clinical:${businessId}:preventive:${event.id}`,
      title: `${event.event_type === "vaccination" ? "Vacuna" : "Desparasitacion"} proxima: ${event.patient_name}`,
      notes: `${event.product_name_snapshot || "Evento preventivo"} programado para ${event.next_due_date}.`,
      due_date: event.next_due_date,
      reminder_type: event.event_type,
      category: "clinical",
      patient_id: event.patient_id,
      metadata: { preventive_event_id: event.id, event_type: event.event_type }
    }, actor);
  }

  for (const appointment of appointmentRows.rows) {
    await upsertAutomaticReminder({
      source_key: `auto:clinical:${businessId}:appointment:${appointment.id}`,
      title: `Cita proxima: ${appointment.patient_name}`,
      notes: `Area ${appointment.area}. Fecha ${appointment.appointment_date}.`,
      due_date: appointment.appointment_date,
      reminder_type: "appointment",
      category: "clinical",
      patient_id: appointment.patient_id,
      metadata: { appointment_id: appointment.id, area: appointment.area }
    }, actor);
  }
}

async function ensureLowStockRemindersForProductIds(productIds = [], actor) {
  const businessId = getBusinessId(actor);
  const normalizedIds = [...new Set(productIds.map(Number).filter(Boolean))];
  if (!normalizedIds.length) {
    await ensureAutomaticReminders(actor);
    return [];
  }
  const { rows } = await pool.query(
    `SELECT id, name, stock, stock_minimo, stock_maximo
     FROM products
     WHERE business_id = $1 AND is_active = TRUE AND status = 'activo' AND stock_minimo > 0 AND stock <= stock_minimo
     ORDER BY name ASC`,
    [businessId]
  );
  const consolidatedReminder = await syncConsolidatedLowStockReminder(rows, actor);
  const reminders = [];
  if (consolidatedReminder) {
    reminders.push(consolidatedReminder);
  }
  for (const product of rows) {
    if (!normalizedIds.includes(Number(product.id))) {
      continue;
    }
    await emitActorAutomationEvent(actor, "low_stock_detected", {
      product_id: product.id,
      name: product.name,
      sku: product.sku || "",
      stock: Number(product.stock || 0),
      stock_minimo: Number(product.stock_minimo || 0),
      source: "stock_threshold_check"
    });
  }
  return reminders;
}

function buildCollectionMessage(context) {
  const totalPaid = Number(context.initial_payment || 0) + Number(context.total_paid || 0);
  return `Recuerda que debes pagar ${context.product_names}. Debes ${Number(context.total).toFixed(2)}, llevas pagado ${totalPaid.toFixed(2)}`;
}

async function sendReminder(payload, actor) {
  const context = payload.sale_id ? await getReminderContext(Number(payload.sale_id), actor) : payload;
  const phone = normalizePhone(context.customer_phone || payload.phone);
  if (!phone || phone.length < 10) throw new ApiError(400, "Telefono invalido para recordatorio");
  const message = payload.message?.trim() || buildCollectionMessage(context);
  const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  let webhook = { attempted: false, success: false, message: "Webhook no configurado" };

  if (n8nWebhookUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(n8nWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sale_id: context.sale_id,
          customer_name: context.customer_name,
          customer_phone: phone,
          total: Number(context.total || 0),
          paid: Number(context.initial_payment || 0) + Number(context.total_paid || 0),
          balance_due: Number(context.balance_due || 0),
          message
        }),
        signal: controller.signal
      });
      webhook = { attempted: true, success: response.ok, message: response.ok ? "Webhook enviado" : "Webhook respondio con error" };
    } catch {
      webhook = { attempted: true, success: false, message: "No fue posible enviar al webhook" };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { whatsapp_url: whatsappUrl, message, webhook };
}

async function receiveAutomationWebhook(payload) {
  if (!payload || typeof payload !== "object") throw new ApiError(400, "Payload invalido");
  return { received: true, event: payload.event || payload.type || "unknown", timestamp: getMexicoCityDateTime(), timezone: TIME_ZONE, payload };
}

module.exports = {
  listReminders,
  listCalendarEvents,
  createReminder,
  updateReminder,
  completeReminder,
  deleteReminder,
  sendReminder,
  upsertSystemReminder,
  upsertAutomaticReminder,
  removeAutomaticReminder,
  cancelAutomaticReminder,
  ensureAutomaticReminders,
  ensureLowStockRemindersForProductIds,
  receiveAutomationWebhook
};
