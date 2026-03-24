const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { n8nWebhookUrl } = require("../config/env");
const { getReminderContext } = require("./creditCollectionService");
const { requireActorBusinessId } = require("../utils/tenant");
const { TIME_ZONE, getMexicoCityDate, getMexicoCityDateTime } = require("../utils/timezone");

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

async function listReminders(actor) {
  await ensureAutomaticReminders(actor);
  const businessId = getBusinessId(actor);
  const { rows } = await pool.query(
    `SELECT reminders.*, users.full_name AS assigned_to_name
     FROM reminders
     LEFT JOIN users ON users.id = reminders.assigned_to AND users.business_id = reminders.business_id
     WHERE reminders.business_id = $1
     ORDER BY reminders.is_completed ASC, reminders.due_date ASC NULLS LAST, reminders.created_at DESC`,
    [businessId]
  );
  return rows;
}

async function createReminder(payload, actor) {
  const businessId = getBusinessId(actor);
  const { rows } = await pool.query(
    `INSERT INTO reminders (title, notes, status, due_date, source_key, assigned_to, created_by, is_completed, business_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [payload.title, payload.notes || "", payload.status || "pending", payload.due_date || null, payload.source_key || null, payload.assigned_to || null, payload.created_by, payload.is_completed ?? false, businessId]
  );
  return rows[0];
}

async function updateReminder(id, payload, actor) {
  const businessId = getBusinessId(actor);
  const { rows: existingRows } = await pool.query("SELECT * FROM reminders WHERE id = $1 AND business_id = $2", [id, businessId]);
  const current = existingRows[0];
  if (!current) throw new ApiError(404, "Reminder not found");

  const { rows } = await pool.query(
    `UPDATE reminders
     SET title = $1, notes = $2, status = $3, due_date = $4, assigned_to = $5, is_completed = $6, source_key = $7, updated_at = NOW()
     WHERE id = $8 AND business_id = $9
     RETURNING *`,
    [payload.title ?? current.title, payload.notes ?? current.notes, payload.status ?? current.status, payload.due_date ?? current.due_date, payload.assigned_to ?? current.assigned_to, payload.is_completed ?? current.is_completed, payload.source_key ?? current.source_key, id, businessId]
  );
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

async function upsertAutomaticReminder(payload, actor) {
  const businessId = getBusinessId(actor);
  const { rows: existingRows } = await pool.query("SELECT * FROM reminders WHERE source_key = $1 AND business_id = $2 LIMIT 1", [payload.source_key, businessId]);
  if (existingRows[0]) {
    const { rows } = await pool.query(
      `UPDATE reminders
       SET title = $1, notes = $2, due_date = $3, status = CASE WHEN is_completed THEN status ELSE 'pending' END,
           is_completed = CASE WHEN is_completed THEN is_completed ELSE FALSE END, updated_at = NOW()
       WHERE source_key = $4 AND business_id = $5
       RETURNING *`,
      [payload.title, payload.notes || "", payload.due_date || null, payload.source_key, businessId]
    );
    return rows[0];
  }
  const { rows } = await pool.query(
    `INSERT INTO reminders (title, notes, status, due_date, source_key, assigned_to, created_by, is_completed, business_id)
     VALUES ($1, $2, 'pending', $3, $4, NULL, NULL, FALSE, $5)
     RETURNING *`,
    [payload.title, payload.notes || "", payload.due_date || null, payload.source_key, businessId]
  );
  return rows[0];
}

async function ensureAutomaticReminders(actor) {
  const businessId = getBusinessId(actor);
  const today = getTodayLocalDate();
  const upcomingDate = addDays(today, 3);
  const [lowStockRows, fixedExpenseRows] = await Promise.all([
    pool.query(
      `SELECT id, name, sku, stock, stock_minimo
       FROM products
       WHERE business_id = $1 AND is_active = TRUE AND status = 'activo' AND stock_minimo > 0 AND stock <= stock_minimo`,
      [businessId]
    ),
    pool.query(
      `SELECT id, name, category, default_amount, due_day
       FROM fixed_expenses
       WHERE business_id = $1 AND is_active = TRUE AND due_day IS NOT NULL AND due_day BETWEEN 1 AND 31`,
      [businessId]
    )
  ]);

  for (const product of lowStockRows.rows) {
    await upsertAutomaticReminder({
      source_key: `auto:stock-low:${businessId}:${product.id}`,
      title: `STOCK BAJO: ${product.name}`,
      notes: `El producto con SKU: ${product.sku || "-"} ha llegado a su nivel minimo (${Number(product.stock_minimo)}). Stock actual: ${Number(product.stock)}.`,
      due_date: today
    }, actor);
  }

  const upcomingDay = Number(upcomingDate.slice(-2));
  for (const expense of fixedExpenseRows.rows) {
    if (Number(expense.due_day) !== upcomingDay) continue;
    await upsertAutomaticReminder({
      source_key: `auto:fixed-expense:${businessId}:${expense.id}:${upcomingDate.slice(0, 7)}`,
      title: `Gasto proximo: ${expense.name}`,
      notes: `Vence el ${upcomingDate}. Categoria ${expense.category}. Monto estimado ${Number(expense.default_amount).toFixed(2)}.`,
      due_date: upcomingDate
    }, actor);
  }
}

async function ensureLowStockRemindersForProductIds(productIds = [], actor) {
  const businessId = getBusinessId(actor);
  const normalizedIds = [...new Set(productIds.map(Number).filter(Boolean))];
  if (!normalizedIds.length) return [];
  const { rows } = await pool.query(
    `SELECT id, name, sku, stock, stock_minimo
     FROM products
     WHERE business_id = $1 AND id = ANY($2::int[]) AND is_active = TRUE AND status = 'activo' AND stock_minimo >= 0 AND stock <= stock_minimo`,
    [businessId, normalizedIds]
  );
  const today = getTodayLocalDate();
  const reminders = [];
  for (const product of rows) {
    reminders.push(await upsertAutomaticReminder({
      source_key: `auto:stock-low:${businessId}:${product.id}`,
      title: `STOCK BAJO: ${product.name}`,
      notes: `El producto con SKU: ${product.sku || "-"} ha llegado a su nivel minimo (${Number(product.stock_minimo)}). Stock actual: ${Number(product.stock)}.`,
      due_date: today
    }, actor));
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
  ensureAutomaticReminders,
  ensureLowStockRemindersForProductIds,
  receiveAutomationWebhook
};
