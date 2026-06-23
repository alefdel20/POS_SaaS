import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { currency } from "../utils/format";

type LowRotationProduct = {
  id: number;
  name: string;
  sku: string;
  stock: number;
  price: number;
  lastSaleDate: string | null;
  daysSinceLastSale: number | null;
  expirationDate: string | null;
};

type TopSellerProduct = {
  id: number;
  name: string;
  quantitySold: number;
  revenue: number;
};

type SearchProduct = {
  id: number;
  name: string;
  sku: string;
  stock: number;
  price: number;
};

type AlertConfig = {
  threshold_days: number;
  enabled: boolean;
  persisted?: boolean;
};

type DiscountForm = {
  discountType: "percentage" | "fixed" | "";
  discountValue: string;
};

const DEFAULT_THRESHOLD = 21;

export function RematePage() {
  const { token, user } = useAuth();
  const isPremium = user?.plan_key === "premium" || user?.plan_key === "enterprise";

  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [lowRotation, setLowRotation] = useState<LowRotationProduct[]>([]);
  const [topSellers, setTopSellers] = useState<TopSellerProduct[]>([]);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchProduct[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<(LowRotationProduct | SearchProduct | TopSellerProduct) | null>(null);
  const [form, setForm] = useState<DiscountForm>({ discountType: "", discountValue: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loadingLow, setLoadingLow] = useState(false);
  const [loadingTop, setLoadingTop] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token || !isPremium) return;
    apiRequest<AlertConfig>("/alert-config", { token })
      .then((config) => {
        if (config?.threshold_days) setThreshold(config.threshold_days);
      })
      .catch(() => {});
  }, [token, isPremium]);

  useEffect(() => {
    if (!token) return;
    setLoadingLow(true);
    apiRequest<LowRotationProduct[]>(
      `/products/alerts/low-rotation?thresholdDays=${threshold}`,
      { token }
    )
      .then(setLowRotation)
      .catch(() => setLowRotation([]))
      .finally(() => setLoadingLow(false));
  }, [token, threshold]);

  useEffect(() => {
    if (!token) return;
    setLoadingTop(true);
    apiRequest<TopSellerProduct[]>("/products/top-sellers?days=30", { token })
      .then(setTopSellers)
      .catch(() => setTopSellers([]))
      .finally(() => setLoadingTop(false));
  }, [token]);

  useEffect(() => {
    if (!token || !search.trim()) {
      setSearchResults([]);
      return;
    }
    const timeout = setTimeout(() => {
      apiRequest<SearchProduct[]>(
        `/products/search?q=${encodeURIComponent(search.trim())}&limit=10`,
        { token }
      )
        .then(setSearchResults)
        .catch(() => setSearchResults([]));
    }, 250);
    return () => clearTimeout(timeout);
  }, [token, search]);

  function selectProduct(product: LowRotationProduct | SearchProduct | TopSellerProduct) {
    setSelectedProduct(product);
    setForm({ discountType: "", discountValue: "" });
    setError("");
    setSuccess("");
  }

  function clearSelection() {
    setSelectedProduct(null);
    setForm({ discountType: "", discountValue: "" });
    setError("");
    setSuccess("");
  }

  async function applyDiscount(event: FormEvent) {
    event.preventDefault();
    if (!token || !selectedProduct) return;

    if (!form.discountType) {
      setError("Selecciona un tipo de descuento");
      return;
    }
    const value = Number(form.discountValue);
    if (!value || value <= 0) {
      setError("El valor del descuento debe ser mayor a 0");
      return;
    }
    if (form.discountType === "percentage" && value > 100) {
      setError("El porcentaje no puede superar 100%");
      return;
    }

    try {
      setSubmitting(true);
      setError("");
      setSuccess("");
      const now = new Date().toISOString();
      await apiRequest("/products/remate/bulk", {
        method: "POST",
        token,
        body: JSON.stringify({
          product_ids: [selectedProduct.id],
          discount_type: form.discountType,
          discount_value: value,
          discount_start: now,
          discount_end: null
        })
      });
      setSuccess(`Remate aplicado a "${selectedProduct.name}"`);
      setSelectedProduct(null);
      setForm({ discountType: "", discountValue: "" });

      apiRequest<LowRotationProduct[]>(
        `/products/alerts/low-rotation?thresholdDays=${threshold}`,
        { token }
      ).then(setLowRotation).catch(() => {});
      apiRequest<TopSellerProduct[]>("/products/top-sellers?days=30", { token })
        .then(setTopSellers).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible aplicar el remate");
    } finally {
      setSubmitting(false);
    }
  }

  function badgeColor(daysSinceLastSale: number | null): string {
    if (daysSinceLastSale === null) return "";
    const doubleThreshold = threshold * 2;
    const ratio = Math.min(daysSinceLastSale / doubleThreshold, 1);
    if (ratio >= 0.75) return "var(--danger)";
    if (ratio >= 0.5) return "var(--warning)";
    return "rgba(255, 159, 67, 0.7)";
  }

  const selectedProductPrice = useMemo(() => {
    if (!selectedProduct) return 0;
    return "price" in selectedProduct ? selectedProduct.price : 0;
  }, [selectedProduct]);

  const previewPrice = useMemo(() => {
    if (!selectedProduct || !form.discountType || !form.discountValue) return null;
    const val = Number(form.discountValue);
    if (!val || val <= 0) return null;
    if (form.discountType === "percentage") {
      return Math.max(selectedProductPrice - selectedProductPrice * (val / 100), 0);
    }
    return Math.max(selectedProductPrice - val, 0);
  }, [selectedProduct, form, selectedProductPrice]);

  return (
    <section className="page-grid">
      {error && <p className="error-text">{error}</p>}
      {success && <p className="success-text">{success}</p>}

      <div className="page-grid two-columns">
        {/* TOP 10 BAJA ROTACIÓN */}
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Baja rotacion / Vencimiento</h2>
              <p className="muted">
                Top 10 productos sin movimiento en {threshold} dias o proximos a vencer.
                {isPremium && (
                  <span style={{ fontSize: 11, marginLeft: 6, opacity: 0.7 }}>
                    (Configurable en Perfil → Alertas)
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Stock</th>
                  <th>Ultimo movimiento</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loadingLow ? (
                  <tr><td className="muted" colSpan={4}>Cargando...</td></tr>
                ) : lowRotation.length === 0 ? (
                  <tr><td className="muted" colSpan={4}>No hay productos con baja rotacion.</td></tr>
                ) : lowRotation.map((product) => (
                  <tr
                    key={`lr-${product.id}`}
                    onClick={() => selectProduct(product)}
                    style={{
                      cursor: "pointer",
                      background: selectedProduct?.id === product.id ? "rgba(var(--accent-rgb), 0.12)" : undefined
                    }}
                  >
                    <td>
                      <strong>{product.name}</strong>
                      <div className="muted" style={{ fontSize: 11 }}>{product.sku}</div>
                    </td>
                    <td>{product.stock}</td>
                    <td>
                      {product.expirationDate && new Date(product.expirationDate) <= new Date(Date.now() + 14 * 86_400_000) ? (
                        <span style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 700,
                          background: "rgba(255, 123, 123, 0.16)",
                          color: "var(--danger)"
                        }}>
                          Vence pronto
                        </span>
                      ) : null}
                      {isPremium && product.daysSinceLastSale != null && product.daysSinceLastSale >= threshold ? (
                        <span
                          title="Configurable en Perfil → Alertas"
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 700,
                            background: `${badgeColor(product.daysSinceLastSale)}22`,
                            color: badgeColor(product.daysSinceLastSale),
                            marginLeft: product.expirationDate ? 4 : 0
                          }}
                        >
                          {product.daysSinceLastSale} dias
                        </span>
                      ) : (
                        <span className="muted" style={{ fontSize: 12 }}>
                          {product.lastSaleDate
                            ? new Date(product.lastSaleDate).toLocaleDateString("es-MX")
                            : "Sin ventas"}
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        className="button ghost"
                        onClick={(e) => { e.stopPropagation(); selectProduct(product); }}
                        type="button"
                        style={{ fontSize: 12 }}
                      >
                        Seleccionar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* TOP 10 MÁS VENDIDOS */}
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Mas vendidos</h2>
              <p className="muted">Top 10 productos mas vendidos en los ultimos 30 dias.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cantidad vendida</th>
                  <th>Ingresos</th>
                </tr>
              </thead>
              <tbody>
                {loadingTop ? (
                  <tr><td className="muted" colSpan={3}>Cargando...</td></tr>
                ) : topSellers.length === 0 ? (
                  <tr><td className="muted" colSpan={3}>No hay datos de ventas recientes.</td></tr>
                ) : topSellers.map((product) => (
                  <tr
                    key={`ts-${product.id}`}
                    onClick={() => selectProduct(product)}
                    style={{
                      cursor: "pointer",
                      background: selectedProduct?.id === product.id ? "rgba(var(--accent-rgb), 0.12)" : undefined
                    }}
                  >
                    <td><strong>{product.name}</strong></td>
                    <td>{product.quantitySold}</td>
                    <td>{currency(product.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* BÚSQUEDA + FORMULARIO INLINE */}
      <div className="page-grid two-columns">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Buscar producto</h2>
              <p className="muted">Busca por nombre o SKU para aplicar remate.</p>
            </div>
            <input
              className="search-input"
              placeholder="Buscar producto por nombre o SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {search.trim() && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>SKU</th>
                    <th>Stock</th>
                    <th>Precio</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.length === 0 ? (
                    <tr><td className="muted" colSpan={5}>Sin resultados.</td></tr>
                  ) : searchResults.map((product) => (
                    <tr
                      key={`sr-${product.id}`}
                      onClick={() => selectProduct(product)}
                      style={{
                        cursor: "pointer",
                        background: selectedProduct?.id === product.id ? "rgba(var(--accent-rgb), 0.12)" : undefined
                      }}
                    >
                      <td><strong>{product.name}</strong></td>
                      <td className="muted">{product.sku}</td>
                      <td>{product.stock}</td>
                      <td>{currency(product.price)}</td>
                      <td>
                        <button
                          className="button ghost"
                          onClick={(e) => { e.stopPropagation(); selectProduct(product); }}
                          type="button"
                          style={{ fontSize: 12 }}
                        >
                          Seleccionar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* FORMULARIO DE APLICAR REMATE */}
        <form className="panel grid-form" onSubmit={applyDiscount}>
          <div className="panel-header">
            <div>
              <h2>Aplicar remate</h2>
              <p className="muted">
                {selectedProduct
                  ? `Producto: ${selectedProduct.name}`
                  : "Selecciona un producto de las listas o busqueda."}
              </p>
            </div>
          </div>

          {selectedProduct && (
            <>
              <div className="info-card">
                <p><strong>{selectedProduct.name}</strong></p>
                {selectedProductPrice > 0 && (
                  <p className="muted">Precio actual: {currency(selectedProductPrice)}</p>
                )}
                {"stock" in selectedProduct && (
                  <p className="muted">Stock: {(selectedProduct as any).stock}</p>
                )}
              </div>

              <label>
                Tipo de descuento
                <select
                  value={form.discountType}
                  onChange={(e) => setForm({ ...form, discountType: e.target.value as DiscountForm["discountType"] })}
                >
                  <option value="">Selecciona</option>
                  <option value="percentage">Porcentaje (%)</option>
                  <option value="fixed">Monto fijo ($)</option>
                </select>
              </label>

              <label>
                Valor del descuento
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={form.discountType === "percentage" ? "Ej: 20" : "Ej: 50.00"}
                  value={form.discountValue}
                  onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
                />
              </label>

              {previewPrice !== null && selectedProductPrice > 0 && (
                <div className="info-card" style={{ borderLeft: "3px solid var(--accent)" }}>
                  <p style={{ fontSize: 13 }}>
                    Precio con remate: <strong style={{ color: "var(--accent)" }}>{currency(previewPrice)}</strong>
                    <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>
                      (ahorro: {currency(selectedProductPrice - previewPrice)})
                    </span>
                  </p>
                </div>
              )}

              <div className="inline-actions">
                <button className="button" disabled={submitting || !form.discountType || !form.discountValue} type="submit">
                  {submitting ? "Aplicando..." : "Aplicar remate"}
                </button>
                <button className="button ghost" onClick={clearSelection} type="button">
                  Quitar seleccion
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </section>
  );
}
