const pool = require("../db/pool");
const { canBypassBusinessScope, requireActorBusinessId } = require("../utils/tenant");

async function getSummary(actor) {
  const businessId = canBypassBusinessScope(actor) ? null : requireActorBusinessId(actor);
  const params = [businessId];

  const predicate = (alias = "") => `($1::int IS NULL OR ${alias ? `${alias}.` : ""}business_id = $1)`;

  const { rows } = await pool.query(
    `SELECT
       COALESCE((SELECT SUM(total) FROM sales WHERE ${predicate("sales")} AND sale_date = CURRENT_DATE), 0) AS total_sales_today,
       COALESCE((SELECT SUM(total) FROM sales WHERE ${predicate("sales")} AND sale_date >= CURRENT_DATE - INTERVAL '6 days'), 0) AS total_sales_week,
       COALESCE((SELECT COUNT(*) FROM products WHERE ${predicate("products")}), 0) AS total_products,
       COALESCE((SELECT COUNT(*) FROM products WHERE ${predicate("products")} AND stock_minimo > 0 AND stock <= stock_minimo), 0) AS low_stock_products,
       COALESCE((SELECT COUNT(*) FROM users WHERE ${predicate("users")} AND is_active = TRUE), 0) AS active_users,
       COALESCE((SELECT COUNT(*) FROM reminders WHERE ${predicate("reminders")} AND is_completed = FALSE), 0) AS pending_reminders`,
    params
  );

  return rows[0];
}

module.exports = { getSummary };
