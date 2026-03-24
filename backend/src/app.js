const express = require("express");
const cors = require("cors");
const { requireAuth } = require("./middleware/authMiddleware");
const errorHandler = require("./middleware/errorHandler");
const { ensureDatabaseCompatibility } = require("./db/init");

// Rutas
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const productRoutes = require("./routes/productRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const saleRoutes = require("./routes/saleRoutes");
const dailyCutRoutes = require("./routes/dailyCutRoutes");
const reminderRoutes = require("./routes/reminderRoutes");
const automationRoutes = require("./role/automationRoutes"); // Revisa si es 'routes' o 'role' en tu carpeta
const dashboardRoutes = require("./routes/dashboardRoutes");
const creditCollectionRoutes = require("./routes/creditCollectionRoutes");
const financeRoutes = require("./routes/financeRoutes");
const profileRoutes = require("./routes/profileRoutes");
const businessRoutes = require("./routes/businessRoutes");
const adminInvoiceRoutes = require("./routes/adminInvoiceRoutes");

const app = express();

// --- CONFIGURACIÓN DE CORS (UNIFICADA) ---
app.use(cors({
  origin: true, // Detecta y permite automáticamente el origen de tu frontend
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization"]
}));

// Middleware para parsear JSON
app.use(express.json());

// Ruta de salud
app.get(["/health", "/api/health"], (req, res) => {
  res.json({ status: "ok", message: "Servidor vivo" });
});

// Configuración de rutas (con y sin prefijo /api)
const routes = [
  { path: "/auth", router: authRoutes, auth: false },
  { path: "/automation", router: automationRoutes, auth: false },
  { path: "/users", router: userRoutes, auth: true },
  { path: "/products", router: productRoutes, auth: true },
  { path: "/suppliers", router: supplierRoutes, auth: true },
  { path: "/sales", router: saleRoutes, auth: true },
  { path: "/daily-cuts", router: dailyCutRoutes, auth: true },
  { path: "/credit-collections", router: creditCollectionRoutes, auth: true },
  { path: "/reminders", router: reminderRoutes, auth: true },
  { path: "/dashboard", router: dashboardRoutes, auth: true },
  { path: "/finances", router: financeRoutes, auth: true },
  { path: "/profile", router: profileRoutes, auth: true },
  { path: "/businesses", router: businessRoutes, auth: true },
  { path: "/admin-invoices", router: adminInvoiceRoutes, auth: true },
];

routes.forEach((route) => {
  const handlers = route.auth ? [requireAuth, route.router] : [route.router];
  app.use(route.path, ...handlers);
  app.use("/api" + route.path, ...handlers);
});

// Manejador de errores global
app.use(errorHandler);

// Puerto para Dokploy
const PORT = 3002;

// Inicialización de DB y Servidor
ensureDatabaseCompatibility()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`>>> SERVIDOR POS CORRIENDO EN PUERTO ${PORT} <<<`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize database compatibility", error);
    process.exit(1);
  });
