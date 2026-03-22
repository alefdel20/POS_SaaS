const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { recomputeDailyCut } = require("./dailyCutService");
const { requireActorBusinessId } = require("../utils/tenant");

async function listDebtors(actor) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `SELECT
       sales.id AS sale_id,
       sales.sale_date,
       sales.customer_name AS person,
       sales.customer_phone AS phone,
       sales.total,
       sales.initial_payment,
       sales.balance_due,
       sales.send_reminder,
       COALESCE(SUM(credit_payments.amount), 0) AS total_paid
     FROM sales
     LEFT JOIN credit_payments ON credit_payments.sale_id = sales.id AND credit_payments.business_id = sales.business_id
     WHERE sales.payment_method = 'credit'
       AND sales.business_id = $1
     GROUP BY sales.id
     HAVING sales.balance_due > 0
     ORDER BY sales.sale_date DESC, sales.id DESC`,
    [businessId]
  );
  return rows;
}

async function updateReminderPreference(saleId, sendReminder, actor) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `UPDATE sales
     SET send_reminder = $1
     WHERE id = $2 AND payment_method = 'credit' AND business_id = $3
     RETURNING id AS sale_id, send_reminder`,
    [sendReminder, saleId, businessId]
  );
  if (!rows[0]) throw new ApiError(404, "Credit sale not found");
  return rows[0];
}

async function getReminderContext(saleId, actor) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `SELECT
       sales.id AS sale_id,
       sales.customer_name,
       sales.customer_phone,
       sales.total,
       sales.initial_payment,
       sales.balance_due,
       sales.send_reminder,
       COALESCE(SUM(credit_payments.amount), 0) AS total_paid,
       COALESCE(STRING_AGG(DISTINCT products.name, ', '), 'tu compra') AS product_names
     FROM sales
     LEFT JOIN credit_payments ON credit_payments.sale_id = sales.id AND credit_payments.business_id = sales.business_id
     LEFT JOIN sale_items ON sale_items.sale_id = sales.id AND sale_items.business_id = sales.business_id
     LEFT JOIN products ON products.id = sale_items.product_id AND products.business_id = sales.business_id
     WHERE sales.id = $1 AND sales.payment_method = 'credit' AND sales.business_id = $2
     GROUP BY sales.id`,
    [saleId, businessId]
  );
  if (!rows[0]) throw new ApiError(404, "Credit sale not found");
  return rows[0];
}

async function listPaymentsBySale(saleId, actor) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `SELECT id, sale_id, payment_date, amount, payment_method, notes, created_at
     FROM credit_payments
     WHERE sale_id = $1 AND business_id = $2
     ORDER BY payment_date DESC, id DESC`,
    [saleId, businessId]
  );
  return rows;
}

async function createPayment(saleId, payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: saleRows } = await client.query(
      "SELECT * FROM sales WHERE id = $1 AND payment_method = 'credit' AND business_id = $2",
      [saleId, businessId]
    );
    const sale = saleRows[0];
    if (!sale) throw new ApiError(404, "Credit sale not found");
    const amount = Number(payload.amount);
    if (amount <= 0) throw new ApiError(400, "Payment amount must be greater than zero");

    const { rows: paymentRows } = await client.query(
      `INSERT INTO credit_payments (sale_id, business_id, payment_date, amount, payment_method, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [saleId, businessId, payload.payment_date || new Date().toISOString().slice(0, 10), amount, payload.payment_method, payload.notes || ""]
    );
    const { rows: totalsRows } = await client.query(
      "SELECT COALESCE(SUM(amount), 0) AS paid FROM credit_payments WHERE sale_id = $1 AND business_id = $2",
      [saleId, businessId]
    );
    const totalPaid = Number(sale.initial_payment || 0) + Number(totalsRows[0]?.paid || 0);
    const balanceDue = Math.max(Number(sale.total) - totalPaid, 0);
    const { rows: updatedRows } = await client.query(
      "UPDATE sales SET balance_due = $1 WHERE id = $2 AND business_id = $3 RETURNING *",
      [balanceDue, saleId, businessId]
    );
    await client.query("COMMIT");
    await recomputeDailyCut(sale.sale_date, actor);
    return { payment: paymentRows[0], sale: updatedRows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { listDebtors, listPaymentsBySale, createPayment, updateReminderPreference, getReminderContext };
