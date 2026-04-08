import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { DailyCut, ManualCut, User } from "../types";
import { currency, dateLabel, shortDate, shortDateTime } from "../utils/format";
import { isCashierRole } from "../utils/roles";

type FilterState = {
  date: string;
  date_from: string;
  date_to: string;
  user_id: string;
  month: string;
};

const emptyFilters: FilterState = {
  date: "",
  date_from: "",
  date_to: "",
  user_id: "",
  month: ""
};

function buildQuery(filters: FilterState) {
  const params = new URLSearchParams();

  if (filters.date) params.set("date", filters.date);
  if (filters.date_from) params.set("date_from", filters.date_from);
  if (filters.date_to) params.set("date_to", filters.date_to);
  if (filters.user_id) params.set("user_id", filters.user_id);
  if (filters.month) params.set("month", filters.month);

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function DailyCutPage() {
  const { token, user } = useAuth();
  const [today, setToday] = useState<DailyCut | null>(null);
  const [history, setHistory] = useState<DailyCut[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [manualCuts, setManualCuts] = useState<ManualCut[]>([]);
  const [manualCutDate, setManualCutDate] = useState("");
  const [manualCutNotes, setManualCutNotes] = useState("");
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState<"" | "daily" | "monthly">("");
  const [savingManualCut, setSavingManualCut] = useState(false);

  async function loadToday() {
    if (!token) return;
    const response = await apiRequest<DailyCut>("/daily-cuts/today", { token });
    setToday(response);
  }

  async function loadHistory(activeFilters: FilterState) {
    if (!token) return;
    const response = await apiRequest<DailyCut[]>(`/daily-cuts${buildQuery(activeFilters)}`, { token });
    setHistory(response);
  }

  async function loadUsers() {
    if (!token) return;
    const response = await apiRequest<User[]>("/users", { token });
    setUsers(response);
  }

  async function loadManualCuts() {
    if (!token || isCashierRole(user?.role)) return;
    const response = await apiRequest<ManualCut[]>("/daily-cuts/manual", { token });
    setManualCuts(response);
  }

  useEffect(() => {
    if (!token) return;

    loadToday().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el corte actual");
    });
    loadHistory(emptyFilters).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el historial");
    });
    if (!isCashierRole(user?.role)) {
      loadUsers().catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar usuarios");
      });
      loadManualCuts().catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar cortes manuales");
      });
    } else {
      setUsers([]);
    }
  }, [token, user?.role]);

  const shareMessage = today
    ? `Corte Diario\nFecha: ${shortDate(today.cut_date)}\n\nTotal: ${currency(today.total_day)}\nEfectivo: ${currency(today.cash_total)}\nTarjeta: ${currency(today.card_total)}\nTransferencia: ${currency(today.transfer_total)}\nFacturas: ${today.invoice_count}\nTimbres usados: ${today.timbres_usados || 0}\nTimbres restantes: ${today.timbres_restantes || 0}\n\nGanancia: ${currency(today.gross_profit)}\nTickets: ${today.ticket_count}`
    : "";
  const encodedShareMessage = encodeURIComponent(shareMessage);
  const activeUserName = useMemo(() => {
    if (!filters.user_id) return "Todos";
    return users.find((user) => user.id === Number(filters.user_id))?.full_name || `Usuario #${filters.user_id}`;
  }, [filters.user_id, users]);
  const isCashier = isCashierRole(user?.role);

  async function applyFilters() {
    try {
      setError("");
      await loadHistory(filters);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el historial");
    }
  }

  async function resetFilters() {
    try {
      setFilters(emptyFilters);
      setError("");
      await loadHistory(emptyFilters);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible reiniciar filtros");
    }
  }

  async function exportExcel(period: "daily" | "monthly") {
    if (!token) return;

    try {
      setExporting(period);
      setError("");
      const response = await fetch(`${(import.meta as any).env.VITE_API_BASE_URL || "http://pos-apis-chatbots-backen-kv6lbk-0befdc-31-97-214-24.traefik.me/api"}/daily-cuts/export?period=${period}${buildQuery(filters).replace("?", "&")}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ message: "Request failed" }));
        throw new Error(errorBody.message || "Request failed");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const disposition = response.headers.get("Content-Disposition");
      const filenameMatch = disposition?.match(/filename="(.+)"/);

      link.href = url;
      link.download = filenameMatch?.[1] || `corte-${period}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "No fue posible exportar el corte");
    } finally {
      setExporting("");
    }
  }

  async function createManualCut() {
    if (!token) return;
    try {
      setSavingManualCut(true);
      setError("");
      await apiRequest<ManualCut>("/daily-cuts/manual", {
        method: "POST",
        token,
        body: JSON.stringify({
          cut_date: manualCutDate || undefined,
          notes: manualCutNotes || undefined
        })
      });
      setManualCutDate("");
      setManualCutNotes("");
      await loadToday();
      await loadHistory(filters);
      if (!isCashier) {
        await loadManualCuts();
      }
    } catch (manualError) {
      setError(manualError instanceof Error ? manualError.message : "No fue posible registrar el corte manual");
    } finally {
      setSavingManualCut(false);
    }
  }

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Corte diario</h2>
            <p className="muted">{today ? dateLabel(today.cut_date) : "-"}</p>
          </div>
          <div className="share-actions">
            <a className="button ghost" href={`https://wa.me/?text=${encodedShareMessage}`} rel="noreferrer" target="_blank">Enviar por WhatsApp</a>
            <a className="button ghost" href={`mailto:?subject=Corte Diario ${today ? shortDate(today.cut_date) : ""}&body=${encodedShareMessage}`}>Enviar por correo</a>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="stats-grid">
          <div className="stat-card"><span className="stat-label">Fecha</span><strong className="stat-value">{today ? shortDate(today.cut_date) : "-"}</strong></div>
          <div className="stat-card"><span className="stat-label">Total del dia</span><strong className="stat-value">{currency(today?.total_day || 0)}</strong></div>
          <div className="stat-card"><span className="stat-label">Efectivo</span><strong className="stat-value">{currency(today?.cash_total || 0)}</strong></div>
          <div className="stat-card"><span className="stat-label">Tarjeta</span><strong className="stat-value">{currency(today?.card_total || 0)}</strong></div>
          <div className="stat-card"><span className="stat-label">Credito</span><strong className="stat-value">{currency(today?.credit_total || 0)}</strong></div>
          <div className="stat-card"><span className="stat-label">Transferencia</span><strong className="stat-value">{currency(today?.transfer_total || 0)}</strong></div>
          <div className="stat-card"><span className="stat-label">Facturas emitidas</span><strong className="stat-value">{today?.invoice_count || 0}</strong></div>
          <div className="stat-card"><span className="stat-label">Tickets</span><strong className="stat-value">{today?.ticket_count || 0}</strong></div>
          <div className="stat-card"><span className="stat-label">Timbres usados</span><strong className="stat-value">{today?.timbres_usados || 0}</strong></div>
          <div className="stat-card"><span className="stat-label">Timbres restantes</span><strong className="stat-value">{today?.timbres_restantes || 0}</strong></div>
          <div className="stat-card"><span className="stat-label">Ganancia</span><strong className="stat-value">{currency(today?.gross_profit || 0)}</strong></div>
          <div className="stat-card"><span className="stat-label">Margen</span><strong className="stat-value">{Number(today?.gross_margin || 0).toFixed(2)}%</strong></div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Historico de cortes</h2>
            <p className="muted">Filtro actual por usuario: {activeUserName}</p>
          </div>
          {!isCashier ? (
            <div className="inline-actions">
              <button className="button ghost" disabled={exporting !== ""} onClick={() => exportExcel("daily")} type="button">
                {exporting === "daily" ? "Exportando..." : "Exportar corte diario"}
              </button>
              <button className="button ghost" disabled={exporting !== ""} onClick={() => exportExcel("monthly")} type="button">
                {exporting === "monthly" ? "Exportando..." : "Exportar corte mensual"}
              </button>
            </div>
          ) : null}
        </div>

        <div className="grid-form">
          <label>
            Fecha
            <input type="date" value={filters.date} onChange={(event) => setFilters({ ...filters, date: event.target.value })} />
          </label>
          <label>
            Desde
            <input type="date" value={filters.date_from} onChange={(event) => setFilters({ ...filters, date_from: event.target.value })} />
          </label>
          <label>
            Hasta
            <input type="date" value={filters.date_to} onChange={(event) => setFilters({ ...filters, date_to: event.target.value })} />
          </label>
          {!isCashier ? (
            <label>
              Usuario
              <select value={filters.user_id} onChange={(event) => setFilters({ ...filters, user_id: event.target.value })}>
                <option value="">Todos</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>{user.full_name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Mes
            <input type="month" value={filters.month} onChange={(event) => setFilters({ ...filters, month: event.target.value })} />
          </label>
          <div className="inline-actions">
            <button className="button" onClick={applyFilters} type="button">Aplicar filtros</button>
            <button className="button ghost" onClick={resetFilters} type="button">Limpiar</button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Total</th>
                <th>Efectivo</th>
                <th>Tarjeta</th>
                <th>Transferencia</th>
                <th>Facturas</th>
                <th>Timbres usados</th>
                <th>Timbres restantes</th>
                <th>Ganancia</th>
              </tr>
            </thead>
            <tbody>
              {history.map((cut) => (
                <tr key={`${cut.cut_date}-${cut.month || "day"}`}>
                  <td>{cut.month || shortDate(cut.cut_date)}</td>
                  <td>{currency(cut.total_day)}</td>
                  <td>{currency(cut.cash_total)}</td>
                  <td>{currency(cut.card_total)}</td>
                  <td>{currency(cut.transfer_total)}</td>
                  <td>{cut.invoice_count}</td>
                  <td>{cut.timbres_usados || 0}</td>
                  <td>{cut.timbres_restantes || 0}</td>
                  <td>{currency(cut.gross_profit)}</td>
                </tr>
              ))}
              {history.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={9}>No hay cortes para los filtros seleccionados.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Corte Manual</h2>
            <p className="muted">
              {isCashier
                ? "Registra tu corte manual. El admin podra consultarlo despues con tu nombre y fecha."
                : "Registra cortes manuales y consulta el historial con trazabilidad por usuario."}
            </p>
          </div>
        </div>
        <div className="grid-form">
          <label>
            Fecha
            <input type="date" value={manualCutDate} onChange={(event) => setManualCutDate(event.target.value)} />
          </label>
          <label className="form-span-2">
            Notas
            <textarea value={manualCutNotes} onChange={(event) => setManualCutNotes(event.target.value)} />
          </label>
          <div className="inline-actions">
            <button className="button" disabled={savingManualCut} onClick={createManualCut} type="button">
              {savingManualCut ? "Registrando..." : "Registrar corte manual"}
            </button>
          </div>
        </div>
        {!isCashier ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Registrado por</th>
                  <th>Registrado en</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                {manualCuts.map((cut) => (
                  <tr key={cut.id}>
                    <td>{shortDate(cut.cut_date)}</td>
                    <td>{cut.cut_type}</td>
                    <td>{cut.performed_by_name_snapshot}</td>
                    <td>{shortDateTime(cut.created_at)}</td>
                    <td>{cut.notes || "-"}</td>
                  </tr>
                ))}
                {!manualCuts.length ? (
                  <tr>
                    <td className="muted" colSpan={5}>No hay cortes manuales registrados.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
