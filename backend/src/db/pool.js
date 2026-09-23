const pg = require("pg");
const { TIME_ZONE } = require("../utils/timezone");
const { debugSql } = require("../config/env");

// OID 1082 = DATE. Forzamos salida como texto plano YYYY-MM-DD.
pg.types.setTypeParser(1082, (value) => value);

// Forzamos el uso de variables de entorno de Dokploy o el archivo config si existen
const poolConfig = {
  host: process.env.PGHOST || "chatbots-postgressql-pos-b8rlox",
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  port: Number(process.env.PGPORT || 5432),
  max: 20,
  idleTimeoutMillis: 30000,
  // Sin esto (default 0) un caller espera para siempre cuando el pool esta agotado.
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
  query_timeout: 15000,
  idle_in_transaction_session_timeout: 30000,
};

const pool = new pg.Pool(poolConfig);

// Un error en un cliente idle (p.ej. reinicio de Postgres) se emite como 'error' en el pool;
// sin handler tumba el proceso. pg ya descarta el cliente y reconecta bajo demanda.
pool.on("error", (error) => {
  console.error(`[SQL:pool:error] ${error.message}`);
});

pool.on("connect", (client) => {
  client.query(`SET TIME ZONE '${TIME_ZONE}'`).catch((error) => {
    console.error(`[SQL:timezone:error] ${error.message}`);
  });
});

const TENANT_TABLES = [
  "users",
  "suppliers",
  "products",
  "supplier_catalog_items",
  "services",
  "automation_events",
  "product_suppliers",
  "sales",
  "sale_items",
  "credit_payments",
  "daily_cuts",
  "reminders",
  "expenses",
  "owner_loans",
  "fixed_expenses",
  "company_profiles",
  "company_stamp_movements",
  "support_access_logs",
  "audit_logs",
  "clients",
  "patients",
  "consultations",
  "appointments",
  "reports",
  "sync_logs",
  "import_jobs",
];

function normalizeSql(text) {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function touchesTenantTable(sql) {
  return TENANT_TABLES.some((table) => new RegExp(`\\b${table}\\b`, "i").test(sql));
}

function shouldWarnMissingBusinessId(sql) {
  const normalized = normalizeSql(sql);

  if (!/^(select|insert|update|delete)\b/.test(normalized)) return false;
  if (!touchesTenantTable(normalized)) return false;

  // Excluir algunas consultas técnicas de bootstrap/migración donde business_id
  // puede no aparecer explícitamente todavía.
  if (
    normalized.includes("information_schema") ||
    normalized.includes("pg_catalog") ||
    normalized.includes("create table") ||
    normalized.includes("alter table") ||
    normalized.includes("create index") ||
    normalized.includes("drop index") ||
    normalized.includes("add constraint")
  ) {
    return false;
  }

  return !/\bbusiness_id\b|\btarget_business_id\b/.test(normalized);
}

function extractQueryPayload(text, params) {
  if (typeof text === "string") {
    return { sql: text, values: Array.isArray(params) ? params : [] };
  }

  if (text && typeof text === "object" && typeof text.text === "string") {
    return {
      sql: text.text,
      values: Array.isArray(text.values) ? text.values : [],
    };
  }

  return { sql: "", values: [] };
}

function logQuery(source, sql, values) {
  if (!sql) return;

  if (debugSql) {
    console.log(`[SQL:${source}] ${sql}`);
    console.log(`[SQL:${source}:params] ${JSON.stringify(values)}`);
  }

  if (shouldWarnMissingBusinessId(sql)) {
    console.warn(`[TENANT-WARN] Query without business_id detected: ${sql}`);
  }
}

function wrapQueryMethod(queryFn, source) {
  return async function wrappedQuery(...args) {
    const { sql, values } = extractQueryPayload(args[0], args[1]);
    logQuery(source, sql, values);

    try {
      return await queryFn(...args);
    } catch (error) {
      console.error(`[SQL:${source}:error] ${error.message}`);
      throw error;
    }
  };
}

// pg-pool quita su listener de 'error' del cliente mientras esta en checkout (pg-pool/index.js:344).
// Si Postgres mata la sesion en ese lapso (p.ej. idle_in_transaction_session_timeout) y nadie mas
// escucha, el 'error' no capturado tumba el proceso. Se adjunta un listener una sola vez por cliente
// (los clientes se reutilizan entre checkouts; sin WeakSet se acumularian listeners).
// Cubre ambas formas de connect(): promesa y callback (pool.query de pg-pool usa la de callback).
const clientsWithErrorListener = new WeakSet();

function attachClientErrorListener(client) {
  if (!client || clientsWithErrorListener.has(client)) return;
  clientsWithErrorListener.add(client);
  client.on("error", (error) => {
    console.error(`[SQL:client:error] ${error.message}`);
  });
}

const rawConnect = pool.connect.bind(pool);
pool.connect = function wrappedConnect(callback) {
  if (typeof callback === "function") {
    return rawConnect((error, client, done) => {
      attachClientErrorListener(client);
      callback(error, client, done);
    });
  }
  return rawConnect().then((client) => {
    attachClientErrorListener(client);
    return client;
  });
};

// pool.connect() SI esta envuelto arriba (solo para adjuntar el listener de 'error').
// Seguimos sin mutar client.query en ningun punto — eso fue lo que probablemente
// rompio el backend en produccion la vez anterior, y ese riesgo especifico sigue evitado.
const rawPoolQuery = pool.query.bind(pool);
pool.query = wrapQueryMethod(rawPoolQuery, "pool");

module.exports = pool;
