const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const { requireAuth } = require("./middleware/authMiddleware");
const errorHandler = require("./middleware/errorHandler");
const { ensureDatabaseCompatibility } = require("./db/init");
const { ensureUploadsDirectory } = require("./utils/productImages");
const { ensureBusinessAssetsDirectory } = require("./utils/businessAssets");
const { startReminderScheduler } = require("./services/reminderSchedulerService");
const { seedInitialCatalogsForExistingBusinesses } = require("./services/initialCatalogSeedService");

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const productRoutes = require("./routes/productRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const saleRoutes = require("./routes/saleRoutes");
const historyRoutes = require("./routes/historyRoutes");
const dailyCutRoutes = require("./routes/dailyCutRoutes");
const reminderRoutes = require("./routes/reminderRoutes");
const automationRoutes = require("./routes/automationRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const creditCollectionRoutes = require("./routes/creditCollectionRoutes");
const catalogClientRoutes = require("./routes/clientRoutes");
const financeRoutes = require("./routes/financeRoutes");
const profileRoutes = require("./routes/profileRoutes");
const businessRoutes = require("./routes/businessRoutes");
const adminInvoiceRoutes = require("./routes/adminInvoiceRoutes");
const onboardingRoutes = require("./routes/onboardingRoutes");
const onboardingStatusRoutes = require("./routes/onboardingStatusRoutes");
const serviceCatalogRoutes = require("./routes/serviceCatalogRoutes");
const clinicalClientRoutes = require("./routes/clinicalClientRoutes");
const clinicalPatientRoutes = require("./routes/clinicalPatientRoutes");
const clinicalConsultationRoutes = require("./routes/clinicalConsultationRoutes");
const clinicalAppointmentRoutes = require("./routes/clinicalAppointmentRoutes");
const clinicalHistoryRoutes = require("./routes/clinicalHistoryRoutes");
const medicalPrescriptionRoutes = require("./routes/medicalPrescriptionRoutes");
const medicalPreventiveEventRoutes = require("./routes/medicalPreventiveEventRoutes");
const productUpdateRequestRoutes = require("./routes/productUpdateRequestRoutes");
const openPayRoutes = require("./routes/openPayRoutes");
const subscriptionRoutes = require("./routes/subscriptionRoutes");
const restaurantRoutes = require("./routes/restaurantRoutes");
const branchRoutes = require("./routes/branchRoutes");
const tutorialRoutes = require("./routes/tutorialRoutes");

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

app.use(cors({
  origin: (origin, callback) => {
    const allowed = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(o => o.trim());
    if (!origin || allowed.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization"]
}));

app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use("/uploads", express.static(path.resolve(__dirname, "../uploads")));
app.use("/api/uploads", express.static(path.resolve(__dirname, "../uploads")));

app.get(["/health", "/api/health"], (req, res) => {
  res.json({ status: "ok", message: "Servidor vivo" });
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts, please try again later." }
});

const routes = [
  { path: "/auth", router: authRoutes, auth: false, limiter: loginLimiter },
  { path: "/automation", router: automationRoutes, auth: false },
  { path: "/openpay", router: openPayRoutes, auth: false },
  { path: "/users", router: userRoutes, auth: true },
  { path: "/products", router: productRoutes, auth: true },
  { path: "/product-update-requests", router: productUpdateRequestRoutes, auth: true },
  { path: "/suppliers", router: supplierRoutes, auth: true },
  { path: "/sales", router: saleRoutes, auth: true },
  { path: "/history", router: historyRoutes, auth: true },
  { path: "/daily-cuts", router: dailyCutRoutes, auth: true },
  { path: "/credit-collections", router: creditCollectionRoutes, auth: true },
  { path: "/catalog-clients", router: catalogClientRoutes, auth: true },
  { path: "/reminders", router: reminderRoutes, auth: true },
  { path: "/dashboard", router: dashboardRoutes, auth: true },
  { path: "/finances", router: financeRoutes, auth: true },
  { path: "/profile", router: profileRoutes, auth: true },
  { path: "/businesses", router: businessRoutes, auth: true },
  { path: "/admin-invoices", router: adminInvoiceRoutes, auth: true },
  { path: "/onboarding", router: onboardingStatusRoutes, auth: false },
  { path: "/onboarding", router: onboardingRoutes, auth: true },
  { path: "/services", router: serviceCatalogRoutes, auth: true },
  { path: "/clients", router: clinicalClientRoutes, auth: true },
  { path: "/patients", router: clinicalPatientRoutes, auth: true },
  { path: "/medical-consultations", router: clinicalConsultationRoutes, auth: true },
  { path: "/medical-appointments", router: clinicalAppointmentRoutes, auth: true },
  { path: "/medical-history", router: clinicalHistoryRoutes, auth: true },
  { path: "/medical-prescriptions", router: medicalPrescriptionRoutes, auth: true },
  { path: "/medical-preventive-events", router: medicalPreventiveEventRoutes, auth: true },
  { path: "/restaurant", router: restaurantRoutes, auth: true },
  { path: "/branches", router: branchRoutes, auth: true },
  { path: "/subscription", router: subscriptionRoutes, auth: true },
  { path: "/users", router: tutorialRoutes, auth: true }
];

routes.forEach((route) => {
  const base = route.auth ? [requireAuth, route.router] : [route.router];
  const handlers = route.limiter ? [route.limiter, ...base] : base;
  app.use(route.path, ...handlers);
  app.use(`/api${route.path}`, ...handlers);
});

app.use(errorHandler);

async function startServer(port = Number(process.env.PORT || 3000)) {
  await ensureDatabaseCompatibility();
  await seedInitialCatalogsForExistingBusinesses().catch((error) => {
    console.error("[INITIAL-CATALOG-SEED] Failed to seed initial catalogs", error);
  });
  await ensureUploadsDirectory();
  await ensureBusinessAssetsDirectory();
  const reminderScheduler = startReminderScheduler();

  return new Promise((resolve) => {
    const server = app.listen(port, "0.0.0.0", () => {
      console.log(`>>> SERVIDOR POS CORRIENDO EN PUERTO ${port} <<<`);
      resolve(server);
    });
    server.on("close", () => {
      reminderScheduler.stop();
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Failed to initialize database compatibility", error);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer
};
