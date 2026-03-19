import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Product } from "../types";
import { currency, shortDateTime } from "../utils/format";

type DiscountForm = {
  discount_type: "" | "percentage" | "fixed";
  discount_value: string;
  discount_start: string;
  discount_end: string;
};

const emptyDiscount: DiscountForm = {
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

function productToDiscountForm(product: Product): DiscountForm {
  return {
    discount_type: product.discount_type || "",
    discount_value: product.discount_value === null || product.discount_value === undefined ? "" : String(product.discount_value),
    discount_start: toDateTimeLocal(product.discount_start),
    discount_end: toDateTimeLocal(product.discount_end)
  };
}

export function RematePage() {
  const { token } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<DiscountForm>(emptyDiscount);
  const [error, setError] = useState("");

  async function loadProducts(term = "") {
    if (!token) return;
    const params = new URLSearchParams();
    if (term.trim()) {
      params.set("search", term.trim());
    }
    const response = await apiRequest<Product[]>(`/products?${params.toString()}`, { token });
    setProducts(response);
  }

  useEffect(() => {
    loadProducts().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar productos");
    });
  }, [token]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadProducts(search).catch(console.error);
    }, 250);
    return () => clearTimeout(timeout);
  }, [search]);

  const filteredProducts = useMemo(
    () => products.filter((product) => product.status !== "inactivo"),
    [products]
  );
  const selectedProducts = useMemo(
    () => filteredProducts.filter((product) => selectedIds.includes(product.id)),
    [filteredProducts, selectedIds]
  );

  useEffect(() => {
    if (selectedProducts.length !== 1) {
      return;
    }

    setForm(productToDiscountForm(selectedProducts[0]));
  }, [selectedProducts]);

  async function applyDiscount(event: FormEvent) {
    event.preventDefault();
    if (!token || selectedIds.length === 0) return;

    try {
      setError("");
      await apiRequest("/products/remate/bulk", {
        method: "POST",
        token,
        body: JSON.stringify({
          product_ids: selectedIds,
          discount_type: form.discount_type || null,
          discount_value: form.discount_value === "" ? null : Number(form.discount_value),
          discount_start: form.discount_start ? new Date(form.discount_start).toISOString() : null,
          discount_end: form.discount_end ? new Date(form.discount_end).toISOString() : null
        })
      });
      setSelectedIds([]);
      setForm(emptyDiscount);
      await loadProducts(search);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible aplicar el remate");
    }
  }

  async function clearDiscount(productId?: number) {
    if (!token) return;

    try {
      setError("");
      await apiRequest("/products/remate/bulk", {
        method: "POST",
        token,
        body: JSON.stringify({
          product_ids: productId ? [productId] : selectedIds,
          clear_discount: true
        })
      });
      setSelectedIds([]);
      await loadProducts(search);
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "No fue posible limpiar el remate");
    }
  }

  function toggleSelection(productId: number) {
    setSelectedIds((current) =>
      current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId]
    );
  }

  function clearSelection() {
    setSelectedIds([]);
    setForm(emptyDiscount);
    setError("");
  }

  return (
    <section className="page-grid two-columns">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Modulo de remate</h2>
            <p className="muted">Aplica remates individuales o masivos sin tocar el precio base.</p>
          </div>
          <input
            className="search-input"
            placeholder="Buscar producto"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Producto</th>
                <th>Precio base</th>
                <th>Precio final</th>
                <th>Vigencia</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => (
                <tr key={product.id}>
                  <td>
                    <input
                      checked={selectedIds.includes(product.id)}
                      onChange={() => toggleSelection(product.id)}
                      type="checkbox"
                    />
                  </td>
                  <td>
                    <strong>{product.name}</strong>
                    <div className="muted">{product.supplier_name || product.category || "-"}</div>
                  </td>
                  <td>{currency(product.price)}</td>
                  <td>{currency(product.effective_price ?? product.price)}</td>
                  <td>
                    {product.discount_start || product.discount_end
                      ? `${shortDateTime(product.discount_start || null)} - ${shortDateTime(product.discount_end || null)}`
                      : "-"}
                  </td>
                  <td>
                    <button className="button ghost" onClick={() => clearDiscount(product.id)} type="button">Limpiar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <form className="panel grid-form" onSubmit={applyDiscount}>
        <div className="panel-header">
          <div>
            <h2>Aplicar remate</h2>
            <p className="muted">
              {selectedIds.length} productos seleccionados
              {selectedProducts.length === 1 && selectedProducts[0].discount_type ? " | remate actual cargado para edicion" : ""}
            </p>
          </div>
        </div>
        <label>
          Tipo de remate
          <select value={form.discount_type} onChange={(event) => setForm({ ...form, discount_type: event.target.value as DiscountForm["discount_type"] })}>
            <option value="">Selecciona</option>
            <option value="percentage">Porcentaje</option>
            <option value="fixed">Fijo</option>
          </select>
        </label>
        <label>
          Valor de remate
          <input type="number" min="0" step="0.01" value={form.discount_value} onChange={(event) => setForm({ ...form, discount_value: event.target.value })} />
        </label>
        <label>
          Inicio (24h)
          <input step="60" type="datetime-local" value={form.discount_start} onChange={(event) => setForm({ ...form, discount_start: event.target.value })} />
        </label>
        <label>
          Fin (24h)
          <input step="60" type="datetime-local" value={form.discount_end} onChange={(event) => setForm({ ...form, discount_end: event.target.value })} />
        </label>
        <div className="inline-actions">
          <button className="button" disabled={!selectedIds.length} type="submit">Aplicar remate</button>
          <button className="button ghost" disabled={!selectedIds.length && !form.discount_type && !form.discount_value && !form.discount_start && !form.discount_end} onClick={clearSelection} type="button">Limpiar seleccion</button>
        </div>
      </form>
    </section>
  );
}
