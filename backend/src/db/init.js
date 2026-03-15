const pool = require("./pool");

async function ensureDatabaseCompatibility() {
  await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(120)");
  await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS liquidation_price NUMERIC(12, 2)");
  await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS expires_at DATE");
  await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_name VARCHAR(150)");
  await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(40)");
  await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS initial_payment NUMERIC(12, 2) NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS balance_due NUMERIC(12, 2) NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS invoice_data JSONB NOT NULL DEFAULT '{}'::jsonb");
  await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_payments (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
      amount NUMERIC(12, 2) NOT NULL,
      payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash', 'card', 'credit', 'transfer')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

module.exports = {
  ensureDatabaseCompatibility
};
