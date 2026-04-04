import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type {
  PaginatedProductsResponse,
  Product,
  SupplierCatalogImportConfirmResponse,
  SupplierCatalogImportPreviewResponse,
  SupplierCatalogItem,
  SupplierCatalogListResponse,
  SupplierDetail
} from "../types";
import { currency, shortDateTime } from "../utils/format";

type SupplierSummary = {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  observations?: string | null;
  product_count: number;
};

type SupplierTab = "overview" | "catalog" | "linked" | "history";

type CatalogFilters = {
  search: string;
  status: string;
  linked: string;
  cost_changed: string;
  active: string;
  category: string;
  supplier_product_code: string;
};

type CreateProductForm = {
  name: string;
  description: string;
  category: string;
  unidad_de_venta: "pieza" | "kg" | "litro" | "caja";
  price: string;
  cost_price: string;
  stock: string;
  stock_minimo: string;
  stock_maximo: string;
};

const DEFAULT_FILTERS: CatalogFilters = {
  search: "",
  status: "",
  linked: "",
  cost_changed: "",
  active: "active",
  category: "",
  supplier_product_code: ""
};

function createProductFormFromCatalogItem(item: SupplierCatalogItem): CreateProductForm {
  return {
    name: item.supplier_product_name,
    description: item.supplier_description || "",
    category: item.supplier_category || "General",
    unidad_de_venta: item.supplier_unit || "pieza",
    price: item.purchase_cost ? String(item.purchase_cost) : "",
    cost_price: String(item.purchase_cost || 0),
    stock: "0",
    stock_minimo: "0",
    stock_maximo: "0"
  };
}

function getCatalogStatusLabel(status: string) {
  switch (status) {
    case "new":
      return "Nuevo";
    case "linked":
      return "Vinculado";
    case "cost_changed":
      return "Costo cambiado";
    case "cost_applied":
      return "Costo aplicado";
    case "inactive":
      return "Inactivo";
    case "pending":
    default:
      return "Pendiente";
  }
}

function buildCatalogQuery(filters: CatalogFilters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value.trim()) {
      params.set(key, value.trim());
    }
  });
  return params.toString();
}

export function SuppliersPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierDetail | null>(null);
  const [catalogData, setCatalogData] = useState<SupplierCatalogListResponse | null>(null);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [catalogFilters, setCatalogFilters] = useState<CatalogFilters>(DEFAULT_FILTERS);
  const [activeTab, setActiveTab] = useState<SupplierTab>("overview");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<SupplierCatalogImportPreviewResponse | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [linkingItem, setLinkingItem] = useState<SupplierCatalogItem | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const [creatingItem, setCreatingItem] = useState<SupplierCatalogItem | null>(null);
  const [createProductForm, setCreateProductForm] = useState<CreateProductForm | null>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  const importableRows = useMemo(
    () => importPreview?.rows.filter((row) => row.errors.length === 0) || [],
    [importPreview]
  );

  async function loadSuppliers(term = "") {
    if (!token) return;
    const params = new URLSearchParams();
    if (term.trim()) params.set("search", term.trim());
    const response = await apiRequest<SupplierSummary[]>(`/suppliers?${params.toString()}`, { token });
    setSuppliers(response);
    setSelectedSupplierId((current) => current ?? response[0]?.id ?? null);
  }

  async function loadSupplierDetail(supplierId: number) {
    if (!token) return;
    const response = await apiRequest<SupplierDetail>(`/suppliers/${supplierId}`, { token });
    setSelectedSupplier(response);
  }

  async function loadSupplierCatalog(supplierId: number, filters: CatalogFilters = catalogFilters) {
    if (!token) return;
    const query = buildCatalogQuery(filters);
    const response = await apiRequest<SupplierCatalogListResponse>(`/suppliers/${supplierId}/catalog${query ? `?${query}` : ""}`, { token });
    setCatalogData(response);
  }

  async function loadProductResults(term: string) {
    if (!token || !linkingItem) return;
    setProductSearchLoading(true);
    try {
      const params = new URLSearchParams();
      if (term.trim()) params.set("search", term.trim());
      params.set("page", "1");
      params.set("pageSize", "15");
      const response = await apiRequest<PaginatedProductsResponse>(`/products?${params.toString()}`, { token });
      setProductResults(response.items);
    } finally {
      setProductSearchLoading(false);
    }
  }

  function resetFeedback() {
    setError("");
    setSuccess("");
  }

  useEffect(() => {
    loadSuppliers().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar proveedores");
    });
  }, [token]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadSuppliers(supplierSearch).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible buscar proveedores");
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [supplierSearch, token]);

  useEffect(() => {
    if (!selectedSupplierId) {
      setSelectedSupplier(null);
      setCatalogData(null);
      return;
    }

    Promise.all([
      loadSupplierDetail(selectedSupplierId),
      loadSupplierCatalog(selectedSupplierId)
    ]).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el proveedor");
    });
  }, [selectedSupplierId, token]);

  useEffect(() => {
    if (!selectedSupplierId) return;
    const timeout = setTimeout(() => {
      loadSupplierCatalog(selectedSupplierId, catalogFilters).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el catálogo del proveedor");
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [catalogFilters, selectedSupplierId, token]);

  useEffect(() => {
    if (!linkingItem) {
      setProductResults([]);
      return;
    }
    const timeout = setTimeout(() => {
      loadProductResults(productSearch || linkingItem.supplier_product_name).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible buscar productos");
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [productSearch, linkingItem, token]);

  function openImportModal() {
    resetFeedback();
    setImportPreview(null);
    setImportFileName("");
    setImportModalOpen(true);
  }

  async function handleImportFileSelected(file: File | null) {
    if (!file || !token || !selectedSupplierId) return;
    resetFeedback();
    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await apiRequest<SupplierCatalogImportPreviewResponse>(`/suppliers/${selectedSupplierId}/catalog/import/preview`, {
        method: "POST",
        body: formData,
        token
      });
      setImportFileName(file.name);
      setImportPreview(response);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "No fue posible analizar el archivo");
    } finally {
      setIsImporting(false);
    }
  }

  async function handleConfirmImport() {
    if (!token || !selectedSupplierId || !importPreview) return;
    resetFeedback();
    setIsImporting(true);
    try {
      const response = await apiRequest<SupplierCatalogImportConfirmResponse>(`/suppliers/${selectedSupplierId}/catalog/import/confirm`, {
        method: "POST",
        token,
        body: JSON.stringify({
          rows: importableRows,
          source_file: importFileName || null
        })
      });
      await Promise.all([
        loadSupplierCatalog(selectedSupplierId),
        loadSupplierDetail(selectedSupplierId)
      ]);
      setSuccess(`Importación completada: ${response.summary.imported} nuevos, ${response.summary.updated} actualizados.`);
      setImportModalOpen(false);
      setImportPreview(null);
      setImportFileName("");
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "No fue posible importar el catálogo");
    } finally {
      setIsImporting(false);
    }
  }

  function openLinkModal(item: SupplierCatalogItem) {
    resetFeedback();
    setLinkingItem(item);
    setProductSearch(item.linked_product?.name || item.supplier_product_name);
  }

  async function handleLinkProduct(productId: number) {
    if (!token || !selectedSupplierId || !linkingItem) return;
    resetFeedback();
    setIsSubmittingAction(true);
    try {
      await apiRequest<SupplierCatalogListResponse>(`/suppliers/${selectedSupplierId}/catalog/${linkingItem.id}/link-product`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ product_id: productId })
      });
      await Promise.all([
        loadSupplierCatalog(selectedSupplierId),
        loadSupplierDetail(selectedSupplierId)
      ]);
      setSuccess("Producto vinculado correctamente.");
      setLinkingItem(null);
      setProductSearch("");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "No fue posible vincular el producto");
    } finally {
      setIsSubmittingAction(false);
    }
  }

  function openCreateProductModal(item: SupplierCatalogItem) {
    resetFeedback();
    setCreatingItem(item);
    setCreateProductForm(createProductFormFromCatalogItem(item));
  }

  async function handleCreateInternalProduct() {
    if (!token || !selectedSupplierId || !creatingItem || !createProductForm) return;
    resetFeedback();
    setIsSubmittingAction(true);
    try {
      const created = await apiRequest<Product>(`/suppliers/${selectedSupplierId}/catalog/${creatingItem.id}/create-product`, {
        method: "POST",
        token,
        body: JSON.stringify({
          ...createProductForm,
          price: Number(createProductForm.price),
          cost_price: Number(createProductForm.cost_price || 0),
          stock: Number(createProductForm.stock || 0),
          stock_minimo: Number(createProductForm.stock_minimo || 0),
          stock_maximo: Number(createProductForm.stock_maximo || 0)
        })
      });
      await Promise.all([
        loadSupplierCatalog(selectedSupplierId),
        loadSupplierDetail(selectedSupplierId)
      ]);
      setSuccess(`Producto interno creado: ${created.name}.`);
      setCreatingItem(null);
      setCreateProductForm(null);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "No fue posible crear el producto interno");
    } finally {
      setIsSubmittingAction(false);
    }
  }

  async function handleApplyCost(item: SupplierCatalogItem) {
    if (!token || !selectedSupplierId) return;
    const confirmed = window.confirm(`Aplicar costo ${currency(item.purchase_cost)} al producto interno vinculado?`);
    if (!confirmed) return;

    resetFeedback();
    setIsSubmittingAction(true);
    try {
      await apiRequest<SupplierCatalogListResponse>(`/suppliers/${selectedSupplierId}/catalog/${item.id}/apply-cost`, {
        method: "PATCH",
        token
      });
      await Promise.all([
        loadSupplierCatalog(selectedSupplierId),
        loadSupplierDetail(selectedSupplierId)
      ]);
      setSuccess("Costo aplicado al producto interno.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "No fue posible aplicar el costo");
    } finally {
      setIsSubmittingAction(false);
    }
  }

  const linkedCatalogItems = catalogData?.items.filter((item) => item.product_id) || [];
  const catalogItemsByProductId = new Map(linkedCatalogItems.map((item) => [item.product_id, item]));

  return (
    <section className="page-grid two-columns">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Proveedores</h2>
            <p className="muted">Consulta proveedores y administra su catálogo externo sin tocar el catálogo interno hasta confirmarlo.</p>
          </div>
          <input
            className="search-input"
            placeholder="Buscar proveedor"
            value={supplierSearch}
            onChange={(event) => setSupplierSearch(event.target.value)}
          />
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {success ? <p className="success-text">{success}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>Contacto</th>
                <th>Productos</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr
                  className={supplier.id === selectedSupplierId ? "table-row-active" : ""}
                  key={supplier.id}
                  onClick={() => setSelectedSupplierId(supplier.id)}
                >
                  <td>{supplier.name}</td>
                  <td>{supplier.whatsapp || supplier.phone || supplier.email || "-"}</td>
                  <td>{supplier.product_count}</td>
                </tr>
              ))}
              {suppliers.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={3}>No hay proveedores registrados.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel supplier-detail-panel">
        <div className="panel-header">
          <div>
            <h2>{selectedSupplier?.name || "Detalle del proveedor"}</h2>
            <p className="muted">Catálogo externo, productos vinculados y cambios de costo controlados.</p>
          </div>
          {selectedSupplierId ? (
            <button className="button ghost" onClick={openImportModal} type="button">
              Importar catálogo
            </button>
          ) : null}
        </div>

        {selectedSupplier ? (
          <>
            <div className="tab-row">
              <button className={`button ghost compact-box ${activeTab === "overview" ? "active-filter" : ""}`} onClick={() => setActiveTab("overview")} type="button">Datos</button>
              <button className={`button ghost compact-box ${activeTab === "catalog" ? "active-filter" : ""}`} onClick={() => setActiveTab("catalog")} type="button">Catálogo proveedor</button>
              <button className={`button ghost compact-box ${activeTab === "linked" ? "active-filter" : ""}`} onClick={() => setActiveTab("linked")} type="button">Productos vinculados</button>
              <button className={`button ghost compact-box ${activeTab === "history" ? "active-filter" : ""}`} onClick={() => setActiveTab("history")} type="button">Historial</button>
            </div>

            {activeTab === "overview" ? (
              <>
                <div className="info-card">
                  <p>Correo: {selectedSupplier.email || "-"}</p>
                  <p>Telefono: {selectedSupplier.phone || "-"}</p>
                  <p>WhatsApp: {selectedSupplier.whatsapp || "-"}</p>
                  <p>Observaciones: {selectedSupplier.observations || "-"}</p>
                </div>
                {catalogData ? (
                  <div className="import-summary-grid">
                    <div className="info-card compact-box"><strong>{catalogData.summary.total}</strong><span className="muted">Items catalogados</span></div>
                    <div className="info-card compact-box"><strong>{catalogData.summary.linked}</strong><span className="muted">Vinculados</span></div>
                    <div className="info-card compact-box"><strong>{catalogData.summary.pending}</strong><span className="muted">Pendientes</span></div>
                    <div className="info-card compact-box"><strong>{catalogData.summary.cost_changes}</strong><span className="muted">Con cambio de costo</span></div>
                  </div>
                ) : null}
              </>
            ) : null}

            {activeTab === "catalog" ? (
              <>
                <div className="grid-form supplier-catalog-filters">
                  <div className="form-section-grid">
                    <label>
                      Buscar
                      <input value={catalogFilters.search} onChange={(event) => setCatalogFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Nombre o descripción" />
                    </label>
                    <label>
                      Código proveedor
                      <input value={catalogFilters.supplier_product_code} onChange={(event) => setCatalogFilters((current) => ({ ...current, supplier_product_code: event.target.value }))} placeholder="Código o clave" />
                    </label>
                    <label>
                      Categoría
                      <select value={catalogFilters.category} onChange={(event) => setCatalogFilters((current) => ({ ...current, category: event.target.value }))}>
                        <option value="">Todas</option>
                        {catalogData?.categories.map((category) => (
                          <option key={category} value={category}>{category}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Estado
                      <select value={catalogFilters.status} onChange={(event) => setCatalogFilters((current) => ({ ...current, status: event.target.value }))}>
                        <option value="">Todos</option>
                        <option value="new">Nuevo</option>
                        <option value="pending">Pendiente</option>
                        <option value="linked">Vinculado</option>
                        <option value="cost_changed">Costo cambiado</option>
                        <option value="cost_applied">Costo aplicado</option>
                        <option value="inactive">Inactivo</option>
                      </select>
                    </label>
                  </div>
                  <div className="inline-actions">
                    <button className={`button ghost compact-box ${catalogFilters.linked === "linked" ? "active-filter" : ""}`} onClick={() => setCatalogFilters((current) => ({ ...current, linked: current.linked === "linked" ? "" : "linked" }))} type="button">Vinculados</button>
                    <button className={`button ghost compact-box ${catalogFilters.linked === "unlinked" ? "active-filter" : ""}`} onClick={() => setCatalogFilters((current) => ({ ...current, linked: current.linked === "unlinked" ? "" : "unlinked" }))} type="button">Sin vincular</button>
                    <button className={`button ghost compact-box ${catalogFilters.cost_changed === "true" ? "active-filter" : ""}`} onClick={() => setCatalogFilters((current) => ({ ...current, cost_changed: current.cost_changed === "true" ? "" : "true" }))} type="button">Costo cambiado</button>
                    <button className={`button ghost compact-box ${catalogFilters.active === "inactive" ? "active-filter" : ""}`} onClick={() => setCatalogFilters((current) => ({ ...current, active: current.active === "inactive" ? "active" : "inactive" }))} type="button">Inactivos</button>
                    <button className="button ghost compact-box" onClick={() => setCatalogFilters(DEFAULT_FILTERS)} type="button">Limpiar filtros</button>
                  </div>
                </div>

                {catalogData ? (
                  <>
                    <div className="import-summary-grid">
                      <div className="info-card compact-box"><strong>{catalogData.summary.total}</strong><span className="muted">Items</span></div>
                      <div className="info-card compact-box"><strong>{catalogData.summary.linked}</strong><span className="muted">Vinculados</span></div>
                      <div className="info-card compact-box"><strong>{catalogData.summary.pending}</strong><span className="muted">Pendientes</span></div>
                      <div className="info-card compact-box"><strong>{catalogData.summary.cost_changes}</strong><span className="muted">Cambio de costo</span></div>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Código</th>
                            <th>Producto proveedor</th>
                            <th>Costo</th>
                            <th>Producto interno</th>
                            <th>Estado</th>
                            <th>Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {catalogData.items.map((item) => (
                            <tr key={item.id}>
                              <td>{item.supplier_product_code || "-"}</td>
                              <td>
                                <strong>{item.supplier_product_name}</strong>
                                <div className="muted">{item.supplier_category || "Sin categoría"} · {item.supplier_unit}</div>
                              </td>
                              <td>
                                <strong>{currency(item.purchase_cost)}</strong>
                                {item.previous_purchase_cost !== null ? <div className="muted">Antes: {currency(item.previous_purchase_cost)}</div> : null}
                              </td>
                              <td>
                                {item.linked_product ? (
                                  <>
                                    <strong>{item.linked_product.name || "Producto vinculado"}</strong>
                                    <div className="muted">{item.linked_product.sku || "-"}</div>
                                  </>
                                ) : (
                                  <span className="muted">Sin vincular</span>
                                )}
                              </td>
                              <td>
                                <span className={`status-badge supplier-status-${item.catalog_status}`}>{getCatalogStatusLabel(item.catalog_status)}</span>
                                <div className="muted">{shortDateTime(item.updated_at)}</div>
                              </td>
                              <td>
                                <div className="inline-actions">
                                  <button className="button ghost" onClick={() => openLinkModal(item)} type="button">Vincular</button>
                                  {!item.product_id ? <button className="button ghost" onClick={() => openCreateProductModal(item)} type="button">Crear producto</button> : null}
                                  {item.cost_changed && item.product_id ? <button className="button ghost" onClick={() => handleApplyCost(item)} type="button">Aplicar costo</button> : null}
                                  {item.product_id ? (
                                    <button className="button ghost" onClick={() => navigate(`/products?edit=${item.product_id}&search=${encodeURIComponent(item.linked_product?.name || item.supplier_product_name)}`)} type="button">Editar interno</button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ))}
                          {catalogData.items.length === 0 ? (
                            <tr>
                              <td className="muted" colSpan={6}>Este proveedor aun no tiene catálogo cargado con esos filtros.</td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className="muted">Cargando catálogo del proveedor.</p>
                )}
              </>
            ) : null}

            {activeTab === "linked" ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Producto interno</th>
                      <th>SKU</th>
                      <th>Costo proveedor</th>
                      <th>Actualización</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSupplier.products.map((product) => {
                      const catalogItem = catalogItemsByProductId.get(product.product_id);
                      return (
                      <tr key={product.product_id}>
                        <td>{product.product_name}</td>
                        <td>{product.sku || "-"}</td>
                        <td>{currency(catalogItem?.purchase_cost ?? product.purchase_cost)}</td>
                        <td>{shortDateTime(catalogItem?.updated_at || product.cost_updated_at || product.product_updated_at)}</td>
                        <td>
                          <div className="inline-actions">
                            <button className="button ghost" onClick={() => navigate(`/products?edit=${product.product_id}&search=${encodeURIComponent(product.product_name)}`)} type="button">Editar producto</button>
                            {catalogItem?.cost_changed ? <button className="button ghost" onClick={() => handleApplyCost(catalogItem)} type="button">Aplicar costo</button> : null}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                    {selectedSupplier.products.length === 0 ? (
                      <tr>
                        <td className="muted" colSpan={5}>Todavía no hay productos internos vinculados desde este catálogo.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : null}

            {activeTab === "history" ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Archivo</th>
                      <th>Última carga</th>
                      <th>Items</th>
                      <th>Vinculados</th>
                      <th>Cambios de costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalogData?.imports.map((entry) => (
                      <tr key={`${entry.source_file}-${entry.imported_at}`}>
                        <td>{entry.source_file}</td>
                        <td>{shortDateTime(entry.imported_at)}</td>
                        <td>{entry.item_count}</td>
                        <td>{entry.linked_count}</td>
                        <td>{entry.cost_changes}</td>
                      </tr>
                    ))}
                    {!catalogData?.imports.length ? (
                      <tr>
                        <td className="muted" colSpan={5}>Todavía no hay cargas registradas para este proveedor.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">Selecciona un proveedor para ver su catálogo y sus productos asociados.</p>
        )}
      </div>

      {importModalOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card import-modal-card">
            <h3>Importar catálogo del proveedor</h3>
            <p className="muted">Sube CSV o XLSX. Este flujo guarda catálogo externo del proveedor, no crea productos internos automáticamente.</p>
            <label>
              Archivo
              <input accept=".csv,.xlsx" onChange={(event) => handleImportFileSelected(event.target.files?.[0] || null)} type="file" />
            </label>
            {isImporting ? <p className="muted">Procesando archivo…</p> : null}
            {importPreview ? (
              <>
                <div className="import-summary-grid">
                  <div className="info-card compact-box"><strong>{importPreview.summary.total}</strong><span className="muted">Filas</span></div>
                  <div className="info-card compact-box"><strong>{importPreview.summary.ready}</strong><span className="muted">Listas</span></div>
                  <div className="info-card compact-box"><strong>{importPreview.summary.new_items}</strong><span className="muted">Nuevas</span></div>
                  <div className="info-card compact-box"><strong>{importPreview.summary.updated}</strong><span className="muted">Actualizables</span></div>
                  <div className="info-card compact-box"><strong>{importPreview.summary.cost_changes}</strong><span className="muted">Costo cambiado</span></div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Producto proveedor</th>
                        <th>Costo</th>
                        <th>Vinculado</th>
                        <th>Sugerencia</th>
                        <th>Observaciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.rows.map((row) => (
                        <tr key={`${row.row_number}-${row.index}`}>
                          <td>{row.payload.supplier_product_code || "-"}</td>
                          <td>
                            <strong>{row.payload.supplier_product_name || "-"}</strong>
                            <div className="muted">{row.payload.supplier_category || "Sin categoría"} · {row.payload.supplier_unit}</div>
                          </td>
                          <td>{currency(Number(row.payload.purchase_cost || 0))}</td>
                          <td>{row.existing_item?.product_name || row.existing_item?.product_sku || (row.existing_item?.product_id ? `#${row.existing_item.product_id}` : "No")}</td>
                          <td>{row.suggested_product ? `${row.suggested_product.name} (${row.suggested_product.match_reason})` : "-"}</td>
                          <td>
                            {row.errors.length ? <div className="error-text">{row.errors.join(", ")}</div> : null}
                            {row.warnings.length ? <div className="muted">{row.warnings.join(", ")}</div> : null}
                            {!row.errors.length && !row.warnings.length ? <span className="muted">{row.action === "update" ? "Se actualizará" : "Se importará"}</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
            <div className="inline-actions modal-actions-end">
              <button className="button ghost" onClick={() => setImportModalOpen(false)} type="button">Cerrar</button>
              <button className="button" disabled={!importableRows.length || isImporting} onClick={handleConfirmImport} type="button">Confirmar importación</button>
            </div>
          </div>
        </div>
      ) : null}

      {linkingItem ? (
        <div className="modal-backdrop">
          <div className="modal-card supplier-modal-card">
            <h3>Vincular producto interno</h3>
            <p className="muted">Selecciona un producto existente para relacionarlo con el catálogo del proveedor.</p>
            <label>
              Buscar producto interno
              <input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Nombre, SKU o código" />
            </label>
            {productSearchLoading ? <p className="muted">Buscando productos…</p> : null}
            <div className="supplier-modal-list">
              {productResults.map((product) => (
                <div className="info-card" key={product.id}>
                  <div className="panel-header">
                    <div>
                      <strong>{product.name}</strong>
                      <div className="muted">{product.sku} · {product.category || "Sin categoría"}</div>
                    </div>
                    <button className="button ghost" disabled={isSubmittingAction} onClick={() => handleLinkProduct(product.id)} type="button">
                      Vincular
                    </button>
                  </div>
                </div>
              ))}
              {!productResults.length && !productSearchLoading ? (
                <div className="empty-state-card">
                  <strong>No se encontraron productos internos.</strong>
                  <span className="muted">Prueba otra búsqueda o crea el producto desde el ítem del proveedor.</span>
                </div>
              ) : null}
            </div>
            <div className="inline-actions modal-actions-end">
              <button className="button ghost" onClick={() => setLinkingItem(null)} type="button">Cerrar</button>
            </div>
          </div>
        </div>
      ) : null}

      {creatingItem && createProductForm ? (
        <div className="modal-backdrop">
          <div className="modal-card quick-product-modal">
            <h3>Crear producto interno desde catálogo</h3>
            <p className="muted">Se reutiliza el alta actual de productos. El costo no se aplica en silencio: queda creado y vinculado al proveedor.</p>
            <div className="product-form-grid">
              <label>
                Nombre
                <input value={createProductForm.name} onChange={(event) => setCreateProductForm((current) => current ? { ...current, name: event.target.value } : current)} />
              </label>
              <label>
                Categoría
                <input value={createProductForm.category} onChange={(event) => setCreateProductForm((current) => current ? { ...current, category: event.target.value } : current)} />
              </label>
              <label className="form-span-2">
                Descripción
                <textarea value={createProductForm.description} onChange={(event) => setCreateProductForm((current) => current ? { ...current, description: event.target.value } : current)} />
              </label>
              <label>
                Unidad
                <select value={createProductForm.unidad_de_venta} onChange={(event) => setCreateProductForm((current) => current ? { ...current, unidad_de_venta: event.target.value as CreateProductForm["unidad_de_venta"] } : current)}>
                  <option value="pieza">pieza</option>
                  <option value="kg">kg</option>
                  <option value="litro">litro</option>
                  <option value="caja">caja</option>
                </select>
              </label>
              <label>
                Precio público
                <input type="number" min="0" step="0.00001" value={createProductForm.price} onChange={(event) => setCreateProductForm((current) => current ? { ...current, price: event.target.value } : current)} />
              </label>
              <label>
                Costo
                <input type="number" min="0" step="0.00001" value={createProductForm.cost_price} onChange={(event) => setCreateProductForm((current) => current ? { ...current, cost_price: event.target.value } : current)} />
              </label>
              <label>
                Stock inicial
                <input type="number" min="0" step="0.001" value={createProductForm.stock} onChange={(event) => setCreateProductForm((current) => current ? { ...current, stock: event.target.value } : current)} />
              </label>
              <label>
                Stock mínimo
                <input type="number" min="0" step="0.001" value={createProductForm.stock_minimo} onChange={(event) => setCreateProductForm((current) => current ? { ...current, stock_minimo: event.target.value } : current)} />
              </label>
              <label>
                Stock máximo
                <input type="number" min="0" step="0.001" value={createProductForm.stock_maximo} onChange={(event) => setCreateProductForm((current) => current ? { ...current, stock_maximo: event.target.value } : current)} />
              </label>
            </div>
            <div className="inline-actions modal-actions-end">
              <button className="button ghost" onClick={() => { setCreatingItem(null); setCreateProductForm(null); }} type="button">Cancelar</button>
              <button className="button" disabled={isSubmittingAction} onClick={handleCreateInternalProduct} type="button">Crear y vincular</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
