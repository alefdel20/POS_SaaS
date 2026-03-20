const pool = require("../db/pool");
const { canBypassBusinessScope, requireActorBusinessId } = require("../utils/tenant");

async function getSummary(actor) {
  const params = [];
  const scoped = (table) => {
    if (canBypassBusinessScope(actor)) return "";
    params.push(requireActorBusinessId(actor));
    return ` WHERE ${table}.business_id = $${params.length}`;
  };

  const { rows } = await pool.query(`
    SELECT
      COALESCE((SELECT SUM(total) FROM sales${scoped("sales")} ${canBypassBusinessScope(actor) ? "WHERE" : "AND"} sale_date = CURRENT_DATE), 0) AS total_sales_today,
      COALESCE((SELECT SUM(total) FROM sales${scoped("sales")} ${canBypassBusinessScope(actor) ? "WHERE" : "AND"} sale_date >= CURRENT_DATE - INTERVAL '6 days'), 0) AS total_sales_week,
      COALESCE((SELECT COUNT(*) FROM products${scoped("products")}), 0) AS total_products,
      COALESCE((SELECT COUNT(*) FROM products${scoped("products")} ${canBypassBusinessScope(actor) ? "WHERE" : "AND"} stock_minimo > 0 AND stock <= stock_minimo), 0) AS low_stock_products,
      COALESCE((SELECT COUNT(*) FROM users${scoped("users")} ${canBypassBusinessScope(actor) ? "WHERE" : "AND"} is_active = TRUE), 0) AS active_users,
      COALESCE((SELECT COUNT(*) FROM reminders${scoped("reminders")} ${canBypassBusinessScope(actor) ? "WHERE" : "AND"} is_completed = FALSE), 0) AS pending_reminders
  `, params);
  return rows[0];
}

module.exports = { getSummary };
