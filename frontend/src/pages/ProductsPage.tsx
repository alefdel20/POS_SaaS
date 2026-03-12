import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Product } from "../types";
import { currency } from "../utils/format";

const emptyProduct = {
  name: "",
  sku: "",
  barcode: "",
  description: "",
  price: 0,
  cost_price: 0,
  stock: 0,
  is_active: true
};

export function ProductsPage() {
  const { token } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState(emptyProduct);

  function loadProducts() {
    if (!token) return;
    apiRequest<Product[]>("/products", { token }).then(setProducts).catch(console.error);
  }

  useEffect(() => {
    loadProducts();
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    await apiRequest<Product>("/products", {
      method: "POST",
      token,
      body: JSON.stringify(form)
    });
    setForm(emptyProduct);
    loadProducts();
  }

  return (
    <section className="page-grid two-columns">
      <div className="panel">
        <div className="panel-header">
          <h2>Productos</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>SKU</th>
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
          Codigo de barras
          <input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} required />
        </label>
        <label>
          Descripcion
          <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </label>
        <label>
          Precio
          <input type="number" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: Number(event.target.value) })} required />
        </label>
        <label>
          Costo
          <input type="number" step="0.01" value={form.cost_price} onChange={(event) => setForm({ ...form, cost_price: Number(event.target.value) })} required />
        </label>
        <label>
          Stock
          <input type="number" step="0.01" value={form.stock} onChange={(event) => setForm({ ...form, stock: Number(event.target.value) })} required />
        </label>
        <button className="button" type="submit">Guardar producto</button>
      </form>
    </section>
  );
}
