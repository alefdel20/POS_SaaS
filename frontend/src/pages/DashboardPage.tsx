import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { StatCard } from "../components/StatCard";
import { useAuth } from "../context/AuthContext";
import { currency } from "../utils/format";
import type { DashboardSummary } from "../types";

export function DashboardPage() {
  const { token } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  useEffect(() => {
    if (!token) return;
    apiRequest<DashboardSummary>("/dashboard/summary", { token }).then(setSummary).catch(console.error);
  }, [token]);

  return (
    <section className="page-grid">
      <div className="page-header">
        <div>
          <h2>Panel administrativo</h2>
          <p className="muted">Vista operativa del dia y la semana.</p>
        </div>
      </div>
      <div className="stats-grid">
        <StatCard label="Ventas hoy" value={currency(summary?.total_sales_today || 0)} accent="#6cf0c2" />
        <StatCard label="Ventas semana" value={currency(summary?.total_sales_week || 0)} />
        <StatCard label="Productos" value={summary?.total_products || 0} />
        <StatCard label="Stock bajo" value={summary?.low_stock_products || 0} accent="#ffb454" />
        <StatCard label="Usuarios activos" value={summary?.active_users || 0} />
        <StatCard label="Recordatorios" value={summary?.pending_reminders || 0} accent="#ff7b7b" />
      </div>
    </section>
  );
}
