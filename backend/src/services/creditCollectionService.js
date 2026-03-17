const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { recomputeDailyCut } = require("./dailyCutService");

async function listDebtors() {
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
     LEFT JOIN credit_payments ON credit_payments.sale_id = sales.id
     WHERE sales.payment_method = 'credit'
     GROUP BY sales.id
     HAVING sales.balance_due > 0
     ORDER BY sales.sale_date DESC, sales.id DESC`
  );
  return rows;
}

async function updateReminderPreference(saleId, sendReminder) {
  const { rows } = await pool.query(
    `UPDATE sales
     SET send_reminder = $1
     WHERE id = $2 AND payment_method = 'credit'
     RETURNING id AS sale_id, send_reminder`,
    [sendReminder, saleId]
  );

  if (!rows[0]) {
    throw new ApiError(404, "Credit sale not found");
  }

  return rows[0];
}

async function getReminderContext(saleId) {
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
     LEFT JOIN credit_payments ON credit_payments.sale_id = sales.id
     LEFT JOIN sale_items ON sale_items.sale_id = sales.id
     LEFT JOIN products ON products.id = sale_items.product_id
     WHERE sales.id = $1 AND sales.payment_method = 'credit'
     GROUP BY sales.id`,
    [saleId]
  );

  if (!rows[0]) {
    throw new ApiError(404, "Credit sale not found");
  }

  return rows[0];
}

async function listPaymentsBySale(saleId) {
  const { rows } = await pool.query(
    `SELECT id, sale_id, payment_date, amount, payment_method, notes, created_at
     FROM credit_payments
     WHERE sale_id = $1
     ORDER BY payment_date DESC, id DESC`,
    [saleId]
  );
  return rows;
}

async function createPayment(saleId, payload) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows: saleRows } = await client.query(
      "SELECT * FROM sales WHERE id = $1 AND payment_method = 'credit'",
      [saleId]
    );
    const sale = saleRows[0];

    if (!sale) {
      throw new ApiError(404, "Credit sale not found");
    }

    const amount = Number(payload.amount);
    if (amount <= 0) {
      throw new ApiError(400, "Payment amount must be greater than zero");
    }

    const { rows: paymentRows } = await client.query(
      `INSERT INTO credit_payments (sale_id, payment_date, amount, payment_method, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        saleId,
        payload.payment_date || new Date().toISOString().slice(0, 10),
        amount,
        payload.payment_method,
        payload.notes || ""
      ]
    );

    const { rows: totalsRows } = await client.query(
      "SELECT COALESCE(SUM(amount), 0) AS paid FROM credit_payments WHERE sale_id = $1",
      [saleId]
    );
    const totalPaid = Number(sale.initial_payment || 0) + Number(totalsRows[0]?.paid || 0);
    const balanceDue = Math.max(Number(sale.total) - totalPaid, 0);

    const { rows: updatedRows } = await client.query(
      "UPDATE sales SET balance_due = $1 WHERE id = $2 RETURNING *",
      [balanceDue, saleId]
    );

    await client.query("COMMIT");
    await recomputeDailyCut(sale.sale_date);

    return {
      payment: paymentRows[0],
      sale: updatedRows[0]
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  listDebtors,
  listPaymentsBySale,
  createPayment,
  updateReminderPreference,
  getReminderContext
};
