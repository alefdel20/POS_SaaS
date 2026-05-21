import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { CatalogClient, CreditPayment, CreditSaleSummary, Debtor } from "../types";
import { currency, normalizeDateInput, shortDate } from "../utils/format";
import { getPaymentMethodLabel } from "../utils/uiLabels";
import { getMexicoCityDateInputValue } from "../utils/timezone";
import { canUseCreditCollections } from "../utils/pos";

type PaymentFormState = {
  amount: string;
  payment_method: CreditPayment["payment_method"];
  payment_date: string;
  notes: string;
};

type DebtorGroup = {
  key: string;
  person: string;
  phone: string;
  sales: Debtor[];
  total_balance_due: number;
  has_overdue: boolean;
};

const emptyPayment: PaymentFormState = {
  amount: "",
  payment_method: "cash",
  payment_date: getMexicoCityDateInputValue(),
  notes: ""
};

function normalizeDebtorName(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeDebtorPhone(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length > 10) {
    return digits.slice(-10);
  }
  return digits;
}

function buildDebtorGroups(items: Debtor[]) {
  const grouped = new Map<string, DebtorGroup>();

  for (const debtor of items) {
    const normalizedName = normalizeDebtorName(debtor.person);
    const normalizedPhone = normalizeDebtorPhone(debtor.phone);
    const key = debtor.client_id
      ? `client:${debtor.client_id}`
      : normalizedName && normalizedPhone
        ? `${normalizedName}::${normalizedPhone}`
        : `sale:${debtor.sale_id}`;

    const existing = grouped.get(key);
    if (existing) {
      existing.sales.push(debtor);
      existing.total_balance_due += Number(debtor.balance_due || 0);
      existing.has_overdue = existing.has_overdue || debtor.status === "overdue";
      continue;
    }

    grouped.set(key, {
      key,
      person: String(debtor.person || "").trim() || "Cliente sin nombre",
      phone: String(debtor.phone || "").trim(),
      sales: [debtor],
      total_balance_due: Number(debtor.balance_due || 0),
      has_overdue: debtor.status === "overdue"
    });
  }

  return Array.from(grouped.values());
}

function resolveGroupSale(group: DebtorGroup, selectedSaleId: number | null) {
  if (selectedSaleId) {
    const selected = group.sales.find((sale) => sale.sale_id === selectedSaleId);
    if (selected) return selected;
  }
  return group.sales[0] || null;
}

export function CreditCollectionsPage() {
  const { token, user } = useAuth();
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);
  const [payments, setPayments] = useState<CreditPayment[]>([]);
  const [saleSummary, setSaleSummary] = useState<CreditSaleSummary | null>(null);
  const [form, setForm] = useState(emptyPayment);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "overdue">("all");
  const [error, setError] = useState("");
  const [sendingReminder, setSendingReminder] = useState(false);
  const [activeTab, setActiveTab] = useState<"deudores" | "clientes">("deudores");
  const [clients, setClients] = useState<CatalogClient[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [clientLoading, setClientLoading] = useState(false);
  const [clientError, setClientError] = useState("");
  const [editingClient, setEditingClient] = useState<CatalogClient | null>(null);
  const [editForm, setEditForm] = useState({ name: "", phone: "", email: "", notes: "" });
  const [showAddClient, setShowAddClient] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", phone: "", email: "", notes: "" });
  const [liquidarModalOpen, setLiquidarModalOpen] = useState(false);
  const [abonoModalOpen, setAbonoModalOpen] = useState(false);
  const [liquidarMontoRecibido, setLiquidarMontoRecibido] = useState("");
  const [liquidarSaldoTotal, setLiquidarSaldoTotal] = useState(0);
  const [clientsWithDebt, setClientsWithDebt] = useState<Set<number>>(new Set());
  const [syncMessage, setSyncMessage] = useState("");
  const isAvailable = canUseCreditCollections(user?.pos_type);
  const tenantRequestRef = useRef(0);
  const debtorGroups = useMemo(() => buildDebtorGroups(debtors), [debtors]);
  const selectedDebtor = debtors.find((debtor) => debtor.sale_id === selectedSaleId) || null;
  const selectedDebtorGroup = useMemo(
    () => debtorGroups.find((group) => group.sales.some((sale) => sale.sale_id === selectedSaleId)) || null,
    [debtorGroups, selectedSaleId]
  );

  if (!isAvailable) {
    return (
      <section className="page-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Credito y Cobranza</h2>
              <p className="muted">Este modulo no esta disponible para el giro Dentista.</p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  async function loadDebtors(nextSearch = search, nextStatus = statusFilter, requestId?: number) {
    if (!token) return;
    const params = new URLSearchParams();
    if (nextSearch.trim()) {
      params.set("search", nextSearch.trim());
    }
    if (nextStatus !== "all") {
      params.set("status", nextStatus);
    }

    const response = await apiRequest<Debtor[]>(`/credit-collections?${params.toString()}`, { token });
    if (requestId !== undefined && tenantRequestRef.current !== requestId) {
      return;
    }
    setDebtors(response);
    setSelectedSaleId((current) => {
      if (current && response.some((debtor) => debtor.sale_id === current)) {
        return current;
      }
      return response[0]?.sale_id ?? null;
    });
  }

  async function loadPayments(saleId: number, requestId?: number) {
    if (!token) return;
    const response = await apiRequest<CreditPayment[]>(`/credit-collections/${saleId}/payments`, { token });
    if (requestId !== undefined && tenantRequestRef.current !== requestId) {
      return;
    }
    setPayments(response.map((payment) => ({
      ...payment,
      payment_date: normalizeDateInput(payment.payment_date, payment.payment_date)
    })));
  }

  async function loadSaleSummary(saleId: number, requestId?: number) {
    if (!token) return;
    const response = await apiRequest<CreditSaleSummary>(`/credit-collections/${saleId}/summary`, { token });
    if (requestId !== undefined && tenantRequestRef.current !== requestId) {
      return;
    }
    setSaleSummary(response);
  }

  useEffect(() => {
    tenantRequestRef.current += 1;
    setDebtors([]);
    setSelectedSaleId(null);
    setPayments([]);
    setSaleSummary(null);
  }, [token, user?.business_id]);

  useEffect(() => {
    const requestId = tenantRequestRef.current;
    loadDebtors(search, statusFilter, requestId).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar deudores");
    });
  }, [token, user?.business_id]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      const requestId = tenantRequestRef.current;
      loadDebtors(search, statusFilter, requestId).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible filtrar deudores");
      });
    }, 250);

    return () => clearTimeout(timeout);
  }, [search, statusFilter, token]);

  useEffect(() => {
    if (!selectedSaleId) {
      setSaleSummary(null);
      setPayments([]);
      return;
    }
    const requestId = tenantRequestRef.current;
    loadPayments(selectedSaleId, requestId).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar los abonos");
    });
    loadSaleSummary(selectedSaleId, requestId).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el detalle de la venta");
    });
  }, [selectedSaleId, token, user?.business_id]);

  async function loadClients() {
    if (!token) return;
    setClientLoading(true);
    setClientError("");
    try {
      const params = new URLSearchParams();
      if (clientSearch.trim()) params.set("search", clientSearch.trim());
      const [response, allDebtors] = await Promise.all([
        apiRequest<CatalogClient[]>(`/catalog-clients?${params.toString()}`, { token }),
        apiRequest<Debtor[]>("/credit-collections", { token })
      ]);
      setClients(response);
      setClientsWithDebt(new Set<number>(
        allDebtors
          .filter((d) => d.client_id != null && Number(d.balance_due) > 0)
          .map((d) => d.client_id as number)
      ));
    } catch (loadError) {
      setClientError(loadError instanceof Error ? loadError.message : "No fue posible cargar clientes");
    } finally {
      setClientLoading(false);
    }
  }

  async function syncClients() {
    if (!token) return;
    setClientLoading(true);
    setClientError("");
    setSyncMessage("");
    try {
      await apiRequest("/catalog-clients/backfill", { method: "POST", token });
      await loadClients();
      setSyncMessage("Clientes sincronizados correctamente");
    } catch (syncError) {
      setClientError(syncError instanceof Error ? syncError.message : "No fue posible sincronizar clientes");
    } finally {
      setClientLoading(false);
    }
  }

  async function saveClient(clientId: number) {
    if (!token) return;
    try {
      setClientError("");
      await apiRequest(`/catalog-clients/${clientId}`, {
        method: "PUT",
        token,
        body: JSON.stringify(editForm)
      });
      setEditingClient(null);
      await loadClients();
    } catch (saveError) {
      setClientError(saveError instanceof Error ? saveError.message : "No fue posible guardar el cliente");
    }
  }

  async function deleteClient(clientId: number, name: string) {
    if (!token) return;
    if (!window.confirm(`¿Eliminar a ${name} del catálogo? Esta acción no se puede deshacer.`)) return;
    try {
      setClientError("");
      await apiRequest(`/catalog-clients/${clientId}`, { method: "DELETE", token });
      await loadClients();
    } catch (deleteError) {
      setClientError(deleteError instanceof Error ? deleteError.message : "No fue posible eliminar el cliente");
    }
  }

  async function addClient() {
    if (!token) return;
    try {
      setClientError("");
      await apiRequest("/catalog-clients", {
        method: "POST",
        token,
        body: JSON.stringify(addForm)
      });
      setShowAddClient(false);
      setAddForm({ name: "", phone: "", email: "", notes: "" });
      await loadClients();
    } catch (addError) {
      setClientError(addError instanceof Error ? addError.message : "No fue posible agregar el cliente");
    }
  }

  useEffect(() => {
    if (activeTab !== "clientes") return;
    const timeout = setTimeout(() => {
      loadClients().catch(() => undefined);
    }, 300);
    return () => clearTimeout(timeout);
  }, [clientSearch, activeTab, token, user?.business_id]);

  async function submitPayment(amount: number) {
    if (!token || !selectedSaleId) return;

    try {
      setError("");
      await apiRequest(`/credit-collections/${selectedSaleId}/payments`, {
        method: "POST",
        token,
        body: JSON.stringify({
          amount,
          payment_method: form.payment_method,
          payment_date: normalizeDateInput(form.payment_date, getMexicoCityDateInputValue()),
          notes: form.notes
        })
      });
      setForm({
        ...emptyPayment,
        payment_date: getMexicoCityDateInputValue()
      });
      await loadDebtors(search, statusFilter);
      await loadPayments(selectedSaleId);
      await loadSaleSummary(selectedSaleId);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible registrar el abono");
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await submitPayment(Number(form.amount));
  }

  async function handleSettleGroup() {
    if (!token || !selectedDebtorGroup) return;
    const pendingIds = selectedDebtorGroup.sales
      .filter((s) => s.balance_due > 0)
      .map((s) => s.sale_id);
    if (pendingIds.length === 0) return;

    try {
      setError("");
      await apiRequest("/credit-collections/settle-group", {
        method: "POST",
        token,
        body: JSON.stringify({ saleIds: pendingIds })
      });
      setLiquidarModalOpen(false);
      setLiquidarMontoRecibido("");
      setSelectedSaleId(null);
      await loadDebtors(search, statusFilter);
    } catch (settleError) {
      setError(settleError instanceof Error ? settleError.message : "No fue posible liquidar las deudas");
    }
  }

  async function updateReminderPreference(saleId: number, sendReminder: boolean) {
    if (!token) return;

    try {
      setError("");
      await apiRequest(`/credit-collections/${saleId}/reminder`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ send_reminder: sendReminder })
      });
      await loadDebtors(search, statusFilter);
    } catch (preferenceError) {
      setError(preferenceError instanceof Error ? preferenceError.message : "No fue posible actualizar el recordatorio");
    }
  }

  async function sendReminder() {
    if (!token || !selectedSaleId) return;

    try {
      setSendingReminder(true);
      setError("");
      const response = await apiRequest<{ whatsapp_url: string; webhook: { attempted: boolean; success: boolean; message: string } }>("/reminders/send", {
        method: "POST",
        token,
        body: JSON.stringify({ sale_id: selectedSaleId })
      });

      window.open(response.whatsapp_url, "_blank", "noopener,noreferrer");
      if (response.webhook.attempted && !response.webhook.success) {
        setError(response.webhook.message);
      }
    } catch (reminderError) {
      setError(reminderError instanceof Error ? reminderError.message : "No fue posible enviar el recordatorio");
    } finally {
      setSendingReminder(false);
    }
  }

  const totalPending = debtorGroups.reduce((sum, group) => sum + group.total_balance_due, 0);
  const overdueCount = debtorGroups.filter((group) => group.has_overdue).length;
  const liquidarCambio = Math.max(Number(liquidarMontoRecibido || 0) - liquidarSaldoTotal, 0);
  const liquidarMontoValido = Number(liquidarMontoRecibido || 0) >= liquidarSaldoTotal && liquidarSaldoTotal > 0;

  return (
    <>
      <div className="inline-actions" style={{ marginBottom: "1rem" }}>
        <button
          className={activeTab === "deudores" ? "button" : "button ghost"}
          onClick={() => setActiveTab("deudores")}
          type="button"
        >
          Deudores
        </button>
        <button
          className={activeTab === "clientes" ? "button" : "button ghost"}
          onClick={() => { setActiveTab("clientes"); setClientError(""); }}
          type="button"
        >
          Clientes
        </button>
      </div>
      {activeTab === "deudores" ? (
      <section className="page-grid two-columns">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Panel de deudores</h2>
            <p className="muted">Saldo final = total venta - total abonado.</p>
          </div>
        </div>
        <div className="credit-summary">
          <div className="total-box secondary">
            <span>Deudores</span>
            <strong>{debtorGroups.length}</strong>
          </div>
          <div className="total-box secondary">
            <span>Saldo pendiente</span>
            <strong>{currency(totalPending)}</strong>
          </div>
          <div className="total-box secondary">
            <span>Atrasados</span>
            <strong>{overdueCount}</strong>
          </div>
        </div>
        <div className="inline-actions quick-filter-row">
          <input
            className="search-input"
            placeholder="Buscar por cliente, telefono o venta"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="all">Todos</option>
            <option value="pending">Pendientes</option>
            <option value="overdue">Vencidos</option>
          </select>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="table-wrap">
          <table className="credit-collections-table credit-collections-table-wide">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Venta</th>
                <th>Saldo pendiente</th>
                <th>Estado</th>
                <th className="credit-reminder-header">Recordatorio</th>
              </tr>
            </thead>
            <tbody>
              {debtorGroups.map((group) => {
                const groupSale = resolveGroupSale(group, selectedSaleId);
                if (!groupSale) {
                  return null;
                }
                return (
                <tr
                  className={group.sales.some((sale) => sale.sale_id === selectedSaleId) ? "table-row-active" : ""}
                  key={group.key}
                  onClick={() => setSelectedSaleId(groupSale.sale_id)}
                >
                  <td>
                    <div>{group.person}</div>
                    <small className="muted">{group.phone || "-"}</small>
                    {group.sales.length > 1 ? <small className="muted">{` ${group.sales.length} ventas a credito`}</small> : null}
                  </td>
                  <td>
                    {group.sales.length === 1 ? (
                      <>
                        <div>{shortDate(groupSale.sale_date)}</div>
                        <small className="muted">Venta #{groupSale.sale_id}</small>
                      </>
                    ) : (
                      <div className="stack-list">
                        {group.sales.map((sale) => (
                          <small className="muted" key={`sale-${sale.sale_id}`}>
                            {shortDate(sale.sale_date)} - Venta #{sale.sale_id} - {currency(sale.balance_due)}
                          </small>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>{currency(group.total_balance_due)}</td>
                  <td>
                    <div>{group.has_overdue ? "Atrasado" : "Pendiente"}</div>
                    <small className="muted">
                      {groupSale.days_overdue ? `${groupSale.days_overdue} dia(s)` : "Sin atraso"}
                    </small>
                  </td>
                  <td className="credit-reminder-cell">
                    <label className="checkbox-row credit-reminder-toggle">
                      <input
                        checked={Boolean(groupSale.send_reminder)}
                        onChange={(event) => {
                          setSelectedSaleId(groupSale.sale_id);
                          updateReminderPreference(groupSale.sale_id, event.target.checked).catch(() => undefined);
                        }}
                        type="checkbox"
                      />
                      <span>{groupSale.send_reminder ? "Activo" : "Inactivo"}</span>
                    </label>
                    {group.sales.length > 1 ? <small className="muted">Aplica a venta #{groupSale.sale_id}</small> : null}
                  </td>
                </tr>
                );
              })}
              {debtors.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={5}>No hay ventas pendientes.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="page-grid">
        {selectedDebtor ? (
          <div className="panel" style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div className="total-box secondary" style={{ flex: 1 }}>
                <span>Saldo pendiente</span>
                <strong>{currency(selectedDebtor.balance_due)}</strong>
              </div>
              <div className="total-box secondary" style={{ flex: 1 }}>
                <span>Días de atraso</span>
                <strong style={{
                  color: selectedDebtor.days_overdue > 0
                    ? "var(--color-text-danger)"
                    : "var(--color-text-success)"
                }}>
                  {selectedDebtor.days_overdue > 0
                    ? `${selectedDebtor.days_overdue} día(s)`
                    : "Al corriente"}
                </strong>
              </div>
            </div>
          </div>
        ) : null}
        <form className="panel grid-form">
          <div className="panel-header">
            <div>
              <h2>Registrar abono</h2>
              <p className="muted">{selectedDebtor ? `${selectedDebtor.person} | venta #${selectedDebtor.sale_id}` : "Selecciona una venta a credito"}</p>
              {selectedDebtorGroup && selectedDebtorGroup.sales.length > 1 ? (
                <small className="muted">
                  Cuenta agrupada con {selectedDebtorGroup.sales.length} ventas pendientes.
                </small>
              ) : null}
            </div>
          </div>
          {selectedDebtorGroup && selectedDebtorGroup.sales.length > 1 ? (
            <label>
              Venta seleccionada
              <select
                value={selectedSaleId || ""}
                onChange={(event) => setSelectedSaleId(Number(event.target.value))}
              >
                {selectedDebtorGroup.sales.map((sale) => (
                  <option key={`selected-sale-${sale.sale_id}`} value={sale.sale_id}>
                    {`${shortDate(sale.sale_date)} - Venta #${sale.sale_id} - ${currency(sale.balance_due)}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Metodo de pago *
            <select value={form.payment_method} onChange={(event) => setForm({ ...form, payment_method: event.target.value as CreditPayment["payment_method"] })}>
              <option value="cash">Efectivo</option>
              <option value="card">Tarjeta</option>
              <option value="transfer">Transferencia</option>
              <option value="credit">Credito</option>
            </select>
          </label>
          <label>
            Fecha *
            <input type="date" value={form.payment_date} onChange={(event) => setForm({ ...form, payment_date: event.target.value })} />
          </label>
          <label>
            Notas
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          <div className="inline-actions">
            <button className="button" disabled={!selectedSaleId} type="button" onClick={() => setAbonoModalOpen(true)}>Registrar abono</button>
            <button
              className="button ghost"
              disabled={!selectedDebtor}
              onClick={() => {
                if (!selectedDebtorGroup) return;
                const saldo = selectedDebtorGroup.total_balance_due;
                setLiquidarSaldoTotal(saldo);
                setLiquidarMontoRecibido(String(saldo));
                setLiquidarModalOpen(true);
              }}
              type="button"
            >
              Liquidar saldo
            </button>
            <button className="button ghost" disabled={!selectedSaleId || sendingReminder} onClick={sendReminder} type="button">
              {sendingReminder ? "Enviando..." : "Enviar recordatorio"}
            </button>
          </div>
        </form>

        <div className="panel">
          <div className="panel-header">
            <h2>Historial de abonos</h2>
          </div>
          {selectedDebtor ? (
            <>
              <div className="credit-summary">
                <div className="total-box secondary">
                  <span>Total venta</span>
                  <strong>{currency(selectedDebtor.total)}</strong>
                </div>
                <div className="total-box secondary">
                  <span>Total abonado</span>
                  <strong>{currency(selectedDebtor.initial_payment + selectedDebtor.total_paid)}</strong>
                </div>
                <div className="total-box secondary">
                  <span>Saldo final</span>
                  <strong>{currency(selectedDebtor.balance_due)}</strong>
                </div>
              </div>
              <div className="info-card">
                <p>Cliente: {selectedDebtor.person || "-"}</p>
                <p>Telefono: {selectedDebtor.phone || "-"}</p>
                <p>Fecha venta: {shortDate(selectedDebtor.sale_date)}</p>
                <p>Estado: {selectedDebtor.status === "overdue" ? "Atrasado" : "Pendiente"}</p>
                <p>Dias de atraso: {selectedDebtor.days_overdue || 0}</p>
              </div>
              <div className="info-card">
                <strong>Productos adeudados de la venta #{selectedDebtor.sale_id}</strong>
                {saleSummary?.items?.length ? (
                  <div className="stack-list" style={{ marginTop: "0.75rem" }}>
                    {saleSummary.items.map((item) => (
                      <div key={`${selectedDebtor.sale_id}-${item.product_id}`}>
                        <div>{item.product_name}</div>
                        <small className="muted">
                          {item.quantity} {item.unidad_de_venta || "pieza"} · {currency(item.subtotal)}
                        </small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted" style={{ marginTop: "0.75rem" }}>Sin productos vinculados para mostrar.</p>
                )}
              </div>
            </>
          ) : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Monto</th>
                  <th>Metodo</th>
                  <th>Venta y productos</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{shortDate(payment.payment_date)}</td>
                    <td>{currency(payment.amount)}</td>
                    <td>{getPaymentMethodLabel(payment.payment_method)}</td>
                    <td>
                      <div>Venta #{payment.sale_id}</div>
                      <small className="muted">
                        {(payment.sale_items || []).map((item) => `${item.product_name} x${item.quantity}`).join(", ") || "Sin detalle"}
                      </small>
                    </td>
                    <td>{payment.notes || "-"}</td>
                  </tr>
                ))}
                {payments.length === 0 ? (
                  <tr>
                    <td className="muted" colSpan={5}>Sin abonos registrados.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {liquidarModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card" style={{ maxWidth: "480px", width: "95vw" }}>
            <div className="panel-header">
              <div>
                <h3>Liquidar saldo</h3>
                <p className="muted">{selectedDebtorGroup?.person || "Cliente"}</p>
              </div>
              <button
                className="button ghost"
                onClick={() => { setLiquidarModalOpen(false); setLiquidarMontoRecibido(""); }}
                type="button"
              >
                Cerrar
              </button>
            </div>
            <div className="total-box">
              <span>Saldo total a liquidar</span>
              <strong>{currency(liquidarSaldoTotal)}</strong>
            </div>
            <div className="form-section-grid">
              <label>
                Monto recibido
                <input
                  autoFocus
                  min="0"
                  step="0.01"
                  type="number"
                  value={liquidarMontoRecibido}
                  onChange={(event) => setLiquidarMontoRecibido(event.target.value)}
                />
              </label>
              {liquidarMontoRecibido !== "" && !liquidarMontoValido ? (
                <p className="error-text">El monto recibido no puede ser menor al saldo</p>
              ) : null}
              {liquidarCambio > 0 ? (
                <div className="total-box secondary">
                  <span>Cambio</span>
                  <strong>{currency(liquidarCambio)}</strong>
                </div>
              ) : null}
              <div className="inline-actions">
                <button
                  className="button"
                  disabled={!liquidarMontoValido}
                  onClick={handleSettleGroup}
                  type="button"
                >
                  Confirmar liquidación
                </button>
                <button
                  className="button ghost"
                  onClick={() => { setLiquidarModalOpen(false); setLiquidarMontoRecibido(""); }}
                  type="button"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {abonoModalOpen && selectedDebtor ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card" style={{ maxWidth: "480px", width: "95vw" }}>
            <div className="panel-header">
              <div>
                <h3>Registrar abono</h3>
                <p className="muted">{selectedDebtor.person} | venta #{selectedDebtor.sale_id}</p>
              </div>
              <button className="button ghost" onClick={() => setAbonoModalOpen(false)} type="button">
                Cerrar
              </button>
            </div>
            <div className="total-box" style={{ marginBottom: "1rem" }}>
              <span>Saldo pendiente</span>
              <strong>{currency(selectedDebtor.balance_due)}</strong>
            </div>
            <div className="form-section-grid">
              <label>
                Monto *
                <input
                  autoFocus
                  min="0"
                  step="0.01"
                  type="number"
                  value={form.amount}
                  onChange={(event) => setForm({ ...form, amount: event.target.value })}
                />
              </label>
              {selectedDebtor && Number(form.amount) > 0 && Number(form.amount) > selectedDebtor.balance_due ? (
                <div className="total-box secondary" style={{ background: "var(--color-background-success)", color: "var(--color-text-success)" }}>
                  <span>Cambio</span>
                  <strong>{currency(Number(form.amount) - selectedDebtor.balance_due)}</strong>
                </div>
              ) : null}
              <label>
                Método de pago *
                <select
                  value={form.payment_method}
                  onChange={(event) => setForm({ ...form, payment_method: event.target.value as CreditPayment["payment_method"] })}
                >
                  <option value="cash">Efectivo</option>
                  <option value="card">Tarjeta</option>
                  <option value="transfer">Transferencia</option>
                  <option value="credit">Crédito</option>
                </select>
              </label>
              <label>
                Fecha *
                <input
                  type="date"
                  value={form.payment_date}
                  onChange={(event) => setForm({ ...form, payment_date: event.target.value })}
                />
              </label>
              <div className="inline-actions">
                <button
                  className="button"
                  disabled={!form.amount || Number(form.amount) <= 0}
                  onClick={async () => {
                    await submitPayment(Number(form.amount));
                    setAbonoModalOpen(false);
                  }}
                  type="button"
                >
                  Confirmar abono
                </button>
                <button className="button ghost" onClick={() => setAbonoModalOpen(false)} type="button">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
    ) : (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Catálogo de clientes</h2>
            <p className="muted">Clientes registrados en el sistema.</p>
          </div>
          <div className="inline-actions">
            <button
              className="button ghost"
              disabled={clientLoading}
              onClick={syncClients}
              type="button"
            >
              Sincronizar clientes
            </button>
            <button
              className="button"
              onClick={() => { setShowAddClient(true); setClientError(""); }}
              type="button"
            >
              Agregar cliente
            </button>
          </div>
        </div>
        <div className="inline-actions quick-filter-row">
          <input
            className="search-input"
            placeholder="Buscar por nombre o teléfono"
            value={clientSearch}
            onChange={(event) => setClientSearch(event.target.value)}
          />
        </div>
        {clientError ? <p className="error-text">{clientError}</p> : null}
        {syncMessage ? <p className="muted">{syncMessage}</p> : null}
        {showAddClient ? (
          <div className="info-card">
            <div className="panel-header" style={{ marginBottom: "0.75rem" }}>
              <strong>Nuevo cliente</strong>
              <button className="button ghost" onClick={() => setShowAddClient(false)} type="button">Cancelar</button>
            </div>
            <label>
              Nombre *
              <input value={addForm.name} onChange={(event) => setAddForm({ ...addForm, name: event.target.value })} />
            </label>
            <label>
              Teléfono
              <input value={addForm.phone} onChange={(event) => setAddForm({ ...addForm, phone: event.target.value })} />
            </label>
            <label>
              Email
              <input value={addForm.email} onChange={(event) => setAddForm({ ...addForm, email: event.target.value })} />
            </label>
            <label>
              Notas
              <textarea value={addForm.notes} onChange={(event) => setAddForm({ ...addForm, notes: event.target.value })} />
            </label>
            <div className="inline-actions" style={{ marginTop: "0.5rem" }}>
              <button className="button" disabled={!addForm.name.trim()} onClick={addClient} type="button">Guardar</button>
              <button className="button ghost" onClick={() => setShowAddClient(false)} type="button">Cancelar</button>
            </div>
          </div>
        ) : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Teléfono</th>
                <th>Email</th>
                <th>Notas</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                editingClient?.id === client.id ? (
                  <tr key={client.id}>
                    <td>
                      <input
                        value={editForm.name}
                        onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        value={editForm.phone}
                        onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        value={editForm.email}
                        onChange={(event) => setEditForm({ ...editForm, email: event.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        value={editForm.notes}
                        onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })}
                      />
                    </td>
                    <td>
                      <div className="inline-actions">
                        <button
                          className="button"
                          disabled={!editForm.name.trim()}
                          onClick={() => saveClient(client.id)}
                          type="button"
                        >
                          Guardar
                        </button>
                        <button className="button ghost" onClick={() => setEditingClient(null)} type="button">Cancelar</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={client.id}>
                    <td><div>{client.name}</div></td>
                    <td><small className="muted">{client.phone || "-"}</small></td>
                    <td><small className="muted">{client.email || "-"}</small></td>
                    <td><small className="muted">{client.notes || "-"}</small></td>
                    <td>
                      <div className="inline-actions">
                        <button
                          className="button ghost"
                          onClick={() => {
                            setEditingClient(client);
                            setEditForm({ name: client.name, phone: client.phone || "", email: client.email || "", notes: client.notes || "" });
                          }}
                          type="button"
                        >
                          Editar
                        </button>
                        {clientsWithDebt.has(client.id) ? (
                          <span className="muted" title="Tiene deuda activa">Con deuda</span>
                        ) : null}
                        <button
                          className="button ghost"
                          disabled={clientsWithDebt.has(client.id)}
                          onClick={() => deleteClient(client.id, client.name)}
                          title={clientsWithDebt.has(client.id) ? "Tiene deuda activa" : undefined}
                          type="button"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
              {clients.length === 0 && !clientLoading ? (
                <tr>
                  <td className="muted" colSpan={5}>No se encontraron clientes.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
    )}
    </>
  );
}
