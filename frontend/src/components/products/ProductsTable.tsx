import type { Dispatch, SetStateAction } from "react";
import { Link } from "react-router-dom";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type { Product } from "../../types";
import { currency, shortDateTime } from "../../utils/format";
import { resolveProductImageUrl } from "../../utils/assets";
import { getMexicoCityDateInputValue } from "../../utils/timezone";
import { getRoleLabel } from "../../utils/uiLabels";
import {
  STATUS_LABELS,
  formatQuantity,
  getStatuses,
  getStockLevel,
  getStockStatus,
  toNumber,
  type StatusKey,
  type StockStatusKey
} from "../../utils/productStatus";
import type { CatalogScope } from "../../utils/navigation";
import { ProductRowActionsMenu, type ProductRowAction } from "./ProductRowActionsMenu";

// Componente de presentacion: busqueda, filtros y paginacion siguen en ProductsPage
// porque disparan loadProducts desde sus efectos.
export type ProductsTableProps = {
  // Cajero con general_settings.cashier_direct_stock en un giro con stock: ajusta
  // existencias directo; no ve Editar/Completar ni textos del flujo de solicitudes.
  cashierDirectStock: boolean;
  // "Bajar existencias" en el menu "...": admin/gerente/superusuario, o cashierDirectStock.
  canDecreaseStock: boolean;
  onDecreaseStock: (product: Product) => void;
  // Aviso de exito en la lista (p. ej. "Existencias actualizadas").
  info: string;
  catalogScope: CatalogScope | null;
  categories: string[];
  categoryFilter: string;
  deleteProduct: (product: Product) => Promise<void>;
  displayProducts: Product[];
  error: string;
  exportProducts: (format: "excel" | "pdf") => Promise<void>;
  handleEdit: (product: Product) => void;
  isCashier: boolean;
  isVeterinaryView: boolean;
  openImportModal: () => void;
  page: number;
  pageSize: 10 | 15;
  printBarcodeLabel: (productId?: number, productName?: string, productBarcode?: string) => Promise<void>;
  resetProductEditor: () => void;
  // Ruta de reabastecer del mismo alcance (ProductsPage: `${productBasePath}/restock`).
  restockPath: string;
  scopedModuleLabel: string;
  // "Por caducar"/"Caducado" solo en giros con lote/caducidad (canUseExpiryDate).
  showExpiryStatus: boolean;
  // Estados de stock, barra y "Sin capturar" solo en giros que descuentan existencias (controlsStock).
  showStockStatus: boolean;
  // Miniaturas solo en giros con foto de producto (canUseProductImage).
  showProductImage: boolean;
  search: string;
  selectedProductIds: number[];
  setCategoryFilter: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setPage: Dispatch<SetStateAction<number>>;
  setPageSize: Dispatch<SetStateAction<10 | 15>>;
  setSearch: Dispatch<SetStateAction<string>>;
  setSelectedProductIds: Dispatch<SetStateAction<number[]>>;
  setStatusFilter: Dispatch<SetStateAction<"all" | "activo" | "inactivo">>;
  statusFilter: "all" | "activo" | "inactivo";
  toggleProductStatus: (product: Product) => Promise<void>;
  togglingId: number | null;
  totalPages: number;
  totalProducts: number;
  veterinaryCategoryFilters: string[];
};

// Casilla + Producto + Precio + Acciones, mas "Lo que tienes" y "Estado" donde aplican.
const BASE_COLUMN_COUNT = 4;

function StockLevel({ product, stockStatus }: { product: Product; stockStatus: StockStatusKey }) {
  if (stockStatus === "uncaptured") {
    return (
      <div className="inventory-list-stock">
        <span className="muted">Sin dato todavía</span>
        <span aria-hidden="true" className="inventory-list-bar-empty" />
      </div>
    );
  }
  const { unit, stock, minimum, reference, percent, unitLabel } = getStockLevel(product);

  return (
    <div className="inventory-list-stock">
      <span className="inventory-list-stock-text">
        <strong>{formatQuantity(stock, unit)}</strong>
        <span className="muted"> {unitLabel} · avisar con {formatQuantity(minimum, unit)}</span>
      </span>
      {percent !== null ? (
        <>
          <span aria-hidden="true" className="inventory-list-bar">
            <span className={`inventory-list-bar-fill is-${stockStatus}`} style={{ width: `${percent}%` }} />
          </span>
          <span className="inventory-list-sr-only">
            {`Nivel: ${formatQuantity(stock, unit)} de ${formatQuantity(reference, unit)} (${Math.round(percent)}%)`}
          </span>
        </>
      ) : null}
    </div>
  );
}

// "Último ajuste manual: María (cajero) · 02/10 14:35". Misma utilidad de fecha que el
// Historial de reabastecimiento (shortDateTime), sin el año.
function LastManualStockChange({ product }: { product: Product }) {
  const change = product.last_manual_stock_change;
  if (!change) return null;
  const roleLabel = change.actor_role ? getRoleLabel(change.actor_role).toLowerCase() : "";
  const who = [change.user_name || "Usuario", roleLabel ? `(${roleLabel})` : ""].filter(Boolean).join(" ");
  const when = shortDateTime(change.at).replace(/^(\d{2}\/\d{2})\/\d{4}/, "$1");
  return (
    <small className="muted stock-adjust-last">Último ajuste manual: {who}{when && when !== "-" ? ` · ${when}` : ""}</small>
  );
}

export function ProductsTable({
  cashierDirectStock,
  canDecreaseStock,
  onDecreaseStock,
  info,
  catalogScope,
  categories,
  categoryFilter,
  deleteProduct,
  displayProducts,
  error,
  exportProducts,
  handleEdit,
  isCashier,
  isVeterinaryView,
  openImportModal,
  page,
  pageSize,
  printBarcodeLabel,
  resetProductEditor,
  restockPath,
  scopedModuleLabel,
  showExpiryStatus,
  showStockStatus,
  showProductImage,
  search,
  selectedProductIds,
  setCategoryFilter,
  setError,
  setPage,
  setPageSize,
  setSearch,
  setSelectedProductIds,
  setStatusFilter,
  statusFilter,
  toggleProductStatus,
  togglingId,
  totalPages,
  totalProducts,
  veterinaryCategoryFilters
}: ProductsTableProps) {
  const today = getMexicoCityDateInputValue();
  const showStatusColumn = showStockStatus || showExpiryStatus;
  const columnCount = BASE_COLUMN_COUNT + (showStockStatus ? 1 : 0) + (showStatusColumn ? 1 : 0);
  const countLabel = catalogScope ? scopedModuleLabel.toLowerCase() : isVeterinaryView ? "productos e insumos" : "productos";

  // Mismo corte que el CSS (<= 640 px). Tabla y tarjetas nunca se renderizan a la vez.
  const isMobile = useMediaQuery("(max-width: 640px)");

  // Piezas compartidas por la tabla (escritorio) y las tarjetas (movil): mismo marcado y logica.
  function renderProductInfo(product: Product) {
    const isInactive = (product.status ?? (product.is_active ? "activo" : "inactivo")) === "inactivo";
    return (
      <div className="inventory-list-product">
        <strong className="inventory-list-product-name">{product.name}</strong>
        <small className="muted">{[product.category, product.sku].filter(Boolean).join(" · ") || "-"}</small>
        {isInactive ? <small className="inventory-list-tag">Inactivo</small> : null}
        {product.has_pending_update_request && !cashierDirectStock ? (
          <small className="muted">Pendiente de aprobación ({product.pending_update_request_count || 1})</small>
        ) : null}
      </div>
    );
  }

  function renderThumbnail(product: Product) {
    if (!showProductImage) return null;
    return product.image_path ? (
      <img alt={product.name} className="product-table-thumb" src={resolveProductImageUrl(product.image_path) || ""} />
    ) : (
      <div className="product-table-thumb product-table-thumb-placeholder" aria-hidden="true">IMG</div>
    );
  }

  function renderPrice(product: Product) {
    return product.is_on_sale ? (
      <div className="price-stack">
        <span className="price-original">{currency(product.price)}</span>
        <strong>{currency(product.effective_price ?? product.price)}</strong>
      </div>
    ) : (
      <strong>{currency(product.price)}</strong>
    );
  }

  function renderStatuses(statuses: StatusKey[]) {
    return (
      <div className="inventory-list-statuses">
        {statuses.map((status) => (
          <span className={`inventory-list-status is-${status}`} key={status}>
            <span aria-hidden="true" className="inventory-list-status-dot" />
            {STATUS_LABELS[status]}
          </span>
        ))}
      </div>
    );
  }

  function renderActions(product: Product, needsCapture: boolean, extraClassName = "") {
    return (
      <div className={`inventory-list-actions${extraClassName ? ` ${extraClassName}` : ""}`}>
        {cashierDirectStock ? (
          // El formulario de producto sigue siendo solo para admin/gerente.
          <Link className="button ghost" to={`${restockPath}?restockSearch=${encodeURIComponent(product.name)}`}>+ Entrada</Link>
        ) : needsCapture ? (
          <button className="button ghost inventory-list-complete" onClick={() => handleEdit(product)} type="button">Completar</button>
        ) : (
          <>
            <button className="button ghost" onClick={() => handleEdit(product)} type="button">Editar</button>
            {showStockStatus ? (
              <Link className="button ghost" to={`${restockPath}?restockSearch=${encodeURIComponent(product.name)}`}>+ Entrada</Link>
            ) : null}
          </>
        )}
        <ProductRowActionsMenu actions={buildRowActions(product)} productName={product.name} />
      </div>
    );
  }

  const allSelected = displayProducts.length > 0 && displayProducts.every((p) => selectedProductIds.includes(p.id));

  function toggleSelected(productId: number, checked: boolean) {
    setSelectedProductIds(checked ? [...selectedProductIds, productId] : selectedProductIds.filter((id) => id !== productId));
  }

  function buildRowActions(product: Product): ProductRowAction[] {
    const actions: ProductRowAction[] = [];
    if (product.barcode) {
      actions.push({
        key: "print",
        label: "Imprimir etiqueta",
        onSelect: () => {
          printBarcodeLabel(product.id, product.name, product.barcode).catch((printError) => setError(printError instanceof Error ? printError.message : "No fue posible imprimir el código de barras"));
        }
      });
    }
    // Solo con existencias: sin stock no hay nada que bajar (y el backend lo rechazaria).
    if (canDecreaseStock && showStockStatus && toNumber(product.stock) > 0) {
      actions.push({
        key: "decrease",
        label: "Bajar existencias",
        onSelect: () => onDecreaseStock(product)
      });
    }
    if (!isCashier) {
      actions.push({
        key: "toggle",
        label: togglingId === product.id ? "Actualizando..." : product.status === "inactivo" ? "Activar" : "Desactivar",
        disabled: togglingId === product.id,
        onSelect: () => {
          toggleProductStatus(product);
        }
      });
      actions.push({
        key: "delete",
        label: "Eliminar",
        danger: true,
        onSelect: () => {
          deleteProduct(product);
        }
      });
    }
    return actions;
  }

  return (
    <div className={`panel inventory-list${isMobile && !isCashier ? " inventory-mobile-has-fab" : ""}`}>
      <div className="inventory-list-header">
        <div>
          <h2 className="inventory-list-title">{catalogScope ? scopedModuleLabel : "Inventario"}</h2>
          <p className="muted inventory-list-subtitle">{totalProducts} {countLabel}</p>
        </div>
        {!isCashier ? (
          <div className="inline-actions">
            <button className="button ghost" onClick={openImportModal} type="button">Importar productos</button>
            {/* En movil lo reemplaza el boton flotante "+ Agregar" (mismo handler). */}
            {!isMobile ? <button className="button" onClick={resetProductEditor} type="button">+ Agregar producto</button> : null}
          </div>
        ) : null}
      </div>

      <div className="inventory-list-toolbar">
        <input
          aria-label="Buscar productos"
          className="search-input inventory-list-search"
          placeholder="Buscar por nombre, SKU, categoría o proveedor"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {!isVeterinaryView ? (
          <select
            aria-label="Filtrar por categoría"
            className="inventory-list-select"
            value={categoryFilter}
            onChange={(event) => { setCategoryFilter(event.target.value); setPage(1); }}
          >
            <option value="">Todas las categorías</option>
            {categoryFilter && !categories.includes(categoryFilter) ? <option value={categoryFilter}>{categoryFilter}</option> : null}
            {categories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        ) : null}
        <select
          aria-label="Productos por página"
          className="inventory-list-select inventory-list-select-compact"
          value={pageSize}
          onChange={(event) => setPageSize(Number(event.target.value) as 10 | 15)}
        >
          <option value={10}>10 por página</option>
          <option value={15}>15 por página</option>
        </select>
      </div>

      <div className="inventory-list-toolbar">
        <div className="inventory-list-segmented inventory-mobile-chips" role="group" aria-label="Filtrar por estado">
          {(["all", "activo", "inactivo"] as const).map((value) => (
            <button
              aria-pressed={statusFilter === value}
              className={`button ghost${statusFilter === value ? " active-filter" : ""}`}
              key={value}
              onClick={() => { setStatusFilter(value); setPage(1); }}
              type="button"
            >
              {value === "all" ? "Todos" : value === "activo" ? "Activos" : "Inactivos"}
            </button>
          ))}
        </div>
        {!isCashier ? (
          <div className="inline-actions inventory-list-export">
            <button className="button ghost" onClick={() => exportProducts("excel").catch(() => {})} type="button">Exportar Excel{selectedProductIds.length > 0 ? ` (${selectedProductIds.length})` : ""}</button>
            <button className="button ghost" onClick={() => exportProducts("pdf").catch(() => {})} type="button">Exportar PDF{selectedProductIds.length > 0 ? ` (${selectedProductIds.length})` : ""}</button>
          </div>
        ) : null}
      </div>

      {isVeterinaryView ? (
        <div className="inline-actions quick-filter-row inventory-mobile-chips">
          <button className={`button ghost ${categoryFilter === "" ? "active-filter" : ""}`} onClick={() => { setCategoryFilter(""); setPage(1); }} type="button">
            Todas
          </button>
          {(catalogScope ? categories : veterinaryCategoryFilters).map((category) => (
            <button
              className={`button ghost ${categoryFilter === category ? "active-filter" : ""}`}
              key={category}
              onClick={() => { setCategoryFilter(category); setPage(1); }}
              type="button"
            >
              {category}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}
      {info ? <p className="success-text" role="status">{info}</p> : null}

      {isMobile ? (
        <div className="inventory-mobile-list">
          {displayProducts.length > 0 ? (
            <label className="inventory-mobile-select-all">
              <input
                checked={allSelected}
                onChange={(e) => setSelectedProductIds(e.target.checked ? displayProducts.map((p) => p.id) : [])}
                type="checkbox"
              />
              <span>Seleccionar todos</span>
            </label>
          ) : null}
          <ul className="inventory-mobile-cards">
            {displayProducts.map((product) => {
              const statuses = getStatuses(product, showStockStatus, showExpiryStatus, today);
              const stockStatus = getStockStatus(product);
              const needsCapture = showStockStatus && stockStatus === "uncaptured";
              const showStatuses = showStatusColumn && statuses.length > 0;
              return (
                <li className="inventory-mobile-card" key={product.id}>
                  <div className="inventory-mobile-card-top">
                    <label className="inventory-mobile-check">
                      <input
                        aria-label={`Seleccionar ${product.name}`}
                        checked={selectedProductIds.includes(product.id)}
                        onChange={(e) => toggleSelected(product.id, e.target.checked)}
                        type="checkbox"
                      />
                    </label>
                    {renderThumbnail(product)}
                    <div className="inventory-mobile-card-info">{renderProductInfo(product)}</div>
                    <div className="inventory-mobile-card-price">{renderPrice(product)}</div>
                  </div>
                  {showStockStatus || showStatuses ? (
                    <div className="inventory-mobile-card-stock">
                      {showStockStatus ? (
                        <>
                          <StockLevel product={product} stockStatus={stockStatus} />
                          <LastManualStockChange product={product} />
                        </>
                      ) : null}
                      {showStatuses ? renderStatuses(statuses) : null}
                    </div>
                  ) : null}
                  {renderActions(product, needsCapture, "inventory-mobile-card-actions")}
                </li>
              );
            })}
          </ul>
          {displayProducts.length === 0 ? <p className="muted">No se encontraron productos.</p> : null}
        </div>
      ) : (
        <div className="table-wrap inventory-list-table-wrap">
          <table className="inventory-list-table">
            <thead>
              <tr>
                <th className="inventory-list-check-cell">
                  <input
                    aria-label="Seleccionar todos"
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => setSelectedProductIds(e.target.checked ? displayProducts.map((p) => p.id) : [])}
                    title="Seleccionar todos"
                  />
                </th>
                <th>Producto</th>
                <th>Precio</th>
                {showStockStatus ? <th>Lo que tienes</th> : null}
                {showStatusColumn ? <th>Estado</th> : null}
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {displayProducts.map((product) => {
                const statuses = getStatuses(product, showStockStatus, showExpiryStatus, today);
                const stockStatus = getStockStatus(product);
                const needsCapture = showStockStatus && stockStatus === "uncaptured";
                return (
                  <tr key={product.id}>
                    <td className="inventory-list-check-cell">
                      <input
                        aria-label={`Seleccionar ${product.name}`}
                        type="checkbox"
                        checked={selectedProductIds.includes(product.id)}
                        onChange={(e) => toggleSelected(product.id, e.target.checked)}
                      />
                    </td>
                    <td>
                      <div className="product-name-cell">
                        {renderThumbnail(product)}
                        {renderProductInfo(product)}
                      </div>
                    </td>
                    <td className="inventory-list-price">
                      {renderPrice(product)}
                    </td>
                    {showStockStatus ? (
                      <td>
                        <StockLevel product={product} stockStatus={stockStatus} />
                        <LastManualStockChange product={product} />
                      </td>
                    ) : null}
                    {showStatusColumn ? (
                      <td>
                        {renderStatuses(statuses)}
                      </td>
                    ) : null}
                    <td>
                      {renderActions(product, needsCapture)}
                    </td>
                  </tr>
                );
              })}
              {displayProducts.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={columnCount}>No se encontraron productos.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      <div className="inventory-list-footer">
        <p className="muted">Mostrando {displayProducts.length} de {totalProducts} {countLabel}</p>
        <div className="inline-actions">
          <button className="button ghost" disabled={page <= 1} onClick={() => setPage((current) => Math.max(current - 1, 1))} type="button">Anterior</button>
          <span className="muted">Página {page} de {totalPages}</span>
          <button className="button ghost" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(current + 1, totalPages))} type="button">Siguiente</button>
        </div>
      </div>
      {isMobile && !isCashier ? (
        <button className="button inventory-mobile-fab" onClick={resetProductEditor} type="button">
          <span aria-hidden="true">+</span> Agregar
        </button>
      ) : null}
    </div>
  );
}
