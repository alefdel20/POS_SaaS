const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { n8nWebhookUrl } = require("../config/env");
const { getReminderContext } = require("./creditCollectionService");
const { emitActorAutomationEvent } = require("./automationEventService");
const { requireActorBusinessId } = require("../utils/tenant");
const { TIME_ZONE, getMexicoCityDate, getMexicoCityDateTime } = require("../utils/timezone");
const { saveAuditLog } = require("./auditLogService");
const { normalizeRole } = require("../utils/roles");
const { getNextFixedExpenseDueDate, normalizeFrequency } = require("../utils/fixedExpenseFrequency");
const {
  normalizeReminderCategory,
  normalizeReminderStatus
} = require("../utils/domainEnums");

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function addDays(dateString, days) {
  const baseDate = new Date(`${dateString}T12:00:00`);
  baseDate.setDate(baseDate.getDate() + days);
  return getMexicoCityDate(baseDate);
}

function getTodayLocalDate() {
  return getMexicoCityDate();
}

function getBusinessId(actor) {
  return requireActorBusinessId(actor);
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
     ORDER BY reminders.is_completed ASC, reminders.due_date ASC NULLS LAST, reminders.created_at DESC`,
    params
  );
  return rows;
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
  const status = normalizeReminderStatus(payload.status) || "pending";
  await assertReminderPatientAccess(payload.patient_id, businessId);
  const { rows } = await pool.query(
    `INSERT INTO reminders (title, notes, status, due_date, source_key, assigned_to, created_by, is_completed, business_id, reminder_type, category, patient_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [String(payload.title || "").trim(), String(payload.notes || "").trim(), status, payload.due_date || null, payload.source_key || null, payload.assigned_to || null, payload.created_by, payload.is_completed ?? false, businessId, payload.reminder_type || "general", category, payload.patient_id || null, JSON.stringify(payload.metadata || {})]
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
  assertClinicalReminderAccess({ category: nextCategory }, actor);
  await assertReminderPatientAccess(payload.patient_id ?? current.patient_id, businessId);

  const { rows } = await pool.query(
    `UPDATE reminders
     SET title = $1, notes = $2, status = $3, due_date = $4, assigned_to = $5, is_completed = $6, source_key = $7, reminder_type = $8, category = $9, patient_id = $10, metadata = $11, updated_at = NOW()
     WHERE id = $12 AND business_id = $13
     RETURNING *`,
    [String(payload.title ?? current.title ?? "").trim(), String(payload.notes ?? current.notes ?? "").trim(), nextStatus, payload.due_date ?? current.due_date, payload.assigned_to ?? current.assigned_to, payload.is_completed ?? current.is_completed, payload.source_key ?? current.source_key, payload.reminder_type ?? current.reminder_type, nextCategory, payload.patient_id ?? current.patient_id, JSON.stringify(payload.metadata ?? current.metadata ?? {}), id, businessId]
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
  const [lowStockRows, fixedExpenseRows] = await Promise.all([
    pool.query(
      `SELECT id, name, stock, stock_minimo, stock_maximo
       FROM products
       WHERE business_id = $1 AND is_active = TRUE AND status = 'activo' AND stock_minimo > 0 AND stock <= stock_minimo`,
      [businessId]
    ),
    pool.query(
      `SELECT id, name, category, default_amount, due_day, frequency
       FROM fixed_expenses
       WHERE business_id = $1 AND is_active = TRUE AND due_day IS NOT NULL AND due_day BETWEEN 1 AND 31`,
      [businessId]
    )
  ]);

  await syncConsolidatedLowStockReminder(lowStockRows.rows, actor);

  for (const expense of fixedExpenseRows.rows) {
    const dueDate = getNextFixedExpenseDueDate({
      due_day: expense.due_day,
      frequency: normalizeFrequency(expense.frequency)
    }, new Date(`${today}T12:00:00`));
    await pool.query(
      `DELETE FROM reminders
       WHERE business_id = $1
         AND source_key LIKE $2`,
      [businessId, `auto:fixed-expense:${businessId}:${expense.id}:%`]
    );
    if (!dueDate || dueDate < today || dueDate > upcomingDate) continue;
    await upsertAutomaticReminder({
      source_key: `finance:fixed-expense:${businessId}:${expense.id}:${dueDate}`,
      title: `Gasto proximo: ${expense.name}`,
      notes: `Vence el ${dueDate}. Categoria ${expense.category}. Monto estimado ${Number(expense.default_amount).toFixed(2)}.`,
      due_date: dueDate,
      metadata: {
        source_module: "fixed_expenses",
        fixed_expense_id: Number(expense.id),
        amount: Number(expense.default_amount || 0),
        category: expense.category || "General",
        frequency: normalizeFrequency(expense.frequency)
      }
    }, actor);
  }

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
