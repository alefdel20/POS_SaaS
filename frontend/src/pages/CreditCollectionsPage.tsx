import { FormEvent, useEffect, useRef, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { CreditPayment, CreditSaleSummary, Debtor } from "../types";
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

const emptyPayment: PaymentFormState = {
  amount: "",
  payment_method: "cash",
  payment_date: getMexicoCityDateInputValue(),
  notes: ""
};

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
  const isAvailable = canUseCreditCollections(user?.pos_type);
  const tenantRequestRef = useRef(0);

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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token || !selectedSaleId) return;

    try {
      setError("");
      await apiRequest(`/credit-collections/${selectedSaleId}/payments`, {
        method: "POST",
        token,
        body: JSON.stringify({
          amount: Number(form.amount),
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
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible registrar el abono");
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

  const selectedDebtor = debtors.find((debtor) => debtor.sale_id === selectedSaleId) || null;
  const totalPending = debtors.reduce((sum, debtor) => sum + Number(debtor.balance_due || 0), 0);
  const overdueCount = debtors.filter((debtor) => debtor.status === "overdue").length;

  return (
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
            <strong>{debtors.length}</strong>
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
              {debtors.map((debtor) => (
                <tr
                  className={debtor.sale_id === selectedSaleId ? "table-row-active" : ""}
                  key={debtor.sale_id}
                  onClick={() => setSelectedSaleId(debtor.sale_id)}
                >
                  <td>
                    <div>{debtor.person}</div>
                    <small className="muted">{debtor.phone || "-"}</small>
                  </td>
                  <td>
                    <div>{shortDate(debtor.sale_date)}</div>
                    <small className="muted">Venta #{debtor.sale_id}</small>
                  </td>
                  <td>{currency(debtor.balance_due)}</td>
                  <td>
                    <div>{debtor.status === "overdue" ? "Atrasado" : "Pendiente"}</div>
                    <small className="muted">{debtor.days_overdue ? `${debtor.days_overdue} dia(s)` : "Sin atraso"}</small>
                  </td>
                  <td className="credit-reminder-cell">
                    <label className="checkbox-row credit-reminder-toggle">
                      <input
                        checked={Boolean(debtor.send_reminder)}
                        onChange={(event) => {
                          setSelectedSaleId(debtor.sale_id);
                          updateReminderPreference(debtor.sale_id, event.target.checked).catch(() => undefined);
                        }}
                        type="checkbox"
                      />
                      <span>{debtor.send_reminder ? "Activo" : "Inactivo"}</span>
                    </label>
                  </td>
                </tr>
              ))}
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
        <form className="panel grid-form" onSubmit={handleSubmit}>
          <div className="panel-header">
            <div>
              <h2>Registrar abono</h2>
              <p className="muted">{selectedDebtor ? `${selectedDebtor.person} | venta #${selectedDebtor.sale_id}` : "Selecciona una venta a credito"}</p>
            </div>
          </div>
          <label>
            Monto *
            <input min="0" step="0.01" required type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
          </label>
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
            <button className="button" disabled={!selectedSaleId} type="submit">Registrar abono</button>
            <button
              className="button ghost"
              disabled={!selectedDebtor}
              onClick={() => setForm((current) => ({ ...current, amount: selectedDebtor ? String(selectedDebtor.balance_due) : current.amount }))}
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
    </section>
  );
}
