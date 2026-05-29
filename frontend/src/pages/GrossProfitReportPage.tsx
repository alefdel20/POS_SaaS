import { useEffect, useState } from "react";
import { apiDownload, apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { getMexicoCityDateInputValue } from "../utils/timezone";

interface ProductRow {
  product_id: number;
  product_name: string;
  units_sold: number;
  revenue: number;
  total_cost: number;
  gross_profit: number;
  margin_pct: number | null;
  no_cost: boolean;
  abc_class: "A" | "B" | "C";
}

interface ClassSummary {
  product_count: number;
  revenue: number;
  total_cost: number;
  gross_profit: number;
  margin_pct: number;
}

interface Summary {
  A: ClassSummary;
  B: ClassSummary;
  C: ClassSummary;
}

interface ReportResponse {
  data: ProductRow[];
  summary: Summary;
  period: { from: string; to: string };
}

function formatMoney(n: number) {
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

function getFirstDayOfCurrentMonth(): string {
  const now = new Date();
  const firstOfMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1, 12, 0, 0));
  return getMexicoCityDateInputValue(firstOfMonth);
}

const ABC_STYLES: Record<"A" | "B" | "C", { bg: string; border: string; titleColor: string; label: string }> = {
  A: { bg: "#e8f5e9", border: "#22c55e", titleColor: "#166534", label: "Clase A — Top 80%" },
  B: { bg: "#fff8e1", border: "#f59e0b", titleColor: "#92400e", label: "Clase B — Siguiente 15%" },
  C: { bg: "#f3f4f6", border: "#9ca3af", titleColor: "#374151", label: "Clase C — Último 5%" },
};

const BADGE_BG: Record<"A" | "B" | "C", string> = {
  A: "#22c55e",
  B: "#f59e0b",
  C: "#9ca3af",
};

export function GrossProfitReportPage() {
  const { token } = useAuth();

  const [from, setFrom] = useState<string>(getFirstDayOfCurrentMonth);
  const [to, setTo] = useState<string>(() => getMexicoCityDateInputValue());
  const [data, setData] = useState<ProductRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingExport, setLoadingExport] = useState<"excel" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchReport() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<ReportResponse>(
        `/reports/gross-profit?from=${from}&to=${to}`,
        { token }
      );
      setData(result.data);
      setSummary(result.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar el reporte");
      setData([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  async function exportReport(format: "excel" | "pdf") {
    if (!token) return;
    setLoadingExport(format);
    try {
      const blob = await apiDownload(
        `/reports/gross-profit/export/${format}?from=${from}&to=${to}`,
        { token }
      );
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `utilidad-bruta-${from}.${format === "excel" ? "xlsx" : "pdf"}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError("Error al exportar el reporte");
    } finally {
      setLoadingExport(null);
    }
  }

  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const today = getMexicoCityDateInputValue();

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2>Reporte de Utilidad Bruta</h2>
          <p className="muted">Rentabilidad por producto con clasificación ABC</p>
        </div>
      </div>

      <div className="panel-body">
        {/* Filtros */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>Desde</label>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>Hasta</label>
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <button
            className="button"
            onClick={fetchReport}
            disabled={loading}
            type="button"
          >
            {loading ? "Cargando..." : "Buscar"}
          </button>
          <button
            className="button ghost"
            onClick={() => exportReport("excel")}
            disabled={!!loadingExport || data.length === 0}
            type="button"
          >
            {loadingExport === "excel" ? "Exportando..." : "Exportar Excel"}
          </button>
          <button
            className="button ghost"
            onClick={() => exportReport("pdf")}
            disabled={!!loadingExport || data.length === 0}
            type="button"
          >
            {loadingExport === "pdf" ? "Exportando..." : "Exportar PDF"}
          </button>
        </div>

        {error && <p className="error-text">{error}</p>}

        {/* Cards resumen ABC */}
        {summary && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
            {(["A", "B", "C"] as const).map((cls) => {
              const s = summary[cls];
              const st = ABC_STYLES[cls];
              return (
                <div
                  key={cls}
                  style={{
                    padding: 16,
                    borderRadius: 8,
                    background: st.bg,
                    borderLeft: `4px solid ${st.border}`,
                  }}
                >
                  <div style={{ fontWeight: 600, color: st.titleColor, marginBottom: 6 }}>
                    {st.label}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                    <div>{s.product_count} producto{s.product_count !== 1 ? "s" : ""}</div>
                    <div>Ingresos: {formatMoney(s.revenue)}</div>
                    <div>Utilidad: {formatMoney(s.gross_profit)}</div>
                    <div>Margen: {s.margin_pct.toFixed(1)}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Tabla */}
        {!loading && data.length === 0 && !error && (
          <p className="muted" style={{ textAlign: "center", padding: "32px 0" }}>
            No hay ventas en el período seleccionado.
          </p>
        )}

        {data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th style={{ textAlign: "right" }}>Unidades</th>
                  <th style={{ textAlign: "right" }}>Ingresos</th>
                  <th style={{ textAlign: "right" }}>Costo total</th>
                  <th style={{ textAlign: "right" }}>Utilidad bruta</th>
                  <th style={{ textAlign: "right" }}>Margen %</th>
                  <th style={{ textAlign: "center" }}>Clase</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.product_id ?? row.product_name}>
                    <td>{row.product_name}</td>
                    <td style={{ textAlign: "right" }}>{row.units_sold}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(row.revenue)}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(row.total_cost)}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(row.gross_profit)}</td>
                    <td style={{ textAlign: "right" }}>
                      {row.no_cost ? (
                        <span style={{ color: "#9ca3af", fontSize: 12 }}>Sin costo</span>
                      ) : (
                        `${(row.margin_pct ?? 0).toFixed(1)}%`
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 10px",
                          borderRadius: 12,
                          fontSize: 12,
                          fontWeight: 600,
                          background: BADGE_BG[row.abc_class],
                          color: "#fff",
                        }}
                      >
                        {row.abc_class}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
