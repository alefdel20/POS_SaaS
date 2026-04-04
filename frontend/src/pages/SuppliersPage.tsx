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
      return "Costo por revisar";
    case "cost_applied":
      return "Costo actualizado";
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
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el catalogo del proveedor");
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
      setSuccess(`Importacion completada: ${response.summary.imported} nuevos, ${response.summary.updated} actualizados.`);
      setImportModalOpen(false);
      setImportPreview(null);
      setImportFileName("");
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "No fue posible importar la lista del proveedor");
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
      setSuccess(`Producto del sistema creado: ${created.name}.`);
      setCreatingItem(null);
      setCreateProductForm(null);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "No fue posible crear el producto del sistema");
    } finally {
      setIsSubmittingAction(false);
    }
  }

  async function handleApplyCost(item: SupplierCatalogItem) {
    if (!token || !selectedSupplierId) return;
    const confirmed = window.confirm(`Actualizar costo de compra a ${currency(item.purchase_cost)} para el producto vinculado?`);
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
      setSuccess("Costo de compra actualizado.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "No fue posible actualizar el costo");
    } finally {
      setIsSubmittingAction(false);
    }
  }

  const linkedCatalogItems = catalogData?.items.filter((item) => item.product_id) || [];
  const catalogItemsByProductId = new Map(linkedCatalogItems.map((item) => [item.product_id, item]));
  const hasSuppliers = suppliers.length > 0;

  return (
    <section className="page-grid two-columns">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Proveedores</h2>
            <p className="muted">Desde aqui cargas la lista de cada proveedor. Tus productos de venta siguen administrandose en Productos.</p>
          </div>
          <div className="inline-actions">
            <button className="button" disabled={!selectedSupplierId} onClick={openImportModal} type="button">
              Importar catalogo proveedor
            </button>
            <input
              className="search-input"
              placeholder="Buscar proveedor"
              value={supplierSearch}
              onChange={(event) => setSupplierSearch(event.target.value)}
            />
          </div>
        </div>

        <div className="info-card supplier-callout">
          <strong>Carga la lista del proveedor desde aqui</strong>
          <p className="muted">1. Crea o selecciona un proveedor. 2. Sube su archivo. 3. Revisa cambios de costo. 4. Vincula solo los productos que quieras usar en el sistema.</p>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
        {success ? <p className="success-text">{success}</p> : null}

        {hasSuppliers ? (
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
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state-card supplier-empty-state">
            <strong>Aun no tienes proveedores registrados.</strong>
            <span className="muted">Primero crea un proveedor. Despues podras cargar su catalogo y revisar sus costos desde este modulo.</span>
            <button className="button" onClick={() => navigate("/products?tab=suppliers")} type="button">
              Crear proveedor primero
            </button>
          </div>
        )}
      </div>

      <div className="panel supplier-detail-panel">
        <div className="panel-header">
          <div>
            <h2>{selectedSupplier?.name || "Selecciona un proveedor"}</h2>
            <p className="muted">
              {selectedSupplier
                ? "Aqui administras la lista del proveedor, sus vinculos con productos del sistema y las actualizaciones de costo."
                : "Selecciona un proveedor para importar y administrar su catalogo."}
            </p>
          </div>
          {selectedSupplierId ? (
            <button className="button ghost" onClick={openImportModal} type="button">
              Subir lista del proveedor
            </button>
          ) : null}
        </div>

        {selectedSupplier ? (
          <>
            <div className="tab-row">
              <button className={`button ghost compact-box ${activeTab === "overview" ? "active-filter" : ""}`} onClick={() => setActiveTab("overview")} type="button">Datos</button>
              <button className={`button ghost compact-box ${activeTab === "catalog" ? "active-filter" : ""}`} onClick={() => setActiveTab("catalog")} type="button">Catalogo proveedor</button>
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
                    <div className="info-card compact-box"><strong>{catalogData.summary.total}</strong><span className="muted">Items en lista</span></div>
                    <div className="info-card compact-box"><strong>{catalogData.summary.linked}</strong><span className="muted">Vinculados</span></div>
                    <div className="info-card compact-box"><strong>{catalogData.summary.pending}</strong><span className="muted">Por revisar</span></div>
                    <div className="info-card compact-box"><strong>{catalogData.summary.cost_changes}</strong><span className="muted">Con cambio de costo</span></div>
                  </div>
                ) : null}
              </>
            ) : null}

            {activeTab === "catalog" ? (
              <>
                <div className="info-card supplier-catalog-guide">
                  <strong>Catalogo del proveedor</strong>
                  <p className="muted">Aqui subes la lista del proveedor y revisas costos. Tus productos de venta siguen administrandose en Productos.</p>
                  <div className="inline-actions">
                    <button className="button" onClick={openImportModal} type="button">Importar catalogo</button>
                    <button className="button ghost" onClick={() => setActiveTab("linked")} type="button">Ver productos vinculados</button>
                  </div>
                </div>

                <div className="grid-form supplier-catalog-filters">
                  <div className="form-section-grid">
                    <label>
                      Buscar
                      <input value={catalogFilters.search} onChange={(event) => setCatalogFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Nombre o descripcion" />
                    </label>
                    <label>
                      Codigo proveedor
                      <input value={catalogFilters.supplier_product_code} onChange={(event) => setCatalogFilters((current) => ({ ...current, supplier_product_code: event.target.value }))} placeholder="Codigo o clave" />
                    </label>
                    <label>
                      Categoria
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
                        <option value="cost_changed">Costo por revisar</option>
                        <option value="cost_applied">Costo actualizado</option>
                        <option value="inactive">Inactivo</option>
                      </select>
                    </label>
                  </div>
                  <div className="inline-actions">
                    <button className={`button ghost compact-box ${catalogFilters.linked === "linked" ? "active-filter" : ""}`} onClick={() => setCatalogFilters((current) => ({ ...current, linked: current.linked === "linked" ? "" : "linked" }))} type="button">Vinculados</button>
                    <button className={`button ghost compact-box ${catalogFilters.linked === "unlinked" ? "active-filter" : ""}`} onClick={() => setCatalogFilters((current) => ({ ...current, linked: current.linked === "unlinked" ? "" : "unlinked" }))} type="button">Sin vincular</button>
                    <button className={`button ghost compact-box ${catalogFilters.cost_changed === "true" ? "active-filter" : ""}`} onClick={() => setCatalogFilters((current) => ({ ...current, cost_changed: current.cost_changed === "true" ? "" : "true" }))} type="button">Costo por revisar</button>
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
                            <th>Codigo</th>
                            <th>Producto del proveedor</th>
                            <th>Costo</th>
                            <th>Producto del sistema</th>
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
                                <div className="muted">{item.supplier_category || "Sin categoria"} · {item.supplier_unit}</div>
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
                                  <button className="button ghost" onClick={() => openLinkModal(item)} type="button">Vincular con producto del sistema</button>
                                  {!item.product_id ? <button className="button ghost" onClick={() => openCreateProductModal(item)} type="button">Crear producto en el sistema</button> : null}
                                  {item.cost_changed && item.product_id ? <button className="button ghost" onClick={() => handleApplyCost(item)} type="button">Actualizar costo de compra</button> : null}
                                  {item.product_id ? (
                                    <button className="button ghost" onClick={() => navigate(`/products?edit=${item.product_id}&search=${encodeURIComponent(item.linked_product?.name || item.supplier_product_name)}`)} type="button">Ver en Productos</button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ))}
                          {catalogData.items.length === 0 ? (
                            <tr>
                              <td className="muted" colSpan={6}>Este proveedor aun no tiene lista cargada. Usa "Importar catalogo" para subir su archivo y empezar a vincular productos.</td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className="muted">Cargando catalogo del proveedor.</p>
                )}
              </>
            ) : null}

            {activeTab === "linked" ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Producto del sistema</th>
                      <th>SKU</th>
                      <th>Costo proveedor</th>
                      <th>Actualizacion</th>
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
                              <button className="button ghost" onClick={() => navigate(`/products?edit=${product.product_id}&search=${encodeURIComponent(product.product_name)}`)} type="button">Ver en Productos</button>
                              {catalogItem?.cost_changed ? <button className="button ghost" onClick={() => handleApplyCost(catalogItem)} type="button">Actualizar costo de compra</button> : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {selectedSupplier.products.length === 0 ? (
                      <tr>
                        <td className="muted" colSpan={5}>Todavia no hay productos del sistema vinculados con este proveedor.</td>
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
                      <th>Ultima carga</th>
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
                        <td className="muted" colSpan={5}>Todavia no hay cargas registradas para este proveedor.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : (
          <div className="empty-state-card supplier-empty-state">
            <strong>Selecciona un proveedor para importar y administrar su catalogo.</strong>
            <span className="muted">Desde Proveedores cargas la lista del proveedor. Desde Productos administras el catalogo de tu negocio.</span>
            {!hasSuppliers ? (
              <button className="button" onClick={() => navigate("/products?tab=suppliers")} type="button">
                Crear proveedor primero
              </button>
            ) : null}
          </div>
        )}
      </div>
      {importModalOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card import-modal-card">
            <h3>Importar catalogo del proveedor</h3>
            <p className="muted">Sube CSV o XLSX con la lista del proveedor. Esto no agrega productos a tu catalogo de venta hasta que tu lo confirmes desde Proveedores.</p>
            <label>
              Archivo
              <input accept=".csv,.xlsx" onChange={(event) => handleImportFileSelected(event.target.files?.[0] || null)} type="file" />
            </label>
            {isImporting ? <p className="muted">Procesando archivo...</p> : null}
            {importPreview ? (
              <>
                <div className="import-summary-grid">
                  <div className="info-card compact-box"><strong>{importPreview.summary.total}</strong><span className="muted">Filas</span></div>
                  <div className="info-card compact-box"><strong>{importPreview.summary.ready}</strong><span className="muted">Listas</span></div>
                  <div className="info-card compact-box"><strong>{importPreview.summary.new_items}</strong><span className="muted">Nuevas</span></div>
                  <div className="info-card compact-box"><strong>{importPreview.summary.updated}</strong><span className="muted">Actualizables</span></div>
                  <div className="info-card compact-box"><strong>{importPreview.summary.cost_changes}</strong><span className="muted">Costo por revisar</span></div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Codigo</th>
                        <th>Producto del proveedor</th>
                        <th>Costo</th>
                        <th>Ya vinculado</th>
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
                            <div className="muted">{row.payload.supplier_category || "Sin categoria"} · {row.payload.supplier_unit}</div>
                          </td>
                          <td>{currency(Number(row.payload.purchase_cost || 0))}</td>
                          <td>{row.existing_item?.product_name || row.existing_item?.product_sku || (row.existing_item?.product_id ? `#${row.existing_item.product_id}` : "No")}</td>
                          <td>{row.suggested_product ? `${row.suggested_product.name} (${row.suggested_product.match_reason})` : "-"}</td>
                          <td>
                            {row.errors.length ? <div className="error-text">{row.errors.join(", ")}</div> : null}
                            {row.warnings.length ? <div className="muted">{row.warnings.join(", ")}</div> : null}
                            {!row.errors.length && !row.warnings.length ? <span className="muted">{row.action === "update" ? "Se actualizara la lista" : "Se guardara en la lista"}</span> : null}
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
              <button className="button" disabled={!importableRows.length || isImporting} onClick={handleConfirmImport} type="button">Guardar lista del proveedor</button>
            </div>
          </div>
        </div>
      ) : null}
      {linkingItem ? (
        <div className="modal-backdrop">
          <div className="modal-card supplier-modal-card">
            <h3>Vincular con producto del sistema</h3>
            <p className="muted">Elige un producto que ya exista en tu sistema para relacionarlo con esta lista del proveedor.</p>
            <label>
              Buscar producto del sistema
              <input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Nombre, SKU o codigo" />
            </label>
            {productSearchLoading ? <p className="muted">Buscando productos...</p> : null}
            <div className="supplier-modal-list">
              {productResults.map((product) => (
                <div className="info-card" key={product.id}>
                  <div className="panel-header">
                    <div>
                      <strong>{product.name}</strong>
                      <div className="muted">{product.sku} · {product.category || "Sin categoria"}</div>
                    </div>
                    <button className="button ghost" disabled={isSubmittingAction} onClick={() => handleLinkProduct(product.id)} type="button">
                      Vincular con este producto
                    </button>
                  </div>
                </div>
              ))}
              {!productResults.length && !productSearchLoading ? (
                <div className="empty-state-card">
                  <strong>No se encontraron productos del sistema.</strong>
                  <span className="muted">Prueba otra busqueda o crea el producto desde esta misma lista del proveedor.</span>
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
            <h3>Crear producto del sistema desde la lista del proveedor</h3>
            <p className="muted">Se usara esta informacion como base para crear el producto en tu sistema y dejarlo vinculado con el proveedor.</p>
            <div className="product-form-grid">
              <label>
                Nombre
                <input value={createProductForm.name} onChange={(event) => setCreateProductForm((current) => current ? { ...current, name: event.target.value } : current)} />
              </label>
              <label>
                Categoria
                <input value={createProductForm.category} onChange={(event) => setCreateProductForm((current) => current ? { ...current, category: event.target.value } : current)} />
              </label>
              <label className="form-span-2">
                Descripcion
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
                Precio publico
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
                Stock minimo
                <input type="number" min="0" step="0.001" value={createProductForm.stock_minimo} onChange={(event) => setCreateProductForm((current) => current ? { ...current, stock_minimo: event.target.value } : current)} />
              </label>
              <label>
                Stock maximo
                <input type="number" min="0" step="0.001" value={createProductForm.stock_maximo} onChange={(event) => setCreateProductForm((current) => current ? { ...current, stock_maximo: event.target.value } : current)} />
              </label>
            </div>
            <div className="inline-actions modal-actions-end">
              <button className="button ghost" onClick={() => { setCreatingItem(null); setCreateProductForm(null); }} type="button">Cancelar</button>
              <button className="button" disabled={isSubmittingAction} onClick={handleCreateInternalProduct} type="button">Crear producto y vincular</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
