const express = require("express");
const cors = require("cors");
const { frontendUrl } = require("./config/env");
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

app.use(
  cors({
    origin: frontendUrl,
    credentials: false
  })
);
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/users", requireAuth, userRoutes);
app.use("/api/products", requireAuth, productRoutes);
app.use("/api/sales", requireAuth, saleRoutes);
app.use("/api/daily-cuts", requireAuth, dailyCutRoutes);
app.use("/api/reminders", requireAuth, reminderRoutes);
app.use("/api/dashboard", requireAuth, dashboardRoutes);

app.use(errorHandler);

module.exports = app;
