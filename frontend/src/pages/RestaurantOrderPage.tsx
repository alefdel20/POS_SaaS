import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Product } from "../types";
import type { RestaurantItemStatus, RestaurantOrder, RestaurantOrderItem } from "../types/restaurant";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

interface ItemBadge { label: string; bg: string; color: string }

function getItemBadge(status: RestaurantItemStatus): ItemBadge {
  switch (status) {
    case "pending":   return { label: "Pendiente",  bg: "rgba(148,163,184,0.16)", color: "#cbd5e1"             };
    case "sent":      return { label: "Enviado",    bg: "rgba(96,165,250,0.14)",  color: "#bfdbfe"             };
    case "preparing": return { label: "Preparando", bg: "rgba(255,159,67,0.16)",  color: "var(--warning-text)" };
    case "ready":     return { label: "Listo",      bg: "rgba(88,212,179,0.16)",  color: "#9ae6b4"             };
    case "served":    return { label: "Servido",    bg: "rgba(148,163,184,0.08)", color: "var(--muted)"        };
    case "cancelled": return { label: "Cancelado",  bg: "rgba(255,123,123,0.16)", color: "#ffd1d1"             };
  }
}

function canMutateOrders(role?: string | null): boolean {
  return role === "superusuario" || role === "superadmin" || role === "admin" || role === "cajero";
}

// ─── Local types ─────────────────────────────────────────────────────────────

interface QuickAdd {
  product: Product;
  quantity: number;
  notes: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RestaurantOrderPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { token, user } = useAuth();
  const navigate = useNavigate();

  const [order, setOrder] = useState<RestaurantOrder | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [quickAdd, setQuickAdd] = useState<QuickAdd | null>(null);
  const [addError, setAddError] = useState("");
  const [showPayModal, setShowPayModal] = useState(false);
  const [payMethod, setPayMethod] = useState<"cash" | "card" | "transfer">("cash");
  const [payTip, setPayTip] = useState<number>(0);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState("");
  const [cashReceived, setCashReceived] = useState<number>(0);
  const [tipMode, setTipMode] = useState<"percent" | "fixed">("percent");
  const [tipPercent, setTipPercent] = useState<number>(0);

  // ── Fetch order ──
  const loadOrder = useCallback(async () => {
    if (!token || !orderId) return;
    try {
      const data = await apiRequest<RestaurantOrder>(`/restaurant/orders/${orderId}`, { token });
      setOrder(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar la comanda");
    } finally {
      setLoading(false);
    }
  }, [token, orderId]);

  // ── Fetch products ──
  const fetchProducts = useCallback(async () => {
    if (!token) return;
    setProductsLoading(true);
    try {
      const qs = search.trim()
        ? `?search=${encodeURIComponent(search.trim())}&pageSize=15`
        : "?pageSize=15";
      const data = await apiRequest<Product[] | { items: Product[] }>(`/products${qs}`, { token });
      setProducts(Array.isArray(data) ? data : (data.items ?? []));
    } catch {
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  }, [token, search]);

  useEffect(() => { loadOrder(); }, [loadOrder]);

  useEffect(() => {
    const id = setTimeout(fetchProducts, 280);
    return () => clearTimeout(id);
  }, [fetchProducts]);

  // ── Actions ──

  async function handleAddItem() {
    if (!quickAdd || !token || !orderId) return;
    setAddError("");
    try {
      await apiRequest(`/restaurant/orders/${orderId}/items`, {
        method: "POST",
        token,
        body: JSON.stringify({
          items: [{
            product_id: quickAdd.product.id,
            product_name: quickAdd.product.name,
            product_price: quickAdd.product.price,
            quantity: quickAdd.quantity,
            ...(quickAdd.notes.trim() ? { notes: quickAdd.notes.trim() } : {})
          }]
        })
      });
      setQuickAdd(null);
      await loadOrder();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Error al agregar el producto");
    }
  }

  async function handleSendToKitchen() {
    if (!token || !orderId) return;
    setActionLoading(true);
    try {
      await apiRequest(`/restaurant/orders/${orderId}/send-to-kitchen`, {
        method: "POST",
        token,
        body: JSON.stringify({})
      });
      await loadOrder();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al enviar a cocina");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRequestBill() {
    if (!token || !orderId) return;
    setActionLoading(true);
    try {
      await apiRequest(`/restaurant/orders/${orderId}/request-bill`, {
        method: "POST", token, body: JSON.stringify({})
      });
      await loadOrder();
      setCashReceived(0); setPayTip(0); setTipPercent(0); setTipMode("percent");
      setShowPayModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al solicitar la cuenta");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCloseOrder() {
    if (!token || !orderId) return;
    setPayLoading(true);
    setPayError("");
    try {
      await apiRequest(`/restaurant/orders/${orderId}/close`, {
        method: "POST",
        token,
        body: JSON.stringify({
          payments: [{
            payment_method: payMethod,
            amount: orderTotal,
            ...(tipAmount > 0 ? { tip_amount: tipAmount } : {})
          }]
        })
      });
      navigate("/restaurant/map");
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Error al cobrar");
      setPayLoading(false);
    }
  }

  // ── Derived state ──

  const isReadOnly = order?.status === "bill_requested"
    || order?.status === "paid"
    || order?.status === "cancelled";

  const userCanMutate = !isReadOnly && canMutateOrders(user?.role);

  const pendingItems = (order?.items ?? []).filter((i: RestaurantOrderItem) => i.status === "pending");

  const orderTotal = (order?.items ?? [])
    .filter((i: RestaurantOrderItem) => i.status !== "cancelled")
    .reduce((sum: number, i: RestaurantOrderItem) => sum + i.product_price * i.quantity, 0);

  const tipAmount = tipMode === "percent"
    ? Math.round(orderTotal * tipPercent) / 100
    : payTip;
  const grandTotal = orderTotal + tipAmount;

  // ── Render guards ──

  if (loading) {
    return (
      <div className="content">
        <p className="muted">Cargando comanda...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="content page-grid">
        <p className="error-text">No se encontró la comanda.</p>
        <div className="inline-actions">
          <button className="button ghost" type="button" onClick={() => navigate("/restaurant/map")}>
            ← Volver al mapa
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="content page-grid">

      {/* ── Header ── */}
      <div className="panel-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
          <button
            className="button ghost"
            type="button"
            onClick={() => navigate("/restaurant/map")}
            style={{ padding: "0.55rem 0.9rem", flexShrink: 0 }}
            aria-label="Volver al mapa"
          >
            ←
          </button>
          <div>
            <h2 style={{ margin: 0 }}>
              {order.table_name ?? `Mesa ${order.table_id}`}
            </h2>
            <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "0.82rem" }}>
              Comanda #{order.order_number}
              {" · "}
              {order.diners_count} comensal{order.diners_count !== 1 ? "es" : ""}
              {order.zone_name ? ` · ${order.zone_name}` : ""}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {order.status === "bill_requested" && (
            <span
              className="status-badge"
              style={{ background: "rgba(255,123,123,0.16)", color: "#ffd1d1", marginTop: 0 }}
            >
              Cuenta pedida
            </span>
          )}
          {order.status === "bill_requested" && canMutateOrders(user?.role) && (
            <button
              className="button"
              type="button"
              disabled={orderTotal === 0}
              onClick={() => {
                setCashReceived(0); setPayTip(0); setTipPercent(0); setTipMode("percent");
                setShowPayModal(true);
              }}
              style={{
                background: orderTotal === 0
                  ? "var(--surface-soft)"
                  : "linear-gradient(135deg, #16a34a, #15803d)",
                color: orderTotal === 0 ? "var(--muted)" : "#fff"
              }}
            >
              Cobrar
            </button>
          )}
          {userCanMutate && order.status === "open" && (
            <button
              className="button"
              type="button"
              disabled={actionLoading}
              onClick={handleRequestBill}
              style={{
                background: "linear-gradient(135deg, var(--danger), #c0392b)",
                color: "#fff"
              }}
            >
              {actionLoading ? "..." : "Pedir cuenta"}
            </button>
          )}
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      {/* ── Two-column layout ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "1.5rem", alignItems: "start" }}>

        {/* ── LEFT — Product search ── */}
        <div className="panel page-grid">
          <div className="panel-header">
            <strong>Agregar productos</strong>
          </div>

          {isReadOnly ? (
            <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
              La comanda está cerrada — no se pueden agregar productos.
            </p>
          ) : (
            <>
              <input
                type="text"
                placeholder="Buscar producto..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ marginBottom: 0 }}
              />

              {productsLoading && (
                <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>Buscando...</p>
              )}

              {!productsLoading && products.length === 0 && (
                <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>Sin resultados.</p>
              )}

              {!productsLoading && products.length > 0 && (
                <div className="product-grid">
                  {products.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className="catalog-card"
                      onClick={() => {
                        setAddError("");
                        setQuickAdd({ product, quantity: 1, notes: "" });
                      }}
                      style={{ textAlign: "left", cursor: "pointer", display: "grid", gap: "0.35rem" }}
                    >
                      <strong style={{ fontSize: "0.88rem" }}>{product.name}</strong>
                      {product.category && (
                        <span className="muted" style={{ fontSize: "0.76rem" }}>{product.category}</span>
                      )}
                      <span style={{ fontWeight: 700, color: "var(--accent)", fontSize: "0.9rem" }}>
                        {formatCurrency(product.price)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── RIGHT — Order items ── */}
        <div className="panel page-grid">
          <div className="panel-header">
            <strong>Comanda</strong>
            {userCanMutate && pendingItems.length > 0 && (
              <button
                className="button ghost"
                type="button"
                disabled={actionLoading}
                onClick={handleSendToKitchen}
                style={{ fontSize: "0.82rem", padding: "0.5rem 0.85rem" }}
              >
                {actionLoading ? "Enviando..." : `Enviar a cocina (${pendingItems.length})`}
              </button>
            )}
          </div>

          {/* Items list */}
          {(order.items ?? []).length === 0 ? (
            <div className="empty-state-card">
              <p className="muted" style={{ margin: 0 }}>
                Sin productos. Agrega productos desde el panel izquierdo.
              </p>
            </div>
          ) : (
            <div className="stack-list">
              {(order.items ?? []).map((item: RestaurantOrderItem) => {
                const badge = getItemBadge(item.status);
                return (
                  <div
                    key={item.id}
                    style={{
                      display: "grid",
                      gap: "0.3rem",
                      padding: "0.75rem",
                      borderRadius: "14px",
                      border: "1px solid var(--border)",
                      background: "var(--surface-soft)"
                    }}
                  >
                    {/* Name + badge */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                      <span style={{ fontWeight: 600, fontSize: "0.9rem", flex: 1, minWidth: 0 }}>
                        {item.product_name}
                      </span>
                      <span
                        className="status-badge"
                        style={{ background: badge.bg, color: badge.color, marginTop: 0, flexShrink: 0 }}
                      >
                        {badge.label}
                      </span>
                    </div>

                    {/* Notes */}
                    {item.notes && (
                      <p className="muted" style={{ margin: 0, fontSize: "0.78rem" }}>
                        📝 {item.notes}
                      </p>
                    )}

                    {/* Quantity × price = subtotal */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className="muted" style={{ fontSize: "0.82rem" }}>
                        x{item.quantity} × {formatCurrency(item.product_price)}
                      </span>
                      <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>
                        {formatCurrency(item.product_price * item.quantity)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Total */}
          <div
            className="total-box"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem" }}
          >
            <span className="muted">Total</span>
            <span style={{ fontSize: "1.3rem", fontWeight: 700 }}>{formatCurrency(orderTotal)}</span>
          </div>
        </div>
      </div>

      {/* ── Quick-add modal ── */}
      {quickAdd && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>{quickAdd.product.name}</h3>
              <button
                className="button ghost"
                type="button"
                onClick={() => { setQuickAdd(null); setAddError(""); }}
                aria-label="Cerrar"
                style={{ padding: "0.5rem 0.75rem" }}
              >
                ✕
              </button>
            </div>

            <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.88rem" }}>
              {formatCurrency(quickAdd.product.price)} por unidad
            </p>

            {addError && <p className="error-text" style={{ marginTop: "0.5rem" }}>{addError}</p>}

            <div className="grid-form" style={{ marginTop: "1rem" }}>
              <label>
                Cantidad
                <div className="quantity-control">
                  <button
                    className="button ghost"
                    type="button"
                    style={{ padding: 0 }}
                    onClick={() => setQuickAdd((q) => q && q.quantity > 1 ? { ...q, quantity: q.quantity - 1 } : q)}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={quickAdd.quantity}
                    onChange={(e) => setQuickAdd((q) => q ? { ...q, quantity: Math.max(1, Number(e.target.value) || 1) } : q)}
                    style={{ width: "72px", textAlign: "center" }}
                  />
                  <button
                    className="button ghost"
                    type="button"
                    style={{ padding: 0 }}
                    onClick={() => setQuickAdd((q) => q ? { ...q, quantity: q.quantity + 1 } : q)}
                  >
                    +
                  </button>
                </div>
              </label>
              <label>
                Notas (opcional)
                <input
                  type="text"
                  placeholder="Ej: sin cebolla, extra picante..."
                  value={quickAdd.notes}
                  onChange={(e) => setQuickAdd((q) => q ? { ...q, notes: e.target.value } : q)}
                />
              </label>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "1.25rem"
              }}
            >
              <strong style={{ fontSize: "1.05rem" }}>
                {formatCurrency(quickAdd.product.price * quickAdd.quantity)}
              </strong>
              <div className="inline-actions">
                <button className="button" type="button" onClick={handleAddItem}>
                  Agregar
                </button>
                <button
                  className="button ghost"
                  type="button"
                  onClick={() => { setQuickAdd(null); setAddError(""); }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Pay modal ── */}
      {showPayModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">

            <div className="panel-header">
              <h3 style={{ margin: 0 }}>Cobrar mesa</h3>
              <button
                className="button ghost"
                type="button"
                onClick={() => { setShowPayModal(false); setPayError(""); }}
                aria-label="Cerrar"
                style={{ padding: "0.5rem 0.75rem" }}
              >✕</button>
            </div>

            <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.88rem" }}>
              {order.table_name ?? `Mesa ${order.table_id}`} · Comanda #{order.order_number}
            </p>

            {payError && <p className="error-text" style={{ marginTop: "0.5rem" }}>{payError}</p>}

            <div className="grid-form" style={{ marginTop: "1rem" }}>
              <label>
                Método de pago
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as "cash" | "card" | "transfer")}
                >
                  <option value="cash">Efectivo</option>
                  <option value="card">Tarjeta</option>
                  <option value="transfer">Transferencia</option>
                </select>
              </label>
              <label>
                Propina
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <div style={{ display: "flex", borderRadius: "10px", overflow: "hidden", border: "1px solid var(--border)", flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => { setTipMode("percent"); setPayTip(0); }}
                      style={{
                        padding: "0.45rem 0.75rem",
                        background: tipMode === "percent" ? "var(--accent)" : "transparent",
                        color: tipMode === "percent" ? "#fff" : "var(--muted)",
                        border: "none", cursor: "pointer", fontSize: "0.82rem", fontWeight: 600
                      }}
                    >%</button>
                    <button
                      type="button"
                      onClick={() => { setTipMode("fixed"); setTipPercent(0); }}
                      style={{
                        padding: "0.45rem 0.75rem",
                        background: tipMode === "fixed" ? "var(--accent)" : "transparent",
                        color: tipMode === "fixed" ? "#fff" : "var(--muted)",
                        border: "none", cursor: "pointer", fontSize: "0.82rem", fontWeight: 600
                      }}
                    >$</button>
                  </div>
                  {tipMode === "percent" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flex: 1 }}>
                      {[10, 15, 20].map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setTipPercent(tipPercent === p ? 0 : p)}
                          style={{
                            padding: "0.45rem 0.6rem", borderRadius: "8px",
                            border: "1px solid var(--border)",
                            background: tipPercent === p ? "var(--accent)" : "transparent",
                            color: tipPercent === p ? "#fff" : "var(--muted)",
                            cursor: "pointer", fontSize: "0.82rem", fontWeight: 600
                          }}
                        >{p}%</button>
                      ))}
                      <input
                        type="number"
                        min={0}
                        max={100}
                        placeholder="0"
                        value={tipPercent || ""}
                        onChange={(e) => setTipPercent(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                        style={{ width: "60px", textAlign: "center" }}
                      />
                    </div>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      placeholder="$0.00"
                      value={payTip || ""}
                      onChange={(e) => setPayTip(Math.max(0, Number(e.target.value) || 0))}
                      style={{ flex: 1 }}
                    />
                  )}
                </div>
                {tipAmount > 0 && (
                  <span className="muted" style={{ fontSize: "0.78rem", marginTop: "0.25rem" }}>
                    Propina: {formatCurrency(tipAmount)}
                  </span>
                )}
              </label>
            </div>

            {payMethod === "cash" && (
              <div className="grid-form" style={{ marginTop: "0.75rem" }}>
                <label>
                  Dinero recibido
                  <input
                    type="number"
                    min={0}
                    placeholder={`$${grandTotal.toFixed(2)}`}
                    value={cashReceived || ""}
                    onChange={(e) => setCashReceived(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
              </div>
            )}

            <div className="total-box" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "1rem" }}>
              {tipAmount > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="muted" style={{ fontSize: "0.88rem" }}>Subtotal</span>
                  <span style={{ fontSize: "0.95rem" }}>{formatCurrency(orderTotal)}</span>
                </div>
              )}
              {tipAmount > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="muted" style={{ fontSize: "0.88rem" }}>Propina</span>
                  <span style={{ fontSize: "0.95rem" }}>{formatCurrency(tipAmount)}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="muted">Total</span>
                <span style={{ fontSize: "1.3rem", fontWeight: 700 }}>{formatCurrency(grandTotal)}</span>
              </div>
              {payMethod === "cash" && cashReceived > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "0.35rem", borderTop: "1px solid var(--border)" }}>
                  <span className="muted">Cambio</span>
                  <span style={{
                    fontSize: "1.2rem", fontWeight: 700,
                    color: cashReceived >= grandTotal ? "#4ade80" : "var(--danger)"
                  }}>
                    {cashReceived >= grandTotal
                      ? formatCurrency(cashReceived - grandTotal)
                      : `Faltan ${formatCurrency(grandTotal - cashReceived)}`}
                  </span>
                </div>
              )}
            </div>

            <div className="inline-actions" style={{ marginTop: "1.25rem", justifyContent: "flex-end" }}>
              <button
                className="button"
                type="button"
                disabled={payLoading || (payMethod === "cash" && cashReceived > 0 && cashReceived < grandTotal)}
                onClick={handleCloseOrder}
                style={{ background: "linear-gradient(135deg, #16a34a, #15803d)", color: "#fff" }}
              >
                {payLoading ? "Procesando..." : `Cobrar ${formatCurrency(grandTotal)}`}
              </button>
              <button
                className="button ghost"
                type="button"
                onClick={() => { setShowPayModal(false); setPayError(""); }}
              >
                Cancelar
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
