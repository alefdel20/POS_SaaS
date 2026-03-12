import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { DailyCut } from "../types";
import { currency } from "../utils/format";

export function DailyCutPage() {
  const { token } = useAuth();
  const [today, setToday] = useState<DailyCut | null>(null);
  const [history, setHistory] = useState<DailyCut[]>([]);

  useEffect(() => {
    if (!token) return;
    apiRequest<DailyCut>("/daily-cuts/today", { token }).then(setToday).catch(console.error);
    apiRequest<DailyCut[]>("/daily-cuts", { token }).then(setHistory).catch(console.error);
  }, [token]);

  return (
    <section className="page-grid">
      <div className="stats-grid">
        <div className="stat-card"><span className="stat-label">Fecha</span><strong className="stat-value">{today?.cut_date || "-"}</strong></div>
        <div className="stat-card"><span className="stat-label">Total dia</span><strong className="stat-value">{currency(today?.total_day || 0)}</strong></div>
        <div className="stat-card"><span className="stat-label">Efectivo</span><strong className="stat-value">{currency(today?.cash_total || 0)}</strong></div>
        <div className="stat-card"><span className="stat-label">Tarjeta</span><strong className="stat-value">{currency(today?.card_total || 0)}</strong></div>
        <div className="stat-card"><span className="stat-label">Credito</span><strong className="stat-value">{currency(today?.credit_total || 0)}</strong></div>
        <div className="stat-card"><span className="stat-label">Transferencia</span><strong className="stat-value">{currency(today?.transfer_total || 0)}</strong></div>
        <div className="stat-card"><span className="stat-label">Facturas</span><strong className="stat-value">{today?.invoice_count || 0}</strong></div>
        <div className="stat-card"><span className="stat-label">Tickets</span><strong className="stat-value">{today?.ticket_count || 0}</strong></div>
        <div className="stat-card"><span className="stat-label">Ganancia</span><strong className="stat-value">{currency(today?.gross_profit || 0)}</strong></div>
        <div className="stat-card"><span className="stat-label">Margen</span><strong className="stat-value">{Number(today?.gross_margin || 0).toFixed(2)}%</strong></div>
      </div>
      <div className="panel">
        <div className="panel-header">
          <h2>Historico de cortes</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Total</th>
                <th>Efectivo</th>
                <th>Tarjeta</th>
                <th>Ganancia</th>
              </tr>
            </thead>
            <tbody>
              {history.map((cut) => (
                <tr key={cut.id}>
                  <td>{cut.cut_date}</td>
                  <td>{currency(cut.total_day)}</td>
                  <td>{currency(cut.cash_total)}</td>
                  <td>{currency(cut.card_total)}</td>
                  <td>{currency(cut.gross_profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
