const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { n8nWebhookUrl } = require("../config/env");
const { getReminderContext } = require("./creditCollectionService");

async function listReminders() {
  const { rows } = await pool.query(
    `SELECT reminders.*, users.full_name AS assigned_to_name
     FROM reminders
     LEFT JOIN users ON users.id = reminders.assigned_to
     ORDER BY reminders.is_completed ASC, reminders.due_date ASC NULLS LAST, reminders.created_at DESC`
  );
  return rows;
}

async function createReminder(payload) {
  const { rows } = await pool.query(
    `INSERT INTO reminders (title, notes, status, due_date, assigned_to, created_by, is_completed)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      payload.title,
      payload.notes || "",
      payload.status || "pending",
      payload.due_date || null,
      payload.assigned_to || null,
      payload.created_by,
      payload.is_completed ?? false
    ]
  );
  return rows[0];
}

async function updateReminder(id, payload) {
  const { rows: existingRows } = await pool.query("SELECT * FROM reminders WHERE id = $1", [id]);
  const current = existingRows[0];

  if (!current) {
    throw new ApiError(404, "Reminder not found");
  }

  const { rows } = await pool.query(
    `UPDATE reminders
     SET title = $1, notes = $2, status = $3, due_date = $4, assigned_to = $5, is_completed = $6, updated_at = NOW()
     WHERE id = $7
     RETURNING *`,
    [
      payload.title ?? current.title,
      payload.notes ?? current.notes,
      payload.status ?? current.status,
      payload.due_date ?? current.due_date,
      payload.assigned_to ?? current.assigned_to,
      payload.is_completed ?? current.is_completed,
      id
    ]
  );
  return rows[0];
}

async function completeReminder(id) {
  const { rows } = await pool.query(
    `UPDATE reminders
     SET is_completed = TRUE, status = 'completed', updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id]
  );

  if (!rows[0]) {
    throw new ApiError(404, "Reminder not found");
  }

  return rows[0];
}

async function deleteReminder(id) {
  const { rows } = await pool.query(
    `DELETE FROM reminders
     WHERE id = $1
     RETURNING *`,
    [id]
  );

  if (!rows[0]) {
    throw new ApiError(404, "Reminder not found");
  }

  return rows[0];
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function buildCollectionMessage(context) {
  const totalPaid = Number(context.initial_payment || 0) + Number(context.total_paid || 0);
  return `Recuerda que debes pagar ${context.product_names}. Debes ${Number(context.total).toFixed(2)}, llevas pagado ${totalPaid.toFixed(2)}`;
}

async function sendReminder(payload) {
  const context = payload.sale_id ? await getReminderContext(Number(payload.sale_id)) : payload;
  const phone = normalizePhone(context.customer_phone || payload.phone);

  if (!phone || phone.length < 10) {
    throw new ApiError(400, "Telefono invalido para recordatorio");
  }

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

      webhook = {
        attempted: true,
        success: response.ok,
        message: response.ok ? "Webhook enviado" : "Webhook respondio con error"
      };
    } catch (_error) {
      webhook = {
        attempted: true,
        success: false,
        message: "No fue posible enviar al webhook"
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    whatsapp_url: whatsappUrl,
    message,
    webhook
  };
}

module.exports = {
  listReminders,
  createReminder,
  updateReminder,
  completeReminder,
  deleteReminder,
  sendReminder
};
