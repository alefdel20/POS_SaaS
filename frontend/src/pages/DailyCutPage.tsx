import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { DailyCut, ManualCut, User } from "../types";
import { currency, dateLabel, shortDate } from "../utils/format";
import { isCashierRole } from "../utils/roles";

type FilterState = {
  date: string;
  date_from: string;
  date_to: string;
  user_id: string;
  month: string;
};

type Denominations = Record<string, number>;
type CashCutFilter = "all" | "cash" | "manual";

const BILL_DENOMINATIONS: number[] = [1000, 500, 200, 100, 50, 20];
const COIN_DENOMINATIONS: number[] = [10, 5, 2, 1, 0.5];
const ALL_DENOMINATIONS: number[] = [...BILL_DENOMINATIONS, ...COIN_DENOMINATIONS];

function initialDenominations(): Denominations {
  const obj: Denominations = {};
  for (const d of ALL_DENOMINATIONS) obj[String(d)] = 0;
  return obj;
}

function formatDenomination(d: number): string {
  return d < 1 ? `$${d}` : `$${d.toLocaleString("es-MX")}`;
}

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

function DiffCell({ diff }: { diff: number | null | undefined }) {
  if (diff == null) return <span>-</span>;
  if (diff === 0) return <span style={{ color: "var(--ankode-green)" }}>✅ Cuadra</span>;
  if (diff > 0) return <span style={{ color: "var(--warning)" }}>↑ +{currency(diff)} Sobrante</span>;
  return <span style={{ color: "var(--danger)" }}>↓ {currency(Math.abs(diff))} Faltante</span>;
}

export function DailyCutPage() {
  const { token, user } = useAuth();
  const [today, setToday] = useState<DailyCut | null>(null);
  const [history, setHistory] = useState<DailyCut[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [manualCuts, setManualCuts] = useState<ManualCut[]>([]);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState<"" | "daily" | "monthly">("");
  const [savingManualCut, setSavingManualCut] = useState(false);
  const [denominations, setDenominations] = useState<Denominations>(initialDenominations);
  const [savingCashCount, setSavingCashCount] = useState(false);
  const [cashCountSuccess, setCashCountSuccess] = useState("");
  const [showCashCount, setShowCashCount] = useState(false);
  const [cashCutFilter, setCashCutFilter] = useState<CashCutFilter>("all");
  const [cashSession, setCashSession] = useState<{
    session_id: number;
    opening_amount: number;
    opened_at: string;
    opened_by_name: string;
  } | null>(null);
  const [openingInput, setOpeningInput] = useState("");
  const [openingCash, setOpeningCash] = useState(false);
  const [sessionError, setSessionError] = useState("");

  async function loadCashSession() {
    if (!token) return;
    const response = await apiRequest<{
      session_id: number;
      opening_amount: number;
      opened_at: string;
      opened_by_name: string;
    } | null>("/daily-cuts/cash-register/current", { token });
    setCashSession(response);
  }

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
    loadCashSession().catch(() => {});
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

  const todayCashReal = Number(today?.cash_real ?? today?.total_day ?? 0);
  const todayCreditGenerated = Number(today?.credit_generated ?? today?.credit_total ?? 0);
  const todayCreditCollected = Number(today?.credit_collected ?? 0);

  const shareMessage = today
    ? `Corte Diario\nFecha: ${shortDate(today.cut_date)}\n\nIngresos reales: ${currency(todayCashReal)}\nCredito generado: ${currency(todayCreditGenerated)}\nCobranza: ${currency(todayCreditCollected)}\nInversión en inventario (hoy): ${currency(today.inventory_restock_total || 0)}\nEfectivo: ${currency(today.cash_total)}\nTarjeta: ${currency(today.card_total)}\nTransferencia: ${currency(today.transfer_total)}\nFacturas: ${today.invoice_count}\n\nGanancia: ${currency(today.gross_profit)}\nTickets: ${today.ticket_count}`
    : "";
  const encodedShareMessage = encodeURIComponent(shareMessage);

  const activeUserName = useMemo(() => {
    if (!filters.user_id) return "Todos";
    return users.find((u) => u.id === Number(filters.user_id))?.full_name || `Usuario #${filters.user_id}`;
  }, [filters.user_id, users]);

  const isCashier = isCashierRole(user?.role);

  const previousComparableCut = useMemo(
    () => history.find((cut) => cut.cut_date !== today?.cut_date && !cut.month) || null,
    [history, today?.cut_date]
  );
  const totalComparison = today && previousComparableCut ? today.total_day - previousComparableCut.total_day : null;
  const profitComparison = today && previousComparableCut ? today.gross_profit - previousComparableCut.gross_profit : null;

  const cashCountedTotal = ALL_DENOMINATIONS.reduce((sum, d) => sum + (denominations[String(d)] || 0) * d, 0);
  const expectedCash = Number(today?.cash_real ?? 0);
  const cashDifference = cashCountedTotal - expectedCash;

  const filteredManualCuts = useMemo(() => {
    if (cashCutFilter === "cash") return manualCuts.filter((c) => c.cash_counted_total != null);
    if (cashCutFilter === "manual") return manualCuts.filter((c) => c.cash_counted_total == null);
    return manualCuts;
  }, [manualCuts, cashCutFilter]);

  function closeCashCount() {
    setShowCashCount(false);
    setCashCountSuccess("");
  }

  async function saveCashCount() {
    if (!token) return;
    const diffLabel =
      cashDifference === 0
        ? "Cuadra"
        : cashDifference > 0
          ? `Sobrante $${cashDifference.toFixed(2)}`
          : `Faltante $${Math.abs(cashDifference).toFixed(2)}`;
    const autoNotes = `Conteo de caja: $${cashCountedTotal.toFixed(2)} contado vs $${expectedCash.toFixed(2)} esperado. Diferencia: ${cashDifference >= 0 ? "+" : ""}$${cashDifference.toFixed(2)} (${diffLabel})`;
    try {
      setSavingCashCount(true);
      setCashCountSuccess("");
      setError("");
      await apiRequest<ManualCut>("/daily-cuts/manual", {
        method: "POST",
        token,
        body: JSON.stringify({
          cut_date: today?.cut_date || undefined,
          notes: autoNotes,
          cash_count: denominations,
          cash_counted_total: cashCountedTotal,
          cash_difference: cashDifference
        })
      });
      setCashCountSuccess("Conteo guardado correctamente.");
      setDenominations(initialDenominations());
      if (!isCashier) await loadManualCuts();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible guardar el conteo");
    } finally {
      setSavingCashCount(false);
    }
  }

  async function handleOpenCashRegister() {
    if (!token) return;
    const amount = parseFloat(openingInput);
    if (isNaN(amount) || amount < 0) {
      setSessionError("Ingresa un monto válido (>= 0)");
      return;
    }
    try {
      setOpeningCash(true);
      setSessionError("");
      await apiRequest("/daily-cuts/cash-register/open", {
        method: "POST",
        token,
        body: JSON.stringify({ opening_amount: amount })
      });
      setOpeningInput("");
      await loadCashSession();
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : "No fue posible abrir la caja");
    } finally {
      setOpeningCash(false);
    }
  }

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
        headers: { Authorization: `Bearer ${token}` }
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

  // kept per constraint — may be triggered externally or re-added later
  void savingManualCut;
  void setSavingManualCut;

  return (
    <>
    <section className="page-grid">

      {/* ── Panel 1: Corte diario ── */}
      <div className="panel">
        {/* ── Sesión de caja ── */}
        <div className="info-card" style={{ marginBottom: "1rem" }}>
          {cashSession ? (
            <p style={{ margin: 0 }}>
              <strong>Caja abierta</strong> — Fondo:{" "}
              <strong>{currency(cashSession.opening_amount)}</strong>
              {" | "}Abierta por: {cashSession.opened_by_name || "—"} a las{" "}
              {new Date(cashSession.opened_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
            </p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem" }}>
              <span className="muted">Caja no abierta</span>
              <input
                type="number"
                min={0}
                step="0.01"
                placeholder="Fondo inicial ($0.00)"
                value={openingInput}
                onChange={(e) => setOpeningInput(e.target.value)}
                style={{ width: 180 }}
              />
              <button className="button" disabled={openingCash} onClick={handleOpenCashRegister} type="button">
                {openingCash ? "Abriendo..." : "Abrir caja"}
              </button>
            </div>
          )}
          {sessionError ? <p className="error-text" style={{ margin: "0.5rem 0 0" }}>{sessionError}</p> : null}
        </div>
        <div className="panel-header">
          <div>
            <h2>
              Corte diario
              <span style={{ fontSize: "1rem", fontWeight: 400, color: "var(--muted)", marginLeft: "0.75rem" }}>
                {today ? shortDate(today.cut_date) : ""}
              </span>
            </h2>
            <p className="muted">{today ? dateLabel(today.cut_date) : "-"}</p>
          </div>
          <div className="share-actions">
            <button className="button ghost" onClick={() => setShowCashCount(true)} type="button">🪙 Corte de Caja</button>
            <a className="button ghost" href={`https://wa.me/?text=${encodedShareMessage}`} rel="noreferrer" target="_blank">Enviar por WhatsApp</a>
            <a className="button ghost" href={`mailto:?subject=Corte Diario ${today ? shortDate(today.cut_date) : ""}&body=${encodedShareMessage}`}>Enviar por correo</a>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div style={{ overflowX: "hidden", width: "100%" }}>
          <div className="stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.75rem" }}>
            <div className="stat-card"><span className="stat-label">Total del dia</span><strong className="stat-value">{today ? currency(today.total_day) : "—"}</strong></div>
            <div className="stat-card"><span className="stat-label">Ingresos reales</span><strong className="stat-value">{today ? currency(todayCashReal) : "—"}</strong></div>
            <div className="stat-card"><span className="stat-label">Efectivo</span><strong className="stat-value">{today ? currency(today.cash_total) : "—"}</strong></div>
            <div className="stat-card"><span className="stat-label">Tarjeta</span><strong className="stat-value">{today ? currency(today.card_total) : "—"}</strong></div>
            <div className="stat-card"><span className="stat-label">Transferencia</span><strong className="stat-value">{today ? currency(today.transfer_total) : "—"}</strong></div>
            <div className="stat-card"><span className="stat-label">Credito generado</span><strong className="stat-value">{today ? currency(todayCreditGenerated) : "—"}</strong></div>
            <div className="stat-card"><span className="stat-label">Cobranza</span><strong className="stat-value">{today ? currency(todayCreditCollected) : "—"}</strong></div>
            <div className="stat-card"><span className="stat-label">Inversión en inventario (hoy)</span><strong className="stat-value">{today ? currency(today.inventory_restock_total || 0) : "—"}</strong></div>
            <div className="stat-card"><span className="stat-label">Facturas emitidas</span><strong className="stat-value">{today ? today.invoice_count : "—"}</strong></div>
            <div className="stat-card"><span className="stat-label">Tickets</span><strong className="stat-value">{today ? today.ticket_count : "—"}</strong></div>
            <div className="stat-card"><span className="stat-label">Ganancia</span><strong className="stat-value">{today ? currency(today.gross_profit) : "—"}</strong></div>
            <div className="stat-card"><span className="stat-label">Margen</span><strong className="stat-value">{today ? `${Number(today.gross_margin || 0).toFixed(2)}%` : "—"}</strong></div>
          </div>
        </div>
        {previousComparableCut ? (
          <div className="info-card">
            <p>Comparado con {shortDate(previousComparableCut.cut_date)}: <strong>{totalComparison && totalComparison >= 0 ? "+" : ""}{currency(totalComparison || 0)}</strong> en total del dia.</p>
            <p>Diferencia en ganancia: <strong>{profitComparison && profitComparison >= 0 ? "+" : ""}{currency(profitComparison || 0)}</strong>.</p>
          </div>
        ) : (
          <div className="info-card">
            <p>No hay suficiente historico claro para mostrar comparacion diaria.</p>
          </div>
        )}
        <div className="info-card">
          <h3>Resumen de Cartera</h3>
          <div className="stats-grid">
            <div className="stat-card"><span className="stat-label">Generado Hoy</span><strong className="stat-value">{today ? currency(todayCreditGenerated) : "—"}</strong></div>
            <div className="stat-card"><span className="stat-label">Cobrado Hoy</span><strong className="stat-value">{today ? currency(todayCreditCollected) : "—"}</strong></div>
          </div>
        </div>
      </div>

      {/* ── Panel 2: Histórico de cortes ── */}
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

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", minWidth: 140, flex: 1 }}>
            <span className="muted" style={{ fontSize: "0.92rem", marginBottom: "0.35rem" }}>Fecha</span>
            <input type="date" value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", minWidth: 140, flex: 1 }}>
            <span className="muted" style={{ fontSize: "0.92rem", marginBottom: "0.35rem" }}>Desde</span>
            <input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", minWidth: 140, flex: 1 }}>
            <span className="muted" style={{ fontSize: "0.92rem", marginBottom: "0.35rem" }}>Hasta</span>
            <input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} />
          </label>
          {!isCashier ? (
            <label style={{ display: "flex", flexDirection: "column", minWidth: 140, flex: 1 }}>
              <span className="muted" style={{ fontSize: "0.92rem", marginBottom: "0.35rem" }}>Usuario</span>
              <select value={filters.user_id} onChange={(e) => setFilters({ ...filters, user_id: e.target.value })}>
                <option value="">Todos</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label style={{ display: "flex", flexDirection: "column", minWidth: 140, flex: 1 }}>
            <span className="muted" style={{ fontSize: "0.92rem", marginBottom: "0.35rem" }}>Mes</span>
            <input type="month" value={filters.month} onChange={(e) => setFilters({ ...filters, month: e.target.value })} />
          </label>
          <div className="inline-actions" style={{ alignSelf: "flex-end" }}>
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
                <th>Ingresos reales</th>
                <th>Efectivo</th>
                <th>Tarjeta</th>
                <th>Credito generado</th>
                <th>Cobranza</th>
                <th>Transferencia</th>
                <th>Inversión en inventario</th>
                <th>Facturas</th>
                <th>Ganancia</th>
              </tr>
            </thead>
            <tbody>
              {history.map((cut) => (
                <tr key={`${cut.cut_date}-${cut.month || "day"}`}>
                  <td>{cut.month || shortDate(cut.cut_date)}</td>
                  <td>{currency(cut.total_day)}</td>
                  <td>{currency(cut.cash_real ?? cut.total_day)}</td>
                  <td>{currency(cut.cash_total)}</td>
                  <td>{currency(cut.card_total)}</td>
                  <td>{currency(cut.credit_generated ?? cut.credit_total)}</td>
                  <td>{currency(cut.credit_collected || 0)}</td>
                  <td>{currency(cut.transfer_total)}</td>
                  <td>{currency(cut.inventory_restock_total || 0)}</td>
                  <td>{cut.invoice_count}</td>
                  <td>{currency(cut.gross_profit)}</td>
                </tr>
              ))}
              {history.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={11}>No hay cortes para los filtros seleccionados.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Panel 3: Historial de Cortes de Caja ── */}
      {!isCashier ? (
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Historial de Cortes de Caja</h2>
              <p className="muted">Registro de conteos de caja y cortes manuales con trazabilidad por usuario.</p>
            </div>
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className="muted" style={{ fontSize: "0.92rem", whiteSpace: "nowrap" }}>Tipo:</span>
              <select
                value={cashCutFilter}
                onChange={(e) => setCashCutFilter(e.target.value as CashCutFilter)}
                style={{ maxWidth: 200 }}
              >
                <option value="all">Todos</option>
                <option value="cash">Corte de caja</option>
                <option value="manual">Corte manual</option>
              </select>
            </label>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Efectivo contado</th>
                  <th>Diferencia</th>
                  <th>Registrado por</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                {filteredManualCuts.map((cut) => (
                  <tr key={cut.id}>
                    <td>{shortDate(cut.cut_date)}</td>
                    <td>{cut.cash_counted_total != null ? "Corte de caja" : "Corte manual"}</td>
                    <td>{cut.cash_counted_total != null ? currency(cut.cash_counted_total) : "-"}</td>
                    <td><DiffCell diff={cut.cash_difference} /></td>
                    <td>{cut.performed_by_name_snapshot}</td>
                    <td>{cut.notes && cut.notes.length > 60 ? `${cut.notes.slice(0, 60)}…` : (cut.notes || "-")}</td>
                  </tr>
                ))}
                {filteredManualCuts.length === 0 ? (
                  <tr>
                    <td className="muted" colSpan={6}>No hay registros para el filtro seleccionado.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

    </section>

    {showCashCount ? (
      <div
        className="modal-backdrop"
        onClick={(e) => { if (e.target === e.currentTarget) closeCashCount(); }}
      >
        <div className="modal-card" style={{ width: "min(860px, 96vw)", maxHeight: "min(92vh, 900px)" }}>
          <div className="panel-header" style={{ marginBottom: "1rem" }}>
            <div>
              <h2 style={{ margin: 0 }}>🪙 Conteo de Caja</h2>
              <p className="muted" style={{ margin: 0 }}>Cuenta el dinero físico en caja y compara con lo registrado en el POS</p>
            </div>
            <button className="button ghost" onClick={closeCashCount} type="button">✕ Cerrar</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.5rem" }}>
            <div>
              <p style={{ fontWeight: 600, marginBottom: "0.5rem", marginTop: 0 }}>Billetes</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {BILL_DENOMINATIONS.map((d) => {
                  const qty = denominations[String(d)] || 0;
                  const subtotal = qty * d;
                  return (
                    <div key={d} style={{ display: "grid", gridTemplateColumns: "60px 1fr 70px", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontWeight: 500 }}>{formatDenomination(d)}</span>
                      <input
                        min={0}
                        type="number"
                        value={qty}
                        onChange={(e) => {
                          const val = e.target.value === "" ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0);
                          setDenominations({ ...denominations, [String(d)]: val });
                        }}
                        onFocus={(e) => e.target.select()}
                      />
                      <span className="muted" style={{ textAlign: "right" }}>{currency(subtotal)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <p style={{ fontWeight: 600, marginBottom: "0.5rem", marginTop: 0 }}>Monedas</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {COIN_DENOMINATIONS.map((d) => {
                  const qty = denominations[String(d)] || 0;
                  const subtotal = qty * d;
                  return (
                    <div key={d} style={{ display: "grid", gridTemplateColumns: "60px 1fr 70px", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontWeight: 500 }}>{formatDenomination(d)}</span>
                      <input
                        min={0}
                        type="number"
                        value={qty}
                        onChange={(e) => {
                          const val = e.target.value === "" ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0);
                          setDenominations({ ...denominations, [String(d)]: val });
                        }}
                        onFocus={(e) => e.target.select()}
                      />
                      <span className="muted" style={{ textAlign: "right" }}>{currency(subtotal)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="info-card">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
              <div className="stat-card" style={{ minWidth: 180, flex: "1 1 180px" }}>
                <span className="stat-label">Total contado</span>
                <strong className="stat-value">{currency(cashCountedTotal)}</strong>
              </div>
              <div className="stat-card" style={{ minWidth: 180, flex: "1 1 180px" }}>
                <span className="stat-label">Efectivo esperado (POS)</span>
                <strong className="stat-value">{currency(expectedCash)}</strong>
              </div>
              <div className="stat-card" style={{ minWidth: 180, flex: "1 1 180px" }}>
                <span className="stat-label">Diferencia</span>
                <strong
                  className="stat-value"
                  style={{
                    color: cashDifference === 0
                      ? "var(--ankode-green)"
                      : cashDifference > 0
                        ? "var(--warning)"
                        : "var(--danger)"
                  }}
                >
                  {cashDifference === 0
                    ? `${currency(0)} ✅ Cuadra`
                    : cashDifference > 0
                      ? `+${currency(cashDifference)} ⚠️ Sobrante`
                      : `${currency(cashDifference)} ❌ Faltante`}
                </strong>
              </div>
            </div>
          </div>

          <div className="inline-actions" style={{ marginTop: "1rem" }}>
            <button className="button" disabled={savingCashCount} onClick={saveCashCount} type="button">
              {savingCashCount ? "Guardando..." : "💾 Guardar conteo"}
            </button>
          </div>
          {cashCountSuccess ? <p className="success-text" style={{ marginTop: "0.5rem" }}>{cashCountSuccess}</p> : null}
        </div>
      </div>
    ) : null}
    </>
  );
}
