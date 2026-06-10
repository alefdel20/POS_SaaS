const pool = require("../db/pool");

const PAYMENT_METHOD_LABELS = {
  card: "Tarjeta",
  bank_account: "SPEI"
};

async function getMrr() {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(
       CASE WHEN plan_type = 'yearly' THEN subscription_amount / 12.0
            ELSE subscription_amount END
     ), 0) AS mrr
     FROM business_subscriptions
     WHERE subscription_status NOT IN ('cancelled', 'blocked', 'suspended')`
  );
  return Number(rows[0]?.mrr || 0);
}

async function getChurnCount() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS churn_count
     FROM business_subscriptions
     WHERE subscription_status IN ('cancelled', 'blocked')
       AND cancelled_at >= date_trunc('month', NOW() AT TIME ZONE 'America/Mexico_City')`
  );
  return Number(rows[0]?.churn_count || 0);
}

async function getPlans() {
  const { rows } = await pool.query(
    `SELECT p.plan_name, COALESCE(c.count, 0)::int AS count
     FROM (VALUES ('Básico', 1), ('Premium', 2), ('Enterprise', 3), ('All-Inclusive', 4)) AS p(plan_name, sort_order)
     LEFT JOIN (
       SELECT plan_name, COUNT(*)::int AS count
       FROM business_subscriptions
       WHERE subscription_status NOT IN ('cancelled', 'blocked', 'suspended')
       GROUP BY plan_name
     ) c ON c.plan_name = p.plan_name
     ORDER BY p.sort_order`
  );
  return rows.map((row) => ({ plan_name: row.plan_name, count: Number(row.count || 0) }));
}

async function getTrialsActive() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS trials_active
     FROM business_subscriptions
     WHERE trial_ends_at > NOW() AND subscription_status = 'active'`
  );
  return Number(rows[0]?.trials_active || 0);
}

async function getTrialsConvertedMonth() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS trials_converted_month
     FROM business_subscriptions bs
     WHERE bs.trial_ends_at IS NOT NULL
       AND bs.trial_ends_at < NOW()
       AND bs.subscription_status = 'active'
       AND EXISTS (
         SELECT 1 FROM subscription_payment_history sph
         WHERE sph.business_id = bs.business_id
           AND sph.status = 'completed'
           AND sph.paid_at >= date_trunc('month', NOW() AT TIME ZONE 'America/Mexico_City')
       )`
  );
  return Number(rows[0]?.trials_converted_month || 0);
}

async function getRevenueByMethod() {
  const { rows } = await pool.query(
    `SELECT payment_method, COALESCE(SUM(amount), 0) AS total
     FROM subscription_payment_history
     WHERE status = 'completed'
       AND paid_at >= date_trunc('month', NOW() AT TIME ZONE 'America/Mexico_City')
     GROUP BY payment_method`
  );
  return rows.map((row) => ({
    method: PAYMENT_METHOD_LABELS[row.payment_method] || row.payment_method,
    total: Number(row.total || 0)
  }));
}

async function getMetricsSummary() {
  const [
    mrr,
    churn_count,
    plans,
    trials_active,
    trials_converted_month,
    revenue_by_method
  ] = await Promise.all([
    getMrr(),
    getChurnCount(),
    getPlans(),
    getTrialsActive(),
    getTrialsConvertedMonth(),
    getRevenueByMethod()
  ]);

  return {
    mrr,
    churn_count,
    plans,
    trials_active,
    trials_converted_month,
    revenue_by_method
  };
}

module.exports = {
  getMetricsSummary
};
