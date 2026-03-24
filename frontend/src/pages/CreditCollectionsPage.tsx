import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { CreditPayment, Debtor } from "../types";
import { currency, shortDate } from "../utils/format";
import { getPaymentMethodLabel } from "../utils/uiLabels";
import { getMexicoCityDateInputValue } from "../utils/timezone";

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
  const { token } = useAuth();
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);
  const [payments, setPayments] = useState<CreditPayment[]>([]);
  const [form, setForm] = useState(emptyPayment);
  const [error, setError] = useState("");
  const [sendingReminder, setSendingReminder] = useState(false);

  async function loadDebtors() {
    if (!token) return;
    const response = await apiRequest<Debtor[]>("/credit-collections", { token });
    setDebtors(response);
    setSelectedSaleId((current) => current ?? response[0]?.sale_id ?? null);
  }

  async function loadPayments(saleId: number) {
    if (!token) return;
    const response = await apiRequest<CreditPayment[]>(`/credit-collections/${saleId}/payments`, { token });
    setPayments(response);
  }

  useEffect(() => {
    loadDebtors().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar deudores");
    });
  }, [token]);

  useEffect(() => {
    if (!selectedSaleId) return;
    loadPayments(selectedSaleId).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar los abonos");
    });
  }, [selectedSaleId, token]);

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
          payment_date: form.payment_date,
          notes: form.notes
        })
      });
      setForm(emptyPayment);
      await loadDebtors();
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
      await loadDebtors();
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

  return (
    <section className="page-grid two-columns">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Panel de deudores</h2>
            <p className="muted">Saldo final = total venta - total abonado.</p>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="table-wrap">
          <table className="credit-collections-table">
            <thead>
              <tr>
                <th>Persona</th>
                <th>Teléfono</th>
                <th>Saldo pendiente</th>
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
                  <td>{debtor.person}</td>
                  <td>{debtor.phone}</td>
                  <td>{currency(debtor.balance_due)}</td>
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
                  <td className="muted" colSpan={4}>No hay ventas pendientes.</td>
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
              <p className="muted">{selectedDebtor ? `${selectedDebtor.person} | venta #${selectedDebtor.sale_id}` : "Selecciona una venta a crédito"}</p>
            </div>
          </div>
          <label>
            Monto *
            <input min="0" step="0.01" required type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
          </label>
          <label>
            Método de pago *
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
          ) : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Monto</th>
                  <th>Metodo</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{shortDate(payment.payment_date)}</td>
                    <td>{currency(payment.amount)}</td>
                    <td>{getPaymentMethodLabel(payment.payment_method)}</td>
                  </tr>
                ))}
                {payments.length === 0 ? (
                  <tr>
                    <td className="muted" colSpan={3}>Sin abonos registrados.</td>
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
