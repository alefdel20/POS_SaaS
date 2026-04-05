import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { PaginatedProductsResponse, Product, ProductUpdateRequest } from "../types";
import { currency, shortDateTime } from "../utils/format";
import { isCashierRole, isManagementRole } from "../utils/roles";

type RequestFormState = {
  product_id: string;
  requested_price: string;
  requested_stock: string;
  reason: string;
};

const emptyForm: RequestFormState = {
  product_id: "",
  requested_price: "",
  requested_stock: "",
  reason: ""
};

const BANNER_REFRESH_EVENT = "product-update-requests:refresh-banner";

function buildProductSearchLabel(product: Product) {
  return `${product.name} - ${product.sku}`;
}

export function ProductUpdateRequestsPage() {
  const { token, user } = useAuth();
  const isCashier = isCashierRole(user?.role);
  const isManagement = isManagementRole(user?.role);
  const [requests, setRequests] = useState<ProductUpdateRequest[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<"" | "pending" | "approved" | "rejected">(isManagement ? "pending" : "");
  const [products, setProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [productInput, setProductInput] = useState("");
  const [form, setForm] = useState<RequestFormState>(emptyForm);
  const [reviewNote, setReviewNote] = useState("");
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const selectedProduct = useMemo(
    () => products.find((product) => String(product.id) === form.product_id) || null,
    [form.product_id, products]
  );
  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedRequestId) || null,
    [requests, selectedRequestId]
  );

  async function loadRequests(nextStatus = selectedStatus) {
    if (!token) return;
    setLoadingRequests(true);
    try {
      const params = new URLSearchParams();
      if (nextStatus) {
        params.set("status", nextStatus);
      }
      const response = await apiRequest<ProductUpdateRequest[]>(`/product-update-requests${params.toString() ? `?${params.toString()}` : ""}`, { token });
      setRequests(response);
      setSelectedRequestId((current) => {
        const nextId = current ?? response[0]?.id ?? null;
        return response.some((request) => request.id === nextId) ? nextId : response[0]?.id ?? null;
      });
    } finally {
      setLoadingRequests(false);
    }
  }

  async function loadProducts(term = "") {
    if (!token || !isCashier) return;
    const params = new URLSearchParams({ activeOnly: "true" });
    if (term.trim()) {
      params.set("search", term.trim());
    } else {
      params.set("page", "1");
      params.set("pageSize", "10");
    }
    const response = await apiRequest<PaginatedProductsResponse | Product[]>(`/products?${params.toString()}`, { token });
    setProducts(Array.isArray(response) ? response : response.items);
  }

  useEffect(() => {
    loadRequests(selectedStatus).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar las solicitudes");
    });
  }, [token, selectedStatus]);

  useEffect(() => {
    if (!isCashier) return;
    const timeout = setTimeout(() => {
      loadProducts(productSearch).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar productos");
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [token, productSearch, isCashier]);

  function resetFeedback() {
    setError("");
    setInfo("");
  }

  function handleProductInputChange(value: string) {
    const matchedProduct = products.find((product) => buildProductSearchLabel(product).toLowerCase() === value.trim().toLowerCase());
    setProductInput(value);
    setProductSearch(value);
    setForm((current) => ({
      ...current,
      product_id: matchedProduct ? String(matchedProduct.id) : ""
    }));
  }

  async function handleCreateRequest(event: FormEvent) {
    event.preventDefault();
    if (!token || !isCashier || !selectedProduct) return;

    const trimmedReason = form.reason.trim();
    if (!trimmedReason) {
      setError("El motivo es obligatorio");
      return;
    }

    const requestedPrice = form.requested_price.trim() === "" ? undefined : Number(form.requested_price);
    const requestedStock = form.requested_stock.trim() === "" ? undefined : Number(form.requested_stock);

    if (requestedPrice === undefined && requestedStock === undefined) {
      setError("Debes solicitar al menos un cambio");
      return;
    }

    try {
      setSaving(true);
      resetFeedback();
      await apiRequest<ProductUpdateRequest>("/product-update-requests", {
        method: "POST",
        token,
        body: JSON.stringify({
          product_id: Number(form.product_id),
          requested_price: requestedPrice,
          requested_stock: requestedStock,
          reason: trimmedReason
        })
      });
      setInfo("Solicitud creada");
      setForm(emptyForm);
      setProductInput("");
      setProductSearch("");
      await loadProducts("");
      await loadRequests(selectedStatus);
      window.dispatchEvent(new CustomEvent(BANNER_REFRESH_EVENT));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible crear la solicitud");
    } finally {
      setSaving(false);
    }
  }

  async function handleReview(decision: "approve" | "reject") {
    if (!token || !isManagement || !selectedRequest) return;
    try {
      setSaving(true);
      resetFeedback();
      await apiRequest<ProductUpdateRequest>(`/product-update-requests/${selectedRequest.id}/review`, {
        method: "POST",
        token,
        body: JSON.stringify({
          decision,
          review_note: reviewNote.trim() || undefined
        })
      });
      setInfo(decision === "approve" ? "Solicitud aprobada" : "Solicitud rechazada");
      setReviewNote("");
      await loadRequests(selectedStatus);
      window.dispatchEvent(new CustomEvent(BANNER_REFRESH_EVENT));
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "No fue posible revisar la solicitud");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-grid">
      {isCashier ? (
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Nueva solicitud de producto</h2>
              <p className="muted">Solo puedes solicitar cambios de precio o stock. El producto real no cambia hasta que un admin apruebe.</p>
            </div>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
          {info ? <p className="success-text">{info}</p> : null}
          <form className="grid-form" onSubmit={handleCreateRequest}>
            <label className="form-span-2">
              Producto *
              <input
                list="product-request-options"
                placeholder="Busca por nombre o SKU"
                value={productInput}
                onChange={(event) => handleProductInputChange(event.target.value)}
              />
            </label>
            <datalist id="product-request-options">
              {products.map((product) => <option key={product.id} value={buildProductSearchLabel(product)} />)}
            </datalist>
            <label>
              Nuevo precio
              <input
                min="0"
                step="0.00001"
                type="number"
                value={form.requested_price}
                onChange={(event) => setForm({ ...form, requested_price: event.target.value })}
              />
            </label>
            <label>
              Nuevo stock actual
              <input
                min="0"
                step="0.001"
                type="number"
                value={form.requested_stock}
                onChange={(event) => setForm({ ...form, requested_stock: event.target.value })}
              />
            </label>
            {selectedProduct ? (
              <div className="info-card form-span-2">
                <p><strong>Producto:</strong> {selectedProduct.name}</p>
                <p><strong>SKU:</strong> {selectedProduct.sku}</p>
                <p><strong>Precio actual:</strong> {currency(selectedProduct.price)}</p>
                <p><strong>Stock actual:</strong> {selectedProduct.stock}</p>
              </div>
            ) : null}
            <label className="form-span-2">
              Motivo *
              <textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
            </label>
            <div className="inline-actions">
              <button className="button" disabled={saving} type="submit">{saving ? "Guardando..." : "Crear solicitud"}</button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>{isManagement ? "Solicitudes de actualización de producto" : "Mis solicitudes de producto"}</h2>
            <p className="muted">{isManagement ? "Aprueba o rechaza solicitudes pendientes del negocio." : "Consulta el estado de tus solicitudes enviadas."}</p>
          </div>
          {isManagement ? (
            <div className="inline-actions">
              <select value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value as typeof selectedStatus)}>
                <option value="pending">Pendientes</option>
                <option value="">Todas</option>
                <option value="approved">Aprobadas</option>
                <option value="rejected">Rechazadas</option>
              </select>
            </div>
          ) : null}
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {info ? <p className="success-text">{info}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Solicita</th>
                <th>Estado</th>
                <th>Cambios</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr className={request.id === selectedRequestId ? "table-row-active" : ""} key={request.id} onClick={() => setSelectedRequestId(request.id)}>
                  <td>
                    <div>{request.product_name}</div>
                    <small className="muted">{request.product_sku || "-"}</small>
                  </td>
                  <td>{request.requested_by_name || `Usuario #${request.requested_by_user_id}`}</td>
                  <td>{request.status}</td>
                  <td>
                    <div>{request.requested_price !== null && request.requested_price !== undefined ? `Precio: ${currency(request.current_price_snapshot)} -> ${currency(request.requested_price)}` : "-"}</div>
                    <small className="muted">{request.requested_stock !== null && request.requested_stock !== undefined ? `Stock: ${request.current_stock_snapshot} -> ${request.requested_stock}` : "Sin cambio de stock"}</small>
                  </td>
                  <td>{shortDateTime(request.created_at)}</td>
                </tr>
              ))}
              {!requests.length ? (
                <tr>
                  <td className="muted" colSpan={5}>{loadingRequests ? "Cargando..." : "No hay solicitudes para este filtro."}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {selectedRequest ? (
          <div className="info-card">
            <p><strong>Producto:</strong> {selectedRequest.product_name}</p>
            <p><strong>SKU:</strong> {selectedRequest.product_sku || "-"}</p>
            <p><strong>Motivo:</strong> {selectedRequest.reason}</p>
            <p><strong>Solicita:</strong> {selectedRequest.requested_by_name || `Usuario #${selectedRequest.requested_by_user_id}`}</p>
            <p><strong>Precio:</strong> {selectedRequest.requested_price !== null && selectedRequest.requested_price !== undefined ? `${currency(selectedRequest.current_price_snapshot)} -> ${currency(selectedRequest.requested_price)}` : "Sin cambio"}</p>
            <p><strong>Stock:</strong> {selectedRequest.requested_stock !== null && selectedRequest.requested_stock !== undefined ? `${selectedRequest.current_stock_snapshot} -> ${selectedRequest.requested_stock}` : "Sin cambio"}</p>
            <p><strong>Estado:</strong> {selectedRequest.status}</p>
            <p><strong>Revisó:</strong> {selectedRequest.reviewed_by_name || "-"}</p>
            <p><strong>Revisión:</strong> {selectedRequest.review_note || "-"}</p>
            <p><strong>Revisado en:</strong> {selectedRequest.reviewed_at ? shortDateTime(selectedRequest.reviewed_at) : "-"}</p>
            {isManagement && selectedRequest.status === "pending" ? (
              <>
                <label>
                  Nota de revisión
                  <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} />
                </label>
                <div className="inline-actions">
                  <button className="button" disabled={saving} onClick={() => handleReview("approve")} type="button">
                    {saving ? "Procesando..." : "Aprobar"}
                  </button>
                  <button className="button ghost danger" disabled={saving} onClick={() => handleReview("reject")} type="button">
                    {saving ? "Procesando..." : "Rechazar"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
