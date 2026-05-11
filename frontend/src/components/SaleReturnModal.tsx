import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import type { SaleDetail } from "../types";
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

  useEffect(() => {
    fetchSaleReturns(saleDetail.id).catch(() => {
      // non-critical — returns list stays empty on error
    });
  }, [saleDetail.id, token]);

  async function fetchSaleReturns(saleId: number) {
    if (!token) return;
    const response = await apiRequest<SaleReturn[]>(`/sales/${saleId}/returns`, { token });
    setSaleReturns(response);
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
          return_reason: returnReason.trim()
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
    if (!token) return;
    try {
      setError("");
      await apiRequest<SaleReturn>(`/sales/returns/${returnId}/approve`, { method: "POST", token });
      await fetchSaleReturns(saleDetail.id);
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "No fue posible aprobar la devolucion");
    }
  }

  async function handleRejectReturn(returnId: number) {
    if (!token) return;
    try {
      setError("");
      await apiRequest<SaleReturn>(`/sales/returns/${returnId}/reject`, { method: "POST", token });
      await fetchSaleReturns(saleDetail.id);
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : "No fue posible rechazar la devolucion");
    }
  }

  return (
    <>
      {(saleDetail.status || "completed") !== "cancelled" ? (
        <button
          className="button ghost"
          onClick={handleOpenReturnModal}
          type="button"
        >
          Devolución
        </button>
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
              {sr.status === "pending" && canAuthorizeReturn ? (
                <div className="inline-actions">
                  <button className="button ghost" onClick={() => handleApproveReturn(sr.id)} type="button">Aprobar</button>
                  <button className="button ghost danger" onClick={() => handleRejectReturn(sr.id)} type="button">Rechazar</button>
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
            <label>
              Motivo (obligatorio)
              <textarea value={returnReason} onChange={(e) => setReturnReason(e.target.value)} />
            </label>
            <p>
              <strong>Total a devolver: {currency(returnItems.reduce((sum, i) => sum + i.subtotal_returned, 0))}</strong>
            </p>
            <div className="inline-actions modal-actions-end">
              <button className="button ghost" onClick={() => setShowReturnModal(false)} type="button">Cancelar</button>
              <button
                className="button ghost"
                disabled={returnLoading || !returnReason.trim() || returnItems.every((i) => i.quantity_returned === 0)}
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
