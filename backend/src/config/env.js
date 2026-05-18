const dotenv = require("dotenv");

dotenv.config();

module.exports = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  jwtSecret: process.env.JWT_SECRET || process.env.SESSION_SECRET,
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL || "",
  webhookSecret: process.env.WEBHOOK_SECRET || null,
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
