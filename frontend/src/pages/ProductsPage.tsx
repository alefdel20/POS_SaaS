import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Product } from "../types";
import { currency } from "../utils/format";

const emptyProduct = {
  name: "",
  sku: "",
  barcode: "",
  category: "",
  description: "",
  price: "",
  cost_price: "",
  stock: "",
  is_active: true
};

export function ProductsPage() {
  const { token } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState(emptyProduct);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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
          stock
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

  return (
    <section className="page-grid two-columns">
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
                <th>Precio</th>
                <th>Stock</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>{product.sku}</td>
                  <td>{product.category || "-"}</td>
                  <td>{currency(product.price)}</td>
                  <td>{product.stock}</td>
                  <td>{product.is_active ? "Activo" : "Inactivo"}</td>
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
          Stock
          <input type="number" min="0" step="0.01" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} required />
        </label>
        <button className="button" disabled={saving} type="submit">{saving ? "Guardando..." : "Guardar producto"}</button>
      </form>
    </section>
  );
}
