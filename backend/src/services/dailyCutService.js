const pool = require("../db/pool");

async function recomputeDailyCut(date) {
  const normalizedDate = date || new Date().toISOString().slice(0, 10);

  const query = `
    WITH totals AS (
      SELECT
        $1::date AS cut_date,
        COALESCE(SUM(total), 0) AS total,
        COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) AS cash_total,
        COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total ELSE 0 END), 0) AS card_total,
        COALESCE(SUM(CASE WHEN payment_method = 'transfer' THEN total ELSE 0 END), 0) AS transfer_total
      FROM sales
      WHERE sale_date::date = $1::date
    )
    INSERT INTO daily_cuts (
      cut_date,
      total,
      cash_total,
      card_total,
      transfer_total
    )
    SELECT
      cut_date,
      total,
      cash_total,
      card_total,
      transfer_total
    FROM totals
    ON CONFLICT (cut_date)
    DO UPDATE SET
      total = EXCLUDED.total,
      cash_total = EXCLUDED.cash_total,
      card_total = EXCLUDED.card_total,
      transfer_total = EXCLUDED.transfer_total
    RETURNING *;
  `;

  const { rows } = await pool.query(query, [normalizedDate]);
  return rows[0];
}

async function listDailyCuts() {
  const { rows } = await pool.query(
    "SELECT * FROM daily_cuts ORDER BY cut_date DESC"
  );
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
