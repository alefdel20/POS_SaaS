const pool = require("../db/pool");
const { requireActorBusinessId } = require("../utils/tenant");
const { getMexicoCityDate } = require("../utils/timezone");
const { listRestockProducts } = require("./productService");

const VALID_SALE_STATUS_SQL = "COALESCE(sales.status, 'completed') <> 'cancelled'";

function toNumber(value) {
  return Number(value || 0);
}

async function getSummary(actor) {
  const businessId = requireActorBusinessId(actor);
  const today = getMexicoCityDate();
  const isClinicalVertical = ["Veterinaria", "Dentista", "FarmaciaConsultorio", "ClinicaChica"].includes(String(actor?.pos_type || ""));

  const [summaryResult, topProductsResult, lowStockItems, profileResult] = await Promise.all([
    pool.query(
      `WITH sales_today AS (
         SELECT COALESCE(SUM(total), 0) AS amount
         FROM sales
         WHERE business_id = $1
           AND sale_date = $2::date
           AND ${VALID_SALE_STATUS_SQL}
       ),
       sales_week AS (
         SELECT COALESCE(SUM(total), 0) AS amount
         FROM sales
         WHERE business_id = $1
           AND sale_date >= $2::date - INTERVAL '6 days'
           AND ${VALID_SALE_STATUS_SQL}
       ),
       sales_month AS (
         SELECT
           COALESCE(SUM(total), 0) AS total_sales_month,
           COALESCE(SUM(total_cost), 0) AS total_cost_month
         FROM sales
         WHERE business_id = $1
           AND sale_date >= DATE_TRUNC('month', $2::date)
           AND ${VALID_SALE_STATUS_SQL}
       ),
       credit_balance AS (
         SELECT COALESCE(SUM(balance_due), 0) AS pending_credit_balance
         FROM sales
         WHERE business_id = $1
           AND payment_method = 'credit'
           AND balance_due > 0
           AND ${VALID_SALE_STATUS_SQL}
       )
       SELECT
         (SELECT amount FROM sales_today) AS total_sales_today,
         (SELECT amount FROM sales_week) AS total_sales_week,
         (SELECT total_sales_month FROM sales_month) AS total_sales_month,
         ((SELECT total_sales_month FROM sales_month) - (SELECT total_cost_month FROM sales_month)) AS estimated_profit_month,
         (SELECT pending_credit_balance FROM credit_balance) AS pending_credit_balance,
         COALESCE((SELECT COUNT(*) FROM products WHERE products.business_id = $1), 0) AS total_products,
         COALESCE((SELECT COUNT(*) FROM products WHERE products.business_id = $1 AND stock_minimo > 0 AND stock <= stock_minimo), 0) AS low_stock_products,
         COALESCE((SELECT COUNT(*) FROM users WHERE users.business_id = $1 AND is_active = TRUE), 0) AS active_users,
         COALESCE((SELECT COUNT(*) FROM reminders WHERE reminders.business_id = $1 AND is_completed = FALSE), 0) AS pending_reminders`,
      [businessId, today]
    ),
    pool.query(
      `SELECT
         sale_items.product_id,
         products.name AS product_name,
         products.sku,
         COALESCE(SUM(sale_items.quantity), 0) AS units_sold,
         COALESCE(SUM(sale_items.subtotal), 0) AS total_sales
       FROM sale_items
       INNER JOIN sales ON sales.id = sale_items.sale_id AND sales.business_id = sale_items.business_id
       INNER JOIN products ON products.id = sale_items.product_id AND products.business_id = sale_items.business_id
       WHERE sale_items.business_id = $1
         AND sales.sale_date >= DATE_TRUNC('month', $2::date)
         AND ${VALID_SALE_STATUS_SQL}
       GROUP BY sale_items.product_id, products.name, products.sku
       ORDER BY units_sold DESC, total_sales DESC, sale_items.product_id ASC
       LIMIT 5`,
      [businessId, today]
    ),
    listRestockProducts({}, actor),
    pool.query(
      `SELECT stamps_available, fiscal_rfc, fiscal_business_name, fiscal_regime, fiscal_address
       FROM company_profiles
       WHERE business_id = $1 AND profile_key = 'default'
       LIMIT 1`,
      [businessId]
    )
  ]);

  const summary = summaryResult.rows[0] || {};
  const profile = profileResult.rows[0] || null;
  const hasFiscalProfile = Boolean(
    profile &&
    profile.fiscal_rfc &&
    profile.fiscal_business_name &&
    profile.fiscal_regime &&
    profile.fiscal_address
  );

  const summaryPayload = {
    total_sales_today: toNumber(summary.total_sales_today),
    total_sales_week: toNumber(summary.total_sales_week),
    total_sales_month: toNumber(summary.total_sales_month),
    estimated_profit_month: toNumber(summary.estimated_profit_month),
    pending_credit_balance: toNumber(summary.pending_credit_balance),
    total_products: toNumber(summary.total_products),
    low_stock_products: toNumber(summary.low_stock_products),
    active_users: toNumber(summary.active_users),
    pending_reminders: toNumber(summary.pending_reminders),
    stamps_available: toNumber(profile?.stamps_available),
    billing_ready: hasFiscalProfile && toNumber(profile?.stamps_available) > 0,
    low_stock_items: lowStockItems.slice(0, 5).map((row) => ({
      id: row.id,
      name: row.name,
      stock: toNumber(row.stock),
      stock_minimo: toNumber(row.stock_minimo),
      category: row.category || null
    })),
    top_products: topProductsResult.rows.map((row) => ({
      ...row,
      units_sold: toNumber(row.units_sold),
      total_sales: toNumber(row.total_sales)
    }))
  };

  if (!isClinicalVertical) {
    return summaryPayload;
  }

  const [appointmentsToday, recentPatients, duePreventive, recentPrescriptions, pendingClinicalReminders] = await Promise.all([
    pool.query(
      `SELECT ma.id, ma.appointment_date, ma.start_time, ma.area, p.name AS patient_name
       FROM appointments ma
       INNER JOIN patients p ON p.id = ma.patient_id AND p.business_id = ma.business_id
       WHERE ma.business_id = $1
         AND ma.is_active = TRUE
         AND ma.status IN ('scheduled', 'confirmed')
         AND ma.appointment_date = $2::date
       ORDER BY ma.start_time ASC, ma.id ASC
       LIMIT 8`,
      [businessId, today]
    ),
    pool.query(
      `SELECT DISTINCT p.id, p.name, mc.consultation_date
       FROM consultations mc
       INNER JOIN patients p ON p.id = mc.patient_id AND p.business_id = mc.business_id
       WHERE mc.business_id = $1
       ORDER BY mc.consultation_date DESC
       LIMIT 6`,
      [businessId]
    ),
    pool.query(
      `SELECT id, patient_id, event_type, product_name_snapshot, next_due_date
       FROM medical_preventive_events
       WHERE business_id = $1
         AND status <> 'cancelled'
         AND next_due_date >= $2::date
       ORDER BY next_due_date ASC
       LIMIT 8`,
      [businessId, today]
    ),
    pool.query(
      `SELECT id, patient_id, status, created_at
       FROM medical_prescriptions
       WHERE business_id = $1
       ORDER BY created_at DESC
       LIMIT 6`,
      [businessId]
    ),
    pool.query(
      `SELECT COUNT(*) AS total
       FROM reminders
       WHERE business_id = $1
         AND category = 'clinical'
         AND is_completed = FALSE`,
      [businessId]
    )
  ]);

  summaryPayload.clinical = {
    appointments_today: appointmentsToday.rows,
    recent_patients: recentPatients.rows,
    upcoming_preventive_events: duePreventive.rows,
    recent_prescriptions: recentPrescriptions.rows,
    pending_clinical_reminders: toNumber(pendingClinicalReminders.rows[0]?.total)
  };

  return summaryPayload;
}

module.exports = { getSummary };
