import { useState, useEffect } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { currency } from "../utils/format";
import type { AdminMetricsSummary } from "../types";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const PLAN_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899"];

export function FinancialDashboardPage() {
  const { token } = useAuth();
  const [data, setData] = useState<AdminMetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function loadMetrics() {
    if (!token) return;
    setLoading(true);
    setError("");
    apiRequest<AdminMetricsSummary>("/admin/metrics/summary", { token })
      .then((response) => setData(response))
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar las métricas");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Dashboard Financiero</h2>
            <p className="muted">Métricas globales de suscripciones y facturación</p>
          </div>
          <div className="share-actions">
            <button className="button ghost" onClick={loadMetrics} disabled={loading} type="button">
              {loading ? "Actualizando..." : "Actualizar"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="info-card" style={{ textAlign: "center", padding: "2rem 1rem" }}>
            <p className="error-text" style={{ margin: "0 0 1rem" }}>{error}</p>
            <button className="button" onClick={loadMetrics} type="button">Reintentar</button>
          </div>
        ) : loading && !data ? (
          <div className="info-card" style={{ textAlign: "center", padding: "2rem 1rem" }}>
            <p className="muted" style={{ margin: 0 }}>Cargando métricas...</p>
          </div>
        ) : (
          <>
            <div className="stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.75rem" }}>
              <div className="stat-card">
                <span className="stat-label">💰 MRR</span>
                <strong className="stat-value">{currency(data?.mrr || 0)}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">📉 Churn del mes</span>
                <strong className="stat-value">{data?.churn_count ?? 0}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">🧪 Trials activos</span>
                <strong className="stat-value">{data?.trials_active ?? 0}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">✅ Conversiones del mes</span>
                <strong className="stat-value">{data?.trials_converted_month ?? 0}</strong>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: "1rem" }}>
              <div className="panel" style={{ flex: "1 1 320px", minWidth: 0 }}>
                <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem" }}>Suscripciones por plan</h3>
                {!data || data.plans.every((p) => p.count === 0) ? (
                  <p className="muted" style={{ textAlign: "center", paddingTop: "2rem", paddingBottom: "2rem" }}>Sin suscripciones activas</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={data.plans}
                        cx="50%" cy="45%" innerRadius={52} outerRadius={80}
                        dataKey="count" nameKey="plan_name"
                      >
                        {data.plans.map((entry, i) => (
                          <Cell key={entry.plan_name} fill={PLAN_COLORS[i % PLAN_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="panel" style={{ flex: "1 1 320px", minWidth: 0 }}>
                <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem" }}>Ingresos del mes por método de pago</h3>
                {!data || data.revenue_by_method.length === 0 ? (
                  <p className="muted" style={{ textAlign: "center", paddingTop: "2rem", paddingBottom: "2rem" }}>Sin ingresos registrados este mes</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={data.revenue_by_method}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
                      <XAxis dataKey="method" tick={{ fontSize: 11, fill: "#9ca3af" }} />
                      <YAxis tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: "#9ca3af" }} width={50} />
                      <Tooltip formatter={(v) => currency(Number(v))} />
                      <Bar dataKey="total" name="Ingresos" radius={[4, 4, 0, 0]}>
                        {data.revenue_by_method.map((entry, i) => (
                          <Cell key={entry.method} fill={PLAN_COLORS[i % PLAN_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
