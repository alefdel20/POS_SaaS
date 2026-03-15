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

const app = express();

// 1. CONEXIÓN A BASE DE DATOS DIRECTA
const pool = new Pool({
  host: process.env.PGHOST || "chatbots-postgressql-pos-b8rlox",
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  port: process.env.PGPORT || 5432,
});

pool.query('SELECT NOW()', (err) => {
  if (err) console.error('❌ ERROR DB:', err.message);
  else console.log('✅ CONEXIÓN A POSTGRES EXITOSA');
});

// 2. MIDDLEWARES Y CABECERAS
app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
app.use(cors());

// 3. RUTAS DUALES (Para que no falle el 404 del Front)
app.get(["/health", "/api/health"], (req, res) => res.json({ status: "ok" }));
app.use(["/auth", "/api/auth"], authRoutes);
app.use(["/users", "/api/users"], requireAuth, userRoutes);
app.use(["/products", "/api/products"], requireAuth, productRoutes);
app.use(["/sales", "/api/sales"], requireAuth, saleRoutes);
app.use(["/daily-cuts", "/api/daily-cuts"], requireAuth, dailyCutRoutes);
app.use(["/credit-collections", "/api/credit-collections"], requireAuth, creditCollectionRoutes);
app.use(["/reminders", "/api/reminders"], requireAuth, reminderRoutes);
app.use(["/dashboard", "/api/dashboard"], requireAuth, dashboardRoutes);

app.use(errorHandler);

// 4. PUERTO FIJO
const PORT = 3002;
ensureDatabaseCompatibility()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`>>> SERVIDOR FUNCIONANDO EN PUERTO ${PORT} <<<`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize database compatibility", error);
    process.exit(1);
  });
