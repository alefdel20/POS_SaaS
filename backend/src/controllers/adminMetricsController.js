const adminMetricsService = require("../services/adminMetricsService");

async function getMetricsSummary(req, res) {
  try {
    const summary = await adminMetricsService.getMetricsSummary();
    res.json(summary);
  } catch (error) {
    console.error("[ADMIN-METRICS] Error al obtener métricas:", error);
    res.status(500).json({ error: "Error al obtener métricas" });
  }
}

module.exports = {
  getMetricsSummary
};
