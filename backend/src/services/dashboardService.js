const pool = require("../db/pool");
const { requireActorBusinessId } = require("../utils/tenant");
const { getMexicoCityDate } = require("../utils/timezone");
const { listRestockProducts } = require("./productService");
const { normalizeRole } = require("../utils/roles");
const { getProductUpdateRequestSummary } = require("./productUpdateRequestService");

const VALID_SALE_STATUS_SQL = "COALESCE(sales.status, 'completed') <> 'cancelled'";

function toNumber(value) {
  return Number(value || 0);
}

function isHealthcareVertical(posType) {
  return ["Veterinaria", "Dentista", "Farmacia", "FarmaciaConsultorio", "ClinicaChica"].includes(String(posType || ""));
}

async function getSummary(actor) {
  const businessId = requireActorBusinessId(actor);
  const today = getMexicoCityDate();
  const role = normalizeRole(actor?.role);
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
    summaryPayload.operations = await getOperationalSummary({ actor, businessId, today, role, isClinicalVertical });
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

  summaryPayload.operations = await getOperationalSummary({ actor, businessId, today, role, isClinicalVertical });
  return summaryPayload;
}

async function getOperationalSummary({ actor, businessId, today, role, isClinicalVertical }) {
  if (role === "cajero") {
    const requestSummary = await getProductUpdateRequestSummary(actor);
    return {
      role: "cajero",
      approvals: requestSummary,
      shortcuts: [
        { label: "Ir a ventas", path: "/sales" },
        { label: "Ver productos", path: "/health/products/medications" }
      ]
    };
  }

  if (role === "clinico") {
    const [todayAppointmentsResult, nextAppointmentsResult, patientCountResult, currentStatusResult] = await Promise.all([
      pool.query(
        `SELECT id, patient_id, patient_name, appointment_date, start_time, end_time, specialty, status
         FROM (
           SELECT
             a.id,
             a.patient_id,
             p.name AS patient_name,
             a.appointment_date,
             a.start_time,
             a.end_time,
             COALESCE(a.specialty, u.specialty, a.area) AS specialty,
             a.status
           FROM appointments a
           INNER JOIN patients p ON p.id = a.patient_id AND p.business_id = a.business_id
           LEFT JOIN users u ON u.id = a.doctor_user_id AND u.business_id = a.business_id
           WHERE a.business_id = $1
             AND a.doctor_user_id = $2
             AND a.is_active = TRUE
             AND a.status IN ('scheduled', 'confirmed')
             AND a.appointment_date = $3::date
         ) today_appointments
         ORDER BY start_time ASC, id ASC
         LIMIT 6`,
        [businessId, actor.id, today]
      ),
      pool.query(
        `SELECT
           a.id,
           p.name AS patient_name,
           a.appointment_date,
           a.start_time,
           a.end_time,
           COALESCE(a.specialty, u.specialty, a.area) AS specialty,
           a.status
         FROM appointments a
         INNER JOIN patients p ON p.id = a.patient_id AND p.business_id = a.business_id
         LEFT JOIN users u ON u.id = a.doctor_user_id AND u.business_id = a.business_id
         WHERE a.business_id = $1
           AND a.doctor_user_id = $2
           AND a.is_active = TRUE
           AND a.status IN ('scheduled', 'confirmed')
           AND (
             a.appointment_date > $3::date
             OR (a.appointment_date = $3::date AND a.start_time > CURRENT_TIME)
           )
         ORDER BY a.appointment_date ASC, a.start_time ASC, a.id ASC
         LIMIT 4`,
        [businessId, actor.id, today]
      ),
      pool.query(
        `SELECT COUNT(DISTINCT patient_id)::int AS total
         FROM appointments
         WHERE business_id = $1
           AND doctor_user_id = $2
           AND appointment_date = $3::date
           AND is_active = TRUE
           AND status IN ('scheduled', 'confirmed')`,
        [businessId, actor.id, today]
      ),
      pool.query(
        `SELECT CASE
            WHEN EXISTS (
              SELECT 1
              FROM appointments
              WHERE business_id = $1
                AND doctor_user_id = $2
                AND appointment_date = $3::date
                AND is_active = TRUE
                AND status IN ('scheduled', 'confirmed')
                AND start_time <= CURRENT_TIME
                AND end_time >= CURRENT_TIME
            ) THEN 'en_consulta'
            ELSE 'activo'
          END AS status`,
        [businessId, actor.id, today]
      )
    ]);

    return {
      role: "clinico",
      doctor: {
        status: currentStatusResult.rows[0]?.status || "activo",
        appointments_today: todayAppointmentsResult.rows,
        next_appointments: nextAppointmentsResult.rows,
        patients_today: Number(patientCountResult.rows[0]?.total || 0)
      },
      shortcuts: [
        { label: "Abrir agenda", path: "/medical-appointments" },
        { label: "Ver pacientes", path: "/patients" },
        { label: "Editar perfil", path: "/health/doctor/profile" }
      ]
    };
  }

  const [requestSummary, todayAppointmentsResult, recentManualCutsResult] = await Promise.all([
    getProductUpdateRequestSummary(actor),
    isClinicalVertical
      ? pool.query(
        `SELECT
           a.id,
           p.name AS patient_name,
           a.appointment_date,
           a.start_time,
           a.end_time,
           u.full_name AS doctor_name,
           COALESCE(a.specialty, u.specialty, a.area) AS specialty,
           a.status
         FROM appointments a
         INNER JOIN patients p ON p.id = a.patient_id AND p.business_id = a.business_id
         LEFT JOIN users u ON u.id = a.doctor_user_id AND u.business_id = a.business_id
         WHERE a.business_id = $1
           AND a.is_active = TRUE
           AND a.status IN ('scheduled', 'confirmed')
           AND a.appointment_date = $2::date
         ORDER BY a.start_time ASC, a.id ASC
         LIMIT 6`,
        [businessId, today]
      )
      : Promise.resolve({ rows: [] }),
    pool.query(
      `SELECT id, cut_date, cut_type, notes, performed_by_name_snapshot, created_at
       FROM manual_cuts
       WHERE business_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 4`,
      [businessId]
    )
  ]);

  return {
    role: "admin",
    approvals: requestSummary,
    appointments_today: todayAppointmentsResult.rows,
    recent_manual_cuts: recentManualCutsResult.rows.map((row) => ({
      id: Number(row.id),
      cut_date: row.cut_date,
      cut_type: row.cut_type,
      notes: row.notes || "",
      performed_by_name_snapshot: row.performed_by_name_snapshot,
      created_at: row.created_at
    })),
    shortcuts: [
      { label: "Abrir aprobaciones", path: isHealthcareVertical(actor?.pos_type) ? "/health/admin/approvals" : "/retail/admin/approvals" },
      isClinicalVertical
        ? { label: "Ver agenda", path: "/medical-appointments" }
        : { label: "Ver productos", path: "/products" },
      { label: "Ir a corte diario", path: isHealthcareVertical(actor?.pos_type) ? "/health/admin/daily-cut" : "/retail/admin/daily-cut" }
    ]
  };
}

module.exports = { getSummary };
