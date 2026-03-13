const { Pool } = require("pg");

// Forzamos el uso de variables de entorno de Dokploy o el archivo config si existen
const poolConfig = {
  host: process.env.PGHOST || "chatbots-postgressql-pos-b8rlox",
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  port: process.env.PGPORT || 5432,
};

const pool = new Pool(poolConfig);

// Esto nos dirá en los Logs de Dokploy si funcionó o no
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error(' ERROR DE CONEXIÓN A DB:', err.message);
  } else {
    console.log(' CONEXIÓN A POSTGRES EXITOSA');
  }
});

module.exports = pool;