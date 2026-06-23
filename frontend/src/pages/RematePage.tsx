import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { currency } from "../utils/format";
import { dateTimeLocalToIsoString, getMexicoCityDateTimeLocalValue } from "../utils/timezone";

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

type SearchProduct = {
  id: number;
  name: string;
  sku: string;
  stock: number;
  price: number;
};

type ActiveDiscount = {
  id: number;
  productId: number;
  name: string;
  sku: string;
  price: number;
  discountType: "percentage" | "fixed";
  discountValue: number;
  discountStart: string;
  discountEnd: string | null;
};

type AlertConfig = {
  threshold_days: number;
  enabled: boolean;
  persisted?: boolean;
};

type DiscountMode = "individual" | "package";

type DiscountForm = {
  discountType: "percentage" | "fixed" | "";
  discountValue: string;
  packageName: string;
  discountStart: string;
  discountEnd: string;
};

type EditForm = {
  discountType: "percentage" | "fixed" | "";
  discountValue: string;
  discountStart: string;
  discountEnd: string;
};

type SelectableProduct = LowRotationProduct | SearchProduct | ActiveDiscount;

const DEFAULT_THRESHOLD = 21;

function nowLocal(): string {
  return getMexicoCityDateTimeLocalValue(new Date().toISOString());
}

function makeEmptyForm(): DiscountForm {
  return { discountType: "", discountValue: "", packageName: "", discountStart: nowLocal(), discountEnd: "" };
}

function getProductPrice(p: SelectableProduct): number {
  return "price" in p ? p.price : 0;
}

function formatShortDateTime(iso: string | null): string {
  if (!iso) return "Sin fin";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function RematePage() {
  const { token, user } = useAuth();
  const isPremium = user?.plan_key === "premium" || user?.plan_key === "enterprise";

  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [lowRotation, setLowRotation] = useState<LowRotationProduct[]>([]);
  const [activeDiscounts, setActiveDiscounts] = useState<ActiveDiscount[]>([]);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchProduct[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<SelectableProduct[]>([]);
  const [discountMode, setDiscountMode] = useState<DiscountMode>("individual");
  const [form, setForm] = useState<DiscountForm>(makeEmptyForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loadingLow, setLoadingLow] = useState(false);
  const [loadingActive, setLoadingActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Edit modal state
  const [editingDiscount, setEditingDiscount] = useState<ActiveDiscount | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ discountType: "", discountValue: "", discountStart: "", discountEnd: "" });
  const [editError, setEditError] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);

  // --- Data loading ---

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

  function loadActiveDiscounts() {
    if (!token) return;
    setLoadingActive(true);
    apiRequest<ActiveDiscount[]>("/products/discounts/active", { token })
      .then(setActiveDiscounts)
      .catch(() => setActiveDiscounts([]))
      .finally(() => setLoadingActive(false));
  }

  useEffect(() => {
    loadActiveDiscounts();
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

  // --- Selection helpers ---

  function isSelected(id: number) {
    return selectedProducts.some((p) => p.id === id);
  }

  function toggleSelectProduct(product: SelectableProduct) {
    setSelectedProducts((prev) =>
      prev.some((p) => p.id === product.id)
        ? prev.filter((p) => p.id !== product.id)
        : [...prev, product]
    );
    setError("");
    setSuccess("");
  }

  function clearSelection() {
    setSelectedProducts([]);
    setForm(makeEmptyForm());
    setDiscountMode("individual");
    setSearch("");
    setError("");
    setSuccess("");
  }

  // --- Price calculations ---

  const totalPrice = useMemo(
    () => selectedProducts.reduce((sum, p) => sum + getProductPrice(p), 0),
    [selectedProducts]
  );

  const individualPrices = useMemo(() => {
    if (!form.discountType || !form.discountValue || selectedProducts.length === 0) return null;
    const val = Number(form.discountValue);
    if (!val || val <= 0) return null;
    return selectedProducts.map((p) => {
      const price = getProductPrice(p);
      const discount = form.discountType === "percentage"
        ? price * (val / 100)
        : val;
      const final_ = Math.max(price - discount, 0);
      return { id: p.id, name: p.name, price, discount: Math.min(discount, price), final: final_ };
    });
  }, [selectedProducts, form]);

  const packagePrice = useMemo(() => {
    if (!form.discountType || !form.discountValue || selectedProducts.length === 0) return null;
    const val = Number(form.discountValue);
    if (!val || val <= 0) return null;
    const discount = form.discountType === "percentage"
      ? totalPrice * (val / 100)
      : val;
    return {
      totalOriginal: totalPrice,
      discount: Math.min(discount, totalPrice),
      totalFinal: Math.max(totalPrice - discount, 0)
    };
  }, [selectedProducts, form, totalPrice]);

  // --- Apply new discount ---

  async function applyDiscount(event: FormEvent) {
    event.preventDefault();
    if (!token || selectedProducts.length === 0) return;

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
    if (!form.discountStart) {
      setError("La fecha de inicio es requerida");
      return;
    }
    if (form.discountEnd && form.discountEnd <= form.discountStart) {
      setError("La fecha de fin debe ser posterior a la de inicio");
      return;
    }
    if (discountMode === "individual" && form.discountType === "fixed") {
      const tooHigh = selectedProducts.find((p) => getProductPrice(p) < value);
      if (tooHigh) {
        setError(`El descuento $${value} supera el precio de "${tooHigh.name}" (${currency(getProductPrice(tooHigh))})`);
        return;
      }
    }
    if (discountMode === "package" && form.discountType === "fixed" && value > totalPrice) {
      setError("El descuento supera el precio total del paquete");
      return;
    }

    try {
      setSubmitting(true);
      setError("");
      setSuccess("");
      const payload: Record<string, unknown> = {
        product_ids: selectedProducts.map((p) => p.id),
        discount_type: form.discountType,
        discount_value: value,
        discount_start: dateTimeLocalToIsoString(form.discountStart),
        discount_end: form.discountEnd ? dateTimeLocalToIsoString(form.discountEnd) : null
      };
      if (discountMode === "package") {
        payload.is_package = true;
        payload.package_name = form.packageName || `Paquete ${selectedProducts.length} productos`;
      }
      await apiRequest("/products/remate/bulk", {
        method: "POST",
        token,
        body: JSON.stringify(payload)
      });
      const label = selectedProducts.length === 1
        ? `"${selectedProducts[0].name}"`
        : `${selectedProducts.length} productos`;
      setSuccess(`Remate aplicado a ${label}`);
      setSelectedProducts([]);
      setForm(makeEmptyForm());
      setDiscountMode("individual");

      apiRequest<LowRotationProduct[]>(
        `/products/alerts/low-rotation?thresholdDays=${threshold}`,
        { token }
      ).then(setLowRotation).catch(() => {});
      loadActiveDiscounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible aplicar el remate");
    } finally {
      setSubmitting(false);
    }
  }

  // --- Cancel discount ---

  async function cancelActiveDiscount(discount: ActiveDiscount) {
    if (!token) return;
    const confirmed = window.confirm(
      `¿Cancelar remate de "${discount.name}"?\nEsta accion no se puede deshacer.`
    );
    if (!confirmed) return;

    try {
      setError("");
      await apiRequest(`/products/discounts/${discount.productId}`, {
        method: "DELETE",
        token
      });
      setSuccess(`Remate de "${discount.name}" cancelado`);
      setSelectedProducts((prev) => prev.filter((p) => p.id !== discount.id));
      loadActiveDiscounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No fue posible cancelar el remate");
    }
  }

  // --- Edit modal ---

  function openEditModal(discount: ActiveDiscount) {
    setEditingDiscount(discount);
    setEditForm({
      discountType: discount.discountType,
      discountValue: String(discount.discountValue),
      discountStart: getMexicoCityDateTimeLocalValue(discount.discountStart),
      discountEnd: discount.discountEnd ? getMexicoCityDateTimeLocalValue(discount.discountEnd) : ""
    });
    setEditError("");
  }

  function closeEditModal() {
    setEditingDiscount(null);
    setEditError("");
  }

  async function saveDiscountChanges() {
    if (!token || !editingDiscount) return;
    if (!editForm.discountType) {
      setEditError("Selecciona un tipo de descuento");
      return;
    }
    const value = Number(editForm.discountValue);
    if (!value || value <= 0) {
      setEditError("El valor del descuento debe ser mayor a 0");
      return;
    }
    if (editForm.discountType === "percentage" && value > 100) {
      setEditError("El porcentaje no puede superar 100%");
      return;
    }
    if (!editForm.discountStart) {
      setEditError("La fecha de inicio es requerida");
      return;
    }
    if (editForm.discountEnd && editForm.discountEnd <= editForm.discountStart) {
      setEditError("La fecha de fin debe ser posterior a la de inicio");
      return;
    }

    try {
      setEditSubmitting(true);
      setEditError("");
      await apiRequest(`/products/discounts/${editingDiscount.productId}`, {
        method: "PUT",
        token,
        body: JSON.stringify({
          discount_type: editForm.discountType,
          discount_value: value,
          discount_start: dateTimeLocalToIsoString(editForm.discountStart),
          discount_end: editForm.discountEnd ? dateTimeLocalToIsoString(editForm.discountEnd) : null
        })
      });
      setSuccess(`Remate de "${editingDiscount.name}" actualizado`);
      closeEditModal();
      loadActiveDiscounts();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "No fue posible actualizar el remate");
    } finally {
      setEditSubmitting(false);
    }
  }

  // --- Badge color ---

  function badgeColor(daysSinceLastSale: number | null): string {
    if (daysSinceLastSale === null) return "";
    const doubleThreshold = threshold * 2;
    const ratio = Math.min(daysSinceLastSale / doubleThreshold, 1);
    if (ratio >= 0.75) return "var(--danger)";
    if (ratio >= 0.5) return "var(--warning)";
    return "rgba(255, 159, 67, 0.7)";
  }

  // --- Render helpers ---

  function renderLowRotationRow(product: LowRotationProduct) {
    const selected = isSelected(product.id);
    return (
      <tr
        key={`lr-${product.id}`}
        onClick={() => toggleSelectProduct(product)}
        style={{
          cursor: "pointer",
          background: selected ? "rgba(var(--accent-rgb), 0.12)" : undefined
        }}
      >
        <td style={{ width: 28 }}>
          <input type="checkbox" checked={selected} readOnly style={{ pointerEvents: "none" }} />
        </td>
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
      </tr>
    );
  }

  function renderSearchRow(product: SearchProduct) {
    const selected = isSelected(product.id);
    return (
      <tr
        key={`sr-${product.id}`}
        onClick={() => toggleSelectProduct(product)}
        style={{
          cursor: "pointer",
          background: selected
            ? "rgba(var(--accent-rgb), 0.12)"
            : "rgba(var(--accent-rgb), 0.04)"
        }}
      >
        <td style={{ width: 28 }}>
          <input type="checkbox" checked={selected} readOnly style={{ pointerEvents: "none" }} />
        </td>
        <td>
          <strong>{product.name}</strong>
          <div className="muted" style={{ fontSize: 11 }}>{product.sku}</div>
        </td>
        <td>{product.stock}</td>
        <td className="muted" style={{ fontSize: 12 }}>{currency(product.price)}</td>
      </tr>
    );
  }

  function renderActiveDiscountRow(discount: ActiveDiscount) {
    const selected = isSelected(discount.id);
    return (
      <tr
        key={`ad-${discount.id}`}
        onClick={() => toggleSelectProduct(discount)}
        style={{
          cursor: "pointer",
          background: selected ? "rgba(var(--accent-rgb), 0.12)" : undefined
        }}
      >
        <td style={{ width: 28 }}>
          <input type="checkbox" checked={selected} readOnly style={{ pointerEvents: "none" }} />
        </td>
        <td>
          <strong>{discount.name}</strong>
          <div className="muted" style={{ fontSize: 11 }}>{discount.sku}</div>
        </td>
        <td>{discount.discountType === "percentage" ? `${discount.discountValue}%` : currency(discount.discountValue)}</td>
        <td style={{ fontSize: 12 }}>{formatShortDateTime(discount.discountStart)}</td>
        <td style={{ fontSize: 12 }}>{formatShortDateTime(discount.discountEnd)}</td>
        <td>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button
              className="button ghost"
              onClick={(e) => { e.stopPropagation(); openEditModal(discount); }}
              type="button"
              style={{ fontSize: 11, padding: "2px 8px" }}
            >
              Editar
            </button>
            <button
              className="button ghost"
              onClick={(e) => { e.stopPropagation(); cancelActiveDiscount(discount); }}
              type="button"
              style={{ fontSize: 11, padding: "2px 8px", color: "var(--danger)" }}
            >
              Cancelar
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <section className="page-grid">
      {error && <p className="error-text">{error}</p>}
      {success && <p className="success-text">{success}</p>}

      {/* ROW 1: Baja rotación (LEFT) + Aplicar remate (RIGHT) */}
      <div className="page-grid two-columns">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Baja rotacion / Vencimiento</h2>
              <p className="muted">
                Top 10 sin movimiento en {threshold} dias o proximos a vencer.
                {isPremium && (
                  <span style={{ fontSize: 11, marginLeft: 6, opacity: 0.7 }}>
                    (Configurable en Perfil)
                  </span>
                )}
              </p>
            </div>
            <input
              className="search-input"
              placeholder="Buscar por nombre o SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 220 }}
            />
          </div>
          <div className="table-wrap" style={{ maxHeight: 520, overflowY: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th>Producto</th>
                  <th>Stock</th>
                  <th>Ultimo movimiento</th>
                </tr>
              </thead>
              <tbody>
                {loadingLow ? (
                  <tr><td className="muted" colSpan={4}>Cargando...</td></tr>
                ) : lowRotation.length === 0 && !search.trim() ? (
                  <tr><td className="muted" colSpan={4}>No hay productos con baja rotacion.</td></tr>
                ) : lowRotation.map(renderLowRotationRow)}

                {searchResults.length > 0 && (
                  <>
                    <tr>
                      <td colSpan={4} style={{ padding: 0 }}>
                        <div style={{
                          borderTop: "1px solid var(--border)",
                          padding: "0.5rem 0.75rem",
                          background: "var(--surface-soft)"
                        }}>
                          <span className="muted" style={{ fontSize: 11, fontWeight: 600 }}>
                            Resultados de busqueda
                          </span>
                        </div>
                      </td>
                    </tr>
                    {searchResults.map(renderSearchRow)}
                  </>
                )}

                {search.trim() && searchResults.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: 0 }}>
                      <div style={{
                        borderTop: "1px solid var(--border)",
                        padding: "0.5rem 0.75rem",
                        background: "var(--surface-soft)"
                      }}>
                        <span className="muted" style={{ fontSize: 11 }}>
                          Sin resultados para &ldquo;{search}&rdquo;
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* PANEL: Aplicar remate (LADO DERECHO) */}
        <form className="panel grid-form" onSubmit={applyDiscount} style={{ alignSelf: "start" }}>
          <div className="panel-header">
            <div>
              <h2>Aplicar remate</h2>
              <p className="muted">
                {selectedProducts.length > 0
                  ? `${selectedProducts.length} ${selectedProducts.length === 1 ? "producto" : "productos"} seleccionados`
                  : "Selecciona productos de las listas o busqueda."}
              </p>
            </div>
            {selectedProducts.length > 0 && (
              <button className="button ghost" onClick={clearSelection} type="button" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                Limpiar todo
              </button>
            )}
          </div>

          {selectedProducts.length > 0 ? (
            <>
              {/* MINI CARRITO */}
              <div className="info-card" style={{ borderLeft: "3px solid var(--accent)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <strong style={{ fontSize: 13 }}>{selectedProducts.length} {selectedProducts.length === 1 ? "producto" : "productos"}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>Total: {currency(totalPrice)}</span>
                </div>
                <div style={{ maxHeight: 120, overflowY: "auto" }}>
                  {selectedProducts.map((p) => (
                    <div key={p.id} style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.25rem 0",
                      borderBottom: "1px solid var(--border)",
                      fontSize: 12
                    }}>
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                      <span className="muted" style={{ whiteSpace: "nowrap" }}>{currency(getProductPrice(p))}</span>
                      <button
                        className="button ghost"
                        onClick={() => toggleSelectProduct(p)}
                        type="button"
                        style={{ fontSize: 11, padding: "2px 6px" }}
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* SELECTOR DE MODO */}
              <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "0.75rem 1rem" }}>
                <legend style={{ fontSize: 13, fontWeight: 600, padding: "0 0.5rem" }}>Tipo de remate:</legend>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 6 }}>
                  <input
                    type="radio"
                    name="discountMode"
                    value="individual"
                    checked={discountMode === "individual"}
                    onChange={() => setDiscountMode("individual")}
                  />
                  Descuento individual a cada producto
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="discountMode"
                    value="package"
                    checked={discountMode === "package"}
                    onChange={() => setDiscountMode("package")}
                  />
                  Paquete / Combo
                </label>
              </fieldset>

              {discountMode === "package" && (
                <label>
                  Nombre del paquete (opcional)
                  <input
                    type="text"
                    placeholder={`Paquete ${selectedProducts.length} productos`}
                    value={form.packageName}
                    onChange={(e) => setForm({ ...form, packageName: e.target.value })}
                  />
                </label>
              )}

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
                {discountMode === "package" ? "Descuento sobre el total" : "Valor del descuento"}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={form.discountType === "percentage" ? "Ej: 20" : "Ej: 50.00"}
                  value={form.discountValue}
                  onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
                />
              </label>

              <label>
                Fecha y hora de inicio
                <input
                  type="datetime-local"
                  step="60"
                  value={form.discountStart}
                  onChange={(e) => setForm({ ...form, discountStart: e.target.value })}
                />
              </label>

              <label>
                Fecha y hora de fin (opcional)
                <input
                  type="datetime-local"
                  step="60"
                  value={form.discountEnd}
                  onChange={(e) => setForm({ ...form, discountEnd: e.target.value })}
                />
              </label>

              {/* PREVIEW INDIVIDUAL */}
              {discountMode === "individual" && individualPrices && (
                <div className="info-card" style={{ borderLeft: "3px solid var(--accent)", padding: "0.5rem" }}>
                  <div className="table-wrap">
                    <table style={{ width: "100%", fontSize: 11 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left" }}>Producto</th>
                          <th style={{ textAlign: "right" }}>Precio</th>
                          <th style={{ textAlign: "right" }}>Desc.</th>
                          <th style={{ textAlign: "right" }}>Final</th>
                        </tr>
                      </thead>
                      <tbody>
                        {individualPrices.map((p) => (
                          <tr key={p.id}>
                            <td>{p.name}</td>
                            <td style={{ textAlign: "right" }}>{currency(p.price)}</td>
                            <td style={{ textAlign: "right", color: "var(--danger)" }}>-{currency(p.discount)}</td>
                            <td style={{ textAlign: "right" }}><strong>{currency(p.final)}</strong></td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: "2px solid var(--border)" }}>
                          <td style={{ fontWeight: 600 }}>TOTAL</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>{currency(totalPrice)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600, color: "var(--danger)" }}>
                            -{currency(individualPrices.reduce((s, p) => s + p.discount, 0))}
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 600, color: "var(--accent)" }}>
                            {currency(individualPrices.reduce((s, p) => s + p.final, 0))}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* PREVIEW PAQUETE */}
              {discountMode === "package" && packagePrice && (
                <div className="info-card" style={{ borderLeft: "3px solid var(--accent)", padding: "0.5rem" }}>
                  <div className="table-wrap">
                    <table style={{ width: "100%", fontSize: 11 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left" }}>Producto</th>
                          <th style={{ textAlign: "right" }}>Precio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedProducts.map((p) => (
                          <tr key={p.id}>
                            <td>{p.name}</td>
                            <td style={{ textAlign: "right" }}>{currency(getProductPrice(p))}</td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: "2px solid var(--border)" }}>
                          <td style={{ fontWeight: 600 }}>Subtotal</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>{currency(packagePrice.totalOriginal)}</td>
                        </tr>
                        <tr>
                          <td style={{ color: "var(--danger)" }}>Descuento</td>
                          <td style={{ textAlign: "right", color: "var(--danger)" }}>-{currency(packagePrice.discount)}</td>
                        </tr>
                        <tr style={{ background: "rgba(var(--accent-rgb), 0.08)" }}>
                          <td style={{ fontWeight: 700 }}>Precio final del paquete</td>
                          <td style={{ textAlign: "right", fontWeight: 700, color: "var(--accent)" }}>{currency(packagePrice.totalFinal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="inline-actions">
                <button
                  className="button"
                  disabled={submitting || selectedProducts.length === 0 || !form.discountType || !form.discountValue}
                  type="submit"
                >
                  {submitting
                    ? "Aplicando..."
                    : `Aplicar remate a ${selectedProducts.length} ${selectedProducts.length === 1 ? "producto" : "productos"}`}
                </button>
                <button className="button ghost" onClick={clearSelection} type="button">
                  Quitar seleccion
                </button>
              </div>
            </>
          ) : (
            <div className="info-card">
              <p className="muted" style={{ textAlign: "center", padding: "1.5rem 0" }}>
                Haz clic en un producto de la tabla o usa el buscador para seleccionarlo.
              </p>
            </div>
          )}
        </form>
      </div>

      {/* ROW 2: Remates vigentes (FULL WIDTH) */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Remates vigentes</h2>
            <p className="muted">Productos con descuento activo. Puedes editar o cancelar cada remate.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>Producto</th>
                <th>Descuento</th>
                <th>Inicio</th>
                <th>Fin</th>
                <th style={{ width: 130 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loadingActive ? (
                <tr><td className="muted" colSpan={6}>Cargando...</td></tr>
              ) : activeDiscounts.length === 0 ? (
                <tr><td className="muted" colSpan={6}>No hay remates vigentes.</td></tr>
              ) : activeDiscounts.map(renderActiveDiscountRow)}
            </tbody>
          </table>
        </div>
      </div>

      {/* EDIT MODAL */}
      {editingDiscount && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => { if (e.target === e.currentTarget) closeEditModal(); }}
        >
          <div className="modal-card" style={{ maxWidth: 480, width: "90vw" }}>
            <div className="panel-header">
              <div>
                <h3 style={{ margin: 0 }}>Editar remate</h3>
                <p className="muted" style={{ margin: 0 }}>{editingDiscount.name}</p>
              </div>
              <button className="button ghost" onClick={closeEditModal} type="button">Cerrar</button>
            </div>

            <div className="grid-form" style={{ padding: "1rem 0" }}>
              {editError && <p className="error-text">{editError}</p>}

              <label>
                Tipo de descuento
                <select
                  value={editForm.discountType}
                  onChange={(e) => setEditForm({ ...editForm, discountType: e.target.value as EditForm["discountType"] })}
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
                  value={editForm.discountValue}
                  onChange={(e) => setEditForm({ ...editForm, discountValue: e.target.value })}
                />
              </label>

              <label>
                Fecha de inicio
                <input
                  type="datetime-local"
                  step="60"
                  value={editForm.discountStart}
                  onChange={(e) => setEditForm({ ...editForm, discountStart: e.target.value })}
                />
              </label>

              <label>
                Fecha de fin (opcional)
                <input
                  type="datetime-local"
                  step="60"
                  value={editForm.discountEnd}
                  onChange={(e) => setEditForm({ ...editForm, discountEnd: e.target.value })}
                />
              </label>

              <div className="inline-actions">
                <button
                  className="button"
                  onClick={saveDiscountChanges}
                  disabled={editSubmitting}
                  type="button"
                >
                  {editSubmitting ? "Guardando..." : "Guardar cambios"}
                </button>
                <button className="button ghost" onClick={closeEditModal} type="button">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
