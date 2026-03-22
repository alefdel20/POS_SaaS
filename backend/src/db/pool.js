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

const TENANT_TABLES = [
  "users",
  "suppliers",
  "products",
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
  "reports",
  "sync_logs",
  "import_jobs"
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
  return !/\bbusiness_id\b|\btarget_business_id\b/.test(normalized);
}

function extractQueryPayload(text, params) {
  if (typeof text === "string") {
    return { sql: text, values: Array.isArray(params) ? params : [] };
  }

  if (text && typeof text === "object" && typeof text.text === "string") {
    return { sql: text.text, values: Array.isArray(text.values) ? text.values : [] };
  }

  return { sql: "", values: [] };
}

function logQuery(source, sql, values) {
  if (!sql) return;
  console.log(`[SQL:${source}] ${sql}`);
  console.log(`[SQL:${source}:params] ${JSON.stringify(values)}`);

  if (shouldWarnMissingBusinessId(sql)) {
    console.warn(`[TENANT-WARN] Query without business_id detected: ${sql}`);
  }
}

function wrapQueryMethod(queryFn, source) {
  return function wrappedQuery(...args) {
    const { sql, values } = extractQueryPayload(args[0], args[1]);
    logQuery(source, sql, values);
    return queryFn(...args);
  };
}

const rawPoolQuery = pool.query.bind(pool);
pool.query = wrapQueryMethod(rawPoolQuery, "pool");

const rawPoolConnect = pool.connect.bind(pool);
pool.connect = async function wrappedConnect(...args) {
  const client = await rawPoolConnect(...args);
  if (!client || typeof client.query !== "function") {
    throw new Error("Failed to acquire database client");
  }
  if (!client.__tenantQueryWrapped) {
    client.query = wrapQueryMethod(client.query.bind(client), "client");
    client.__tenantQueryWrapped = true;
  }
  return client;
};

module.exports = pool;
