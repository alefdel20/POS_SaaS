const pool = require("../db/pool");
const { requireActorBusinessId } = require("../utils/tenant");
const { getMexicoCityDate } = require("../utils/timezone");

const VALID_SALE_STATUS_SQL = "COALESCE(sales.status, 'completed') <> 'cancelled'";

async function getSummary(actor) {
  const businessId = requireActorBusinessId(actor);
  const today = getMexicoCityDate();
  const params = [businessId, today];

  const { rows } = await pool.query(
    `SELECT
       COALESCE((SELECT SUM(total) FROM sales WHERE sales.business_id = $1 AND sale_date = $2::date AND ${VALID_SALE_STATUS_SQL}), 0) AS total_sales_today,
       COALESCE((SELECT SUM(total) FROM sales WHERE sales.business_id = $1 AND sale_date >= $2::date - INTERVAL '6 days' AND ${VALID_SALE_STATUS_SQL}), 0) AS total_sales_week,
       COALESCE((SELECT COUNT(*) FROM products WHERE products.business_id = $1), 0) AS total_products,
       COALESCE((SELECT COUNT(*) FROM products WHERE products.business_id = $1 AND stock_minimo > 0 AND stock <= stock_minimo), 0) AS low_stock_products,
       COALESCE((SELECT COUNT(*) FROM users WHERE users.business_id = $1 AND is_active = TRUE), 0) AS active_users,
       COALESCE((SELECT COUNT(*) FROM reminders WHERE reminders.business_id = $1 AND is_completed = FALSE), 0) AS pending_reminders`,
    params
  );

  return rows[0];
}

module.exports = { getSummary };
