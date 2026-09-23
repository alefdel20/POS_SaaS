const dotenv = require("dotenv");

dotenv.config();

const DEV_CORS_ORIGIN = "http://localhost:5173";

// Se invoca desde startServer() (no al cargar el modulo) para que el error lo
// capture el .catch(() => process.exit(1)) existente y salga con log legible.
function validateEnv() {
  const nodeEnv = process.env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const problems = [];

  if (!process.env.JWT_SECRET && !process.env.SESSION_SECRET) {
    problems.push("JWT_SECRET (or SESSION_SECRET)");
  }
  ["PGUSER", "PGPASSWORD", "PGDATABASE"].forEach((name) => {
    if (!process.env[name]) problems.push(name);
  });
  if (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === DEV_CORS_ORIGIN) {
    problems.push("CORS_ORIGIN");
  }

  if (!isProduction) {
    problems.forEach((name) => console.warn(`[ENV-WARN] Missing or insecure env var: ${name}`));
    return;
  }

  if (!process.env.PGHOST) {
    console.warn("[ENV-WARN] PGHOST is unset; falling back to the hardcoded internal hostname");
  }

  if (problems.length > 0) {
    throw new Error(`Missing required production env vars: ${problems.join(", ")}`);
  }
}

module.exports = {
  validateEnv,
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  jwtSecret: process.env.JWT_SECRET || process.env.SESSION_SECRET,
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL || "",
  webhookSecret: process.env.WEBHOOK_SECRET || null,
  ankodeInternalToken: process.env.ANKODE_INTERNAL_TOKEN || null,
  debugSql: process.env.DEBUG_SQL === "true",
  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || "pos_app",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres"
  },
  ai: {
    provider: process.env.AI_PROVIDER || "ollama",
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    ollamaModel: process.env.OLLAMA_MODEL || "gemma4",
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
    deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    maxTokens: parseInt(process.env.AI_MAX_TOKENS) || 4096,
    timeoutMs: parseInt(process.env.AI_TIMEOUT_MS) || 60000,
    monthlyLimitPlus: parseInt(process.env.AI_MONTHLY_LIMIT_PLUS) || 4000000,
    monthlyLimitEnterprise: parseInt(process.env.AI_MONTHLY_LIMIT_ENTERPRISE) || 6000000
  }
};
