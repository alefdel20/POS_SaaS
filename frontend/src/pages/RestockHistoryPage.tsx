import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { RestockHistoryItem, RestockHistoryMetrics, RestockHistoryResponse } from "../types";
import { currency, shortDateTime } from "../utils/format";
import { getCatalogScopeFromPath, getCatalogScopeLabel } from "../utils/navigation";
import { isCashierRole } from "../utils/roles";
import { getRoleLabel } from "../utils/uiLabels";

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(Math.trunc(value)) : value.toFixed(3);
}

// Bajas (entry_type "decrease") llegan con cantidad negativa; se muestra con signo menos tipografico.
function formatMovementQuantity(item: RestockHistoryItem) {
  const value = Number(item.quantity_added || 0);
  return value < 0 ? `−${formatQuantity(Math.abs(value))}` : formatQuantity(value);
}

function isDecrease(item: RestockHistoryItem) {
  return item.entry_type === "decrease" || Number(item.quantity_added || 0) < 0;
}

function normalizeBasePath(pathname: string) {
  return pathname.replace(/\/history$/, "");
}

export function RestockHistoryPage() {
  const { token, user } = useAuth();
  // El cajero no ve costos: no se piden las metricas (el backend responde 403) y se ocultan columnas.
  const isCashier = isCashierRole(user?.role);
  const location = useLocation();
  const restockPath = normalizeBasePath(location.pathname);
  const catalogScope = getCatalogScopeFromPath(location.pathname);
  const scopeLabel = catalogScope ? getCatalogScopeLabel(catalogScope) : "Productos";
  const [items, setItems] = useState<RestockHistoryResponse["items"]>([]);
  const [metrics, setMetrics] = useState<RestockHistoryMetrics | null>(null);
  const [filters, setFilters] = useState({
    date: "",
    product: "",
    supplier: "",
    category: ""
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 15>(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize)
    });
    if (filters.date) params.set("date", filters.date);
    if (filters.product.trim()) params.set("product", filters.product.trim());
    if (filters.supplier.trim()) params.set("supplier", filters.supplier.trim());
    if (filters.category.trim()) params.set("category", filters.category.trim());
    return params.toString();
  }, [filters, page, pageSize]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError("");
    Promise.all([
      apiRequest<RestockHistoryResponse>(`/products/restock-history?${queryString}`, { token }),
      isCashier ? Promise.resolve(null) : apiRequest<RestockHistoryMetrics>(`/products/restock-history/metrics?${queryString}`, { token })
    ])
      .then(([historyResponse, metricsResponse]) => {
        setItems(historyResponse.items);
        setTotalItems(historyResponse.pagination.total);
        setTotalPages(historyResponse.pagination.totalPages);
        setMetrics(metricsResponse);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el historial");
      })
      .finally(() => setLoading(false));
  }, [queryString, token, isCashier]);

  useEffect(() => {
    setPage(1);
  }, [filters.date, filters.product, filters.supplier, filters.category, pageSize]);

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Historial de reabastecimiento</h2>
            <p className="muted">Trazabilidad operativa de {scopeLabel.toLowerCase()} con totales recalculados por filtro.</p>
          </div>
          <div className="inline-actions">
            <Link className="button ghost" to={restockPath}>Volver a reabastecer</Link>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {isCashier ? (
          // Sin tarjetas de costo; los movimientos salen del total del historial (incluye bajas).
          <div className="stats-grid">
            <div className="stat-card"><span className="stat-label">Movimientos</span><strong className="stat-value">{loading ? "—" : error ? "⚠️" : totalItems}</strong></div>
          </div>
        ) : (
          <div className="stats-grid">
            <div className="stat-card"><span className="stat-label">Total gastado</span><strong className="stat-value">{loading ? "—" : error ? "⚠️" : currency(metrics?.total_spent || 0)}</strong></div>
            <div className="stat-card"><span className="stat-label">Valor antes</span><strong className="stat-value">{loading ? "—" : error ? "⚠️" : currency(metrics?.inventory_value_before || 0)}</strong></div>
            <div className="stat-card"><span className="stat-label">Valor despues</span><strong className="stat-value">{loading ? "—" : error ? "⚠️" : currency(metrics?.inventory_value_after || 0)}</strong></div>
            <div className="stat-card"><span className="stat-label">Movimientos</span><strong className="stat-value">{loading ? "—" : error ? "⚠️" : (metrics?.total_movements || 0)}</strong></div>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="inline-actions quick-filter-row">
          <label>
            Fecha
            <input type="date" value={filters.date} onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value }))} />
          </label>
          <label>
            Producto
            <input placeholder="Nombre o SKU" value={filters.product} onChange={(event) => setFilters((current) => ({ ...current, product: event.target.value }))} />
          </label>
          <label>
            Proveedor
            <input placeholder="Proveedor" value={filters.supplier} onChange={(event) => setFilters((current) => ({ ...current, supplier: event.target.value }))} />
          </label>
          <label>
            Categoria
            <input placeholder="Categoria" value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))} />
          </label>
          <button
            className="button ghost"
            onClick={() => {
              setFilters({ date: "", product: "", supplier: "", category: "" });
              setPage(1);
            }}
            type="button"
          >
            Limpiar filtros
          </button>
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value) as 10 | 15)}>
            <option value={10}>10 por pagina</option>
            <option value={15}>15 por pagina</option>
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Producto</th>
                <th>Categoria</th>
                <th>Proveedor</th>
                <th>Cantidad</th>
                {!isCashier ? <th>Costo unitario</th> : null}
                {!isCashier ? <th>Costo total</th> : null}
                <th>Stock antes</th>
                <th>Stock despues</th>
                <th>Usuario</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const decrease = isDecrease(item);
                const roleLabel = item.actor_role ? getRoleLabel(item.actor_role).toLowerCase() : "";
                return (
                  <tr key={item.id}>
                    <td>{shortDateTime(item.created_at)}</td>
                    <td>
                      <div>{item.product_name}</div>
                      <small className="muted">{item.sku || "-"}</small>
                    </td>
                    <td>{item.category || "-"}</td>
                    <td>{item.supplier_name || "-"}</td>
                    <td>
                      <div className="stock-adjust-quantity">
                        <span>{formatMovementQuantity(item)}</span>
                        {decrease ? (
                          <span className="stock-adjust-badge">
                            <span aria-hidden="true">↓</span> Baja
                          </span>
                        ) : null}
                      </div>
                    </td>
                    {!isCashier ? <td>{currency(item.unit_cost ?? 0)}</td> : null}
                    {!isCashier ? <td>{currency(item.total_cost ?? 0)}</td> : null}
                    <td>
                      <div>{formatQuantity(item.stock_before)}</div>
                      {!isCashier ? <small className="muted">{currency(item.inventory_value_before ?? 0)}</small> : null}
                    </td>
                    <td>
                      <div>{formatQuantity(item.stock_after)}</div>
                      {!isCashier ? <small className="muted">{currency(item.inventory_value_after ?? 0)}</small> : null}
                    </td>
                    <td>
                      <div>
                        {item.actor_name || "-"}
                        {roleLabel ? <span className="muted stock-adjust-role"> ({roleLabel})</span> : null}
                      </div>
                      <small className={decrease ? "stock-adjust-reason" : "muted"}>
                        {decrease ? "Motivo: " : ""}{item.reason || "Sin motivo"}
                      </small>
                    </td>
                  </tr>
                );
              })}
              {!items.length ? (
                <tr>
                  <td className="muted" colSpan={isCashier ? 8 : 10}>{loading ? "Cargando historial..." : "No hay reabastecimientos para este filtro."}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="panel-header product-table-footer">
          <p className="muted">{totalItems} movimientos encontrados</p>
          <div className="inline-actions">
            <button className="button ghost" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(current - 1, 1))} type="button">Anterior</button>
            <span className="muted">Pagina {page} de {totalPages}</span>
            <button className="button ghost" disabled={page >= totalPages || loading} onClick={() => setPage((current) => Math.min(current + 1, totalPages))} type="button">Siguiente</button>
          </div>
        </div>
      </div>
    </section>
  );
}
