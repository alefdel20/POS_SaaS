const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: "postgresql://admin:POSS@@A2010Ale@chatbots-postgressql-wwwpjx.1.hqes6jomss67rhs64xhuf9qm3:5432/pos_saas"
});

async function fix() {
  const hash = await bcrypt.hash("admin123", 10);
  await pool.query("DELETE FROM users WHERE username = 'admin'");
  await pool.query(
    "INSERT INTO users (username, email, full_name, password_hash, role, is_active) VALUES ($1, $2, $3, $4, $5, $6)",
    ['admin', 'admin@correo.com', 'Admin', hash, 'admin', true]
  );
  console.log("¡Usuario admin actualizado con éxito!");
  process.exit();
}

fix();