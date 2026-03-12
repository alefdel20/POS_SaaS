const pool = require("../db/pool");

async function recomputeDailyCut(date) {
  const normalizedDate = date || new Date().toISOString().slice(0, 10);
  const query = `
    WITH totals AS (
      SELECT
        COALESCE(SUM(total), 0) AS total_day,
        COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) AS cash_total,
        COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total ELSE 0 END), 0) AS card_total,
        COALESCE(SUM(CASE WHEN payment_method = 'credit' THEN total ELSE 0 END), 0) AS credit_total,
        COALESCE(SUM(CASE WHEN payment_method = 'transfer' THEN total ELSE 0 END), 0) AS transfer_total,
        COALESCE(SUM(CASE WHEN sale_type = 'invoice' THEN 1 ELSE 0 END), 0) AS invoice_count,
        COALESCE(SUM(CASE WHEN sale_type = 'ticket' THEN 1 ELSE 0 END), 0) AS ticket_count,
        COALESCE(SUM(total - total_cost), 0) AS gross_profit,
        COALESCE(CASE WHEN SUM(total) = 0 THEN 0 ELSE ((SUM(total - total_cost) / SUM(total)) * 100) END, 0) AS gross_margin
      FROM sales
      WHERE sale_date = $1
    )
    INSERT INTO daily_cuts (
      cut_date, total_day, cash_total, card_total, credit_total, transfer_total,
      invoice_count, ticket_count, gross_profit, gross_margin, updated_at
    )
    SELECT
      $1, total_day, cash_total, card_total, credit_total, transfer_total,
      invoice_count, ticket_count, gross_profit, gross_margin, NOW()
    FROM totals
    ON CONFLICT (cut_date)
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
    RETURNING *;
  `;

  const { rows } = await pool.query(query, [normalizedDate]);
  return rows[0];
}

async function listDailyCuts() {
  const { rows } = await pool.query("SELECT * FROM daily_cuts ORDER BY cut_date DESC");
  return rows;
}

async function getTodayDailyCut() {
  return recomputeDailyCut(new Date().toISOString().slice(0, 10));
}

module.exports = {
  recomputeDailyCut,
  listDailyCuts,
  getTodayDailyCut
};
