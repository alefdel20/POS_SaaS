const ExcelJS = require("exceljs");
const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");
const { getMexicoCityDate, getMonthRange } = require("../utils/timezone");

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

function buildSalesFilters(filters = {}, actor, alias = "sales") {
  const conditions = [];
  const values = [];
  const add = (sql, value) => { values.push(value); conditions.push(sql.replace("?", `$${values.length}`)); };
  add(`${alias}.business_id = ?`, requireActorBusinessId(actor));
  if (filters.date) add(`${alias}.sale_date = ?::date`, filters.date);
  if (filters.date_from) add(`${alias}.sale_date >= ?::date`, filters.date_from);
  if (filters.date_to) add(`${alias}.sale_date <= ?::date`, filters.date_to);
  const monthRange = normalizeMonthRange(filters.month);
  if (monthRange) { add(`${alias}.sale_date >= ?::date`, monthRange.start); add(`${alias}.sale_date <= ?::date`, monthRange.end); }
  if (filters.user_id) add(`${alias}.user_id = ?`, Number(filters.user_id));
  return { whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
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
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(total), 0) AS total_day,
       COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) AS cash_total,
       COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total ELSE 0 END), 0) AS card_total,
       COALESCE(SUM(CASE WHEN payment_method = 'credit' THEN total ELSE 0 END), 0) AS credit_total,
       COALESCE(SUM(CASE WHEN payment_method = 'transfer' THEN total ELSE 0 END), 0) AS transfer_total,
       COALESCE(SUM(CASE WHEN sale_type = 'invoice' THEN 1 ELSE 0 END), 0) AS invoice_count,
       COALESCE(SUM(CASE WHEN sale_type = 'ticket' THEN 1 ELSE 0 END), 0) AS ticket_count,
       COALESCE(SUM(total - total_cost), 0) AS gross_profit,
       CASE WHEN COALESCE(SUM(total), 0) = 0 THEN 0 ELSE (COALESCE(SUM(total - total_cost), 0) / SUM(total)) * 100 END AS gross_margin
     FROM sales
     WHERE sale_date = $1 AND business_id = $2
       AND ${VALID_SALE_STATUS_SQL}`,
    [date, businessId]
  );
  const current = rows[0];
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
  const { whereClause, values } = buildSalesFilters(filters, actor);
  const { rows } = await pool.query(
    `SELECT
       sales.sale_date AS cut_date,
       COALESCE(SUM(sales.total), 0) AS total_day,
       COALESCE(SUM(CASE WHEN sales.payment_method = 'cash' THEN sales.total ELSE 0 END), 0) AS cash_total,
       COALESCE(SUM(CASE WHEN sales.payment_method = 'card' THEN sales.total ELSE 0 END), 0) AS card_total,
       COALESCE(SUM(CASE WHEN sales.payment_method = 'credit' THEN sales.total ELSE 0 END), 0) AS credit_total,
       COALESCE(SUM(CASE WHEN sales.payment_method = 'transfer' THEN sales.total ELSE 0 END), 0) AS transfer_total,
       COALESCE(SUM(CASE WHEN sales.sale_type = 'invoice' THEN 1 ELSE 0 END), 0) AS invoice_count,
       COALESCE(SUM(CASE WHEN sales.sale_type = 'ticket' THEN 1 ELSE 0 END), 0) AS ticket_count,
       COALESCE(SUM(sales.total - sales.total_cost), 0) AS gross_profit,
       CASE WHEN COALESCE(SUM(sales.total), 0) = 0 THEN 0 ELSE (COALESCE(SUM(sales.total - sales.total_cost), 0) / SUM(sales.total)) * 100 END AS gross_margin,
       COALESCE(SUM(CASE WHEN sales.sale_type = 'invoice' AND sales.stamp_status = 'consumed' THEN 1 ELSE 0 END), 0) AS timbres_usados,
       COALESCE(MAX(COALESCE(NULLIF(sales.stamp_snapshot->>'available_after', '')::INTEGER, company_profiles.stamps_available)), 0) AS timbres_restantes,
       COALESCE(STRING_AGG(DISTINCT users.full_name, ', '), '') AS cashier_names
     FROM sales
     INNER JOIN users ON users.id = sales.user_id AND users.business_id = sales.business_id
     LEFT JOIN company_profiles ON company_profiles.id = sales.company_profile_id AND company_profiles.business_id = sales.business_id
     ${whereClause}
     ${whereClause ? `AND ${VALID_SALE_STATUS_SQL}` : `WHERE ${VALID_SALE_STATUS_SQL}`}
     GROUP BY sales.sale_date
     ORDER BY sales.sale_date DESC`,
    values
  );
  return rows.map(mapCutRow);
}

async function getTodayDailyCut(actor) {
  const today = getLocalIsoDate();
  await recomputeDailyCut(today, actor);
  const rows = await listDailyCuts({ date: today }, actor);
  return rows[0] || { cut_date: today, total_day: 0, cash_total: 0, card_total: 0, credit_total: 0, transfer_total: 0, invoice_count: 0, ticket_count: 0, gross_profit: 0, gross_margin: 0, timbres_usados: 0, timbres_restantes: 0, cashier_names: "" };
}

async function listMonthlyCuts(filters = {}, actor) {
  const { whereClause, values } = buildSalesFilters(filters, actor);
  const { rows } = await pool.query(
    `SELECT
       TO_CHAR(DATE_TRUNC('month', sales.sale_date::timestamp), 'YYYY-MM') AS month,
       MIN(sales.sale_date) AS start_date,
       MAX(sales.sale_date) AS end_date,
       COALESCE(SUM(sales.total), 0) AS total_day,
       COALESCE(SUM(CASE WHEN sales.payment_method = 'cash' THEN sales.total ELSE 0 END), 0) AS cash_total,
       COALESCE(SUM(CASE WHEN sales.payment_method = 'card' THEN sales.total ELSE 0 END), 0) AS card_total,
       COALESCE(SUM(CASE WHEN sales.payment_method = 'credit' THEN sales.total ELSE 0 END), 0) AS credit_total,
       COALESCE(SUM(CASE WHEN sales.payment_method = 'transfer' THEN sales.total ELSE 0 END), 0) AS transfer_total,
       COALESCE(SUM(CASE WHEN sales.sale_type = 'invoice' THEN 1 ELSE 0 END), 0) AS invoice_count,
       COALESCE(SUM(CASE WHEN sales.sale_type = 'ticket' THEN 1 ELSE 0 END), 0) AS ticket_count,
       COALESCE(SUM(sales.total - sales.total_cost), 0) AS gross_profit,
       CASE WHEN COALESCE(SUM(sales.total), 0) = 0 THEN 0 ELSE (COALESCE(SUM(sales.total - sales.total_cost), 0) / SUM(sales.total)) * 100 END AS gross_margin,
       COALESCE(SUM(CASE WHEN sales.sale_type = 'invoice' AND sales.stamp_status = 'consumed' THEN 1 ELSE 0 END), 0) AS timbres_usados,
       COALESCE(MAX(COALESCE(NULLIF(sales.stamp_snapshot->>'available_after', '')::INTEGER, company_profiles.stamps_available)), 0) AS timbres_restantes
     FROM sales
     LEFT JOIN company_profiles ON company_profiles.id = sales.company_profile_id AND company_profiles.business_id = sales.business_id
     ${whereClause}
     ${whereClause ? `AND ${VALID_SALE_STATUS_SQL}` : `WHERE ${VALID_SALE_STATUS_SQL}`}
     GROUP BY DATE_TRUNC('month', sales.sale_date::timestamp)
     ORDER BY DATE_TRUNC('month', sales.sale_date::timestamp) DESC`,
    values
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
  const businessId = requireActorBusinessId(actor);
  const cutDate = payload.cut_date || getLocalIsoDate();
  const notes = String(payload.notes || "").trim();
  const performedByNameSnapshot = String(actor.full_name || "").trim() || `Usuario #${actor.id}`;
  console.info("[MANUAL-CUT] Creating manual cut", { businessId, actorId: actor.id, cutDate });

  let rows;
  try {
    ({ rows } = await pool.query(
      `INSERT INTO manual_cuts (
        business_id, cut_date, cut_type, notes, performed_by_user_id, performed_by_name_snapshot
       )
       VALUES ($1, $2, 'manual', $3, $4, $5)
       RETURNING id, business_id, cut_date, cut_type, notes, performed_by_user_id, performed_by_name_snapshot, created_at, updated_at`,
      [businessId, cutDate, notes, actor.id, performedByNameSnapshot]
    ));
  } catch (error) {
    if (isSchemaError(error)) {
      console.error("[MANUAL-CUT] Schema error while creating manual cut", error);
      throw new ApiError(503, "Feature schema is not ready");
    }
    throw error;
  }

  return {
    ...rows[0],
    id: Number(rows[0].id),
    business_id: Number(rows[0].business_id),
    performed_by_user_id: rows[0].performed_by_user_id ? Number(rows[0].performed_by_user_id) : null
  };
}

module.exports = { recomputeDailyCut, listDailyCuts, getTodayDailyCut, exportDailyCutsExcel, listManualCuts, createManualCut };
