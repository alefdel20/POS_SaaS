const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { saveAuditLog } = require("./auditLogService");
const { requireActorBusinessId } = require("../utils/tenant");
const { getMexicoCityDate } = require("../utils/timezone");
const { getNextFixedExpenseDueDate, normalizeFrequency } = require("../utils/fixedExpenseFrequency");
const { upsertSystemReminder, ensureAutomaticReminders } = require("./reminderService");

const VALID_SALE_STATUS_SQL = "COALESCE(status, 'completed') <> 'cancelled'";

function mapExpense(expense) {
  return expense ? { ...expense, amount: Number(expense.amount || 0), is_voided: Boolean(expense.is_voided) } : null;
}
function mapOwnerLoan(loan) {
  return loan ? { ...loan, amount: Number(loan.amount || 0), balance: Number(loan.balance || 0), is_voided: Boolean(loan.is_voided) } : null;
}
function mapFixedExpense(fixedExpense) {
  return fixedExpense
    ? { ...fixedExpense, default_amount: Number(fixedExpense.default_amount || 0), is_active: Boolean(fixedExpense.is_active), frequency: normalizeFrequency(fixedExpense.frequency) }
    : null;
}

function buildFinancialMovementReminderPayload({ businessId, type, row, actor }) {
  const actorName = actor?.full_name || actor?.username || "Sistema";
  const commonMetadata = {
    source_module: type,
    actor_user_id: actor?.id || null,
    actor_name: actorName
  };

  if (type === "expenses") {
    return {
      business_id: businessId,
      source_key: `finance:expense:${businessId}:${row.id}`,
      title: `Gasto registrado: ${row.concept}`,
      notes: `Concepto: ${row.concept}. Monto ${Number(row.amount || 0).toFixed(2)}. Categoria ${row.category || "General"}.`,
      due_date: row.date,
      status: row.is_voided ? "cancelled" : "completed",
      is_completed: !row.is_voided,
      reminder_type: "finance_expense",
      category: "administrative",
      metadata: {
        ...commonMetadata,
        expense_id: Number(row.id),
        concept: row.concept,
        amount: Number(row.amount || 0),
        date: row.date,
        payment_method: row.payment_method || "cash",
        state: row.is_voided ? "voided" : "registered"
      }
    };
  }

  if (type === "owner_loans") {
    return {
      business_id: businessId,
      source_key: `finance:owner-loan:${businessId}:${row.id}`,
      title: `Deuda del dueno: ${row.type === "entrada" ? "entrada" : "abono"}`,
      notes: `${row.notes || "Movimiento del dueno"}. Monto ${Number(row.amount || 0).toFixed(2)}. Saldo ${Number(row.balance || 0).toFixed(2)}.`,
      due_date: row.date,
      status: row.is_voided ? "cancelled" : "completed",
      is_completed: !row.is_voided,
      reminder_type: "finance_owner_loan",
      category: "administrative",
      metadata: {
        ...commonMetadata,
        owner_loan_id: Number(row.id),
        movement_type: row.type,
        amount: Number(row.amount || 0),
        balance: Number(row.balance || 0),
        date: row.date,
        state: row.is_voided ? "voided" : "registered"
      }
    };
  }

  const dueDate = getNextFixedExpenseDueDate(row, new Date(`${getMexicoCityDate()}T12:00:00`));
  return dueDate
    ? {
      business_id: businessId,
      source_key: `finance:fixed-expense:${businessId}:${row.id}:${dueDate}`,
      title: `Gasto fijo: ${row.name}`,
      notes: `Proximo vencimiento ${dueDate}. Frecuencia ${normalizeFrequency(row.frequency)}. Monto ${Number(row.default_amount || 0).toFixed(2)}.`,
      due_date: dueDate,
      status: row.is_active ? "pending" : "cancelled",
      is_completed: !row.is_active,
      reminder_type: "finance_fixed_expense",
      category: "administrative",
      metadata: {
        ...commonMetadata,
        fixed_expense_id: Number(row.id),
        concept: row.name,
        amount: Number(row.default_amount || 0),
        frequency: normalizeFrequency(row.frequency),
        due_day: row.due_day,
        state: row.is_active ? "scheduled" : "inactive"
      }
    }
    : null;
}

async function syncFinancialMovementReminder({ type, row, actor, client }) {
  const businessId = requireActorBusinessId(actor);
  const payload = buildFinancialMovementReminderPayload({ businessId, type, row, actor });
  if (!payload) {
    if (type === "fixed_expenses") {
      await client.query(
        `DELETE FROM reminders
         WHERE business_id = $1
           AND source_key LIKE $2`,
        [businessId, `finance:fixed-expense:${businessId}:${row.id}:%`]
      );
    }
    return null;
  }

  if (type === "fixed_expenses") {
    await client.query(
      `DELETE FROM reminders
       WHERE business_id = $1
         AND source_key LIKE $2
         AND source_key <> $3`,
      [businessId, `finance:fixed-expense:${businessId}:${row.id}:%`, payload.source_key]
    );
  }

  return upsertSystemReminder(payload, { client, businessId });
}

async function listExpenses(actor) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `SELECT id, concept, category, amount, date, notes, payment_method, fixed_expense_id, is_voided, void_reason, created_at, updated_at
     FROM expenses
     WHERE business_id = $1
     ORDER BY date DESC, id DESC`,
    [businessId]
  );
  return rows.map(mapExpense);
}

async function createExpense(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO expenses (business_id, concept, category, amount, date, notes, payment_method, fixed_expense_id, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [businessId, payload.concept, payload.category || "General", payload.amount, payload.date || getMexicoCityDate(), payload.notes || "", payload.payment_method || "cash", payload.fixed_expense_id || null, actor.id]
    );
    await syncFinancialMovementReminder({ type: "expenses", row: rows[0], actor, client });
    await saveAuditLog({ business_id: businessId, usuario_id: actor.id, modulo: "finances", accion: "create_expense", entidad_tipo: "expense", entidad_id: rows[0].id, detalle_nuevo: { entity: "expense", entity_id: rows[0].id, snapshot: mapExpense(rows[0]), version: 1 }, motivo: payload.notes || "", metadata: {} }, { client });
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
  const businessId = requireActorBusinessId(actor);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: currentRows } = await client.query("SELECT * FROM expenses WHERE id = $1 AND business_id = $2", [id, businessId]);
    const current = currentRows[0];
    if (!current) throw new ApiError(404, "Expense not found");
    if (current.is_voided) throw new ApiError(409, "Void expense cannot be edited");
    const { rows } = await client.query(
      `UPDATE expenses
       SET concept = $1, category = $2, amount = $3, date = $4, notes = $5, payment_method = $6,
           fixed_expense_id = $7, updated_at = NOW(), updated_by = $8
       WHERE id = $9 AND business_id = $10
       RETURNING *`,
      [payload.concept ?? current.concept, payload.category ?? current.category, payload.amount ?? current.amount, payload.date ?? current.date, payload.notes ?? current.notes, payload.payment_method ?? current.payment_method, payload.fixed_expense_id !== undefined ? payload.fixed_expense_id : current.fixed_expense_id, actor.id, id, businessId]
    );
    await syncFinancialMovementReminder({ type: "expenses", row: rows[0], actor, client });
    await saveAuditLog({ business_id: businessId, usuario_id: actor.id, modulo: "finances", accion: "update_expense", entidad_tipo: "expense", entidad_id: id, detalle_anterior: { entity: "expense", entity_id: id, snapshot: mapExpense(current), version: 1 }, detalle_nuevo: { entity: "expense", entity_id: id, snapshot: mapExpense(rows[0]), version: 1 }, motivo: payload.reason || payload.notes || "", metadata: {} }, { client });
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
  const businessId = requireActorBusinessId(actor);
  const reason = payload.reason?.trim();
  if (!reason) throw new ApiError(400, "Void reason is required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: currentRows } = await client.query("SELECT * FROM expenses WHERE id = $1 AND business_id = $2", [id, businessId]);
    const current = currentRows[0];
    if (!current) throw new ApiError(404, "Expense not found");
    if (current.is_voided) throw new ApiError(409, "Expense is already voided");
    const { rows } = await client.query(
      `UPDATE expenses
       SET is_voided = TRUE, voided_at = NOW(), voided_by = $1, void_reason = $2, updated_at = NOW(), updated_by = $1
       WHERE id = $3 AND business_id = $4
       RETURNING *`,
      [actor.id, reason, id, businessId]
    );
    await syncFinancialMovementReminder({ type: "expenses", row: rows[0], actor, client });
    await saveAuditLog({ business_id: businessId, usuario_id: actor.id, modulo: "finances", accion: "void_expense", entidad_tipo: "expense", entidad_id: id, detalle_anterior: { entity: "expense", entity_id: id, snapshot: mapExpense(current), version: 1 }, detalle_nuevo: { entity: "expense", entity_id: id, snapshot: mapExpense(rows[0]), version: 1 }, motivo: reason, metadata: {} }, { client });
    await client.query("COMMIT");
    return mapExpense(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listOwnerLoans(actor) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `SELECT id, amount, type, balance, date, notes, is_voided, void_reason, created_at, updated_at
     FROM owner_loans
     WHERE business_id = $1
     ORDER BY date DESC, id DESC`,
    [businessId]
  );
  return rows.map(mapOwnerLoan);
}

async function recalculateOwnerLoanBalances(client, businessId) {
  const { rows } = await client.query("SELECT * FROM owner_loans WHERE business_id = $1 ORDER BY date ASC, id ASC", [businessId]);
  let balance = 0;
  for (const row of rows) {
    if (!row.is_voided) balance = row.type === "entrada" ? balance + Number(row.amount) : Math.max(balance - Number(row.amount), 0);
    await client.query("UPDATE owner_loans SET balance = $1, updated_at = NOW() WHERE id = $2 AND business_id = $3", [balance, row.id, businessId]);
  }
}

async function createOwnerLoan(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const note = payload.notes?.trim();
  if (!note) throw new ApiError(400, "Loan note is required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: balanceRows } = await client.query("SELECT COALESCE(balance, 0) AS balance FROM owner_loans WHERE business_id = $1 ORDER BY id DESC LIMIT 1", [businessId]);
    const currentBalance = Number(balanceRows[0]?.balance || 0);
    const amount = Number(payload.amount || 0);
    const nextBalance = payload.type === "entrada" ? currentBalance + amount : Math.max(currentBalance - amount, 0);
    const { rows } = await client.query(
      `INSERT INTO owner_loans (business_id, amount, type, balance, date, notes, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [businessId, amount, payload.type, nextBalance, payload.date || getMexicoCityDate(), note, actor.id]
    );
    await syncFinancialMovementReminder({ type: "owner_loans", row: rows[0], actor, client });
    await saveAuditLog({ business_id: businessId, usuario_id: actor.id, modulo: "finances", accion: "create_owner_loan", entidad_tipo: "owner_loan", entidad_id: rows[0].id, detalle_nuevo: { entity: "owner_loan", entity_id: rows[0].id, snapshot: mapOwnerLoan(rows[0]), version: 1 }, motivo: note, metadata: {} }, { client });
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
  const businessId = requireActorBusinessId(actor);
  const reason = payload.reason?.trim();
  if (!reason) throw new ApiError(400, "Void reason is required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: currentRows } = await client.query("SELECT * FROM owner_loans WHERE id = $1 AND business_id = $2", [id, businessId]);
    const current = currentRows[0];
    if (!current) throw new ApiError(404, "Owner loan not found");
    if (current.is_voided) throw new ApiError(409, "Owner loan is already voided");
    await client.query(
      `UPDATE owner_loans
       SET is_voided = TRUE, voided_at = NOW(), voided_by = $1, void_reason = $2, updated_at = NOW(), updated_by = $1
       WHERE id = $3 AND business_id = $4`,
      [actor.id, reason, id, businessId]
    );
    await recalculateOwnerLoanBalances(client, businessId);
    const { rows: refreshedRows } = await client.query("SELECT * FROM owner_loans WHERE id = $1 AND business_id = $2", [id, businessId]);
    await syncFinancialMovementReminder({ type: "owner_loans", row: refreshedRows[0], actor, client });
    await saveAuditLog({ business_id: businessId, usuario_id: actor.id, modulo: "finances", accion: "void_owner_loan", entidad_tipo: "owner_loan", entidad_id: id, detalle_anterior: { entity: "owner_loan", entity_id: id, snapshot: mapOwnerLoan(current), version: 1 }, detalle_nuevo: { entity: "owner_loan", entity_id: id, snapshot: mapOwnerLoan(refreshedRows[0]), version: 1 }, motivo: reason, metadata: {} }, { client });
    await client.query("COMMIT");
    return mapOwnerLoan(refreshedRows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listFixedExpenses(actor) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query("SELECT * FROM fixed_expenses WHERE business_id = $1 ORDER BY is_active DESC, name ASC", [businessId]);
  return rows.map(mapFixedExpense);
}

async function createFixedExpense(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO fixed_expenses (business_id, name, category, default_amount, frequency, payment_method, due_day, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       RETURNING *`,
      [businessId, payload.name, payload.category || "General", payload.default_amount || 0, normalizeFrequency(payload.frequency), payload.payment_method || "cash", payload.due_day || null, payload.notes || "", actor.id]
    );
    await syncFinancialMovementReminder({ type: "fixed_expenses", row: rows[0], actor, client });
    await saveAuditLog({ business_id: businessId, usuario_id: actor.id, modulo: "finances", accion: "create_fixed_expense", entidad_tipo: "fixed_expense", entidad_id: rows[0].id, detalle_nuevo: { entity: "fixed_expense", entity_id: rows[0].id, snapshot: mapFixedExpense(rows[0]), version: 1 }, motivo: payload.notes || "", metadata: {} }, { client });
    await client.query("COMMIT");
    await ensureAutomaticReminders(actor);
    return mapFixedExpense(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateFixedExpense(id, payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: currentRows } = await client.query("SELECT * FROM fixed_expenses WHERE id = $1 AND business_id = $2", [id, businessId]);
    const current = currentRows[0];
    if (!current) throw new ApiError(404, "Fixed expense not found");
    const { rows } = await client.query(
      `UPDATE fixed_expenses
       SET name = $1, category = $2, default_amount = $3, frequency = $4, payment_method = $5,
           due_day = $6, notes = $7, is_active = $8, updated_by = $9, updated_at = NOW()
       WHERE id = $10 AND business_id = $11
       RETURNING *`,
      [payload.name ?? current.name, payload.category ?? current.category, payload.default_amount ?? current.default_amount, normalizeFrequency(payload.frequency ?? current.frequency), payload.payment_method ?? current.payment_method, payload.due_day !== undefined ? payload.due_day : current.due_day, payload.notes ?? current.notes, payload.is_active ?? current.is_active, actor.id, id, businessId]
    );
    await syncFinancialMovementReminder({ type: "fixed_expenses", row: rows[0], actor, client });
    await saveAuditLog({ business_id: businessId, usuario_id: actor.id, modulo: "finances", accion: "update_fixed_expense", entidad_tipo: "fixed_expense", entidad_id: id, detalle_anterior: { entity: "fixed_expense", entity_id: id, snapshot: mapFixedExpense(current), version: 1 }, detalle_nuevo: { entity: "fixed_expense", entity_id: id, snapshot: mapFixedExpense(rows[0]), version: 1 }, motivo: payload.notes || "", metadata: {} }, { client });
    await client.query("COMMIT");
    await ensureAutomaticReminders(actor);
    return mapFixedExpense(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getDashboard(actor) {
  const businessId = requireActorBusinessId(actor);
  const today = getMexicoCityDate();
  const { rows } = await pool.query(
    `WITH sales_totals AS (
       SELECT COALESCE(SUM(total), 0) AS ingresos, COALESCE(SUM(total_cost), 0) AS costo
       FROM sales
       WHERE business_id = $1 AND sale_date >= $2::date - INTERVAL '30 days'
         AND ${VALID_SALE_STATUS_SQL}
     ),
     expenses_totals AS (
       SELECT COALESCE(SUM(amount), 0) AS gastos
       FROM expenses
       WHERE business_id = $1 AND date >= $2::date - INTERVAL '30 days' AND is_voided = FALSE
     ),
     owner_balance AS (
       SELECT COALESCE(balance, 0) AS deuda_dueno
       FROM owner_loans
       WHERE business_id = $1
       ORDER BY id DESC
       LIMIT 1
     )
     SELECT sales_totals.ingresos, expenses_totals.gastos,
            sales_totals.ingresos - sales_totals.costo AS utilidad_bruta,
            (sales_totals.ingresos - sales_totals.costo) - expenses_totals.gastos AS utilidad_neta,
            COALESCE(owner_balance.deuda_dueno, 0) AS deuda_dueno
     FROM sales_totals, expenses_totals
     LEFT JOIN owner_balance ON TRUE`,
    [businessId, today]
  );
  return rows[0];
}

module.exports = { listExpenses, createExpense, updateExpense, voidExpense, listOwnerLoans, createOwnerLoan, voidOwnerLoan, listFixedExpenses, createFixedExpense, updateFixedExpense, getDashboard };
