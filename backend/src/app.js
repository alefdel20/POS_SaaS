const express = require("express");
const cors = require("cors");
const path = require("path");
const { requireAuth } = require("./middleware/authMiddleware");
const errorHandler = require("./middleware/errorHandler");
const { ensureDatabaseCompatibility } = require("./db/init");
const { ensureUploadsDirectory } = require("./utils/productImages");
const { ensureBusinessAssetsDirectory } = require("./utils/businessAssets");
const { startReminderScheduler } = require("./services/reminderSchedulerService");

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const productRoutes = require("./routes/productRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const saleRoutes = require("./routes/saleRoutes");
const dailyCutRoutes = require("./routes/dailyCutRoutes");
const reminderRoutes = require("./routes/reminderRoutes");
const automationRoutes = require("./routes/automationRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const creditCollectionRoutes = require("./routes/creditCollectionRoutes");
const financeRoutes = require("./routes/financeRoutes");
const profileRoutes = require("./routes/profileRoutes");
const businessRoutes = require("./routes/businessRoutes");
const adminInvoiceRoutes = require("./routes/adminInvoiceRoutes");
const onboardingRoutes = require("./routes/onboardingRoutes");
const serviceCatalogRoutes = require("./routes/serviceCatalogRoutes");
const clinicalClientRoutes = require("./routes/clinicalClientRoutes");
const clinicalPatientRoutes = require("./routes/clinicalPatientRoutes");
const clinicalConsultationRoutes = require("./routes/clinicalConsultationRoutes");
const clinicalAppointmentRoutes = require("./routes/clinicalAppointmentRoutes");
const clinicalHistoryRoutes = require("./routes/clinicalHistoryRoutes");
const medicalPrescriptionRoutes = require("./routes/medicalPrescriptionRoutes");
const medicalPreventiveEventRoutes = require("./routes/medicalPreventiveEventRoutes");
const productUpdateRequestRoutes = require("./routes/productUpdateRequestRoutes");

const app = express();

app.use(cors({
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization"]
}));

app.use(express.json());
app.use("/uploads", express.static(path.resolve(__dirname, "../uploads")));
app.use("/api/uploads", express.static(path.resolve(__dirname, "../uploads")));

app.get(["/health", "/api/health"], (req, res) => {
  res.json({ status: "ok", message: "Servidor vivo" });
});

const routes = [
  { path: "/auth", router: authRoutes, auth: false },
  { path: "/automation", router: automationRoutes, auth: false },
  { path: "/users", router: userRoutes, auth: true },
  { path: "/products", router: productRoutes, auth: true },
  { path: "/product-update-requests", router: productUpdateRequestRoutes, auth: true },
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
  { path: "/onboarding", router: onboardingRoutes, auth: true },
  { path: "/services", router: serviceCatalogRoutes, auth: true },
  { path: "/clients", router: clinicalClientRoutes, auth: true },
  { path: "/patients", router: clinicalPatientRoutes, auth: true },
  { path: "/medical-consultations", router: clinicalConsultationRoutes, auth: true },
  { path: "/medical-appointments", router: clinicalAppointmentRoutes, auth: true },
  { path: "/medical-history", router: clinicalHistoryRoutes, auth: true },
  { path: "/medical-prescriptions", router: medicalPrescriptionRoutes, auth: true },
  { path: "/medical-preventive-events", router: medicalPreventiveEventRoutes, auth: true }
];

routes.forEach((route) => {
  const handlers = route.auth ? [requireAuth, route.router] : [route.router];
  app.use(route.path, ...handlers);
  app.use(`/api${route.path}`, ...handlers);
});

app.use(errorHandler);

async function startServer(port = Number(process.env.PORT || 3000)) {
  await ensureDatabaseCompatibility();
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
