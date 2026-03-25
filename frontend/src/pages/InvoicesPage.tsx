import { useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { AdministrativeInvoice } from "../types";
import { currency, shortDate, shortDateTime } from "../utils/format";
import { canEditAdministrativeInvoices } from "../utils/roles";

const API_URL = (import.meta as any).env.VITE_API_BASE_URL || "http://pos-apis-chatbots-backen-kv6lbk-0befdc-31-97-214-24.traefik.me/api";

export function InvoicesPage() {
  const { token, user } = useAuth();
  const [items, setItems] = useState<AdministrativeInvoice[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AdministrativeInvoice | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const canEdit = canEditAdministrativeInvoices(user?.role);

  async function loadItems() {
    if (!token) return;
    const response = await apiRequest<AdministrativeInvoice[]>("/admin-invoices", { token });
    setItems(response);
    setSelectedId((current) => current ?? response[0]?.id ?? null);
  }

  async function loadDetail(id: number) {
    if (!token) return;
    const response = await apiRequest<AdministrativeInvoice>(`/admin-invoices/${id}`, { token });
    setDetail(response);
  }

  useEffect(() => {
    loadItems().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "No fue posible cargar facturas"));
  }, [token]);

  useEffect(() => {
    if (!selectedId) return;
    loadDetail(selectedId).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el detalle"));
  }, [selectedId, token]);

  async function saveDetail() {
    if (!token || !detail || !canEdit) return;
    try {
      setSaving(true);
      setError("");
      await apiRequest(`/admin-invoices/${detail.id}`, {
        method: "PUT",
        token,
        body: JSON.stringify({
          status: detail.status,
          customer_name: detail.customer_name,
          rfc: detail.rfc,
          email: detail.email,
          phone: detail.phone,
          fiscal_regime: detail.fiscal_regime,
          cantidad_clave: detail.cantidad_clave,
          observations: detail.observations
        })
      });
      await loadItems();
      await loadDetail(detail.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible guardar");
    } finally {
      setSaving(false);
    }
  }

  async function downloadExport(type: "pdf" | "docx") {
    if (!token || !detail) return;
    const response = await fetch(`${API_URL}/admin-invoices/${detail.id}/export/${type}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ message: "Request failed" }));
      throw new Error(errorBody.message || "Request failed");
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `factura-administrativa-${detail.id}.${type}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  return (
    <section className="page-grid two-columns">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Facturas administrativas</h2>
            <p className="muted">Solicitudes generadas desde ventas con Requiere factura.</p>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Folio</th>
                <th>Fecha</th>
                <th>Cajero</th>
                <th>Status</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr className={item.id === selectedId ? "table-row-active" : ""} key={item.id} onClick={() => setSelectedId(item.id)}>
                  <td>{item.sale_folio}</td>
                  <td>{shortDate(item.sale_date)}</td>
                  <td>{item.cashier_name || "-"}</td>
                  <td>{item.status}</td>
                  <td>{currency(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Detalle</h2>
            <p className="muted">{detail ? `Actualizado ${shortDateTime(detail.updated_at)}` : "Selecciona un registro"}</p>
          </div>
          {detail ? (
            <div className="inline-actions">
              <button className="button ghost" onClick={() => downloadExport("pdf").catch((downloadError) => setError(downloadError instanceof Error ? downloadError.message : "No fue posible exportar PDF"))} type="button">Exportar PDF</button>
              <button className="button ghost" onClick={() => downloadExport("docx").catch((downloadError) => setError(downloadError instanceof Error ? downloadError.message : "No fue posible exportar DOCX"))} type="button">Exportar DOCX</button>
            </div>
          ) : null}
        </div>
        {detail ? (
          <div className="grid-form">
            <label>
              Status
              <select disabled={!canEdit} value={detail.status} onChange={(event) => setDetail({ ...detail, status: event.target.value as AdministrativeInvoice["status"] })}>
                <option value="pending">pending</option>
                <option value="in_progress">in_progress</option>
                <option value="completed">completed</option>
                <option value="cancelled">cancelled</option>
              </select>
            </label>
            <label>
              Cliente / Razón social
              <input disabled={!canEdit} value={detail.customer_name || ""} onChange={(event) => setDetail({ ...detail, customer_name: event.target.value })} />
            </label>
            <label>
              RFC
              <input disabled={!canEdit} value={detail.rfc || ""} onChange={(event) => setDetail({ ...detail, rfc: event.target.value })} />
            </label>
            <label>
              Correo
              <input disabled={!canEdit} value={detail.email || ""} onChange={(event) => setDetail({ ...detail, email: event.target.value })} />
            </label>
            <label>
              Teléfono
              <input disabled={!canEdit} value={detail.phone || ""} onChange={(event) => setDetail({ ...detail, phone: event.target.value })} />
            </label>
            <label>
              Régimen fiscal
              <input disabled={!canEdit} value={detail.fiscal_regime || ""} onChange={(event) => setDetail({ ...detail, fiscal_regime: event.target.value })} />
            </label>
            <label>
              Cantidad Clave
              <input disabled={!canEdit} value={detail.cantidad_clave || ""} onChange={(event) => setDetail({ ...detail, cantidad_clave: event.target.value })} />
            </label>
            <label className="form-span-2">
              Observaciones
              <textarea disabled={!canEdit} value={detail.observations || ""} onChange={(event) => setDetail({ ...detail, observations: event.target.value })} />
            </label>
            <div className="info-card form-span-2">
              <h3>Venta relacionada</h3>
              <p>Folio: {detail.sale_folio}</p>
              <p>Fecha: {shortDate(detail.sale_date)}</p>
              <p>Cajero: {detail.cashier_name || "-"}</p>
              <p>Total: {currency(detail.total)}</p>
              <p>Productos: {detail.sale_snapshot?.items?.map((item) => `${item.quantity} ${item.unidad_de_venta || "pieza"} ${item.product_name}`).join(", ") || "-"}</p>
            </div>
            {canEdit ? <button className="button" disabled={saving} onClick={saveDetail} type="button">{saving ? "Guardando..." : "Guardar cambios"}</button> : <p className="muted">Modo solo lectura para soporte.</p>}
          </div>
        ) : (
          <p className="muted">No hay registro seleccionado.</p>
        )}
      </div>
    </section>
  );
}
