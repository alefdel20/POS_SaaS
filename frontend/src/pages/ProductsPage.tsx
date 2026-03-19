import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { PaginatedProductsResponse, Product, Supplier } from "../types";
import { currency, shortDate, shortDateTime } from "../utils/format";

type ProductFormState = {
  name: string;
  sku: string;
  barcode: string;
  category: string;
  description: string;
  price: string;
  cost_price: string;
  stock: string;
  expires_at: string;
  is_active: boolean;
  status: "activo" | "inactivo";
  supplier_name: string;
  supplier_id: string;
  supplier_email: string;
  supplier_phone: string;
  supplier_whatsapp: string;
  supplier_observations: string;
  discount_type: "" | "percentage" | "fixed";
  discount_value: string;
  discount_start: string;
  discount_end: string;
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
  expires_at: "",
  is_active: true,
  status: "activo",
  supplier_name: "",
  supplier_id: "",
  supplier_email: "",
  supplier_phone: "",
  supplier_whatsapp: "",
  supplier_observations: "",
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
    expires_at: product.expires_at?.slice(0, 10) || "",
    is_active: product.is_active,
    status: product.status || (product.is_active ? "activo" : "inactivo"),
    supplier_name: product.supplier_name || "",
    supplier_id: product.supplier_id ? String(product.supplier_id) : "",
    supplier_email: product.supplier_email || "",
    supplier_phone: product.supplier_phone || "",
    supplier_whatsapp: product.supplier_whatsapp || "",
    supplier_observations: product.supplier_observations || "",
    discount_type: (product.discount_type as ProductFormState["discount_type"]) || "",
    discount_value: product.discount_value === null || product.discount_value === undefined ? "" : String(product.discount_value),
    discount_start: toDateTimeLocal(product.discount_start),
    discount_end: toDateTimeLocal(product.discount_end)
  };
}

export function ProductsPage() {
  const { token } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [form, setForm] = useState<ProductFormState>(emptyProduct);
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

  useEffect(() => {
    loadProducts(search, page, pageSize).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar los productos");
    });
    loadSuppliers().catch(console.error);
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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    const price = Number(form.price);
    const stock = Number(form.stock);
    const costPrice = form.cost_price === "" ? 0 : Number(form.cost_price);
    const discountValue = form.discount_value === "" ? null : Number(form.discount_value);

    if (!form.name.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    if (Number.isNaN(price) || price < 0 || Number.isNaN(stock) || stock < 0 || Number.isNaN(costPrice) || costPrice < 0) {
      setError("Precio, costo y stock deben ser numericos validos");
      return;
    }
    if (form.discount_type && (discountValue === null || Number.isNaN(discountValue) || discountValue < 0)) {
      setError("El valor del remate debe ser numerico y valido");
      return;
    }
    if ((form.discount_start && !form.discount_end) || (!form.discount_start && form.discount_end)) {
      setError("Debes indicar inicio y fin del remate");
      return;
    }

    const supplierByName = suppliers.find((supplier) => supplier.name.toLowerCase() === form.supplier_name.trim().toLowerCase());
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
      expires_at: form.expires_at || null,
      supplier_id: form.supplier_id ? Number(form.supplier_id) : supplierByName?.id ?? null,
      supplier_name: form.supplier_name.trim() || null,
      supplier_email: form.supplier_email.trim() || null,
      supplier_phone: form.supplier_phone.trim() || null,
      supplier_whatsapp: form.supplier_whatsapp.trim() || null,
      supplier_observations: form.supplier_observations.trim(),
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
      await loadProducts(search, page, pageSize);
      await loadSuppliers();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible guardar el producto");
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(product: Product) {
    setEditingId(product.id);
    setForm(productToForm(product));
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
            <p className="muted">Productos con baja rotacion, proximos a vencer o con remate activo.</p>
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
                  <td>{product.supplier_name || "-"}</td>
                  <td>
                    {product.has_active_discount ? "Remate activo" : ""}
                    {product.has_active_discount && (product.is_low_rotation || product.is_near_expiry) ? " + " : ""}
                    {product.is_low_rotation ? "Baja rotacion" : ""}
                    {product.is_low_rotation && product.is_near_expiry ? " + " : ""}
                    {product.is_near_expiry ? "Proximo a vencer" : ""}
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
              }}
              type="button"
            >
              Cancelar
            </button>
          ) : null}
        </div>
        <div className="product-form-grid product-form-grid-wide">
          <label>
            Nombre
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </label>
          <label>
            Proveedor
            <input
              list="supplier-options"
              value={form.supplier_name}
              onChange={(event) => {
                const value = event.target.value;
                const matchedSupplier = suppliers.find((supplier) => supplier.name.toLowerCase() === value.toLowerCase());
                setForm({
                  ...form,
                  supplier_name: value,
                  supplier_id: matchedSupplier ? String(matchedSupplier.id) : "",
                  supplier_email: matchedSupplier?.email || "",
                  supplier_phone: matchedSupplier?.phone || "",
                  supplier_whatsapp: matchedSupplier?.whatsapp || "",
                  supplier_observations: matchedSupplier?.observations || ""
                });
                loadSuppliers(value).catch(console.error);
              }}
              placeholder="Selecciona o escribe un proveedor"
            />
          </label>
          <datalist id="supplier-options">
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.name} />
            ))}
          </datalist>
          <label>
            Correo proveedor
            <input type="email" value={form.supplier_email} onChange={(event) => setForm({ ...form, supplier_email: event.target.value })} />
          </label>
          <label>
            Telefono proveedor
            <input value={form.supplier_phone} onChange={(event) => setForm({ ...form, supplier_phone: event.target.value })} />
          </label>
          <label>
            WhatsApp proveedor
            <input value={form.supplier_whatsapp} onChange={(event) => setForm({ ...form, supplier_whatsapp: event.target.value })} />
          </label>
          <label>
            SKU
            <input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} required />
          </label>
          <label>
            Categoria
            <input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} />
          </label>
          <label>
            Codigo de barras
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
            Descripcion
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
          <label className="form-span-2">
            Observaciones proveedor
            <textarea value={form.supplier_observations} onChange={(event) => setForm({ ...form, supplier_observations: event.target.value })} />
          </label>
          <label>
            Precio
            <input type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} required />
          </label>
          <label>
            Costo
            <input type="number" min="0" step="0.01" value={form.cost_price} onChange={(event) => setForm({ ...form, cost_price: event.target.value })} />
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
          <label>
            Stock
            <input type="number" min="0" step="0.01" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} required />
          </label>
          <label>
            Fecha de vencimiento
            <input type="date" value={form.expires_at} onChange={(event) => setForm({ ...form, expires_at: event.target.value })} />
          </label>
        </div>
        <button className="button" disabled={saving} type="submit">
          {saving ? "Guardando..." : editingId ? "Actualizar producto" : "Guardar producto"}
        </button>
      </form>

      <div className="panel">
        <div className="panel-header product-catalog-header">
          <div>
            <h2>Catalogo administrativo</h2>
            <p className="muted">Buscador y paginacion sin borrado destructivo.</p>
          </div>
          <div className="inline-actions">
            <input
              className="search-input"
              placeholder="Buscar por nombre, SKU, categoria o proveedor"
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
                <th>Proveedor</th>
                <th>SKU</th>
                <th>Categoria</th>
                <th>Precio</th>
                <th>Stock</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>
                    <div>{product.supplier_name || "-"}</div>
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
                  <td>{product.stock}</td>
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
