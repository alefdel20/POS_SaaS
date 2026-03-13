const express = require("express");
const cors = require("cors");
const { requireAuth } = require("./middleware/authMiddleware");
const errorHandler = require("./middleware/errorHandler");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const productRoutes = require("./routes/productRoutes");
const saleRoutes = require("./routes/saleRoutes");
const dailyCutRoutes = require("./routes/dailyCutRoutes");
const reminderRoutes = require("./routes/reminderRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");

const app = express();

// 1. ARTILLERÍA PESADA PARA CORS (Manual)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  // Si es la petición de prueba que hace Chrome (OPTIONS), respondemos OK rápido
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// 2. CONFIGURACIÓN ESTÁNDAR
app.use(cors());
app.use(express.json());

// 3. RUTA DE PRUEBA
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// 4. RUTAS DE LA APP
app.use("/api/auth", authRoutes);
app.use("/api/users", requireAuth, userRoutes);
app.use("/api/products", requireAuth, productRoutes);
app.use("/api/sales", requireAuth, saleRoutes);
app.use("/api/daily-cuts", requireAuth, dailyCutRoutes);
app.use("/api/reminders", requireAuth, reminderRoutes);
app.use("/api/dashboard", requireAuth, dashboardRoutes);

app.use(errorHandler);

module.exports = app;