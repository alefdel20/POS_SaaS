const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const { requireAuth } = require("./middleware/authMiddleware");
const errorHandler = require("./middleware/errorHandler");
const { ensureDatabaseCompatibility } = require("./db/init");

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const productRoutes = require("./routes/productRoutes");
const saleRoutes = require("./routes/saleRoutes");
const dailyCutRoutes = require("./routes/dailyCutRoutes");
const reminderRoutes = require("./routes/reminderRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const creditCollectionRoutes = require("./routes/creditCollectionRoutes");
const financeRoutes = require("./routes/financeRoutes");
const profileRoutes = require("./routes/profileRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const businessRoutes = require("./routes/businessRoutes");

const app = express();

// DB
const pool = new Pool({
  host: process.env.PGHOST || "chatbots-postgressql-pos-b8rlox",
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  port: process.env.PGPORT || 5432,
});

pool.query("SELECT NOW()", (err) => {
  if (err) console.error("❌ ERROR DB:", err.message);
  else console.log("✅ CONEXIÓN A POSTGRES EXITOSA");
});

// CORS
app.use(cors({ origin: "*" }));
app.use(express.json());

// Health
app.get(["/health", "/api/health"], (req, res) => {
  res.json({ status: "ok" });
});

// Routes
app.use(["/auth", "/api/auth"], authRoutes);
app.use(["/users", "/api/users"], requireAuth, userRoutes);
app.use(["/products", "/api/products"], requireAuth, productRoutes);
app.use(["/sales", "/api/sales"], requireAuth, saleRoutes);
app.use(["/daily-cuts", "/api/daily-cuts"], requireAuth, dailyCutRoutes);
app.use(["/credit-collections", "/api/credit-collections"], requireAuth, creditCollectionRoutes);
app.use(["/reminders", "/api/reminders"], requireAuth, reminderRoutes);
app.use(["/dashboard", "/api/dashboard"], requireAuth, dashboardRoutes);
app.use(["/finances", "/api/finances"], requireAuth, financeRoutes);
app.use(["/profile", "/api/profile"], requireAuth, profileRoutes);
app.use(["/suppliers", "/api/suppliers"], requireAuth, supplierRoutes);
app.use(["/businesses", "/api/businesses"], requireAuth, businessRoutes);

app.use(errorHandler);

// 🔥 IMPORTANTE: puerto dinámico
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    console.log("🚀 Iniciando backend...");

    try {
      console.log("🛠️ Ejecutando ensureDatabaseCompatibility...");
      await ensureDatabaseCompatibility();
      console.log("✅ DB OK");
    } catch (error) {
      console.error("❌ DB compatibility error:", error.message);
      console.error("⚠️ Continúa para diagnóstico");
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`>>> SERVIDOR FUNCIONANDO EN PUERTO ${PORT} <<<`);
    });

  } catch (error) {
    console.error("❌ Error fatal:", error);
    process.exit(1);
  }
}

startServer();