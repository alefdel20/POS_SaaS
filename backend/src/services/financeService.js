const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { saveAuditLog } = require("./auditLogService");

function mapExpense(expense) {
  return expense
    ? {
        ...expense,
        amount: Number(expense.amount || 0),
        is_voided: Boolean(expense.is_voided)
      }
    : null;
}

function mapOwnerLoan(loan) {
  return loan
    ? {
        ...loan,
        amount: Number(loan.amount || 0),
        balance: Number(loan.balance || 0),
        is_voided: Boolean(loan.is_voided)
      }
    : null;
}

function mapFixedExpense(fixedExpense) {
  return fixedExpense
    ? {
        ...fixedExpense,
        default_amount: Number(fixedExpense.default_amount || 0),
        is_active: Boolean(fixedExpense.is_active)
      }
    : null;
}

async function listExpenses() {
  const { rows } = await pool.query(
    `SELECT id, concept, category, amount, date, notes, payment_method, fixed_expense_id, is_voided, void_reason, created_at, updated_at
     FROM expenses
     ORDER BY date DESC, id DESC`
  );
  return rows.map(mapExpense);
}

async function createExpense(payload, actor) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO expenses (concept, category, amount, date, notes, payment_method, fixed_expense_id, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        payload.concept,
        payload.category || "General",
        payload.amount,
        payload.date || new Date().toISOString().slice(0, 10),
        payload.notes || "",
        payload.payment_method || "cash",
        payload.fixed_expense_id || null,
        actor.id
      ]
    );

    await saveAuditLog({
      usuario_id: actor.id,
      modulo: "finances",
      accion: "create_expense",
      entidad_tipo: "expense",
      entidad_id: rows[0].id,
      detalle_anterior: {},
      detalle_nuevo: {
        entity: "expense",
        entity_id: rows[0].id,
        snapshot: mapExpense(rows[0]),
        source: "financeService.createExpense",
        version: 1
      },
      motivo: payload.notes || "",
      metadata: {}
    }, { client });

    await client.query("COMMIT");
    return mapExpense(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateExpense(id, payload, actor) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows: currentRows } = await client.query("SELECT * FROM expenses WHERE id = $1", [id]);
    const current = currentRows[0];
    if (!current) {
      throw new ApiError(404, "Expense not found");
    }
    if (current.is_voided) {
      throw new ApiError(409, "Void expense cannot be edited");
    }

    const { rows } = await client.query(
      `UPDATE expenses
       SET concept = $1,
           category = $2,
           amount = $3,
           date = $4,
           notes = $5,
           payment_method = $6,
           fixed_expense_id = $7,
           updated_at = NOW(),
           updated_by = $8
       WHERE id = $9
       RETURNING *`,
      [
        payload.concept ?? current.concept,
        payload.category ?? current.category,
        payload.amount ?? current.amount,
        payload.date ?? current.date,
        payload.notes ?? current.notes,
        payload.payment_method ?? current.payment_method,
        payload.fixed_expense_id !== undefined ? payload.fixed_expense_id : current.fixed_expense_id,
        actor.id,
        id
      ]
    );

    await saveAuditLog({
      usuario_id: actor.id,
      modulo: "finances",
      accion: "update_expense",
      entidad_tipo: "expense",
      entidad_id: id,
      detalle_anterior: {
        entity: "expense",
        entity_id: id,
        snapshot: mapExpense(current),
        source: "financeService.updateExpense",
        version: 1
      },
      detalle_nuevo: {
        entity: "expense",
        entity_id: id,
        snapshot: mapExpense(rows[0]),
        source: "financeService.updateExpense",
        version: 1
      },
      motivo: payload.reason || payload.notes || "",
      metadata: {}
    }, { client });

    await client.query("COMMIT");
    return mapExpense(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function voidExpense(id, payload, actor) {
  const reason = payload.reason?.trim();
  if (!reason) {
    throw new ApiError(400, "Void reason is required");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows: currentRows } = await client.query("SELECT * FROM expenses WHERE id = $1", [id]);
    const current = currentRows[0];
    if (!current) {
      throw new ApiError(404, "Expense not found");
    }
    if (current.is_voided) {
      throw new ApiError(409, "Expense is already voided");
    }

    const { rows } = await client.query(
      `UPDATE expenses
       SET is_voided = TRUE,
           voided_at = NOW(),
           voided_by = $1,
           void_reason = $2,
           updated_at = NOW(),
           updated_by = $1
       WHERE id = $3
       RETURNING *`,
      [actor.id, reason, id]
    );

    await saveAuditLog({
      usuario_id: actor.id,
      modulo: "finances",
      accion: "void_expense",
      entidad_tipo: "expense",
      entidad_id: id,
      detalle_anterior: {
        entity: "expense",
        entity_id: id,
        snapshot: mapExpense(current),
        source: "financeService.voidExpense",
        version: 1
      },
      detalle_nuevo: {
        entity: "expense",
        entity_id: id,
        snapshot: mapExpense(rows[0]),
        source: "financeService.voidExpense",
        version: 1
      },
      motivo: reason,
      metadata: {}
    }, { client });

    await client.query("COMMIT");
    return mapExpense(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listOwnerLoans() {
  const { rows } = await pool.query(
    `SELECT id, amount, type, balance, date, notes, is_voided, void_reason, created_at, updated_at
     FROM owner_loans
     ORDER BY date DESC, id DESC`
  );
  return rows.map(mapOwnerLoan);
}

async function recalculateOwnerLoanBalances(client) {
  const { rows } = await client.query(
    `SELECT *
     FROM owner_loans
     ORDER BY date ASC, id ASC`
  );

  let balance = 0;
  for (const row of rows) {
    if (row.is_voided) {
      await client.query("UPDATE owner_loans SET balance = $1, updated_at = NOW() WHERE id = $2", [balance, row.id]);
      continue;
    }

    balance = row.type === "entrada"
      ? balance + Number(row.amount)
      : Math.max(balance - Number(row.amount), 0);

    await client.query("UPDATE owner_loans SET balance = $1, updated_at = NOW() WHERE id = $2", [balance, row.id]);
  }
}

async function createOwnerLoan(payload, actor) {
  const note = payload.notes?.trim();
  if (!note) {
    throw new ApiError(400, "Loan note is required");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows: balanceRows } = await client.query(
      "SELECT COALESCE(balance, 0) AS balance FROM owner_loans ORDER BY id DESC LIMIT 1"
    );
    const currentBalance = Number(balanceRows[0]?.balance || 0);
    const amount = Number(payload.amount || 0);
    const nextBalance = payload.type === "entrada"
      ? currentBalance + amount
      : Math.max(currentBalance - amount, 0);

    const { rows } = await client.query(
      `INSERT INTO owner_loans (amount, type, balance, date, notes, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [amount, payload.type, nextBalance, payload.date || new Date().toISOString().slice(0, 10), note, actor.id]
    );

    await saveAuditLog({
      usuario_id: actor.id,
      modulo: "finances",
      accion: "create_owner_loan",
      entidad_tipo: "owner_loan",
      entidad_id: rows[0].id,
      detalle_anterior: {},
      detalle_nuevo: {
        entity: "owner_loan",
        entity_id: rows[0].id,
        snapshot: mapOwnerLoan(rows[0]),
        source: "financeService.createOwnerLoan",
        version: 1
      },
      motivo: note,
      metadata: {}
    }, { client });

    await client.query("COMMIT");
    return mapOwnerLoan(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function voidOwnerLoan(id, payload, actor) {
  const reason = payload.reason?.trim();
  if (!reason) {
    throw new ApiError(400, "Void reason is required");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows: currentRows } = await client.query("SELECT * FROM owner_loans WHERE id = $1", [id]);
    const current = currentRows[0];
    if (!current) {
      throw new ApiError(404, "Owner loan not found");
    }
    if (current.is_voided) {
      throw new ApiError(409, "Owner loan is already voided");
    }

    const { rows } = await client.query(
      `UPDATE owner_loans
       SET is_voided = TRUE,
           voided_at = NOW(),
           voided_by = $1,
           void_reason = $2,
           updated_at = NOW(),
           updated_by = $1
       WHERE id = $3
       RETURNING *`,
      [actor.id, reason, id]
    );

    await recalculateOwnerLoanBalances(client);

    const { rows: refreshedRows } = await client.query("SELECT * FROM owner_loans WHERE id = $1", [id]);

    await saveAuditLog({
      usuario_id: actor.id,
      modulo: "finances",
      accion: "void_owner_loan",
      entidad_tipo: "owner_loan",
      entidad_id: id,
      detalle_anterior: {
        entity: "owner_loan",
        entity_id: id,
        snapshot: mapOwnerLoan(current),
        source: "financeService.voidOwnerLoan",
        version: 1
      },
      detalle_nuevo: {
        entity: "owner_loan",
        entity_id: id,
        snapshot: mapOwnerLoan(refreshedRows[0] || rows[0]),
        source: "financeService.voidOwnerLoan",
        version: 1
      },
      motivo: reason,
      metadata: {}
    }, { client });

    await client.query("COMMIT");
    return mapOwnerLoan(refreshedRows[0] || rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listFixedExpenses() {
  const { rows } = await pool.query(
    `SELECT *
     FROM fixed_expenses
     ORDER BY is_active DESC, name ASC`
  );
  return rows.map(mapFixedExpense);
}

async function createFixedExpense(payload, actor) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO fixed_expenses (name, category, default_amount, frequency, payment_method, due_day, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING *`,
      [
        payload.name,
        payload.category || "General",
        payload.default_amount || 0,
        payload.frequency || "monthly",
        payload.payment_method || "cash",
        payload.due_day || null,
        payload.notes || "",
        actor.id
      ]
    );

    await saveAuditLog({
      usuario_id: actor.id,
      modulo: "finances",
      accion: "create_fixed_expense",
      entidad_tipo: "fixed_expense",
      entidad_id: rows[0].id,
      detalle_anterior: {},
      detalle_nuevo: {
        entity: "fixed_expense",
        entity_id: rows[0].id,
        snapshot: mapFixedExpense(rows[0]),
        source: "financeService.createFixedExpense",
        version: 1
      },
      motivo: payload.notes || "",
      metadata: {}
    }, { client });

    await client.query("COMMIT");
    return mapFixedExpense(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateFixedExpense(id, payload, actor) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows: currentRows } = await client.query("SELECT * FROM fixed_expenses WHERE id = $1", [id]);
    const current = currentRows[0];
    if (!current) {
      throw new ApiError(404, "Fixed expense not found");
    }

    const { rows } = await client.query(
      `UPDATE fixed_expenses
       SET name = $1,
           category = $2,
           default_amount = $3,
           frequency = $4,
           payment_method = $5,
           due_day = $6,
           notes = $7,
           is_active = $8,
           updated_by = $9,
           updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        payload.name ?? current.name,
        payload.category ?? current.category,
        payload.default_amount ?? current.default_amount,
        payload.frequency ?? current.frequency,
        payload.payment_method ?? current.payment_method,
        payload.due_day !== undefined ? payload.due_day : current.due_day,
        payload.notes ?? current.notes,
        payload.is_active ?? current.is_active,
        actor.id,
        id
      ]
    );

    await saveAuditLog({
      usuario_id: actor.id,
      modulo: "finances",
      accion: "update_fixed_expense",
      entidad_tipo: "fixed_expense",
      entidad_id: id,
      detalle_anterior: {
        entity: "fixed_expense",
        entity_id: id,
        snapshot: mapFixedExpense(current),
        source: "financeService.updateFixedExpense",
        version: 1
      },
      detalle_nuevo: {
        entity: "fixed_expense",
        entity_id: id,
        snapshot: mapFixedExpense(rows[0]),
        source: "financeService.updateFixedExpense",
        version: 1
      },
      motivo: payload.notes || "",
      metadata: {}
    }, { client });

    await client.query("COMMIT");
    return mapFixedExpense(rows[0]);
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
         AND is_voided = FALSE
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
  updateExpense,
  voidExpense,
  listOwnerLoans,
  createOwnerLoan,
  voidOwnerLoan,
  listFixedExpenses,
  createFixedExpense,
  updateFixedExpense,
  getDashboard
};
