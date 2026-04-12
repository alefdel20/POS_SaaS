const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");

const HISTORY_TYPES = new Set([
  "all",
  "sales",
  "credit_collections",
  "invoice_payments",
  "expenses",
  "fixed_expenses",
  "owner_debt"
]);

function normalizeHistoryType(value) {
  const normalized = String(value || "all").trim().toLowerCase() || "all";
  if (!HISTORY_TYPES.has(normalized)) {
    throw new ApiError(400, "Invalid history type");
  }
  return normalized;
}

function normalizeExactAmount(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ApiError(400, "Invalid total filter");
  }
  return parsed;
}

function appendDateConditions(conditions, values, columnExpression, filters) {
  if (filters.date) {
    values.push(String(filters.date));
    conditions.push(`${columnExpression} = $${values.length}::date`);
  }
  if (filters.date_from) {
    values.push(String(filters.date_from));
    conditions.push(`${columnExpression} >= $${values.length}::date`);
  }
  if (filters.date_to) {
    values.push(String(filters.date_to));
    conditions.push(`${columnExpression} <= $${values.length}::date`);
  }
}

async function listHistory(filters = {}, actor) {
  const businessId = requireActorBusinessId(actor);
  const movementType = normalizeHistoryType(filters.type);
  const values = [businessId];
  const include = (type) => movementType === "all" || movementType === type;
  const unionSegments = [];

  if (include("sales")) {
    const conditions = [
      "sales.business_id = $1",
      "COALESCE(sales.sale_type, 'ticket') <> 'invoice'"
    ];
    appendDateConditions(conditions, values, "sales.sale_date::date", filters);
    unionSegments.push(
      `SELECT
         CONCAT('sale-', sales.id)::text AS id,
         sales.sale_date::date AS date,
         'sales'::text AS type,
         CAST(sales.id AS text) AS reference,
         CASE
           WHEN COALESCE(NULLIF(sales.customer_name, ''), '') <> '' THEN CONCAT('Venta a ', sales.customer_name)
           ELSE 'Venta de mostrador'
         END AS concept,
         sales.payment_method::text AS payment_method,
         sales.total::numeric AS amount,
         sales.id::int AS sale_id,
         users.full_name AS cashier_name,
         COALESCE(sales.status, 'completed')::text AS status,
         sales.created_at
       FROM sales
       INNER JOIN users
         ON users.id = sales.user_id
        AND users.business_id = sales.business_id
       WHERE ${conditions.join(" AND ")}`
    );
  }

  if (include("invoice_payments")) {
    const conditions = [
      "sales.business_id = $1",
      "COALESCE(sales.sale_type, 'ticket') = 'invoice'"
    ];
    appendDateConditions(conditions, values, "sales.sale_date::date", filters);
    unionSegments.push(
      `SELECT
         CONCAT('invoice-payment-', sales.id)::text AS id,
         sales.sale_date::date AS date,
         'invoice_payments'::text AS type,
         CAST(sales.id AS text) AS reference,
         CASE
           WHEN COALESCE(NULLIF(sales.customer_name, ''), '') <> '' THEN CONCAT('Pago de factura - ', sales.customer_name)
           ELSE 'Pago de factura'
         END AS concept,
         sales.payment_method::text AS payment_method,
         sales.total::numeric AS amount,
         sales.id::int AS sale_id,
         users.full_name AS cashier_name,
         COALESCE(sales.status, 'completed')::text AS status,
         sales.created_at
       FROM sales
       INNER JOIN users
         ON users.id = sales.user_id
        AND users.business_id = sales.business_id
       WHERE ${conditions.join(" AND ")}`
    );
  }

  if (include("credit_collections")) {
    const conditions = ["credit_payments.business_id = $1"];
    appendDateConditions(conditions, values, "credit_payments.payment_date::date", filters);
    unionSegments.push(
      `SELECT
         CONCAT('credit-payment-', credit_payments.id)::text AS id,
         credit_payments.payment_date::date AS date,
         'credit_collections'::text AS type,
         CAST(credit_payments.sale_id AS text) AS reference,
         COALESCE(NULLIF(credit_payments.notes, ''), CONCAT('Abono a venta #', credit_payments.sale_id::text)) AS concept,
         credit_payments.payment_method::text AS payment_method,
         credit_payments.amount::numeric AS amount,
         credit_payments.sale_id::int AS sale_id,
         NULL::text AS cashier_name,
         NULL::text AS status,
         credit_payments.created_at
       FROM credit_payments
       WHERE ${conditions.join(" AND ")}`
    );
  }

  if (include("expenses")) {
    const conditions = [
      "expenses.business_id = $1",
      "expenses.is_voided = FALSE",
      "expenses.fixed_expense_id IS NULL"
    ];
    appendDateConditions(conditions, values, "expenses.date::date", filters);
    unionSegments.push(
      `SELECT
         CONCAT('expense-', expenses.id)::text AS id,
         expenses.date::date AS date,
         'expenses'::text AS type,
         '-'::text AS reference,
         COALESCE(NULLIF(expenses.concept, ''), 'Gasto') AS concept,
         expenses.payment_method::text AS payment_method,
         expenses.amount::numeric AS amount,
         NULL::int AS sale_id,
         NULL::text AS cashier_name,
         NULL::text AS status,
         expenses.created_at
       FROM expenses
       WHERE ${conditions.join(" AND ")}`
    );
  }

  if (include("fixed_expenses")) {
    const conditions = [
      "expenses.business_id = $1",
      "expenses.is_voided = FALSE",
      "expenses.fixed_expense_id IS NOT NULL"
    ];
    appendDateConditions(conditions, values, "expenses.date::date", filters);
    unionSegments.push(
      `SELECT
         CONCAT('fixed-expense-', expenses.id)::text AS id,
         expenses.date::date AS date,
         'fixed_expenses'::text AS type,
         '-'::text AS reference,
         COALESCE(NULLIF(fixed_expenses.name, ''), NULLIF(expenses.concept, ''), 'Gasto fijo') AS concept,
         expenses.payment_method::text AS payment_method,
         expenses.amount::numeric AS amount,
         NULL::int AS sale_id,
         NULL::text AS cashier_name,
         NULL::text AS status,
         expenses.created_at
       FROM expenses
       LEFT JOIN fixed_expenses
         ON fixed_expenses.id = expenses.fixed_expense_id
        AND fixed_expenses.business_id = expenses.business_id
       WHERE ${conditions.join(" AND ")}`
    );
  }

  if (include("owner_debt")) {
    const conditions = [
      "owner_loans.business_id = $1",
      "owner_loans.is_voided = FALSE"
    ];
    appendDateConditions(conditions, values, "owner_loans.date::date", filters);
    unionSegments.push(
      `SELECT
         CONCAT('owner-debt-', owner_loans.id)::text AS id,
         owner_loans.date::date AS date,
         'owner_debt'::text AS type,
         '-'::text AS reference,
         CASE
           WHEN owner_loans.type = 'entrada' THEN COALESCE(NULLIF(owner_loans.notes, ''), 'Entrada de deuda del dueno')
           ELSE COALESCE(NULLIF(owner_loans.notes, ''), 'Abono de deuda del dueno')
         END AS concept,
         NULL::text AS payment_method,
         CASE
           WHEN owner_loans.type = 'entrada' THEN owner_loans.amount::numeric
           ELSE owner_loans.amount::numeric * -1
         END AS amount,
         NULL::int AS sale_id,
         NULL::text AS cashier_name,
         NULL::text AS status,
         owner_loans.created_at
       FROM owner_loans
       WHERE ${conditions.join(" AND ")}`
    );
  }

  if (!unionSegments.length) {
    return [];
  }

  const outerConditions = ["1 = 1"];
  const folio = String(filters.folio || "").trim();
  if (folio) {
    values.push(`%${folio}%`);
    outerConditions.push(`COALESCE(history.reference, '-') ILIKE $${values.length}`);
  }

  const paymentMethod = String(filters.payment_method || "").trim();
  if (paymentMethod) {
    values.push(paymentMethod);
    outerConditions.push(`history.payment_method = $${values.length}`);
  }

  const cashier = String(filters.cashier || "").trim();
  if (cashier) {
    values.push(`%${cashier}%`);
    outerConditions.push(`COALESCE(history.cashier_name, '') ILIKE $${values.length}`);
  }

  const total = normalizeExactAmount(filters.total);
  if (total !== null) {
    values.push(total);
    outerConditions.push(`history.amount = $${values.length}`);
  }

  const { rows } = await pool.query(
    `WITH history AS (
       ${unionSegments.join("\nUNION ALL\n")}
     )
     SELECT
       history.id,
       history.date,
       history.type,
       COALESCE(NULLIF(history.reference, ''), '-') AS reference,
       COALESCE(NULLIF(history.concept, ''), '-') AS concept,
       history.payment_method,
       history.amount,
       history.sale_id,
       history.cashier_name,
       history.status,
       history.created_at
     FROM history
     WHERE ${outerConditions.join(" AND ")}
     ORDER BY history.date DESC, history.created_at DESC, history.id DESC`,
    values
  );

  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    type: row.type,
    reference: row.reference || "-",
    concept: row.concept || "-",
    payment_method: row.payment_method || null,
    amount: Number(row.amount || 0),
    sale_id: row.sale_id === null || row.sale_id === undefined ? null : Number(row.sale_id),
    cashier_name: row.cashier_name || null,
    status: row.status || null
  }));
}

module.exports = {
  HISTORY_TYPES: Array.from(HISTORY_TYPES.values()),
  listHistory
};



