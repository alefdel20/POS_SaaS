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

function normalizeDebtorSearchKey(name, phone) {
  const normalizedName = String(name || "").trim().toLowerCase();
  const normalizedPhone = String(phone || "").replace(/\D/g, "");
  return `${normalizedName}::${normalizedPhone}`;
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
    conditions.push("sales.sale_date::date < CURRENT_DATE");
  }

  const query = `
    SELECT
      sales.id AS sale_id,
      sales.sale_date,
      sales.customer_name AS person,
      sales.customer_phone AS phone,
      sales.total,
      sales.initial_payment,
      sales.balance_due,
      sales.send_reminder,
      COALESCE(SUM(credit_payments.amount), 0) AS total_paid,
      GREATEST(CURRENT_DATE - sales.sale_date::date, 0) AS days_overdue,
      CASE
        WHEN sales.balance_due <= 0 THEN 'settled'
        WHEN sales.sale_date::date < CURRENT_DATE THEN 'overdue'
        ELSE 'pending'
      END AS status
    FROM sales
    LEFT JOIN credit_payments
      ON credit_payments.sale_id = sales.id
      AND credit_payments.business_id = sales.business_id
    WHERE ${conditions.join(" AND ")}
    GROUP BY sales.id
    HAVING sales.balance_due > 0
    ORDER BY sales.sale_date DESC, sales.id DESC
  `;

  const { rows } = await pool.query(query, values);
  return rows;
}

async function updateReminderPreference(saleId, sendReminder, actor) {
  ensureCreditCollectionsEnabled(actor);
  const businessId = requireActorBusinessId(actor);

  const { rows } = await pool.query(
    `UPDATE sales
     SET send_reminder = $1
     WHERE id = $2
       AND payment_method = 'credit'
       AND business_id = $3
       AND ${VALID_SALE_STATUS_SQL}
     RETURNING id AS sale_id, send_reminder`,
    [sendReminder, saleId, businessId]
  );

  if (!rows[0]) {
    throw new ApiError(404, "Credit sale not found");
  }

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
       COALESCE(STRING_AGG(DISTINCT COALESCE(NULLIF(sale_items.product_name_snapshot, ''), products.name), ', '), 'tu compra') AS product_names
     FROM sales
     LEFT JOIN credit_payments
       ON credit_payments.sale_id = sales.id
      AND credit_payments.business_id = sales.business_id
     LEFT JOIN sale_items
       ON sale_items.sale_id = sales.id
      AND sale_items.business_id = sales.business_id
     LEFT JOIN products
       ON products.id = sale_items.product_id
      AND products.business_id = sales.business_id
     WHERE sales.id = $1
       AND sales.payment_method = 'credit'
       AND sales.business_id = $2
       AND ${VALID_SALE_STATUS_SQL}
     GROUP BY sales.id`,
    [saleId, businessId]
  );

  if (!rows[0]) {
    throw new ApiError(404, "Credit sale not found");
  }

  return rows[0];
}

async function listPaymentsBySale(saleId, actor) {
  ensureCreditCollectionsEnabled(actor);
  const businessId = requireActorBusinessId(actor);

  const { rows } = await pool.query(
    `SELECT
       credit_payments.id,
       credit_payments.sale_id,
       credit_payments.payment_date,
       credit_payments.amount,
       credit_payments.payment_method,
       credit_payments.notes,
       credit_payments.created_at,
       sales.total AS sale_total,
       sales.balance_due,
       sales.customer_name,
       sales.customer_phone,
       COALESCE(items.items, '[]'::json) AS sale_items
     FROM credit_payments
     INNER JOIN sales
       ON sales.id = credit_payments.sale_id
      AND sales.business_id = credit_payments.business_id
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
         'product_id', sale_items.product_id,
         'product_name', COALESCE(NULLIF(sale_items.product_name_snapshot, ''), products.name),
         'quantity', sale_items.quantity,
         'unidad_de_venta', sale_items.unidad_de_venta,
         'unit_price', sale_items.unit_price,
         'subtotal', sale_items.subtotal
       ) ORDER BY sale_items.id ASC) AS items
       FROM sale_items
       INNER JOIN products
         ON products.id = sale_items.product_id
        AND products.business_id = sale_items.business_id
       WHERE sale_items.sale_id = sales.id
         AND sale_items.business_id = sales.business_id
     ) items ON TRUE
     WHERE credit_payments.sale_id = $1 AND credit_payments.business_id = $2
     ORDER BY credit_payments.payment_date DESC, credit_payments.id DESC`,
    [saleId, businessId]
  );

  return rows.map((row) => ({
    ...row,
    amount: Number(row.amount || 0),
    sale_total: Number(row.sale_total || 0),
    balance_due: Number(row.balance_due || 0),
    sale_items: Array.isArray(row.sale_items) ? row.sale_items.map((item) => ({
      ...item,
      quantity: Number(item.quantity || 0),
      unit_price: Number(item.unit_price || 0),
      subtotal: Number(item.subtotal || 0)
    })) : []
  }));
}

async function listDebtorSuggestions(actor, search = "") {
  ensureCreditCollectionsEnabled(actor);
  const businessId = requireActorBusinessId(actor);
  const term = String(search || "").trim();
  if (!term) {
    return [];
  }

  const { rows } = await pool.query(
    `SELECT
       sales.customer_name,
       sales.customer_phone,
       COUNT(*)::int AS sale_count,
       COALESCE(SUM(sales.balance_due), 0) AS pending_balance,
       MAX(sales.sale_date) AS last_sale_date
     FROM sales
     WHERE sales.business_id = $1
       AND sales.payment_method = 'credit'
       AND COALESCE(sales.status, 'completed') <> 'cancelled'
       AND (
         COALESCE(sales.customer_name, '') ILIKE $2
         OR COALESCE(sales.customer_phone, '') ILIKE $2
       )
       AND COALESCE(sales.customer_name, '') <> ''
     GROUP BY sales.customer_name, sales.customer_phone
     ORDER BY MAX(sales.sale_date) DESC, sales.customer_name ASC
     LIMIT 8`,
    [businessId, `%${term}%`]
  );

  const deduped = new Map();
  rows.forEach((row) => {
    const key = normalizeDebtorSearchKey(row.customer_name, row.customer_phone);
    if (!deduped.has(key)) {
      const phone = row.customer_phone || null;
      deduped.set(key, {
        match_key: key,
        customer_name: row.customer_name,
        customer_phone: phone,
        sale_count: Number(row.sale_count || 0),
        pending_balance: Number(row.pending_balance || 0),
        last_sale_date: row.last_sale_date,
        selection_label: phone ? `${row.customer_name} · ${phone}` : row.customer_name
      });
    }
  });
  return Array.from(deduped.values());
}

async function getCreditSaleSummary(saleId, actor) {
  ensureCreditCollectionsEnabled(actor);
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `SELECT
       sales.id AS sale_id,
       sales.sale_date,
       sales.customer_name,
       sales.customer_phone,
       sales.total,
       sales.initial_payment,
       sales.balance_due,
       COALESCE(payments.total_paid, 0) AS total_paid,
       COALESCE(items.items, '[]'::json) AS items
     FROM sales
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(credit_payments.amount), 0) AS total_paid
       FROM credit_payments
       WHERE credit_payments.sale_id = sales.id
         AND credit_payments.business_id = sales.business_id
     ) payments ON TRUE
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
         'product_id', sale_items.product_id,
         'product_name', COALESCE(NULLIF(sale_items.product_name_snapshot, ''), products.name),
         'quantity', sale_items.quantity,
         'unidad_de_venta', sale_items.unidad_de_venta,
         'unit_price', sale_items.unit_price,
         'subtotal', sale_items.subtotal
       ) ORDER BY sale_items.id ASC) AS items
       FROM sale_items
       INNER JOIN products
         ON products.id = sale_items.product_id
        AND products.business_id = sale_items.business_id
       WHERE sale_items.sale_id = sales.id
         AND sale_items.business_id = sales.business_id
     ) items ON TRUE
     WHERE sales.id = $1
       AND sales.business_id = $2
       AND sales.payment_method = 'credit'
       AND ${VALID_SALE_STATUS_SQL}`,
    [saleId, businessId]
  );

  if (!rows[0]) {
    throw new ApiError(404, "Credit sale not found");
  }

  return {
    sale_id: Number(rows[0].sale_id),
    sale_date: rows[0].sale_date,
    customer_name: rows[0].customer_name || null,
    customer_phone: rows[0].customer_phone || null,
    total: Number(rows[0].total || 0),
    initial_payment: Number(rows[0].initial_payment || 0),
    total_paid: Number(rows[0].total_paid || 0),
    balance_due: Number(rows[0].balance_due || 0),
    items: Array.isArray(rows[0].items) ? rows[0].items.map((item) => ({
      ...item,
      quantity: Number(item.quantity || 0),
      unit_price: Number(item.unit_price || 0),
      subtotal: Number(item.subtotal || 0)
    })) : []
  };
}

async function createPayment(saleId, payload, actor) {
  ensureCreditCollectionsEnabled(actor);
  const businessId = requireActorBusinessId(actor);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows: saleRows } = await client.query(
      `SELECT *
       FROM sales
       WHERE id = $1
         AND payment_method = 'credit'
         AND business_id = $2
         AND COALESCE(status, 'completed') <> 'cancelled'
       FOR UPDATE`,
      [saleId, businessId]
    );

    const sale = saleRows[0];

    if (!sale) {
      throw new ApiError(404, "Credit sale not found");
    }

    const amount = Number(payload.amount);

    if (amount <= 0) {
      throw new ApiError(400, "Payment amount must be greater than zero");
    }

    const { rows: totalsRows } = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid
       FROM credit_payments
       WHERE sale_id = $1 AND business_id = $2`,
      [saleId, businessId]
    );

    const totalPaidBeforePayment = Number(sale.initial_payment || 0) + Number(totalsRows[0]?.paid || 0);
    const authoritativeBalanceDue = Math.max(Number(sale.total || 0) - totalPaidBeforePayment, 0);

    if (amount > authoritativeBalanceDue) {
      throw new ApiError(400, "Payment amount cannot exceed pending balance");
    }

    const paymentDate = payload.payment_date || getMexicoCityDate();

    const { rows: paymentRows } = await client.query(
      `INSERT INTO credit_payments (sale_id, business_id, payment_date, amount, payment_method, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        saleId,
        businessId,
        paymentDate,
        amount,
        payload.payment_method,
        payload.notes || ""
      ]
    );

    const totalPaid = totalPaidBeforePayment + amount;
    const balanceDue = Math.max(Number(sale.total) - totalPaid, 0);

    const { rows: updatedRows } = await client.query(
      `UPDATE sales
       SET balance_due = $1
       WHERE id = $2 AND business_id = $3
       RETURNING *`,
      [balanceDue, saleId, businessId]
    );

    await emitActorAutomationEvent(
      actor,
      "credit_payment_received",
      {
        sale_id: saleId,
        payment_id: paymentRows[0].id,
        amount,
        payment_method: payload.payment_method,
        payment_date: paymentDate,
        previous_balance_due: authoritativeBalanceDue,
        balance_due: Number(balanceDue)
      },
      { client }
    );

    await client.query("COMMIT");
    await recomputeDailyCut(paymentDate, actor);
    if (paymentDate !== sale.sale_date) {
      await recomputeDailyCut(sale.sale_date, actor);
    }

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
  listDebtorSuggestions,
  listPaymentsBySale,
  getCreditSaleSummary,
  createPayment,
  updateReminderPreference,
  getReminderContext
};
