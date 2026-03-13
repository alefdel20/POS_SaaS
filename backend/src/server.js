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

// 1. CABECERAS MANUALES TOTALES
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(cors());
app.use(express.json());

// 2. RUTAS COMPATIBLES (Con y sin /api para que no falle nada)
// Ruta de salud doble
app.get(["/health", "/api/health"], (req, res) => res.json({ status: "ok", message: "Servidor vivo" }));

// Definición de rutas con doble prefijo
const routes = [
  { path: "/auth", router: authRoutes, auth: false },
  { path: "/users", router: userRoutes, auth: true },
  { path: "/products", router: productRoutes, auth: true },
  { path: "/sales", router: saleRoutes, auth: true },
  { path: "/daily-cuts", router: dailyCutRoutes, auth: true },
  { path: "/reminders", router: reminderRoutes, auth: true },
  { path: "/dashboard", router: dashboardRoutes, auth: true },
];

routes.forEach(route => {
  const handlers = route.auth ? [requireAuth, route.router] : [route.router];
  // Esto registra la ruta con /api y sin /api
  app.use(route.path, ...handlers);
  app.use("/api" + route.path, ...handlers);
});

app.use(errorHandler);

// 3. PUERTO FIJO PARA DOKPLOY
const PORT = 3002; 
app.listen(PORT, '0.0.0.0', () => {
  console.log(`>>> SERVIDOR POS CORRIENDO EN PUERTO ${PORT} <<<`);
});