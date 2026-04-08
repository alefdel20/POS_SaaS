import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type {
  PaginatedProductsResponse,
  Product,
  ProductUpdateRequest,
  ProductUpdateRequestListResponse,
  ProductUpdateRequestSummary
} from "../types";
import { currency, shortDate, shortDateTime } from "../utils/format";
import { isCashierRole, isManagementRole } from "../utils/roles";

type RequestFormState = {
  product_id: string;
  requested_price: string;
  requested_stock: string;
  reason: string;
};

type FiltersState = {
  status: "" | "pending" | "approved" | "rejected";
  requested_by_user_id: string;
  product_id: string;
  search: string;
  date_from: string;
  date_to: string;
};

const emptyForm: RequestFormState = {
  product_id: "",
  requested_price: "",
  requested_stock: "",
  reason: ""
};

const defaultFilters: FiltersState = {
  status: "",
  requested_by_user_id: "",
  product_id: "",
  search: "",
  date_from: "",
  date_to: ""
};

const BANNER_REFRESH_EVENT = "product-update-requests:refresh-banner";

function buildProductSearchLabel(product: Product) {
  return `${product.name} - ${product.sku}`;
}

function formatChangeValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Si" : "No";
  return String(value);
}

function buildChangedFieldRows(request: ProductUpdateRequest) {
  const beforeSnapshot = request.before_snapshot || {};
  const afterSnapshot = request.after_snapshot || {};
  const changedFields = request.changed_fields || [];
  return changedFields.map((field) => ({
    field,
    before: beforeSnapshot[field],
    after: afterSnapshot[field]
  }));
}

function getStatusLabel(status: ProductUpdateRequest["status"]) {
  if (status === "approved") return "Aprobada";
  if (status === "rejected") return "Rechazada";
  return "Pendiente";
}

export function ProductUpdateRequestsPage() {
  const { token, user } = useAuth();
  const isCashier = isCashierRole(user?.role);
  const isManagement = isManagementRole(user?.role);
  const [requests, setRequests] = useState<ProductUpdateRequest[]>([]);
  const [summary, setSummary] = useState<ProductUpdateRequestSummary | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [filters, setFilters] = useState<FiltersState>(isManagement ? { ...defaultFilters, status: "pending" } : defaultFilters);
  const [products, setProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [productInput, setProductInput] = useState("");
  const [form, setForm] = useState<RequestFormState>(emptyForm);
  const [reviewNote, setReviewNote] = useState("");
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 15>(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const selectedProduct = useMemo(
    () => products.find((product) => String(product.id) === form.product_id) || null,
    [form.product_id, products]
  );
  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedRequestId) || null,
    [requests, selectedRequestId]
  );
  const selectedDiffRows = useMemo(
    () => (selectedRequest ? buildChangedFieldRows(selectedRequest) : []),
    [selectedRequest]
  );

  async function loadRequests(nextPage = page, nextPageSize = pageSize, nextFilters = filters) {
    if (!token) return;
    setLoadingRequests(true);
    try {
      const params = new URLSearchParams({
        includeMeta: "true",
        page: String(nextPage),
        pageSize: String(nextPageSize)
      });
      if (nextFilters.status) params.set("status", nextFilters.status);
      if (nextFilters.requested_by_user_id) params.set("requested_by_user_id", nextFilters.requested_by_user_id);
      if (nextFilters.product_id) params.set("product_id", nextFilters.product_id);
      if (nextFilters.search.trim()) params.set("search", nextFilters.search.trim());
      if (nextFilters.date_from) params.set("date_from", nextFilters.date_from);
      if (nextFilters.date_to) params.set("date_to", nextFilters.date_to);

      const response = await apiRequest<ProductUpdateRequestListResponse>(`/product-update-requests?${params.toString()}`, { token });
      setRequests(response.items);
      setSummary(response.summary);
      setTotalPages(response.pagination.totalPages);
      setTotalItems(response.pagination.total);
      setSelectedRequestId((current) => {
        const nextId = current ?? response.items[0]?.id ?? null;
        return response.items.some((request) => request.id === nextId) ? nextId : response.items[0]?.id ?? null;
      });
    } finally {
      setLoadingRequests(false);
    }
  }

  async function loadProducts(term = "") {
    if (!token) return;
    const params = new URLSearchParams({ activeOnly: "true", page: "1", pageSize: "10" });
    if (term.trim()) {
      params.set("search", term.trim());
    }
    const response = await apiRequest<PaginatedProductsResponse | Product[]>(`/products?${params.toString()}`, { token });
    setProducts(Array.isArray(response) ? response : response.items);
  }

  useEffect(() => {
    loadRequests(page, pageSize, filters).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar las solicitudes");
    });
  }, [token, page, pageSize, filters]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadProducts(productSearch).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar productos");
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [token, productSearch]);

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

  function updateFilters(patch: Partial<FiltersState>) {
    setPage(1);
    setFilters((current) => ({ ...current, ...patch }));
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
      setInfo("Tu cambio fue enviado para aprobacion");
      setForm(emptyForm);
      setProductInput("");
      setProductSearch("");
      await loadProducts("");
      await loadRequests(1, pageSize, filters);
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
      setInfo(decision === "approve" ? "Solicitud aprobada correctamente" : "Solicitud rechazada correctamente");
      setReviewNote("");
      await loadRequests(page, pageSize, filters);
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
              <p className="muted">Solicita cambios de precio o stock con confirmacion clara y seguimiento visible.</p>
            </div>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
          {info ? <p className="success-text">{info}</p> : null}
          <div className="stats-grid">
            <StatCardLike label="Pendientes" value={summary?.pending || 0} />
            <StatCardLike label="Aprobadas" value={summary?.approved || 0} accent="#6cf0c2" />
            <StatCardLike label="Rechazadas" value={summary?.rejected || 0} accent="#ff7b7b" />
            <StatCardLike label="Enviadas hoy" value={summary?.today || 0} accent="#ffb454" />
          </div>
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
              <button className="button" disabled={saving} type="submit">{saving ? "Enviando..." : "Enviar solicitud"}</button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>{isManagement ? "Cambios por aprobar" : "Mis solicitudes"}</h2>
            <p className="muted">
              {isManagement
                ? "Panel con resumen, filtros y diff legible para revisar sin aprobar a ciegas."
                : "Consulta el estado de tus solicitudes recientes sin perder contexto operativo."}
            </p>
          </div>
          <div className="inline-actions">
            <select value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value) as 10 | 15); }}>
              <option value={10}>10 por pagina</option>
              <option value={15}>15 por pagina</option>
            </select>
          </div>
        </div>

        <div className="stats-grid">
          <StatCardLike label="Pendientes" value={summary?.pending || 0} />
          <StatCardLike label="Aprobadas" value={summary?.approved || 0} accent="#6cf0c2" />
          <StatCardLike label="Rechazadas" value={summary?.rejected || 0} accent="#ff7b7b" />
          <StatCardLike label="Solicitudes de hoy" value={summary?.today || 0} accent="#ffb454" />
        </div>

        <div className="inline-actions quick-filter-row">
          <select value={filters.status} onChange={(event) => updateFilters({ status: event.target.value as FiltersState["status"] })}>
            <option value="">Todos los estatus</option>
            <option value="pending">Pendientes</option>
            <option value="approved">Aprobadas</option>
            <option value="rejected">Rechazadas</option>
          </select>
          <input
            className="search-input"
            placeholder={isManagement ? "Buscar por producto, SKU, cajero o motivo" : "Buscar por producto, SKU o motivo"}
            value={filters.search}
            onChange={(event) => updateFilters({ search: event.target.value })}
          />
          <input type="date" value={filters.date_from} onChange={(event) => updateFilters({ date_from: event.target.value })} />
          <input type="date" value={filters.date_to} onChange={(event) => updateFilters({ date_to: event.target.value })} />
          <button className="button ghost" onClick={() => { setPage(1); setFilters(isManagement ? { ...defaultFilters, status: "pending" } : defaultFilters); }} type="button">
            Limpiar filtros
          </button>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
        {info ? <p className="success-text">{info}</p> : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Solicita</th>
                <th>Estatus</th>
                <th>Campos modificados</th>
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
                  <td>
                    <span className={`status-badge appointment-status-${request.status === "approved" ? "completed" : request.status === "rejected" ? "cancelled" : "scheduled"}`}>
                      {getStatusLabel(request.status)}
                    </span>
                  </td>
                  <td>
                    <div>{request.changed_fields?.length ? request.changed_fields.join(", ") : "Sin diff"}</div>
                    <small className="muted">{request.request_type || "update"}</small>
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

        <div className="panel-header product-table-footer">
          <p className="muted">{totalItems} solicitudes encontradas</p>
          <div className="inline-actions">
            <button className="button ghost" disabled={page <= 1 || loadingRequests} onClick={() => setPage((current) => Math.max(current - 1, 1))} type="button">Anterior</button>
            <span className="muted">Pagina {page} de {totalPages}</span>
            <button className="button ghost" disabled={page >= totalPages || loadingRequests} onClick={() => setPage((current) => Math.min(current + 1, totalPages))} type="button">Siguiente</button>
          </div>
        </div>

        {selectedRequest ? (
          <div className="info-card">
            <p><strong>Producto:</strong> {selectedRequest.product_name}</p>
            <p><strong>SKU:</strong> {selectedRequest.product_sku || "-"}</p>
            <p><strong>Motivo:</strong> {selectedRequest.reason}</p>
            <p><strong>Solicita:</strong> {selectedRequest.requested_by_name || `Usuario #${selectedRequest.requested_by_user_id}`}</p>
            <p><strong>Estatus:</strong> {getStatusLabel(selectedRequest.status)}</p>
            {selectedDiffRows.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Campo</th>
                      <th>Antes</th>
                      <th>Despues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedDiffRows.map((row) => (
                      <tr key={row.field}>
                        <td><strong>{row.field}</strong></td>
                        <td>{formatChangeValue(row.before)}</td>
                        <td>{formatChangeValue(row.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">Esta solicitud no tiene diff legible disponible.</p>
            )}
            <p><strong>Revision:</strong> {selectedRequest.review_note || "-"}</p>
            <p><strong>Revisado por:</strong> {selectedRequest.reviewed_by_name || "-"}</p>
            <p><strong>Revisado en:</strong> {selectedRequest.reviewed_at ? shortDateTime(selectedRequest.reviewed_at) : "-"}</p>
            {isManagement && selectedRequest.status === "pending" ? (
              <>
                <label>
                  Nota de revision
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
        ) : (
          <div className="empty-state-card">
            <strong>No hay una solicitud seleccionada.</strong>
            <span className="muted">Selecciona una fila para revisar su detalle y diff.</span>
          </div>
        )}

        {!isManagement && summary?.recent.length ? (
          <div className="panel">
            <div className="panel-header">
              <div>
                <h3>Actividad reciente</h3>
                <p className="muted">Tus ultimas solicitudes y su respuesta.</p>
              </div>
            </div>
            <div className="stack-list">
              {summary.recent.map((request) => (
                <article className="info-card" key={`recent-own-${request.id}`}>
                  <strong>{request.product_name}</strong>
                  <p>{request.product_sku || "-"}</p>
                  <p>{getStatusLabel(request.status)} · {shortDateTime(request.created_at)}</p>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function StatCardLike({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <article className="info-card compact-box">
      <span className="muted">{label}</span>
      <strong style={accent ? { color: accent } : undefined}>{value}</strong>
    </article>
  );
}
