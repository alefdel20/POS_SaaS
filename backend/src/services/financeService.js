const pool = require("../db/pool");

async function listExpenses() {
  const { rows } = await pool.query(
    `SELECT id, concept, category, amount, date, notes, payment_method, created_at
     FROM expenses
     ORDER BY date DESC, id DESC`
  );
  return rows;
}

async function createExpense(payload) {
  const { rows } = await pool.query(
    `INSERT INTO expenses (concept, category, amount, date, notes, payment_method)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      payload.concept,
      payload.category || "General",
      payload.amount,
      payload.date || new Date().toISOString().slice(0, 10),
      payload.notes || "",
      payload.payment_method || "cash"
    ]
  );
  return rows[0];
}

async function listOwnerLoans() {
  const { rows } = await pool.query(
    `SELECT id, amount, type, balance, date, created_at
     FROM owner_loans
     ORDER BY date DESC, id DESC`
  );
  return rows;
}

async function createOwnerLoan(payload) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows: balanceRows } = await client.query("SELECT COALESCE(balance, 0) AS balance FROM owner_loans ORDER BY id DESC LIMIT 1");
    const currentBalance = Number(balanceRows[0]?.balance || 0);
    const amount = Number(payload.amount || 0);
    const nextBalance = payload.type === "entrada"
      ? currentBalance + amount
      : Math.max(currentBalance - amount, 0);

    const { rows } = await client.query(
      `INSERT INTO owner_loans (amount, type, balance, date)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [amount, payload.type, nextBalance, payload.date || new Date().toISOString().slice(0, 10)]
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getDashboard() {
  const { rows } = await pool.query(
    `WITH sales_totals AS (
       SELECT COALESCE(SUM(total), 0) AS ingresos, COALESCE(SUM(total_cost), 0) AS costo
       FROM sales
       WHERE sale_date >= CURRENT_DATE - INTERVAL '30 days'
     ),
     expenses_totals AS (
       SELECT COALESCE(SUM(amount), 0) AS gastos
       FROM expenses
       WHERE date >= CURRENT_DATE - INTERVAL '30 days'
     ),
     owner_balance AS (
       SELECT COALESCE(balance, 0) AS deuda_dueno
       FROM owner_loans
       ORDER BY id DESC
       LIMIT 1
     )
     SELECT
       sales_totals.ingresos,
       expenses_totals.gastos,
       sales_totals.ingresos - sales_totals.costo AS utilidad_bruta,
       (sales_totals.ingresos - sales_totals.costo) - expenses_totals.gastos AS utilidad_neta,
       COALESCE(owner_balance.deuda_dueno, 0) AS deuda_dueno
     FROM sales_totals, expenses_totals
     LEFT JOIN owner_balance ON TRUE`
  );

  return rows[0];
}

module.exports = {
  listExpenses,
  createExpense,
  listOwnerLoans,
  createOwnerLoan,
  getDashboard
};
