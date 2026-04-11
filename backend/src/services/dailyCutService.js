const ExcelJS = require("exceljs");
const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");
const { getMexicoCityDate, getMonthRange } = require("../utils/timezone");
const { normalizeRole } = require("../utils/roles");
const { saveAuditLog } = require("./auditLogService");

const VALID_SALE_STATUS_SQL = "COALESCE(sales.status, 'completed') <> 'cancelled'";

function isSchemaError(error) {
  return ["42P01", "42703", "42704"].includes(String(error?.code || ""));
}

function getLocalIsoDate() {
  return getMexicoCityDate();
}

function normalizeMonthRange(month) {
  return getMonthRange(month);
}

const REALIZED_CASHFLOW_CTE_SQL = `
  WITH sale_rows AS (
    SELECT
      sales.sale_date::date AS cut_date,
      sales.user_id AS sale_user_id,
      users.full_name AS cashier_name,
      CASE WHEN sales.payment_method = 'credit' THEN 'credit' ELSE sales.payment_method END AS payment_method,
      CASE
        WHEN sales.payment_method = 'credit'
          THEN LEAST(GREATEST(COALESCE(sales.initial_payment, 0), 0), GREATEST(COALESCE(sales.total, 0), 0))
        ELSE COALESCE(sales.total, 0)
      END AS realized_amount,
      CASE
        WHEN sales.payment_method = 'credit'
          THEN CASE
            WHEN COALESCE(sales.total, 0) <= 0 THEN 0
            ELSE COALESCE(sales.total_cost, 0) * LEAST(
              GREATEST(
                LEAST(GREATEST(COALESCE(sales.initial_payment, 0), 0), GREATEST(COALESCE(sales.total, 0), 0)) / NULLIF(sales.total, 0),
                0
              ),
              1
            )
          END
        ELSE COALESCE(sales.total_cost, 0)
      END AS realized_cost,
      CASE WHEN sales.sale_type = 'invoice' THEN 1 ELSE 0 END AS invoice_count,
      CASE WHEN sales.sale_type = 'ticket' THEN 1 ELSE 0 END AS ticket_count,
      CASE WHEN sales.sale_type = 'invoice' AND sales.stamp_status = 'consumed' THEN 1 ELSE 0 END AS timbres_usados,
      COALESCE(NULLIF(sales.stamp_snapshot->>'available_after', '')::NUMERIC, company_profiles.stamps_available::NUMERIC) AS timbres_restantes
    FROM sales
    INNER JOIN users ON users.id = sales.user_id AND users.business_id = sales.business_id
    LEFT JOIN company_profiles ON company_profiles.id = sales.company_profile_id AND company_profiles.business_id = sales.business_id
    WHERE sales.business_id = $1
      AND ${VALID_SALE_STATUS_SQL}
  ),
  payment_rows AS (
    SELECT
      credit_payments.payment_date::date AS cut_date,
      sales.user_id AS sale_user_id,
      users.full_name AS cashier_name,
      COALESCE(credit_payments.payment_method, 'credit') AS payment_method,
      COALESCE(credit_payments.amount, 0) AS realized_amount,
      CASE
        WHEN COALESCE(sales.total, 0) <= 0 THEN 0
        ELSE COALESCE(sales.total_cost, 0) * LEAST(
          GREATEST(COALESCE(credit_payments.amount, 0) / NULLIF(sales.total, 0), 0),
          1
        )
      END AS realized_cost,
      0::INTEGER AS invoice_count,
      0::INTEGER AS ticket_count,
      0::INTEGER AS timbres_usados,
      NULL::NUMERIC AS timbres_restantes
    FROM credit_payments
    INNER JOIN sales ON sales.id = credit_payments.sale_id AND sales.business_id = credit_payments.business_id
    INNER JOIN users ON users.id = sales.user_id AND users.business_id = sales.business_id
    WHERE credit_payments.business_id = $1
      AND sales.payment_method = 'credit'
      AND ${VALID_SALE_STATUS_SQL}
  ),
  cashflow_rows AS (
    SELECT * FROM sale_rows
    UNION ALL
    SELECT * FROM payment_rows
  )
`;

function buildCutFilters(filters = {}, startingIndex = 2) {
  const conditions = [];
  const values = [];
  const add = (sql, value) => {
    values.push(value);
    conditions.push(sql.replace("?", `$${startingIndex + values.length - 1}`));
  };

  if (filters.date) add("cut_date = ?::date", filters.date);
  if (filters.date_from) add("cut_date >= ?::date", filters.date_from);
  if (filters.date_to) add("cut_date <= ?::date", filters.date_to);

  const monthRange = normalizeMonthRange(filters.month);
  if (monthRange) {
    add("cut_date >= ?::date", monthRange.start);
    add("cut_date <= ?::date", monthRange.end);
  }

  if (filters.user_id) add("sale_user_id = ?", Number(filters.user_id));

  return { whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
}

function emptyCutRow(cutDate = getLocalIsoDate()) {
  return {
    cut_date: cutDate,
    total_day: 0,
    cash_total: 0,
    card_total: 0,
    credit_total: 0,
    transfer_total: 0,
    invoice_count: 0,
    ticket_count: 0,
    gross_profit: 0,
    gross_margin: 0,
    timbres_usados: 0,
    timbres_restantes: 0,
    cashier_names: ""
  };
}

async function listRealizedDailyCuts(filters = {}, actor) {
  const businessId = requireActorBusinessId(actor);
  const { whereClause, values } = buildCutFilters(filters, 2);
  const { rows } = await pool.query(
    `${REALIZED_CASHFLOW_CTE_SQL}
     SELECT
       cut_date,
       COALESCE(SUM(realized_amount), 0) AS total_day,
       COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN realized_amount ELSE 0 END), 0) AS cash_total,
       COALESCE(SUM(CASE WHEN payment_method = 'card' THEN realized_amount ELSE 0 END), 0) AS card_total,
       COALESCE(SUM(CASE WHEN payment_method = 'credit' THEN realized_amount ELSE 0 END), 0) AS credit_total,
       COALESCE(SUM(CASE WHEN payment_method = 'transfer' THEN realized_amount ELSE 0 END), 0) AS transfer_total,
       COALESCE(SUM(invoice_count), 0) AS invoice_count,
       COALESCE(SUM(ticket_count), 0) AS ticket_count,
       COALESCE(SUM(realized_amount - realized_cost), 0) AS gross_profit,
       CASE WHEN COALESCE(SUM(realized_amount), 0) = 0 THEN 0 ELSE (COALESCE(SUM(realized_amount - realized_cost), 0) / SUM(realized_amount)) * 100 END AS gross_margin,
       COALESCE(SUM(timbres_usados), 0) AS timbres_usados,
       COALESCE(MAX(timbres_restantes), 0) AS timbres_restantes,
       COALESCE(STRING_AGG(DISTINCT cashier_name, ', '), '') AS cashier_names
     FROM cashflow_rows
     ${whereClause}
     GROUP BY cut_date
     ORDER BY cut_date DESC`,
    [businessId, ...values]
  );
  return rows.map(mapCutRow);
}

function mapCutRow(row) {
  if (!row) return null;
  return {
    ...row,
    total_day: Number(row.total_day || 0),
    cash_total: Number(row.cash_total || 0),
    card_total: Number(row.card_total || 0),
    credit_total: Number(row.credit_total || 0),
    transfer_total: Number(row.transfer_total || 0),
    invoice_count: Number(row.invoice_count || 0),
    ticket_count: Number(row.ticket_count || 0),
    gross_profit: Number(row.gross_profit || 0),
    gross_margin: Number(row.gross_margin || 0),
    timbres_usados: Number(row.timbres_usados || 0),
    timbres_restantes: Number(row.timbres_restantes || 0)
  };
}

async function recomputeDailyCut(date = getLocalIsoDate(), actor) {
  const businessId = requireActorBusinessId(actor);
  const dailyRows = await listRealizedDailyCuts({ date }, actor);
  const current = dailyRows[0] || emptyCutRow(date);
  const { rows: upserted } = await pool.query(
    `INSERT INTO daily_cuts (cut_date, business_id, total_day, cash_total, card_total, credit_total, transfer_total, invoice_count, ticket_count, gross_profit, gross_margin, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
     ON CONFLICT (business_id, cut_date)
     DO UPDATE SET
       total_day = EXCLUDED.total_day,
       cash_total = EXCLUDED.cash_total,
       card_total = EXCLUDED.card_total,
       credit_total = EXCLUDED.credit_total,
       transfer_total = EXCLUDED.transfer_total,
       invoice_count = EXCLUDED.invoice_count,
       ticket_count = EXCLUDED.ticket_count,
       gross_profit = EXCLUDED.gross_profit,
       gross_margin = EXCLUDED.gross_margin,
       updated_at = NOW()
     RETURNING *`,
    [date, businessId, current.total_day, current.cash_total, current.card_total, current.credit_total, current.transfer_total, current.invoice_count, current.ticket_count, current.gross_profit, current.gross_margin]
  );
  return upserted[0];
}

async function listDailyCuts(filters = {}, actor) {
  return listRealizedDailyCuts(filters, actor);
}

async function getTodayDailyCut(actor) {
  const today = getLocalIsoDate();
  await recomputeDailyCut(today, actor);
  const rows = await listDailyCuts({ date: today }, actor);
  return rows[0] || { cut_date: today, total_day: 0, cash_total: 0, card_total: 0, credit_total: 0, transfer_total: 0, invoice_count: 0, ticket_count: 0, gross_profit: 0, gross_margin: 0, timbres_usados: 0, timbres_restantes: 0, cashier_names: "" };
}

async function listMonthlyCuts(filters = {}, actor) {
  const businessId = requireActorBusinessId(actor);
  const { whereClause, values } = buildCutFilters(filters, 2);
  const { rows } = await pool.query(
    `${REALIZED_CASHFLOW_CTE_SQL}
     SELECT
       TO_CHAR(DATE_TRUNC('month', cut_date::timestamp), 'YYYY-MM') AS month,
       MIN(cut_date) AS start_date,
       MAX(cut_date) AS end_date,
       COALESCE(SUM(realized_amount), 0) AS total_day,
       COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN realized_amount ELSE 0 END), 0) AS cash_total,
       COALESCE(SUM(CASE WHEN payment_method = 'card' THEN realized_amount ELSE 0 END), 0) AS card_total,
       COALESCE(SUM(CASE WHEN payment_method = 'credit' THEN realized_amount ELSE 0 END), 0) AS credit_total,
       COALESCE(SUM(CASE WHEN payment_method = 'transfer' THEN realized_amount ELSE 0 END), 0) AS transfer_total,
       COALESCE(SUM(invoice_count), 0) AS invoice_count,
       COALESCE(SUM(ticket_count), 0) AS ticket_count,
       COALESCE(SUM(realized_amount - realized_cost), 0) AS gross_profit,
       CASE WHEN COALESCE(SUM(realized_amount), 0) = 0 THEN 0 ELSE (COALESCE(SUM(realized_amount - realized_cost), 0) / SUM(realized_amount)) * 100 END AS gross_margin,
       COALESCE(SUM(timbres_usados), 0) AS timbres_usados,
       COALESCE(MAX(timbres_restantes), 0) AS timbres_restantes
     FROM cashflow_rows
     ${whereClause}
     GROUP BY DATE_TRUNC('month', cut_date::timestamp)
     ORDER BY DATE_TRUNC('month', cut_date::timestamp) DESC`,
    [businessId, ...values]
  );
  return rows.map(mapCutRow);
}

async function buildWorkbook(period, filters = {}, actor) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(period === "monthly" ? "Cortes mensuales" : "Cortes diarios");
  const rows = period === "monthly" ? await listMonthlyCuts(filters, actor) : await listDailyCuts(filters, actor);
  worksheet.columns = [
    { header: period === "monthly" ? "Mes" : "Fecha", key: "label", width: 18 },
    { header: "Total", key: "total_day", width: 16 },
    { header: "Efectivo", key: "cash_total", width: 16 },
    { header: "Tarjeta", key: "card_total", width: 16 },
    { header: "Credito", key: "credit_total", width: 16 },
    { header: "Transferencia", key: "transfer_total", width: 16 },
    { header: "Facturas", key: "invoice_count", width: 12 },
    { header: "Tickets", key: "ticket_count", width: 12 },
    { header: "Timbres usados", key: "timbres_usados", width: 16 },
    { header: "Timbres restantes", key: "timbres_restantes", width: 18 },
    { header: "Ganancia", key: "gross_profit", width: 16 },
    { header: "Margen %", key: "gross_margin", width: 12 }
  ];
  rows.forEach((row) => worksheet.addRow({ label: period === "monthly" ? row.month : row.cut_date, ...row }));
  worksheet.getRow(1).font = { bold: true };
  return workbook;
}

async function exportDailyCutsExcel(period = "daily", filters = {}, actor) {
  const workbook = await buildWorkbook(period, filters, actor);
  const buffer = await workbook.xlsx.writeBuffer();
  const suffix = period === "monthly" ? "mensual" : "diario";
  return { buffer, filename: `corte-${suffix}-${getLocalIsoDate()}.xlsx` };
}

async function listManualCuts(filters = {}, actor) {
  const actorRole = normalizeRole(actor?.role);
  if (!["superusuario", "admin"].includes(actorRole || "")) {
    throw new ApiError(403, "Forbidden");
  }
  const businessId = requireActorBusinessId(actor);
  const params = [businessId];
  const conditions = ["business_id = $1"];
  if (filters.date) {
    params.push(filters.date);
    conditions.push(`cut_date = $${params.length}`);
  }

  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT id, business_id, cut_date, cut_type, notes, performed_by_user_id, performed_by_name_snapshot, created_at, updated_at
       FROM manual_cuts
       WHERE ${conditions.join(" AND ")}
       ORDER BY cut_date DESC, created_at DESC, id DESC`,
      params
    ));
  } catch (error) {
    if (isSchemaError(error)) {
      console.error("[MANUAL-CUT] Schema error while listing manual cuts", error);
      throw new ApiError(503, "Feature schema is not ready");
    }
    throw error;
  }
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    business_id: Number(row.business_id),
    performed_by_user_id: row.performed_by_user_id ? Number(row.performed_by_user_id) : null
  }));
}

async function createManualCut(payload = {}, actor) {
  const actorRole = normalizeRole(actor?.role);
  if (!["superusuario", "admin", "cajero"].includes(actorRole || "")) {
    throw new ApiError(403, "Forbidden");
  }
  const businessId = requireActorBusinessId(actor);
  const cutDate = payload.cut_date || getLocalIsoDate();
  const notes = String(payload.notes || "").trim();
  const performedByNameSnapshot = String(actor.full_name || "").trim() || `Usuario #${actor.id}`;
  console.info("[MANUAL-CUT] Creating manual cut", { businessId, actorId: actor.id, cutDate });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO manual_cuts (
        business_id, cut_date, cut_type, notes, performed_by_user_id, performed_by_name_snapshot
       )
       VALUES ($1, $2, 'manual', $3, $4, $5)
       RETURNING id, business_id, cut_date, cut_type, notes, performed_by_user_id, performed_by_name_snapshot, created_at, updated_at`,
      [businessId, cutDate, notes, actor.id, performedByNameSnapshot]
    );

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "daily_cuts",
      accion: "create_manual_cut",
      entidad_tipo: "manual_cut",
      entidad_id: rows[0].id,
      detalle_anterior: {},
      detalle_nuevo: {
        cut_date: rows[0].cut_date,
        cut_type: rows[0].cut_type,
        notes: rows[0].notes,
        performed_by_user_id: rows[0].performed_by_user_id,
        performed_by_name_snapshot: rows[0].performed_by_name_snapshot
      },
      motivo: notes,
      metadata: {
        actor_role: actorRole
      }
    }, { client });

    await client.query("COMMIT");

    return {
      ...rows[0],
      id: Number(rows[0].id),
      business_id: Number(rows[0].business_id),
      performed_by_user_id: rows[0].performed_by_user_id ? Number(rows[0].performed_by_user_id) : null
    };
  } catch (error) {
    await client.query("ROLLBACK");
    if (isSchemaError(error)) {
      console.error("[MANUAL-CUT] Schema error while creating manual cut", error);
      throw new ApiError(503, "Feature schema is not ready");
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { recomputeDailyCut, listDailyCuts, getTodayDailyCut, exportDailyCutsExcel, listManualCuts, createManualCut };
