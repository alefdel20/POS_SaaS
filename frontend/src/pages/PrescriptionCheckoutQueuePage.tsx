import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type {
  PrescriptionCheckoutRequest,
  PrescriptionCheckoutRequestListResponse,
  PrescriptionCheckoutRequestPendingSummary
} from "../types";
import { currency, shortDateTime } from "../utils/format";
import { ROUTE_ROLES, hasAnyRole } from "../utils/roles";

type FiltersState = {
  status: "" | "pending" | "completed" | "cancelled";
};

const defaultFilters: FiltersState = {
  status: "pending"
};

function getStatusLabel(status: PrescriptionCheckoutRequest["status"]) {
  if (status === "completed") return "Completada";
  if (status === "cancelled") return "Cancelada";
  return "Pendiente";
}

export function PrescriptionCheckoutQueuePage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const canManage = hasAnyRole(user?.role, ROUTE_ROLES.gerente);

  const [requests, setRequests] = useState<PrescriptionCheckoutRequest[]>([]);
  const [summary, setSummary] = useState<PrescriptionCheckoutRequestPendingSummary | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [filters, setFilters] = useState<FiltersState>(defaultFilters);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 15>(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [cancelReason, setCancelReason] = useState("");

  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedRequestId) || null,
    [requests, selectedRequestId]
  );

  async function loadRequests(nextPage = page, nextPageSize = pageSize, nextFilters = filters) {
    if (!token) return;
    setLoadingRequests(true);
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(nextPageSize)
      });
      if (nextFilters.status) params.set("status", nextFilters.status);

      const response = await apiRequest<PrescriptionCheckoutRequestListResponse>(`/prescription-checkout-requests?${params.toString()}`, { token });
      setRequests(response.items);
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

  async function loadSummary() {
    if (!token) return;
    try {
      const response = await apiRequest<PrescriptionCheckoutRequestPendingSummary>("/prescription-checkout-requests/pending-summary", { token });
      setSummary(response);
    } catch {
      setSummary(null);
    }
  }

  useEffect(() => {
    loadRequests(page, pageSize, filters).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar la cola de cobro");
    });
  }, [token, page, pageSize, filters]);

  useEffect(() => {
    loadSummary();
  }, [token]);

  function resetFeedback() {
    setError("");
    setInfo("");
  }

  function updateFilters(patch: Partial<FiltersState>) {
    setPage(1);
    setFilters((current) => ({ ...current, ...patch }));
  }

  function handleLoadToRegister(request: PrescriptionCheckoutRequest) {
    navigate(`/sales?checkout_request_id=${request.id}`);
  }

  async function handleCancel() {
    if (!token || !selectedRequest || saving) return;
    try {
      setSaving(true);
      resetFeedback();
      await apiRequest(`/prescription-checkout-requests/${selectedRequest.id}/cancel`, {
        method: "POST",
        token,
        body: JSON.stringify({ reason: cancelReason.trim() || undefined })
      });
      setInfo("Solicitud cancelada correctamente");
      setCancelReason("");
      await loadRequests(page, pageSize, filters);
      await loadSummary();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "No fue posible cancelar la solicitud");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Recetas pendientes de cobro</h2>
            <p className="muted">Consultas y recetas enviadas a caja para completar el cobro.</p>
          </div>
          <div className="inline-actions">
            <select value={pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value) as 10 | 15); }}>
              <option value={10}>10 por pagina</option>
              <option value={15}>15 por pagina</option>
            </select>
          </div>
        </div>

        <div className="stats-grid">
          <article className="info-card compact-box">
            <span className="muted">Pendientes</span>
            <strong>{summary?.pending_count || 0}</strong>
          </article>
          <article className="info-card compact-box">
            <span className="muted">En esta vista</span>
            <strong>{totalItems}</strong>
          </article>
        </div>

        <div className="inline-actions quick-filter-row">
          <select value={filters.status} onChange={(event) => updateFilters({ status: event.target.value as FiltersState["status"] })}>
            <option value="">Todos los estados</option>
            <option value="pending">Pendientes</option>
            <option value="completed">Completadas</option>
            <option value="cancelled">Canceladas</option>
          </select>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
        {info ? <p className="success-text">{info}</p> : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Paciente / consulta</th>
                <th>Solicita</th>
                <th>Cobra consulta</th>
                <th>Estado</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr className={request.id === selectedRequestId ? "table-row-active" : ""} key={request.id} onClick={() => setSelectedRequestId(request.id)}>
                  <td>
                    <div>{request.patient_name || `Consulta #${request.consultation_id}`}</div>
                    <small className="muted">{request.consultation_reason || "-"}</small>
                  </td>
                  <td>{request.requested_by_name || `Usuario #${request.requested_by_user_id}`}</td>
                  <td>{request.charge_consultation ? currency(request.consultation_amount || 0) : "No"}</td>
                  <td>
                    <span className={`status-badge appointment-status-${request.status === "completed" ? "completed" : request.status === "cancelled" ? "cancelled" : "scheduled"}`}>
                      {getStatusLabel(request.status)}
                    </span>
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
            <p><strong>Paciente:</strong> {selectedRequest.patient_name || `Consulta #${selectedRequest.consultation_id}`}</p>
            <p><strong>Motivo de consulta:</strong> {selectedRequest.consultation_reason || "-"}</p>
            <p><strong>Solicita:</strong> {selectedRequest.requested_by_name || `Usuario #${selectedRequest.requested_by_user_id}`}</p>
            <p><strong>Estado:</strong> {getStatusLabel(selectedRequest.status)}</p>
            <p><strong>Cobra consulta:</strong> {selectedRequest.charge_consultation ? currency(selectedRequest.consultation_amount || 0) : "No"}</p>
            {selectedRequest.status === "completed" ? (
              <>
                <p><strong>Venta:</strong> {selectedRequest.sale_id ? `#${selectedRequest.sale_id}` : "-"}</p>
                <p><strong>Completada por:</strong> {selectedRequest.completed_by_name || "-"}</p>
                <p><strong>Completada en:</strong> {selectedRequest.completed_at ? shortDateTime(selectedRequest.completed_at) : "-"}</p>
              </>
            ) : null}
            {selectedRequest.status === "cancelled" ? (
              <p><strong>Motivo de cancelacion:</strong> {selectedRequest.cancelled_reason || "-"}</p>
            ) : null}

            {selectedRequest.status === "pending" ? (
              <div className="inline-actions">
                <button className="button" disabled={saving} onClick={() => handleLoadToRegister(selectedRequest)} type="button">
                  Cargar a caja
                </button>
              </div>
            ) : null}

            {selectedRequest.status === "pending" && canManage ? (
              <>
                <label>
                  Motivo de cancelacion
                  <textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
                </label>
                <div className="inline-actions">
                  <button className="button ghost danger" disabled={saving} onClick={handleCancel} type="button">
                    {saving ? "Procesando..." : "Cancelar"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <div className="empty-state-card">
            <strong>No hay una solicitud seleccionada.</strong>
            <span className="muted">Selecciona una fila para ver el detalle y las acciones disponibles.</span>
          </div>
        )}
      </div>
    </section>
  );
}
