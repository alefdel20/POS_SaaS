const express = require("express");
const cors = require("cors");
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

// CORS
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization"]
}));

app.options("*", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  return res.sendStatus(204);
});

app.use(express.json());

// Cabeceras extra por compatibilidad
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// Ruta de salud con y sin /api
app.get(["/health", "/api/health"], (req, res) => {
  res.json({ status: "ok", message: "Servidor vivo" });
});

// Rutas con y sin /api
const routes = [
  { path: "/auth", router: authRoutes, auth: false },
  { path: "/users", router: userRoutes, auth: true },
  { path: "/products", router: productRoutes, auth: true },
  { path: "/sales", router: saleRoutes, auth: true },
  { path: "/daily-cuts", router: dailyCutRoutes, auth: true },
  { path: "/credit-collections", router: creditCollectionRoutes, auth: true },
  { path: "/reminders", router: reminderRoutes, auth: true },
  { path: "/dashboard", router: dashboardRoutes, auth: true },
];

routes.forEach((route) => {
  const handlers = route.auth ? [requireAuth, route.router] : [route.router];
  app.use(route.path, ...handlers);
  app.use("/api" + route.path, ...handlers);
});

app.use(errorHandler);

// Puerto fijo para Dokploy
const PORT = 3002;

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