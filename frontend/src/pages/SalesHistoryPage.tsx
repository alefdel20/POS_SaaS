import { Fragment, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { HistoryMovement, Sale, SaleDetail } from "../types";
import { currency, shortDate, shortDateTime } from "../utils/format";
import { getPaymentMethodLabel, getSaleTypeLabel } from "../utils/uiLabels";
import { getMexicoCityDateInputValue } from "../utils/timezone";
import { isManagementRole } from "../utils/roles";

type RangeFilter = "day" | "week" | "month";
type MovementFilter = "all" | "sales" | "credit_collections" | "invoice_payments" | "expenses" | "fixed_expenses" | "owner_debt";

function toDateInputValue(date: Date) {
  return getMexicoCityDateInputValue(date);
}

function getRangeDates(range: RangeFilter, selectedDate: string) {
  const base = selectedDate ? new Date(`${selectedDate}T00:00:00`) : new Date();
  const start = new Date(base);
  const end = new Date(base);

  if (range === "week") {
    const day = start.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diffToMonday);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
  }

  if (range === "month") {
    start.setDate(1);
    end.setMonth(start.getMonth() + 1, 0);
  }

  return {
    start: toDateInputValue(start),
    end: toDateInputValue(end)
  };
}

function getMovementTypeLabel(type: MovementFilter | HistoryMovement["type"]) {
  switch (type) {
    case "sales":
      return "Ventas";
    case "credit_collections":
      return "Abonos";
    case "invoice_payments":
      return "Facturas";
    case "expenses":
      return "Gastos";
    case "fixed_expenses":
      return "Gastos fijos";
    case "owner_debt":
      return "Deuda del dueno";
    case "all":
    default:
      return "Todos";
  }
}

function getMovementPaymentLabel(value?: HistoryMovement["payment_method"] | null) {
  if (!value) {
    return "-";
  }
  return getPaymentMethodLabel(value);
}

export function SalesHistoryPage() {
  const { token, user } = useAuth();
  const [movements, setMovements] = useState<HistoryMovement[]>([]);
  const [selectedMovementId, setSelectedMovementId] = useState<string | null>(null);
  const [saleDetail, setSaleDetail] = useState<SaleDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");
  const [range, setRange] = useState<RangeFilter>("day");
  const [selectedDate, setSelectedDate] = useState(toDateInputValue(new Date()));
  const [movementType, setMovementType] = useState<MovementFilter>("all");
  const [folio, setFolio] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [cashier, setCashier] = useState("");
  const [total, setTotal] = useState("");
  const [cancelTarget, setCancelTarget] = useState<Sale | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelLoading, setCancelLoading] = useState(false);

  const activeRange = useMemo(() => getRangeDates(range, selectedDate), [range, selectedDate]);
  const today = getMexicoCityDateInputValue(new Date());
  const canCancelSales = isManagementRole(user?.role);
  const selectedMovement = useMemo(
    () => movements.find((movement) => movement.id === selectedMovementId) || null,
    [movements, selectedMovementId]
  );
  const selectedSaleId = selectedMovement?.sale_id || null;

  async function loadHistory() {
    if (!token) return;

    const params = new URLSearchParams();
    params.set("type", movementType);
    if (range === "day") {
      params.set("date", activeRange.start);
    } else {
      params.set("date_from", activeRange.start);
      params.set("date_to", activeRange.end);
    }
    if (folio.trim()) {
      params.set("folio", folio.trim());
    }
    if (paymentMethod) {
      params.set("payment_method", paymentMethod);
    }
    if (cashier.trim()) {
      params.set("cashier", cashier.trim());
    }
    if (total.trim()) {
      params.set("total", total.trim());
    }

    const response = await apiRequest<HistoryMovement[]>(`/history?${params.toString()}`, { token });
    setMovements(response);
    setSelectedMovementId((current) => (response.some((movement) => movement.id === current) ? current : null));
  }

  async function loadSaleDetail(saleId: number) {
    if (!token) return;

    setLoadingDetail(true);
    try {
      const response = await apiRequest<SaleDetail>(`/sales/${saleId}`, { token });
      setSaleDetail(response);
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    loadHistory().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el historial");
    });
  }, [token, range, selectedDate, movementType, folio, paymentMethod, cashier, total]);

  useEffect(() => {
    if (!selectedSaleId) {
      setSaleDetail(null);
      return;
    }

    loadSaleDetail(selectedSaleId).catch((detailError) => {
      setError(detailError instanceof Error ? detailError.message : "No fue posible cargar el detalle de la venta");
    });
  }, [selectedSaleId, token]);

  function toggleMovementDetail(movement: HistoryMovement) {
    setError("");
    if (selectedMovementId === movement.id) {
      setSelectedMovementId(null);
      setSaleDetail(null);
      return;
    }

    setSelectedMovementId(movement.id);
    if (!movement.sale_id) {
      setSaleDetail(null);
    }
  }

  function canCancelSale(sale: Sale) {
    return canCancelSales && sale.sale_date === today && (sale.status || "completed") !== "cancelled";
  }

  async function handleCancelSale() {
    if (!token || !cancelTarget) return;
    if (!cancelReason.trim()) {
      setError("Debes capturar un motivo de anulacion");
      return;
    }

    try {
      setCancelLoading(true);
      setError("");
      await apiRequest<Sale>(`/sales/${cancelTarget.id}/cancel`, {
        method: "POST",
        token,
        body: JSON.stringify({ reason: cancelReason.trim() })
      });
      setCancelTarget(null);
      setCancelReason("");
      await loadHistory();
      if (selectedSaleId) {
        await loadSaleDetail(selectedSaleId);
      }
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "No fue posible anular la venta");
    } finally {
      setCancelLoading(false);
    }
  }

  const invoiceData = saleDetail?.invoice_info?.invoice_data || {};
  const invoiceCompany = invoiceData.company_profile || invoiceData.company || {};
  const invoiceClient = invoiceData.client || {};

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Historial general</h2>
            <p className="muted">Incluye ventas, abonos, facturas, gastos, gastos fijos y deuda del dueno.</p>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="form-section-grid">
          <label>
            Periodo
            <select value={range} onChange={(event) => setRange(event.target.value as RangeFilter)}>
              <option value="day">Dia</option>
              <option value="week">Semana</option>
              <option value="month">Mes</option>
            </select>
          </label>
          <label>
            Fecha base
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </label>
          <label>
            Tipo de movimiento
            <select value={movementType} onChange={(event) => setMovementType(event.target.value as MovementFilter)}>
              <option value="all">Todos</option>
              <option value="sales">Ventas</option>
              <option value="credit_collections">Abonos</option>
              <option value="invoice_payments">Facturas</option>
              <option value="expenses">Gastos</option>
              <option value="fixed_expenses">Gastos fijos</option>
              <option value="owner_debt">Deuda del dueno</option>
            </select>
          </label>
          <label>
            Folio
            <input placeholder="Buscar por folio" value={folio} onChange={(event) => setFolio(event.target.value)} />
          </label>
          <label>
            Metodo de pago
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
              <option value="">Todos</option>
              <option value="cash">Efectivo</option>
              <option value="card">Tarjeta</option>
              <option value="credit">Credito</option>
              <option value="transfer">Transferencia</option>
            </select>
          </label>
          <label>
            Cajero
            <input placeholder="Buscar por cajero" value={cashier} onChange={(event) => setCashier(event.target.value)} />
          </label>
          <label>
            Total
            <input placeholder="Buscar total exacto" type="number" min="0" step="0.01" value={total} onChange={(event) => setTotal(event.target.value)} />
          </label>
        </div>
      </div>

      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Folio</th>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Cajero</th>
                <th>Pago</th>
                <th>Concepto</th>
                <th>Monto</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => (
                <Fragment key={movement.id}>
                  <tr
                    className={movement.id === selectedMovementId ? "table-row-active" : ""}
                    onClick={() => toggleMovementDetail(movement)}
                  >
                    <td>{movement.reference || "-"}</td>
                    <td>{shortDate(movement.date)}</td>
                    <td>{getMovementTypeLabel(movement.type)}</td>
                    <td>{movement.cashier_name || "-"}</td>
                    <td>{getMovementPaymentLabel(movement.payment_method)}</td>
                    <td>
                      <div>{movement.concept || "-"}</div>
                      {(movement.status || "completed") === "cancelled" ? <span className="status-badge cancelled">ANULADA</span> : null}
                    </td>
                    <td>{currency(movement.amount)}</td>
                  </tr>
                  {movement.id === selectedMovementId ? (
                    <tr>
                      <td colSpan={7}>
                        {movement.sale_id ? (
                          <>
                            {loadingDetail && !saleDetail ? <p className="muted">Cargando detalle...</p> : null}
                            {saleDetail && saleDetail.id === movement.sale_id ? (
                              <div className="info-card">
                                <div className="panel-header">
                                  <div>
                                    <h3>Detalle de venta #{saleDetail.folio}</h3>
                                    <p className="muted">{shortDateTime(saleDetail.created_at)}</p>
                                  </div>
                                </div>
                                <div className="credit-summary">
                                  <div className="total-box secondary">
                                    <span>Folio</span>
                                    <strong>{saleDetail.folio}</strong>
                                  </div>
                                  <div className="total-box secondary">
                                    <span>Cajero</span>
                                    <strong>{saleDetail.user?.full_name || saleDetail.cashier_name || "-"}</strong>
                                  </div>
                                  <div className="total-box secondary">
                                    <span>Total</span>
                                    <strong>{currency(saleDetail.total)}</strong>
                                  </div>
                                </div>
                                <p>Metodo de pago: {getPaymentMethodLabel(saleDetail.payment_method)}</p>
                                <p>Tipo de salida: {getSaleTypeLabel(saleDetail.sale_type)}</p>
                                <p>Estado: {(saleDetail.status || "completed") === "cancelled" ? "Anulada" : "Completada"}</p>
                                {saleDetail.cancellation_reason ? <p>Motivo de anulacion: {saleDetail.cancellation_reason}</p> : null}
                                {saleDetail.cancelled_at ? <p>Fecha de anulacion: {shortDateTime(saleDetail.cancelled_at)}</p> : null}
                                {canCancelSale(saleDetail) ? (
                                  <div className="inline-actions">
                                    <button
                                      className="button ghost danger"
                                      onClick={() => {
                                        setCancelTarget(saleDetail);
                                        setCancelReason("");
                                      }}
                                      type="button"
                                    >
                                      Anular venta
                                    </button>
                                  </div>
                                ) : null}
                                <div className="table-wrap">
                                  <table>
                                    <thead>
                                      <tr>
                                        <th>Producto</th>
                                        <th>Cantidad</th>
                                        <th>Unidad</th>
                                        <th>Precio unitario</th>
                                        <th>Subtotal</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {saleDetail.items.map((item) => (
                                        <tr key={item.id}>
                                          <td>{item.product_name}</td>
                                          <td>{item.quantity}</td>
                                          <td>{item.unidad_de_venta || "pieza"}</td>
                                          <td>{currency(item.unit_price)}</td>
                                          <td>{currency(item.subtotal)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                                {saleDetail.credit_info ? (
                                  <div className="info-card">
                                    <h3>Datos de credito</h3>
                                    <p>Cliente: {saleDetail.credit_info.customer_name || "-"}</p>
                                    <p>Telefono: {saleDetail.credit_info.customer_phone || "-"}</p>
                                    <p>Pago inicial: {currency(saleDetail.credit_info.initial_payment)}</p>
                                    <p>Saldo pendiente: {currency(saleDetail.credit_info.balance_due)}</p>
                                  </div>
                                ) : null}
                                {saleDetail.transfer_info ? (
                                  <div className="info-card">
                                    <h3>Datos de transferencia</h3>
                                    <p>Banco: {saleDetail.transfer_info.bank || "-"}</p>
                                    <p>CLABE: {saleDetail.transfer_info.clabe || "-"}</p>
                                    <p>Beneficiario: {saleDetail.transfer_info.beneficiary || "-"}</p>
                                  </div>
                                ) : null}
                                {saleDetail.invoice_info ? (
                                  <div className="info-card">
                                    <h3>Datos de factura</h3>
                                    <p>Estado factura: {saleDetail.invoice_info.status || "-"}</p>
                                    <p>Estado timbre: {saleDetail.invoice_info.stamp_status || "-"}</p>
                                    <p>RFC empresa: {invoiceCompany.rfc || "-"}</p>
                                    <p>Razon social: {invoiceCompany.razon_social || "-"}</p>
                                    <p>Regimen fiscal: {invoiceCompany.regimen_fiscal || "-"}</p>
                                    <p>Direccion fiscal: {invoiceCompany.direccion_fiscal || invoiceCompany.direccion || "-"}</p>
                                    <p>RFC cliente: {invoiceClient.rfc || "-"}</p>
                                    <p>Cliente: {invoiceClient.nombre || "-"}</p>
                                    <p>Correo cliente: {invoiceClient.correo || "-"}</p>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <div className="info-card">
                            <h3>Detalle de movimiento</h3>
                            <p><strong>Tipo:</strong> {getMovementTypeLabel(movement.type)}</p>
                            <p><strong>Referencia:</strong> {movement.reference || "-"}</p>
                            <p><strong>Concepto:</strong> {movement.concept || "-"}</p>
                            <p><strong>Metodo de pago:</strong> {getMovementPaymentLabel(movement.payment_method)}</p>
                            <p><strong>Monto:</strong> {currency(movement.amount)}</p>
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
              {movements.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={7}>No hay movimientos para los filtros seleccionados.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {cancelTarget ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card">
            <div className="panel-header">
              <div>
                <h3>Anular venta #{cancelTarget.id}</h3>
                <p className="muted">Esta accion revertira stock y marcara la venta como cancelada.</p>
              </div>
              <button className="button ghost" onClick={() => { setCancelTarget(null); setCancelReason(""); }} type="button">Cerrar</button>
            </div>
            <label>
              Motivo obligatorio
              <textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
            </label>
            <div className="inline-actions modal-actions-end">
              <button className="button ghost" onClick={() => { setCancelTarget(null); setCancelReason(""); }} type="button">Cancelar</button>
              <button className="button ghost danger" disabled={cancelLoading || !cancelReason.trim()} onClick={handleCancelSale} type="button">
                {cancelLoading ? "Anulando..." : "Confirmar anulacion"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
