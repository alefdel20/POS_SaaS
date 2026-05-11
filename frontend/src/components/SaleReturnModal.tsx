import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import type { Product, SaleDetail } from "../types";
import { currency, shortDate } from "../utils/format";

export interface ReturnItem {
  sale_item_id: number;
  product_id: number;
  quantity_returned: number;
  unit_price: number;
  subtotal_returned: number;
  restock: boolean;
}

export interface SaleReturn {
  id: number;
  status: "pending" | "approved" | "rejected";
  resolution_type: "refund_cash" | "credit_note" | "exchange";
  return_reason: string;
  total_returned: number;
  initiated_by: number;
  authorized_by: number | null;
  created_at: string;
  items: ReturnItem[];
  exchange_items?: Array<{
    id: number;
    product_id: number;
    product_name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    unidad_de_venta: string | null;
  }>;
}

interface ExchangeCartItem {
  product: Product;
  quantity: number;
}

function getResolutionLabel(type: SaleReturn["resolution_type"]) {
  if (type === "refund_cash") return "Efectivo";
  if (type === "credit_note") return "Nota de crédito";
  return "Intercambio";
}

function getReturnStatusLabel(status: SaleReturn["status"]) {
  if (status === "approved") return "Aprobada";
  if (status === "rejected") return "Rechazada";
  return "Pendiente";
}

interface SaleReturnModalProps {
  saleDetail: SaleDetail;
  token: string;
  canAuthorizeReturn: boolean;
  onClose: () => void;
  onSuccess: (saleId: number) => void;
}

export default function SaleReturnModal({ saleDetail, token, canAuthorizeReturn, onClose, onSuccess }: SaleReturnModalProps) {
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);
  const [returnReason, setReturnReason] = useState("");
  const [returnResolution, setReturnResolution] = useState<SaleReturn["resolution_type"]>("refund_cash");
  const [returnLoading, setReturnLoading] = useState(false);
  const [saleReturns, setSaleReturns] = useState<SaleReturn[]>([]);
  const [error, setError] = useState("");
  const [exchangeSearch, setExchangeSearch] = useState("");
  const [exchangeResults, setExchangeResults] = useState<Product[]>([]);
  const [exchangeCart, setExchangeCart] = useState<ExchangeCartItem[]>([]);
  const [exchangeSearching, setExchangeSearching] = useState(false);
  const [exchangeDifferencePaymentMethod, setExchangeDifferencePaymentMethod] = useState<"cash" | "card" | "transfer">("cash");
  const [actionLoading, setActionLoading] = useState(false);
  const [returnsLoading, setReturnsLoading] = useState(false);

  useEffect(() => {
    fetchSaleReturns(saleDetail.id).catch(() => {
      // non-critical — returns list stays empty on error
    });
  }, [saleDetail.id, token]);

  useEffect(() => {
    const delay = setTimeout(() => {
      searchExchangeProducts(exchangeSearch);
    }, 250);
    return () => clearTimeout(delay);
  }, [exchangeSearch, token]);

  async function fetchSaleReturns(saleId: number) {
    if (!token) return;
    setReturnsLoading(true);
    try {
      const response = await apiRequest<SaleReturn[]>(`/sales/${saleId}/returns`, { token });
      setSaleReturns(response);
    } catch {
      // non-critical
    } finally {
      setReturnsLoading(false);
    }
  }

  async function searchExchangeProducts(term: string) {
    if (!term.trim()) {
      setExchangeResults([]);
      return;
    }
    setExchangeSearching(true);
    try {
      const params = new URLSearchParams({ activeOnly: "true", search: term });
      const response = await apiRequest<Product[]>(`/products?${params}`, { token });
      setExchangeResults(response);
    } catch {
      setExchangeResults([]);
    } finally {
      setExchangeSearching(false);
    }
  }

  function addToExchangeCart(product: Product) {
    setExchangeCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
    setExchangeResults([]);
    setExchangeSearch("");
  }

  function updateExchangeQty(productId: number, qty: number) {
    if (qty <= 0) {
      setExchangeCart((prev) => prev.filter((i) => i.product.id !== productId));
      return;
    }
    setExchangeCart((prev) =>
      prev.map((i) => (i.product.id === productId ? { ...i, quantity: qty } : i))
    );
  }

  function removeFromExchangeCart(productId: number) {
    setExchangeCart((prev) => prev.filter((i) => i.product.id !== productId));
  }

  function handleOpenReturnModal() {
    setReturnItems(
      saleDetail.items.map((item) => ({
        sale_item_id: item.id,
        product_id: item.product_id,
        quantity_returned: 0,
        unit_price: item.unit_price,
        subtotal_returned: 0,
        restock: true
      }))
    );
    setReturnReason("");
    setReturnResolution("refund_cash");
    setExchangeCart([]);
    setExchangeSearch("");
    setExchangeResults([]);
    setShowReturnModal(true);
  }

  function handleReturnQuantityChange(saleItemId: number, qty: number) {
    setReturnItems((prev) =>
      prev.map((item) => {
        if (item.sale_item_id !== saleItemId) return item;
        const originalItem = saleDetail.items.find((i) => i.id === saleItemId);
        const maxQty = originalItem?.quantity ?? 0;
        const clamped = Math.max(0, Math.min(qty, maxQty));
        return {
          ...item,
          quantity_returned: clamped,
          subtotal_returned: Math.round(clamped * item.unit_price * 100000) / 100000
        };
      })
    );
  }

  function handleReturnRestockChange(saleItemId: number, restock: boolean) {
    setReturnItems((prev) =>
      prev.map((item) => {
        if (item.sale_item_id !== saleItemId) return item;
        const subtotal = restock
          ? Math.round(item.quantity_returned * item.unit_price * 100000) / 100000
          : 0;
        return { ...item, restock, subtotal_returned: subtotal };
      })
    );
  }

  async function handleSubmitReturn() {
    if (!token) return;
    const activeItems = returnItems.filter((i) => i.quantity_returned > 0);
    if (activeItems.length === 0) {
      setError("Debes seleccionar al menos un articulo para devolver");
      return;
    }
    if (!returnReason.trim()) {
      setError("Debes capturar un motivo de devolucion");
      return;
    }
    try {
      setReturnLoading(true);
      setError("");
      await apiRequest<SaleReturn>(`/sales/${saleDetail.id}/returns`, {
        method: "POST",
        token,
        body: JSON.stringify({
          items: activeItems,
          resolution_type: returnResolution,
          return_reason: returnReason.trim(),
          exchange_items: returnResolution === "exchange"
            ? exchangeCart.map((i) => ({
                product_id: i.product.id,
                quantity: i.quantity,
                unit_price: Number(i.product.effective_price ?? i.product.price),
                subtotal: Math.round(i.quantity * Number(i.product.effective_price ?? i.product.price) * 100) / 100
              }))
            : [],
          exchange_difference: returnResolution === "exchange" ? exchangeDifference : 0,
          exchange_difference_payment_method: returnResolution === "exchange" && exchangeDifference > 0
            ? exchangeDifferencePaymentMethod
            : null
        })
      });
      setShowReturnModal(false);
      await fetchSaleReturns(saleDetail.id);
      onSuccess(saleDetail.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No fue posible registrar la devolucion");
    } finally {
      setReturnLoading(false);
    }
  }

  async function handleApproveReturn(returnId: number) {
    if (!token || !saleDetail) return;
    setActionLoading(true);
    try {
      setError("");
      await apiRequest<SaleReturn>(`/sales/returns/${returnId}/approve`, { method: "POST", token });
      await fetchSaleReturns(saleDetail.id);
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "No fue posible aprobar la devolucion");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRejectReturn(returnId: number) {
    if (!token || !saleDetail) return;
    setActionLoading(true);
    try {
      setError("");
      await apiRequest<SaleReturn>(`/sales/returns/${returnId}/reject`, { method: "POST", token });
      await fetchSaleReturns(saleDetail.id);
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : "No fue posible rechazar la devolucion");
    } finally {
      setActionLoading(false);
    }
  }

  const allItemsFullyReturned =
    saleDetail.items.length > 0 &&
    saleDetail.items.every((saleItem) => {
      const approvedReturnedQty = saleReturns
        .filter((sr) => sr.status === "approved")
        .flatMap((sr) => sr.items)
        .filter((ri) => ri.sale_item_id === saleItem.id)
        .reduce((sum, ri) => sum + ri.quantity_returned, 0);
      return approvedReturnedQty >= saleItem.quantity;
    });

  const returnTotal = returnItems.reduce((sum, i) => sum + i.subtotal_returned, 0);
  const exchangeTotal = exchangeCart.reduce(
    (sum, i) => sum + Math.round(i.quantity * Number(i.product.effective_price ?? i.product.price) * 100) / 100,
    0
  );
  const exchangeDifference = Math.round((exchangeTotal - returnTotal) * 100) / 100;

  return (
    <>
      {(saleDetail.status || "completed") !== "cancelled" && !allItemsFullyReturned ? (
        <button
          className="button ghost"
          onClick={handleOpenReturnModal}
          type="button"
        >
          Devolución
        </button>
      ) : null}

      {(saleDetail.status || "completed") !== "cancelled" && allItemsFullyReturned ? (
        <p className="muted">Devolución completa — todos los productos de esta venta ya fueron devueltos.</p>
      ) : null}

      {returnsLoading ? (
        <p className="muted">Cargando devoluciones...</p>
      ) : null}

      {saleReturns.length > 0 ? (
        <div className="info-card">
          <h3>Devoluciones registradas</h3>
          {saleReturns.map((sr) => (
            <div key={sr.id} className="info-card">
              <div className="credit-summary">
                <div className="total-box secondary">
                  <span>Fecha</span>
                  <strong>{shortDate(sr.created_at)}</strong>
                </div>
                <div className="total-box secondary">
                  <span>Resolución</span>
                  <strong>{getResolutionLabel(sr.resolution_type)}</strong>
                </div>
                <div className="total-box secondary">
                  <span>Total devuelto</span>
                  <strong>{currency(sr.total_returned)}</strong>
                </div>
              </div>
              <p>Estado: <span className={`status-badge${sr.status === "rejected" ? " cancelled" : ""}`}>{getReturnStatusLabel(sr.status)}</span></p>
              <p>Motivo: {sr.return_reason}</p>
              {sr.resolution_type === "exchange" && sr.exchange_items && sr.exchange_items.length > 0 ? (
                <div>
                  <p><strong>Productos entregados al cliente:</strong></p>
                  <ul style={{ margin: "0.25rem 0 0 1rem", padding: 0 }}>
                    {sr.exchange_items.map((ei) => (
                      <li key={ei.id}>
                        {ei.quantity} {ei.unidad_de_venta || "pieza"} — {ei.product_name} ({currency(ei.subtotal)})
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {sr.status === "pending" && canAuthorizeReturn ? (
                <div className="inline-actions">
                  <button className="button ghost" disabled={actionLoading} onClick={() => handleApproveReturn(sr.id)} type="button">
                    {actionLoading ? "Procesando..." : "Aprobar"}
                  </button>
                  <button className="button ghost danger" disabled={actionLoading} onClick={() => handleRejectReturn(sr.id)} type="button">
                    {actionLoading ? "Procesando..." : "Rechazar"}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}

      {showReturnModal ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card" style={{ maxWidth: "860px", width: "95vw" }}>
            <div className="panel-header">
              <div>
                <h3>Registrar devolución — venta #{saleDetail.folio}</h3>
                <p className="muted">Selecciona los articulos y cantidades a devolver.</p>
              </div>
              <button className="button ghost" onClick={() => setShowReturnModal(false)} type="button">Cerrar</button>
            </div>
            {!canAuthorizeReturn ? (
              <p className="muted">Esta devolución quedará pendiente de autorización por un gerente o administrador.</p>
            ) : null}
            <div className="table-wrap" style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Cant. original</th>
                    <th>Precio unitario</th>
                    <th>Cant. a devolver</th>
                    <th>Subtotal</th>
                    <th>Regresar a stock</th>
                  </tr>
                </thead>
                <tbody>
                  {saleDetail.items.map((item) => {
                    const ri = returnItems.find((r) => r.sale_item_id === item.id);
                    if (!ri) return null;
                    return (
                      <tr key={item.id}>
                        <td>{item.product_name}</td>
                        <td>{item.quantity}</td>
                        <td>{currency(item.unit_price)}</td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            max={item.quantity}
                            step="any"
                            value={ri.quantity_returned}
                            onChange={(e) => handleReturnQuantityChange(item.id, Number(e.target.value))}
                          />
                        </td>
                        <td>{ri.quantity_returned > 0 ? currency(ri.subtotal_returned) : "-"}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={ri.restock}
                            onChange={(e) => handleReturnRestockChange(item.id, e.target.checked)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <label>
              Tipo de resolución
              <select
                value={returnResolution}
                onChange={(e) => setReturnResolution(e.target.value as SaleReturn["resolution_type"])}
              >
                <option value="refund_cash">Efectivo</option>
                <option value="credit_note">Nota de crédito</option>
                <option value="exchange">Intercambio</option>
              </select>
            </label>

            {returnResolution === "exchange" ? (
              <div className="info-card">
                <h3>Productos de intercambio</h3>
                <p className="muted">Busca y agrega los productos que recibirá el cliente.</p>

                <label>
                  Buscar producto
                  <input
                    type="text"
                    value={exchangeSearch}
                    onChange={(e) => setExchangeSearch(e.target.value)}
                    placeholder="Nombre, código de barras, categoría..."
                  />
                </label>

                {exchangeSearching ? <p className="muted">Buscando...</p> : null}

                {exchangeResults.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th>Stock</th>
                          <th>Precio</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {exchangeResults.map((p) => (
                          <tr key={p.id}>
                            <td>{p.name}</td>
                            <td>{p.stock} {p.unidad_de_venta || ""}</td>
                            <td>{currency(Number(p.effective_price ?? p.price))}</td>
                            <td>
                              <button
                                className="button ghost"
                                onClick={() => addToExchangeCart(p)}
                                type="button"
                              >
                                Agregar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {exchangeCart.length > 0 ? (
                  <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
                    <h4>Productos seleccionados</h4>
                    <table>
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th>Cantidad</th>
                          <th>Subtotal</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {exchangeCart.map((item) => (
                          <tr key={item.product.id}>
                            <td>{item.product.name}</td>
                            <td>
                              <input
                                type="number"
                                min={1}
                                step="any"
                                value={item.quantity}
                                onChange={(e) => updateExchangeQty(item.product.id, Number(e.target.value))}
                                style={{ width: "5rem" }}
                              />
                            </td>
                            <td>{currency(Math.round(item.quantity * Number(item.product.effective_price ?? item.product.price) * 100) / 100)}</td>
                            <td>
                              <button
                                className="button ghost danger"
                                onClick={() => removeFromExchangeCart(item.product.id)}
                                type="button"
                              >
                                Quitar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}

            <label>
              Motivo (obligatorio)
              <textarea value={returnReason} onChange={(e) => setReturnReason(e.target.value)} />
            </label>
            <p>
              <strong>Total a devolver: {currency(returnTotal)}</strong>
            </p>
            {returnResolution === "exchange" && exchangeCart.length > 0 ? (
              <div className="info-card">
                {exchangeDifference > 0 ? (
                  <>
                    <p><strong>Diferencia a cobrar al cliente: {currency(exchangeDifference)}</strong></p>
                    <label>
                      Método de cobro de diferencia
                      <select
                        value={exchangeDifferencePaymentMethod}
                        onChange={(e) => setExchangeDifferencePaymentMethod(e.target.value as "cash" | "card" | "transfer")}
                      >
                        <option value="cash">Efectivo</option>
                        <option value="card">Tarjeta</option>
                        <option value="transfer">Transferencia</option>
                      </select>
                    </label>
                  </>
                ) : exchangeDifference < 0 ? (
                  <p><strong>Diferencia a regresar al cliente: {currency(Math.abs(exchangeDifference))}</strong></p>
                ) : (
                  <p className="muted">Intercambio por valor equivalente — sin diferencia.</p>
                )}
              </div>
            ) : null}
            <div className="inline-actions modal-actions-end">
              <button className="button ghost" onClick={() => setShowReturnModal(false)} type="button">Cancelar</button>
              <button
                className="button ghost"
                disabled={
                  returnLoading ||
                  !returnReason.trim() ||
                  returnItems.every((i) => i.quantity_returned === 0) ||
                  (returnResolution === "exchange" && exchangeCart.length === 0)
                }
                onClick={handleSubmitReturn}
                type="button"
              >
                {returnLoading ? "Registrando..." : "Registrar devolución"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
