const pool = require("../db/pool");

async function getSummary() {
  const { rows } = await pool.query(`
    SELECT
      COALESCE((SELECT SUM(total) FROM sales WHERE sale_date = CURRENT_DATE), 0) AS total_sales_today,
      COALESCE((SELECT SUM(total) FROM sales WHERE sale_date >= CURRENT_DATE - INTERVAL '6 days'), 0) AS total_sales_week,
      COALESCE((SELECT COUNT(*) FROM products), 0) AS total_products,
      COALESCE((SELECT COUNT(*) FROM products WHERE stock <= 5), 0) AS low_stock_products,
      COALESCE((SELECT COUNT(*) FROM users WHERE is_active = TRUE), 0) AS active_users,
      COALESCE((SELECT COUNT(*) FROM reminders WHERE is_completed = FALSE), 0) AS pending_reminders
  `);
  return rows[0];
}

module.exports = {
  getSummary
};
