import { Fragment, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Sale, SaleDetail } from "../types";
import { currency, shortDate, shortDateTime } from "../utils/format";
import { getPaymentMethodLabel, getSaleTypeLabel } from "../utils/uiLabels";
import { getMexicoCityDateInputValue } from "../utils/timezone";

type RangeFilter = "day" | "week" | "month";

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

export function SalesHistoryPage() {
  const { token } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);
  const [saleDetail, setSaleDetail] = useState<SaleDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");
  const [range, setRange] = useState<RangeFilter>("day");
  const [selectedDate, setSelectedDate] = useState(toDateInputValue(new Date()));
  const [folio, setFolio] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [cashier, setCashier] = useState("");
  const [total, setTotal] = useState("");

  const activeRange = useMemo(() => getRangeDates(range, selectedDate), [range, selectedDate]);

  async function loadSales() {
    if (!token) return;

    const params = new URLSearchParams();
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

    const response = await apiRequest<Sale[]>(`/sales?${params.toString()}`, { token });
    setSales(response);
    setSelectedSaleId((current) => (response.some((sale) => sale.id === current) ? current : null));
    if (!response.some((sale) => sale.id === selectedSaleId)) {
      setSaleDetail(null);
    }
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
    loadSales().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el historial");
    });
  }, [token, range, selectedDate, folio, paymentMethod, cashier, total]);

  useEffect(() => {
    if (!selectedSaleId || !sales.some((sale) => sale.id === selectedSaleId)) {
      return;
    }

    loadSaleDetail(selectedSaleId).catch((detailError) => {
      setError(detailError instanceof Error ? detailError.message : "No fue posible cargar el detalle de la venta");
    });
  }, [selectedSaleId, token, sales]);

  function toggleSaleDetail(saleId: number) {
    setError("");
    if (selectedSaleId === saleId) {
      setSelectedSaleId(null);
      setSaleDetail(null);
      return;
    }

    setSelectedSaleId(saleId);
  }

  const invoiceData = saleDetail?.invoice_info?.invoice_data || {};
  const invoiceCompany = invoiceData.company_profile || invoiceData.company || {};
  const invoiceClient = invoiceData.client || {};

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Historial de ventas</h2>
            <p className="muted">Vista por defecto del dia actual, con filtros por periodo y transaccion.</p>
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
                <th>Cajero</th>
                <th>Pago</th>
                <th>Tipo</th>
                <th>Resumen</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <Fragment key={sale.id}>
                  <tr
                    className={sale.id === selectedSaleId ? "table-row-active" : ""}
                    onClick={() => toggleSaleDetail(sale.id)}
                  >
                    <td>{sale.id}</td>
                    <td>{shortDate(sale.sale_date)}</td>
                    <td>{sale.cashier_name}</td>
                    <td>{getPaymentMethodLabel(sale.payment_method)}</td>
                    <td>{getSaleTypeLabel(sale.sale_type)}</td>
                    <td>{sale.items_summary || "-"}</td>
                    <td>{currency(sale.total)}</td>
                  </tr>
                  {sale.id === selectedSaleId ? (
                    <tr>
                      <td colSpan={7}>
                        {loadingDetail && !saleDetail ? <p className="muted">Cargando detalle...</p> : null}
                        {saleDetail && saleDetail.id === sale.id ? (
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
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
              {sales.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={7}>No hay ventas para los filtros seleccionados.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
