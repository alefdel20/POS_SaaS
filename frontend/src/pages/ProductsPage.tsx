import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { PaginatedProductsResponse, Product, Supplier } from "../types";
import { currency, shortDate, shortDateTime } from "../utils/format";

type ProductSupplierFormState = {
  supplier_id: string;
  supplier_name: string;
  supplier_email: string;
  supplier_phone: string;
  supplier_whatsapp: string;
  supplier_observations: string;
  purchase_cost: string;
  cost_updated_at: string | null;
};

type ProductFormState = {
  name: string;
  sku: string;
  barcode: string;
  category: string;
  description: string;
  price: string;
  cost_price: string;
  stock: string;
  stock_minimo: string;
  expires_at: string;
  is_active: boolean;
  status: "activo" | "inactivo";
  suppliers: ProductSupplierFormState[];
  discount_type: "" | "percentage" | "fixed";
  discount_value: string;
  discount_start: string;
  discount_end: string;
};

const emptySupplier: ProductSupplierFormState = {
  supplier_id: "",
  supplier_name: "",
  supplier_email: "",
  supplier_phone: "",
  supplier_whatsapp: "",
  supplier_observations: "",
  purchase_cost: "",
  cost_updated_at: null
};

const emptyProduct: ProductFormState = {
  name: "",
  sku: "",
  barcode: "",
  category: "",
  description: "",
  price: "",
  cost_price: "",
  stock: "",
  stock_minimo: "",
  expires_at: "",
  is_active: true,
  status: "activo",
  suppliers: [{ ...emptySupplier }],
  discount_type: "",
  discount_value: "",
  discount_start: "",
  discount_end: ""
};

function toDateTimeLocal(value?: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const timezoneOffset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - timezoneOffset * 60000);
  return localDate.toISOString().slice(0, 16);
}

function supplierToForm(supplier?: Supplier | null): ProductSupplierFormState {
  return {
    supplier_id: supplier?.supplier_id ? String(supplier.supplier_id) : supplier?.id ? String(supplier.id) : "",
    supplier_name: supplier?.supplier_name || supplier?.name || "",
    supplier_email: supplier?.email || "",
    supplier_phone: supplier?.phone || "",
    supplier_whatsapp: supplier?.whatsapp || "",
    supplier_observations: supplier?.observations || "",
    purchase_cost: supplier?.purchase_cost === null || supplier?.purchase_cost === undefined ? "" : String(supplier.purchase_cost),
    cost_updated_at: supplier?.cost_updated_at || null
  };
}

function productToForm(product: Product): ProductFormState {
  return {
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    category: product.category || "",
    description: product.description || "",
    price: String(product.price ?? ""),
    cost_price: String(product.cost_price ?? ""),
    stock: String(product.stock ?? ""),
    stock_minimo: String(product.stock_minimo ?? ""),
    expires_at: product.expires_at?.slice(0, 10) || "",
    is_active: product.is_active,
    status: product.status || (product.is_active ? "activo" : "inactivo"),
    suppliers: product.suppliers?.length
      ? product.suppliers.map((supplier) => supplierToForm(supplier))
      : [supplierToForm({
          id: product.supplier_id || undefined,
          supplier_name: product.supplier_name || undefined,
          email: product.supplier_email,
          phone: product.supplier_phone,
          whatsapp: product.supplier_whatsapp,
          observations: product.supplier_observations
        })],
    discount_type: (product.discount_type as ProductFormState["discount_type"]) || "",
    discount_value: product.discount_value === null || product.discount_value === undefined ? "" : String(product.discount_value),
    discount_start: toDateTimeLocal(product.discount_start),
    discount_end: toDateTimeLocal(product.discount_end)
  };
}

function requiredLabel(text: string) {
  return `${text} *`;
}

export function ProductsPage() {
  const { token } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [form, setForm] = useState<ProductFormState>(emptyProduct);
  const [supplierDrafts, setSupplierDrafts] = useState<ProductSupplierFormState[]>([]);
  const [showSuppliersModal, setShowSuppliersModal] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 15>(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalProducts, setTotalProducts] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  async function loadProducts(nextSearch = search, nextPage = page, nextPageSize = pageSize) {
    if (!token) return;
    const params = new URLSearchParams({
      page: String(nextPage),
      pageSize: String(nextPageSize)
    });

    if (nextSearch.trim()) {
      params.set("search", nextSearch.trim());
    }

    const response = await apiRequest<PaginatedProductsResponse>(`/products?${params.toString()}`, { token });
    setProducts(response.items);
    setTotalPages(response.pagination.totalPages);
    setTotalProducts(response.pagination.total);
  }

  async function loadSuppliers(searchTerm = "") {
    if (!token) return;
    const params = new URLSearchParams();
    if (searchTerm.trim()) {
      params.set("search", searchTerm.trim());
    }
    const response = await apiRequest<Supplier[]>(`/products/suppliers?${params.toString()}`, { token });
    setSuppliers(response);
  }

  async function loadCategories(searchTerm = "") {
    if (!token) return;
    const params = new URLSearchParams();
    if (searchTerm.trim()) {
      params.set("search", searchTerm.trim());
    }
    const response = await apiRequest<string[]>(`/products/categories?${params.toString()}`, { token });
    setCategories(response);
  }

  useEffect(() => {
    loadProducts(search, page, pageSize).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar los productos");
    });
    loadSuppliers().catch(console.error);
    loadCategories().catch(console.error);
  }, [token, page, pageSize]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setPage(1);
      loadProducts(search, 1, pageSize).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible buscar productos");
      });
    }, 250);

    return () => clearTimeout(timeout);
  }, [search, pageSize, token]);

  function updateSupplier(index: number, nextSupplier: ProductSupplierFormState) {
    setForm((current) => ({
      ...current,
      suppliers: current.suppliers.map((supplier, supplierIndex) => supplierIndex === index ? nextSupplier : supplier)
    }));
  }

  function updateSupplierDraft(index: number, nextSupplier: ProductSupplierFormState) {
    setSupplierDrafts((current) => current.map((supplier, supplierIndex) => supplierIndex === index ? nextSupplier : supplier));
  }

  function resolveSupplierByName(name: string) {
    return suppliers.find((supplier) => supplier.name.toLowerCase() === name.trim().toLowerCase()) || null;
  }

  function openSuppliersModal() {
    setSupplierDrafts(form.suppliers.slice(1).map((supplier) => ({ ...supplier })));
    setShowSuppliersModal(true);
  }

  function closeSuppliersModal() {
    setSupplierDrafts([]);
    setShowSuppliersModal(false);
  }

  function saveSuppliersModal() {
    const cleanedDrafts = supplierDrafts
      .map((supplier) => ({
        ...supplier,
        supplier_id: supplier.supplier_id.trim(),
        supplier_name: supplier.supplier_name.trim(),
        supplier_email: supplier.supplier_email.trim(),
        supplier_phone: supplier.supplier_phone.trim(),
        supplier_whatsapp: supplier.supplier_whatsapp.trim(),
        supplier_observations: supplier.supplier_observations.trim(),
        purchase_cost: supplier.purchase_cost.trim()
      }))
      .filter((supplier) => supplier.supplier_id || supplier.supplier_name);

    setForm((current) => ({
      ...current,
      suppliers: [current.suppliers[0] || { ...emptySupplier }, ...cleanedDrafts]
    }));
    setShowSuppliersModal(false);
    setSupplierDrafts([]);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    const price = Number(form.price);
    const stock = Number(form.stock);
    const stockMinimo = Number(form.stock_minimo);
    const costPrice = form.cost_price === "" ? 0 : Number(form.cost_price);
    const discountValue = form.discount_value === "" ? null : Number(form.discount_value);

    if (!form.name.trim() || !form.sku.trim()) {
      setError("Nombre y SKU son obligatorios");
      return;
    }
    if (Number.isNaN(price) || price < 0 || Number.isNaN(stock) || stock < 0 || Number.isNaN(costPrice) || costPrice < 0 || Number.isNaN(stockMinimo) || stockMinimo < 0) {
      setError("Precio, costo, stock y stock mínimo deben ser numéricos válidos");
      return;
    }
    if (form.discount_type && (discountValue === null || Number.isNaN(discountValue) || discountValue < 0)) {
      setError("El valor del remate debe ser numérico y válido");
      return;
    }
    if ((form.discount_start && !form.discount_end) || (!form.discount_start && form.discount_end)) {
      setError("Debes indicar inicio y fin del remate");
      return;
    }

    const normalizedSuppliers = form.suppliers
      .map((supplier) => {
        const matchedSupplier = resolveSupplierByName(supplier.supplier_name);
        const purchaseCost = supplier.purchase_cost.trim() === "" ? null : Number(supplier.purchase_cost);

        return {
          supplier_id: supplier.supplier_id ? Number(supplier.supplier_id) : matchedSupplier?.id ?? undefined,
          supplier_name: supplier.supplier_name.trim(),
          supplier_email: supplier.supplier_email.trim() || null,
          supplier_phone: supplier.supplier_phone.trim() || null,
          supplier_whatsapp: supplier.supplier_whatsapp.trim() || null,
          supplier_observations: supplier.supplier_observations.trim() || "",
          purchase_cost: purchaseCost,
          is_primary: false
        };
      })
      .filter((supplier) => supplier.supplier_id || supplier.supplier_name);

    const seenSupplierNames = new Set<string>();
    const seenSupplierWhatsapps = new Set<string>();
    for (const supplier of normalizedSuppliers) {
      const normalizedName = supplier.supplier_name.toLowerCase();
      const normalizedWhatsapp = String(supplier.supplier_whatsapp || "").replace(/\D/g, "");
      if ((normalizedName && seenSupplierNames.has(normalizedName)) || (normalizedWhatsapp && seenSupplierWhatsapps.has(normalizedWhatsapp))) {
        setError("No puedes asignar proveedores duplicados al mismo producto");
        return;
      }
      if (supplier.purchase_cost !== null && (Number.isNaN(supplier.purchase_cost) || supplier.purchase_cost < 0)) {
        setError("El costo de compra por proveedor debe ser numérico y válido");
        return;
      }
      if (normalizedName) seenSupplierNames.add(normalizedName);
      if (normalizedWhatsapp) seenSupplierWhatsapps.add(normalizedWhatsapp);
    }

    if (!normalizedSuppliers.length) {
      normalizedSuppliers.push({
        supplier_id: undefined,
        supplier_name: "",
        supplier_email: null,
        supplier_phone: null,
        supplier_whatsapp: null,
        supplier_observations: "",
        purchase_cost: null,
        is_primary: true
      });
    } else {
      normalizedSuppliers[0].is_primary = true;
    }

    const primarySupplier = normalizedSuppliers[0];
    const payload = {
      ...form,
      name: form.name.trim(),
      sku: form.sku.trim(),
      barcode: form.barcode.trim(),
      category: form.category.trim() || null,
      description: form.description.trim(),
      price,
      cost_price: costPrice,
      stock,
      stock_minimo: stockMinimo,
      expires_at: form.expires_at || null,
      supplier_id: primarySupplier?.supplier_id ?? null,
      supplier_name: primarySupplier?.supplier_name || null,
      supplier_email: primarySupplier?.supplier_email || null,
      supplier_phone: primarySupplier?.supplier_phone || null,
      supplier_whatsapp: primarySupplier?.supplier_whatsapp || null,
      supplier_observations: primarySupplier?.supplier_observations || "",
      suppliers: normalizedSuppliers,
      discount_type: form.discount_type || null,
      discount_value: discountValue,
      discount_start: form.discount_start ? new Date(form.discount_start).toISOString() : null,
      discount_end: form.discount_end ? new Date(form.discount_end).toISOString() : null,
      is_active: form.status === "activo"
    };

    setSaving(true);
    setError("");

    try {
      if (editingId) {
        await apiRequest<Product>(`/products/${editingId}`, {
          method: "PUT",
          token,
          body: JSON.stringify(payload)
        });
      } else {
        await apiRequest<Product>("/products", {
          method: "POST",
          token,
          body: JSON.stringify(payload)
        });
      }
      setForm(emptyProduct);
      setEditingId(null);
      setSupplierDrafts([]);
      setShowSuppliersModal(false);
      await loadProducts(search, page, pageSize);
      await loadSuppliers();
      await loadCategories();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible guardar el producto");
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(product: Product) {
    setEditingId(product.id);
    setForm(productToForm(product));
    setSupplierDrafts([]);
    setShowSuppliersModal(false);
    setError("");
  }

  async function toggleProductStatus(product: Product) {
    if (!token) return;

    try {
      setTogglingId(product.id);
      setError("");
      const nextStatus = product.status === "inactivo" ? "activo" : "inactivo";
      await apiRequest(`/products/${product.id}/status`, {
        method: "PATCH",
        token,
        body: JSON.stringify({
          status: nextStatus,
          is_active: nextStatus === "activo"
        })
      });
      await loadProducts(search, page, pageSize);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "No fue posible actualizar el producto");
    } finally {
      setTogglingId(null);
    }
  }

  const liquidationProducts = useMemo(
    () => products.filter((product) => product.is_low_rotation || product.is_near_expiry || product.has_active_discount),
    [products]
  );

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Resumen de remate</h2>
            <p className="muted">Productos con baja rotación, próximos a vencer o con remate activo.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Proveedor</th>
                <th>Motivo</th>
                <th>Precio base</th>
                <th>Precio final</th>
                <th>Vigencia</th>
              </tr>
            </thead>
            <tbody>
              {liquidationProducts.map((product) => (
                <tr key={`liquidation-${product.id}`}>
                  <td>{product.name}</td>
                  <td>{product.supplier_names?.join(", ") || product.supplier_name || "-"}</td>
                  <td>
                    {product.has_active_discount ? "Remate activo" : ""}
                    {product.has_active_discount && (product.is_low_rotation || product.is_near_expiry) ? " + " : ""}
                    {product.is_low_rotation ? "Baja rotación" : ""}
                    {product.is_low_rotation && product.is_near_expiry ? " + " : ""}
                    {product.is_near_expiry ? "Próximo a vencer" : ""}
                  </td>
                  <td>{currency(product.price)}</td>
                  <td>{currency(product.effective_price ?? product.price)}</td>
                  <td>
                    {product.discount_start || product.discount_end
                      ? `${shortDateTime(product.discount_start || null)} - ${shortDateTime(product.discount_end || null)}`
                      : shortDate(product.expires_at || null)}
                  </td>
                </tr>
              ))}
              {liquidationProducts.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={6}>No hay productos con remate o riesgo detectado.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <form className="panel product-form-panel product-form-panel-wide" onSubmit={handleSubmit}>
        <div className="panel-header">
          <h2>{editingId ? "Editar producto" : "Nuevo producto"}</h2>
          {editingId ? (
            <button
              className="button ghost"
              onClick={() => {
                setEditingId(null);
                setForm(emptyProduct);
                setSupplierDrafts([]);
                setShowSuppliersModal(false);
              }}
              type="button"
            >
              Cancelar
            </button>
          ) : null}
        </div>
        <div className="product-form-grid product-form-grid-wide">
          <label>
            {requiredLabel("Nombre")}
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </label>
          <label>
            {requiredLabel("SKU")}
            <input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} required />
          </label>
          <label>
            Categoría
            <input
              list="product-category-options"
              value={form.category}
              onChange={(event) => {
                setForm({ ...form, category: event.target.value });
                loadCategories(event.target.value).catch(console.error);
              }}
            />
          </label>
          <datalist id="product-category-options">
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
          <label>
            Código de barras
            <input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} />
          </label>
          <label>
            Estado
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as "activo" | "inactivo", is_active: event.target.value === "activo" })}>
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </select>
          </label>
          <label className="form-span-2">
            Descripción
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
          <label>
            {requiredLabel("Precio")}
            <input type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} required />
          </label>
          <label>
            Costo
            <input type="number" min="0" step="0.01" value={form.cost_price} onChange={(event) => setForm({ ...form, cost_price: event.target.value })} />
          </label>
          <label>
            {requiredLabel("Stock")}
            <input type="number" min="0" step="0.01" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} required />
          </label>
          <label>
            {requiredLabel("Stock mínimo")}
            <input type="number" min="0" step="0.01" value={form.stock_minimo} onChange={(event) => setForm({ ...form, stock_minimo: event.target.value })} required />
          </label>
          <label>
            Fecha de vencimiento
            <input type="date" value={form.expires_at} onChange={(event) => setForm({ ...form, expires_at: event.target.value })} />
          </label>
          <label>
            Tipo de remate
            <select
              value={form.discount_type}
              onChange={(event) => {
                const nextDiscountType = event.target.value as ProductFormState["discount_type"];
                setForm({
                  ...form,
                  discount_type: nextDiscountType,
                  discount_value: nextDiscountType ? form.discount_value : "",
                  discount_start: nextDiscountType ? form.discount_start : "",
                  discount_end: nextDiscountType ? form.discount_end : ""
                });
              }}
            >
              <option value="">Sin remate programado</option>
              <option value="percentage">Porcentaje</option>
              <option value="fixed">Monto fijo</option>
            </select>
          </label>
          <label>
            Valor de remate
            <input type="number" min="0" step="0.01" value={form.discount_value} onChange={(event) => setForm({ ...form, discount_value: event.target.value })} />
          </label>
          <label>
            Inicio remate
            <input type="datetime-local" value={form.discount_start} onChange={(event) => setForm({ ...form, discount_start: event.target.value })} />
          </label>
          <label>
            Fin remate
            <input type="datetime-local" value={form.discount_end} onChange={(event) => setForm({ ...form, discount_end: event.target.value })} />
          </label>
        </div>

        <div className="panel-header">
          <div>
            <h2>Proveedores</h2>
            <p className="muted">El proveedor principal permanece visible. Los proveedores adicionales se administran bajo demanda.</p>
          </div>
          <button
            className="button ghost"
            onClick={openSuppliersModal}
            type="button"
          >
            {form.suppliers.length > 1 ? `Gestionar proveedores extra (${form.suppliers.length - 1})` : "Agregar otro proveedor"}
          </button>
        </div>
        <div className="product-form-grid product-form-grid-wide">
          <div className="info-card form-span-2">
            <div className="panel-header">
              <div>
                <h3>Proveedor principal</h3>
              </div>
            </div>
            <div className="product-form-grid product-form-grid-wide">
              <label>
                Nombre proveedor
                <input
                  list="supplier-options"
                  value={form.suppliers[0]?.supplier_name || ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    const matchedSupplier = resolveSupplierByName(value);
                    updateSupplier(0, {
                      supplier_id: matchedSupplier ? String(matchedSupplier.id) : "",
                      supplier_name: value,
                      supplier_email: matchedSupplier?.email || "",
                      supplier_phone: matchedSupplier?.phone || "",
                      supplier_whatsapp: matchedSupplier?.whatsapp || "",
                      supplier_observations: matchedSupplier?.observations || "",
                      purchase_cost: form.suppliers[0]?.purchase_cost || "",
                      cost_updated_at: form.suppliers[0]?.cost_updated_at || null
                    });
                    loadSuppliers(value).catch(console.error);
                  }}
                  placeholder="Selecciona o escribe un proveedor"
                />
              </label>
              <label>
                WhatsApp proveedor
                <input
                  value={form.suppliers[0]?.supplier_whatsapp || ""}
                  onChange={(event) => updateSupplier(0, { ...(form.suppliers[0] || { ...emptySupplier }), supplier_whatsapp: event.target.value })}
                />
              </label>
              <label>
                Correo proveedor
                <input
                  type="email"
                  value={form.suppliers[0]?.supplier_email || ""}
                  onChange={(event) => updateSupplier(0, { ...(form.suppliers[0] || { ...emptySupplier }), supplier_email: event.target.value })}
                />
              </label>
              <label>
                Teléfono proveedor
                <input
                  value={form.suppliers[0]?.supplier_phone || ""}
                  onChange={(event) => updateSupplier(0, { ...(form.suppliers[0] || { ...emptySupplier }), supplier_phone: event.target.value })}
                />
              </label>
              <label>
                Costo de compra
                <input
                  min="0"
                  step="0.01"
                  type="number"
                  value={form.suppliers[0]?.purchase_cost || ""}
                  onChange={(event) => updateSupplier(0, { ...(form.suppliers[0] || { ...emptySupplier }), purchase_cost: event.target.value })}
                />
              </label>
              <label className="form-span-2">
                Observaciones proveedor
                <textarea
                  value={form.suppliers[0]?.supplier_observations || ""}
                  onChange={(event) => updateSupplier(0, { ...(form.suppliers[0] || { ...emptySupplier }), supplier_observations: event.target.value })}
                />
              </label>
              {form.suppliers[0]?.cost_updated_at ? (
                <p className="muted form-span-2">
                  Última actualización de costo: {shortDateTime(form.suppliers[0]?.cost_updated_at)}
                </p>
              ) : null}
            </div>
          </div>
          <datalist id="supplier-options">
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.name} />
            ))}
          </datalist>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <button className="button" disabled={saving} type="submit">
          {saving ? "Guardando..." : editingId ? "Actualizar producto" : "Guardar producto"}
        </button>
      </form>

      {showSuppliersModal ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card supplier-modal-card">
            <div className="panel-header">
              <div>
                <h3>Proveedores adicionales</h3>
                <p className="muted">Agrega o edita proveedores extra sin saturar la vista principal.</p>
              </div>
              <button className="button ghost" onClick={closeSuppliersModal} type="button">Cerrar</button>
            </div>
            <div className="inline-actions supplier-modal-actions">
              <button
                className="button ghost"
                onClick={() => setSupplierDrafts((current) => [...current, { ...emptySupplier }])}
                type="button"
              >
                Agregar proveedor
              </button>
            </div>
            <div className="supplier-modal-list">
              {supplierDrafts.length === 0 ? (
                <p className="muted">Aún no hay proveedores adicionales configurados.</p>
              ) : null}
              {supplierDrafts.map((supplier, index) => (
                <div className="info-card" key={`supplier-draft-${index}`}>
                  <div className="panel-header">
                    <div>
                      <h3>{`Proveedor ${index + 2}`}</h3>
                    </div>
                    <button
                      className="button ghost"
                      onClick={() => setSupplierDrafts((current) => current.filter((_, supplierIndex) => supplierIndex !== index))}
                      type="button"
                    >
                      Quitar
                    </button>
                  </div>
                  <div className="product-form-grid product-form-grid-wide">
                    <label>
                      Nombre proveedor
                      <input
                        list="supplier-options"
                        value={supplier.supplier_name}
                        onChange={(event) => {
                          const value = event.target.value;
                          const matchedSupplier = resolveSupplierByName(value);
                          updateSupplierDraft(index, {
                            supplier_id: matchedSupplier ? String(matchedSupplier.id) : "",
                            supplier_name: value,
                            supplier_email: matchedSupplier?.email || "",
                            supplier_phone: matchedSupplier?.phone || "",
                            supplier_whatsapp: matchedSupplier?.whatsapp || "",
                            supplier_observations: matchedSupplier?.observations || "",
                            purchase_cost: supplier.purchase_cost,
                            cost_updated_at: supplier.cost_updated_at
                          });
                          loadSuppliers(value).catch(console.error);
                        }}
                        placeholder="Selecciona o escribe un proveedor"
                      />
                    </label>
                    <label>
                      WhatsApp proveedor
                      <input value={supplier.supplier_whatsapp} onChange={(event) => updateSupplierDraft(index, { ...supplier, supplier_whatsapp: event.target.value })} />
                    </label>
                    <label>
                      Correo proveedor
                      <input type="email" value={supplier.supplier_email} onChange={(event) => updateSupplierDraft(index, { ...supplier, supplier_email: event.target.value })} />
                    </label>
                    <label>
                      Teléfono proveedor
                      <input value={supplier.supplier_phone} onChange={(event) => updateSupplierDraft(index, { ...supplier, supplier_phone: event.target.value })} />
                    </label>
                    <label>
                      Costo de compra
                      <input
                        min="0"
                        step="0.01"
                        type="number"
                        value={supplier.purchase_cost}
                        onChange={(event) => updateSupplierDraft(index, { ...supplier, purchase_cost: event.target.value })}
                      />
                    </label>
                    <label className="form-span-2">
                      Observaciones proveedor
                      <textarea value={supplier.supplier_observations} onChange={(event) => updateSupplierDraft(index, { ...supplier, supplier_observations: event.target.value })} />
                    </label>
                    {supplier.cost_updated_at ? (
                      <p className="muted form-span-2">
                        Última actualización de costo: {shortDateTime(supplier.cost_updated_at)}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            <div className="inline-actions supplier-modal-actions">
              <button className="button ghost" onClick={closeSuppliersModal} type="button">Cancelar</button>
              <button className="button" onClick={saveSuppliersModal} type="button">Aplicar proveedores</button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-header product-catalog-header">
          <div>
            <h2>Catálogo administrativo</h2>
            <p className="muted">Buscador, paginación y alertas por stock mínimo.</p>
          </div>
          <div className="inline-actions">
            <input
              className="search-input"
              placeholder="Buscar por nombre, SKU, categoría o proveedor"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value) as 10 | 15)}>
              <option value={10}>10 por pagina</option>
              <option value={15}>15 por pagina</option>
            </select>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Proveedores</th>
                <th>SKU</th>
                <th>Categoría</th>
                <th>Precio</th>
                <th>Stock</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>
                    <div>{product.name}</div>
                    {product.is_low_stock ? <small className="error-text">Stock bajo</small> : null}
                  </td>
                  <td>
                    <div>{product.supplier_names?.join(", ") || product.supplier_name || "-"}</div>
                    <small className="muted">{product.supplier_whatsapp || product.supplier_phone || product.supplier_email || "-"}</small>
                  </td>
                  <td>{product.sku}</td>
                  <td>{product.category || "-"}</td>
                  <td>
                    {product.is_on_sale ? (
                      <div className="price-stack">
                        <span className="price-original">{currency(product.price)}</span>
                        <strong>{currency(product.effective_price ?? product.price)}</strong>
                      </div>
                    ) : (
                      currency(product.price)
                    )}
                  </td>
                  <td>
                    {product.stock}
                    <small className="muted"> / min {product.stock_minimo ?? 0}</small>
                  </td>
                  <td>{product.status || (product.is_active ? "activo" : "inactivo")}</td>
                  <td>
                    <div className="inline-actions">
                      <button className="button ghost" onClick={() => handleEdit(product)} type="button">Editar</button>
                      <button
                        className="button ghost"
                        disabled={togglingId === product.id}
                        onClick={() => toggleProductStatus(product)}
                        type="button"
                      >
                        {togglingId === product.id
                          ? "Actualizando..."
                          : product.status === "inactivo"
                            ? "Activar"
                            : "Desactivar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {products.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={8}>No se encontraron productos.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="panel-header product-table-footer">
          <p className="muted">{totalProducts} productos encontrados</p>
          <div className="inline-actions">
            <button className="button ghost" disabled={page <= 1} onClick={() => setPage((current) => Math.max(current - 1, 1))} type="button">Anterior</button>
            <span className="muted">Pagina {page} de {totalPages}</span>
            <button className="button ghost" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(current + 1, totalPages))} type="button">Siguiente</button>
          </div>
        </div>
      </div>
    </section>
  );
}
