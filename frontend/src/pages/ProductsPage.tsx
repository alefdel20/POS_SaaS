import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Product, Supplier } from "../types";
import { currency, shortDate, shortDateTime } from "../utils/format";

type ProductFormState = {
  name: string;
  sku: string;
  barcode: string;
  category: string;
  description: string;
  price: string;
  cost_price: string;
  liquidation_price: string;
  stock: string;
  expires_at: string;
  is_active: boolean;
  status: "activo" | "inactivo";
  supplier_name: string;
  supplier_id: string;
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
  liquidation_price: "",
  stock: "",
  expires_at: "",
  is_active: true,
  status: "activo",
  supplier_name: "",
  supplier_id: "",
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
    liquidation_price: product.liquidation_price === null || product.liquidation_price === undefined ? "" : String(product.liquidation_price),
    stock: String(product.stock ?? ""),
    expires_at: product.expires_at?.slice(0, 10) || "",
    is_active: product.is_active,
    status: product.status || (product.is_active ? "activo" : "inactivo"),
    supplier_name: product.supplier_name || "",
    supplier_id: product.supplier_id ? String(product.supplier_id) : "",
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
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  async function loadProducts() {
    if (!token) return;
    const response = await apiRequest<Product[]>("/products", { token });
    setProducts(response);
  }

  async function loadSuppliers(search = "") {
    if (!token) return;
    const params = new URLSearchParams();
    if (search.trim()) {
      params.set("search", search.trim());
    }
    const response = await apiRequest<Supplier[]>(`/products/suppliers?${params.toString()}`, { token });
    setSuppliers(response);
  }

  useEffect(() => {
    loadProducts().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar los productos");
    });
    loadSuppliers().catch(console.error);
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    const price = Number(form.price);
    const stock = Number(form.stock);
    const costPrice = form.cost_price === "" ? 0 : Number(form.cost_price);
    const liquidationPrice = form.liquidation_price === "" ? null : Number(form.liquidation_price);
    const discountValue = form.discount_value === "" ? null : Number(form.discount_value);

    if (!form.name.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    if (Number.isNaN(price) || price < 0 || Number.isNaN(stock) || stock < 0 || Number.isNaN(costPrice) || costPrice < 0) {
      setError("Precio, costo y stock deben ser numericos validos");
      return;
    }
    if (liquidationPrice !== null && (Number.isNaN(liquidationPrice) || liquidationPrice < 0)) {
      setError("El precio de remate legacy debe ser valido");
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
      liquidation_price: liquidationPrice,
      stock,
      expires_at: form.expires_at || null,
      supplier_id: form.supplier_id ? Number(form.supplier_id) : supplierByName?.id ?? null,
      supplier_name: form.supplier_name.trim() || null,
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
      await loadProducts();
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
      await loadProducts();
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

      <div className="page-grid product-management-layout">
        <div className="panel">
          <div className="panel-header">
            <h2>Catalogo administrativo</h2>
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
                    <td>{product.supplier_name || "-"}</td>
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
              </tbody>
            </table>
          </div>
        </div>

        <form className="panel product-form-panel" onSubmit={handleSubmit}>
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
          <div className="product-form-grid">
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
                    supplier_id: matchedSupplier ? String(matchedSupplier.id) : ""
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
            <label>
              Precio
              <input type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} required />
            </label>
            <label>
              Costo
              <input type="number" min="0" step="0.01" value={form.cost_price} onChange={(event) => setForm({ ...form, cost_price: event.target.value })} />
            </label>
            <label>
              Precio remate legacy
              <input type="number" min="0" step="0.01" value={form.liquidation_price} onChange={(event) => setForm({ ...form, liquidation_price: event.target.value })} />
            </label>
            <label>
              Tipo de remate
              <select value={form.discount_type} onChange={(event) => setForm({ ...form, discount_type: event.target.value as ProductFormState["discount_type"] })}>
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
      </div>
    </section>
  );
}
