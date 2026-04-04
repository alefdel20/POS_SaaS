import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { StatCard } from "../components/StatCard";
import { useAuth } from "../context/AuthContext";
import { currency } from "../utils/format";
import type { CompanyProfile, DashboardSummary } from "../types";

export function DashboardPage() {
  const { token } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;

    Promise.all([
      apiRequest<DashboardSummary>("/dashboard/summary", { token }),
      apiRequest<CompanyProfile>("/profile", { token })
    ])
      .then(([summaryResponse, profileResponse]) => {
        setSummary(summaryResponse);
        setProfile(profileResponse);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el dashboard");
      });
  }, [token]);

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Resumen del negocio</h2>
            <p className="muted">Ventas, utilidad estimada, productos clave y pendientes operativos en una sola vista.</p>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="stats-grid">
          <StatCard label="Ventas del dia" value={currency(summary?.total_sales_today || 0)} accent="#6cf0c2" />
          <StatCard label="Ventas del mes" value={currency(summary?.total_sales_month || 0)} />
          <StatCard label="Utilidad estimada" value={currency(summary?.estimated_profit_month || 0)} accent="#8b5cf6" />
          <StatCard label="Saldo por cobrar" value={currency(summary?.pending_credit_balance || 0)} accent="#ffb454" />
          <StatCard label="Stock bajo" value={summary?.low_stock_products || 0} accent="#ff7b7b" />
          <StatCard
            label="Timbres disponibles"
            value={summary?.stamps_available ?? profile?.stamps_available ?? 0}
            accent={Number(summary?.stamps_available ?? profile?.stamps_available ?? 0) > 0 ? "#6cf0c2" : "#ff7b7b"}
          />
        </div>
      </div>

      <div className="page-grid two-columns dashboard-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Productos mas vendidos</h2>
              <p className="muted">Top del mes con base en ventas reales registradas.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Unidades</th>
                  <th>Venta</th>
                </tr>
              </thead>
              <tbody>
                {summary?.top_products?.map((item) => (
                  <tr key={item.product_id}>
                    <td>
                      <div>{item.product_name}</div>
                      <small className="muted">{item.sku || "-"}</small>
                    </td>
                    <td>{item.units_sold}</td>
                    <td>{currency(item.total_sales)}</td>
                  </tr>
                ))}
                {!summary?.top_products?.length ? (
                  <tr>
                    <td className="muted" colSpan={3}>Aun no hay productos vendidos este mes.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Productos con stock bajo</h2>
              <p className="muted">Resumen corto para decidir reabastecimiento rapido.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Stock</th>
                  <th>Minimo</th>
                </tr>
              </thead>
              <tbody>
                {summary?.low_stock_items?.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div>{item.name}</div>
                      <small className="muted">{item.category || "-"}</small>
                    </td>
                    <td>{item.stock}</td>
                    <td>{item.stock_minimo}</td>
                  </tr>
                ))}
                {!summary?.low_stock_items?.length ? (
                  <tr>
                    <td className="muted" colSpan={3}>No hay productos en nivel bajo.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="page-grid two-columns dashboard-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Estado fiscal y timbres</h2>
              <p className="muted">
                {profile?.has_fiscal_profile
                  ? "El perfil fiscal esta completo."
                  : "Completa Perfil > Datos fiscales para habilitar facturacion."}
              </p>
            </div>
          </div>
          <div className="dashboard-note-list">
            <div className="info-card">
              <p>Timbres disponibles: <strong>{summary?.stamps_available ?? profile?.stamps_available ?? 0}</strong></p>
              <p>Facturacion lista: <strong>{summary?.billing_ready ? "Si" : "No"}</strong></p>
            </div>
            {profile?.stamp_alert_active ? (
              <div className="warning-box">
                <p>El saldo de timbres ya esta en umbral de alerta.</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Lectura rapida para dueno</h2>
              <p className="muted">Indicadores accionables con base en ventas, cobranza y stock actuales.</p>
            </div>
          </div>
          <div className="dashboard-note-list">
            <div className="info-card">
              <p>Ventas de la semana: <strong>{currency(summary?.total_sales_week || 0)}</strong></p>
              <p>Recordatorios pendientes: <strong>{summary?.pending_reminders || 0}</strong></p>
              <p>Usuarios activos: <strong>{summary?.active_users || 0}</strong></p>
            </div>
            <div className="info-card">
              <p>La utilidad estimada del mes usa la estructura actual de ventas menos `total_cost`.</p>
              <p>El saldo por cobrar muestra credito vigente con `balance_due` pendiente.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
