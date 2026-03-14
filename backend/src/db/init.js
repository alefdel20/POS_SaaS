const pool = require("./pool");

async function ensureDatabaseCompatibility() {
  await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(120)");
}

module.exports = {
  ensureDatabaseCompatibility
};
