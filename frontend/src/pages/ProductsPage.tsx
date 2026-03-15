import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Product } from "../types";
import { currency, shortDate } from "../utils/format";

const emptyProduct = {
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
  is_active: true
};

export function ProductsPage() {
  const { token } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState(emptyProduct);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function loadProducts() {
    if (!token) return;
    const response = await apiRequest<Product[]>("/products", { token });
    setProducts(response);
  }

  useEffect(() => {
    loadProducts().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar los productos");
    });
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    const price = Number(form.price);
    const stock = Number(form.stock);
    const costPrice = form.cost_price === "" ? 0 : Number(form.cost_price);
    const liquidationPrice = form.liquidation_price === "" ? null : Number(form.liquidation_price);

    if (!form.name.trim()) {
      setError("El nombre es obligatorio");
      return;
    }

    if (Number.isNaN(price) || price < 0) {
      setError("El precio debe ser numerico y valido");
      return;
    }

    if (Number.isNaN(stock) || stock < 0) {
      setError("El stock debe ser numerico y valido");
      return;
    }

    if (Number.isNaN(costPrice) || costPrice < 0) {
      setError("El costo debe ser numerico y valido");
      return;
    }

    if (liquidationPrice !== null && (Number.isNaN(liquidationPrice) || liquidationPrice < 0)) {
      setError("El precio de remate debe ser numerico y valido");
      return;
    }

    setSaving(true);
    setError("");

    try {
      await apiRequest<Product>("/products", {
        method: "POST",
        token,
        body: JSON.stringify({
          ...form,
          name: form.name.trim(),
          sku: form.sku.trim(),
          barcode: form.barcode.trim(),
          category: form.category.trim() || null,
          price,
          cost_price: costPrice,
          liquidation_price: liquidationPrice,
          stock,
          expires_at: form.expires_at || null
        })
      });
      setForm(emptyProduct);
      await loadProducts();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible guardar el producto");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteProduct(product: Product) {
    if (!token) return;
    const confirmed = window.confirm(`Eliminar producto "${product.name}"?`);
    if (!confirmed) return;

    try {
      setDeletingId(product.id);
      setError("");
      await apiRequest(`/products/${product.id}`, {
        method: "DELETE",
        token
      });
      await loadProducts();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No fue posible eliminar el producto");
    } finally {
      setDeletingId(null);
    }
  }

  const liquidationProducts = products.filter((product) => product.is_low_rotation || product.is_near_expiry);

  return (
    <section className="page-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Remate</h2>
            <p className="muted">Productos con baja rotacion o proximos a vencer.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Motivo</th>
                <th>Precio normal</th>
                <th>Precio remate</th>
                <th>Vence</th>
              </tr>
            </thead>
            <tbody>
              {liquidationProducts.map((product) => (
                <tr key={`liquidation-${product.id}`}>
                  <td>{product.name}</td>
                  <td>
                    {product.is_low_rotation ? "Baja rotacion" : ""}
                    {product.is_low_rotation && product.is_near_expiry ? " + " : ""}
                    {product.is_near_expiry ? "Proximo a vencer" : ""}
                  </td>
                  <td>{currency(product.price)}</td>
                  <td>{product.liquidation_price ? currency(product.liquidation_price) : "-"}</td>
                  <td>{shortDate(product.expires_at || null)}</td>
                </tr>
              ))}
              {liquidationProducts.length === 0 ? (
                <tr>
                  <td className="muted" colSpan={5}>No hay productos candidatos a remate.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="page-grid two-columns">
        <div className="panel">
          <div className="panel-header">
            <h2>Productos</h2>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>SKU</th>
                  <th>Categoria</th>
                  <th>Costo</th>
                  <th>Precio</th>
                  <th>Remate</th>
                  <th>Stock</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>{product.name}</td>
                    <td>{product.sku}</td>
                    <td>{product.category || "-"}</td>
                    <td>{currency(product.cost_price)}</td>
                    <td>{currency(product.price)}</td>
                    <td>{product.liquidation_price ? currency(product.liquidation_price) : "-"}</td>
                    <td>{product.stock}</td>
                    <td>{product.is_active ? "Activo" : "Inactivo"}</td>
                    <td>
                      <button
                        className="button ghost danger"
                        disabled={deletingId === product.id}
                        onClick={() => handleDeleteProduct(product)}
                        type="button"
                      >
                        {deletingId === product.id ? "Eliminando..." : "Eliminar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <form className="panel grid-form" onSubmit={handleSubmit}>
          <div className="panel-header">
            <h2>Nuevo producto</h2>
          </div>
          <label>
            Nombre
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
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
            Precio remate
            <input type="number" min="0" step="0.01" value={form.liquidation_price} onChange={(event) => setForm({ ...form, liquidation_price: event.target.value })} />
          </label>
          <label>
            Stock
            <input type="number" min="0" step="0.01" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} required />
          </label>
          <label>
            Fecha de vencimiento
            <input type="date" value={form.expires_at} onChange={(event) => setForm({ ...form, expires_at: event.target.value })} />
          </label>
          <button className="button" disabled={saving} type="submit">{saving ? "Guardando..." : "Guardar producto"}</button>
        </form>
      </div>
    </section>
  );
}
