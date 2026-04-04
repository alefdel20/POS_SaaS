const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { recomputeDailyCut } = require("./dailyCutService");
const { requireActorBusinessId } = require("../utils/tenant");
const { getMexicoCityDate } = require("../utils/timezone");
const { canUseCreditCollections } = require("../utils/business");
const { emitActorAutomationEvent } = require("./automationEventService");

const VALID_SALE_STATUS_SQL = "COALESCE(sales.status, 'completed') <> 'cancelled'";

function ensureCreditCollectionsEnabled(actor) {
  if (!canUseCreditCollections(actor?.pos_type)) {
    throw new ApiError(403, "Credit collections are not available for this business type");
  }
}

async function listDebtors(actor, filters = {}) {
  ensureCreditCollectionsEnabled(actor);
  const businessId = requireActorBusinessId(actor);
  const values = [businessId];
  const conditions = [
    "sales.payment_method = 'credit'",
    "sales.business_id = $1",
    VALID_SALE_STATUS_SQL
  ];

  if (filters.search) {
    values.push(`%${String(filters.search).trim()}%`);
    conditions.push(`(
      COALESCE(sales.customer_name, '') ILIKE $${values.length}
      OR COALESCE(sales.customer_phone, '') ILIKE $${values.length}
      OR CAST(sales.id AS TEXT) ILIKE $${values.length}
    )`);
  }

  if (String(filters.status || "") === "overdue") {
    conditions.push("sales.sale_date < CURRENT_DATE");
  }

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
       COALESCE(SUM(credit_payments.amount), 0) AS total_paid,
       GREATEST(CURRENT_DATE - sales.sale_date, 0) AS days_overdue,
       CASE
         WHEN sales.balance_due <= 0 THEN 'settled'
         WHEN sales.sale_date < CURRENT_DATE THEN 'overdue'
         ELSE 'pending'
       END AS status
     FROM sales
     LEFT JOIN credit_payments ON credit_payments.sale_id = sales.id AND credit_payments.business_id = sales.business_id
     WHERE ${conditions.join(" AND ")}
     GROUP BY sales.id
     HAVING sales.balance_due > 0
     ORDER BY sales.sale_date DESC, sales.id DESC`,
    values
  );
  return rows;
}

async function updateReminderPreference(saleId, sendReminder, actor) {
  ensureCreditCollectionsEnabled(actor);
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `UPDATE sales
     SET send_reminder = $1
     WHERE id = $2 AND payment_method = 'credit' AND business_id = $3
       AND ${VALID_SALE_STATUS_SQL}
     RETURNING id AS sale_id, send_reminder`,
    [sendReminder, saleId, businessId]
  );
  if (!rows[0]) throw new ApiError(404, "Credit sale not found");
  return rows[0];
}

async function getReminderContext(saleId, actor) {
  ensureCreditCollectionsEnabled(actor);
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
       AND ${VALID_SALE_STATUS_SQL}
     GROUP BY sales.id`,
    [saleId, businessId]
  );
  if (!rows[0]) throw new ApiError(404, "Credit sale not found");
  return rows[0];
}

async function listPaymentsBySale(saleId, actor) {
  ensureCreditCollectionsEnabled(actor);
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
  ensureCreditCollectionsEnabled(actor);
  const businessId = requireActorBusinessId(actor);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: saleRows } = await client.query(
      "SELECT * FROM sales WHERE id = $1 AND payment_method = 'credit' AND business_id = $2 AND COALESCE(status, 'completed') <> 'cancelled'",
      [saleId, businessId]
    );
    const sale = saleRows[0];
    if (!sale) throw new ApiError(404, "Credit sale not found");
    const amount = Number(payload.amount);
    if (amount <= 0) throw new ApiError(400, "Payment amount must be greater than zero");
    if (amount > Number(sale.balance_due || 0)) throw new ApiError(400, "Payment amount cannot exceed pending balance");

    const { rows: paymentRows } = await client.query(
      `INSERT INTO credit_payments (sale_id, business_id, payment_date, amount, payment_method, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [saleId, businessId, payload.payment_date || getMexicoCityDate(), amount, payload.payment_method, payload.notes || ""]
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
    await emitActorAutomationEvent(actor, "credit_payment_received", {
      sale_id: saleId,
      payment_id: paymentRows[0].id,
      amount,
      payment_method: payload.payment_method,
      payment_date: payload.payment_date || getMexicoCityDate(),
      previous_balance_due: Number(sale.balance_due || 0),
      balance_due: Number(balanceDue)
    }, { client });
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
