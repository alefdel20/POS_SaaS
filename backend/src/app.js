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

// 1. CABECERAS MANUALES PARA EVITAR EL BLOQUEO DE CHROME
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// 2. CONFIGURACIÓN DE MIDDLEWARES
app.use(cors());
app.use(express.json());

// 3. RUTA DE SALUD (La dejo sin /api también por si acaso)
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// 4. DEFINICIÓN DE RUTAS (Se quitó el prefijo /api para coincidir con tu VITE_API_BASE_URL)
app.use("/auth", authRoutes);
app.use("/users", requireAuth, userRoutes);
app.use("/products", requireAuth, productRoutes);
app.use("/sales", requireAuth, saleRoutes);
app.use("/daily-cuts", requireAuth, dailyCutRoutes);
app.use("/reminders", requireAuth, reminderRoutes);
app.use("/dashboard", requireAuth, dashboardRoutes);

app.use(errorHandler);

// 5. ACTIVACIÓN DEL SERVIDOR
const PORT = process.env.PORT || 3002;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`SERVIDOR ACTIVADO EN EL PUERTO: ${PORT}`);
});