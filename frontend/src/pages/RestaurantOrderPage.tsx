import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Product } from "../types";
import type {
  RestaurantItemStatus,
  RestaurantModifierGroup,
  RestaurantModifierOption,
  RestaurantOrder,
  RestaurantOrderItem,
  RestaurantOrderItemModifier,
} from "../types/restaurant";
import { useCfdiAddon } from "../hooks/useCfdiAddon";
import NumericKeypad from "../components/NumericKeypad";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

interface ItemBadge { label: string; className: string }

function getItemBadge(status: RestaurantItemStatus): ItemBadge {
  switch (status) {
    case "pending":   return { label: "Pendiente",  className: "badge-pending"   };
    case "sent":      return { label: "Enviado",    className: "badge-sent"      };
    case "preparing": return { label: "Preparando", className: "badge-preparing" };
    case "ready":     return { label: "Listo",      className: "badge-ready"     };
    case "served":    return { label: "Servido",    className: "badge-served"    };
    case "cancelled": return { label: "Cancelado",  className: "badge-cancelled" };
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

type SplitMode = "equal" | "byItem";

interface SplitPart {
  id: number;
  method: "cash" | "card" | "transfer";
  amount: number;
  itemIds: number[];
  paid: boolean;
  cashReceived: string;
  tipMode: "percent" | "fixed";
  tipInput: string;
  tipAmount: number;
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
  const [modifierModal, setModifierModal] = useState<{
    product: Product | null;
    groups: RestaurantModifierGroup[];
    selected: Record<number, RestaurantModifierOption[]>;
  }>({ product: null, groups: [], selected: {} });
  const [modifierLoading, setModifierLoading] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [payMethod, setPayMethod] = useState<"cash" | "card" | "transfer">("cash");
  const [payTip, setPayTip] = useState<number>(0);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [showNumpad, setShowNumpad] = useState(false);
  const [tipMode, setTipMode] = useState<"percent" | "fixed">("percent");
  const [tipPercent, setTipPercent] = useState<number>(0);
  const [tipInputValue, setTipInputValue] = useState("");
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitMode, setSplitMode] = useState<SplitMode>("equal");
  const [splitParts, setSplitParts] = useState<SplitPart[]>([]);
  const [splitDiners, setSplitDiners] = useState(2);
  const [splitLoading, setSplitLoading] = useState(false);
  const [splitError, setSplitError] = useState("");
  const [splitStep, setSplitStep] = useState<"config" | "pay">("config");
  const [splitNumpadOpen, setSplitNumpadOpen] = useState<number | null>(null);
  const { cfdiAddonActive } = useCfdiAddon();
  const [saleType, setSaleType] = useState<"ticket" | "invoice">("ticket");
  const [invoiceData, setInvoiceData] = useState({
    client_rfc: "",
    client_name: "",
    client_email: "",
    client_tax_regime: "616",
    cfdi_use: "G03",
  });
  const [invoiceClients, setInvoiceClients] = useState<Array<{ id: number; name: string; phone: string | null; email: string | null; tax_id: string | null }>>([]);
  const [invoiceClientMode, setInvoiceClientMode] = useState<"select" | "manual">("manual");

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
    if (token) {
      apiRequest<Array<{ id: number; name: string; phone: string | null; email: string | null; tax_id: string | null }>>("/catalog-clients", { token })
        .then(setInvoiceClients)
        .catch(() => setInvoiceClients([]));
    }
  }, [token]);

  useEffect(() => {
    const id = setTimeout(fetchProducts, 280);
    return () => clearTimeout(id);
  }, [fetchProducts]);

  // ── Actions ──

  async function addItemToOrder(
    product: Product,
    quantity: number,
    notes: string,
    modifiers: RestaurantModifierOption[]
  ) {
    if (!token || !orderId) return;
    await apiRequest(`/restaurant/orders/${orderId}/items`, {
      method: "POST",
      token,
      body: JSON.stringify({
        items: [{
          product_id: product.id,
          product_name: product.name,
          product_price: product.price,
          quantity,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          modifiers: modifiers.map(m => ({ id: m.id, name: m.name, price_delta: m.price_delta }))
        }]
      })
    });
    await loadOrder();
  }

  async function handleAddItem() {
    if (!quickAdd || !token || !orderId) return;
    setAddError("");
    try {
      await addItemToOrder(quickAdd.product, quickAdd.quantity, quickAdd.notes, []);
      setQuickAdd(null);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Error al agregar el producto");
    }
  }

  async function handleProductClick(product: Product) {
    if (!token) return;
    setModifierLoading(true);
    try {
      const groups = await apiRequest<RestaurantModifierGroup[]>(
        `/restaurant/products/${product.id}/modifiers`,
        { token }
      );
      if (groups.length === 0) {
        setAddError("");
        setQuickAdd({ product, quantity: 1, notes: "" });
      } else {
        setModifierModal({ product, groups, selected: {} });
      }
    } catch {
      setAddError("");
      setQuickAdd({ product, quantity: 1, notes: "" });
    } finally {
      setModifierLoading(false);
    }
  }

  async function handleModifierConfirm() {
    if (!modifierModal.product) return;

    const missing = modifierModal.groups.filter(
      (g) => g.required && !(modifierModal.selected[g.group_id]?.length > 0)
    );
    if (missing.length > 0) {
      setError(`Elige una opción en: ${missing.map((g) => g.group_name).join(", ")}`);
      return;
    }

    const modifiers = Object.values(modifierModal.selected).flat();
    setAddError("");
    try {
      await addItemToOrder(modifierModal.product, 1, "", modifiers);
      setModifierModal({ product: null, groups: [], selected: {} });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al agregar el producto");
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
    if (!order?.items || order.items.length === 0) {
      setError("Debes agregar al menos 1 producto para pedir la cuenta");
      return;
    }
    setActionLoading(true);
    try {
      await apiRequest(`/restaurant/orders/${orderId}/request-bill`, {
        method: "POST", token, body: JSON.stringify({})
      });
      await loadOrder();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al solicitar la cuenta");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancelOrder() {
    if (!token || !orderId) return;
    if (!window.confirm("¿Estás seguro de que deseas cancelar esta orden?")) return;
    setActionLoading(true);
    try {
      await apiRequest(`/restaurant/orders/${orderId}`, { method: "DELETE", token });
      navigate("/restaurant/map");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cancelar la orden");
      setActionLoading(false);
    }
  }

  async function handleCloseOrder() {
    if (!token || !orderId) return;
    if (grandTotal <= 0) {
      setPayError("No se puede cobrar $0.00. Agrega productos o cancela la orden.");
      return;
    }
    if (payMethod === "cash" && (!cashReceived || Number(cashReceived) <= 0)) {
      setPayError("Ingresa el dinero recibido antes de cobrar.");
      return;
    }
    setPayLoading(true);
    setPayError("");
    try {
      const response = await apiRequest<{ sale_id?: number }>(`/restaurant/orders/${orderId}/close`, {
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
      if (cfdiAddonActive && saleType === "invoice" && response?.sale_id) {
        try {
          await apiRequest("/cfdi/invoices", {
            method: "POST",
            token,
            body: JSON.stringify({
              sale_id: response.sale_id,
              client_rfc: invoiceData.client_rfc || "XAXX010101000",
              client_name: invoiceData.client_name || "Público en General",
              client_email: invoiceData.client_email || undefined,
              client_tax_regime: invoiceData.client_tax_regime || undefined,
              cfdi_use: invoiceData.cfdi_use || "G03",
              payment_form: payMethod === "cash" ? "01" : payMethod === "card" ? "04" : "03",
              total: orderTotal,
              items: (order?.items ?? [])
                .filter((item: RestaurantOrderItem) => item.status !== "cancelled")
                .map((item: RestaurantOrderItem) => ({
                  description: item.product_name,
                  product_key: "01010101",
                  unit_key: "H87",
                  unit_price: item.product_price,
                  quantity: item.quantity,
                })),
            }),
          });
        } catch {
          // Timbrado no bloquea el cobro
        }
      }
      navigate("/restaurant/map");
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Error al cobrar");
      setPayLoading(false);
    }
  }

  function initSplitParts() {
    if (splitMode === "equal") {
      const amountPerPerson = grandTotal / splitDiners;
      setSplitParts(
        Array.from({ length: splitDiners }, (_, i) => ({
          id: i + 1,
          method: "cash" as const,
          amount: parseFloat(amountPerPerson.toFixed(2)),
          itemIds: [],
          paid: false,
          cashReceived: "",
          tipMode: "percent" as const,
          tipInput: "",
          tipAmount: 0,
        }))
      );
    } else {
      setSplitParts([
        { id: 1, method: "cash", amount: 0, itemIds: [], paid: false, cashReceived: "", tipMode: "percent", tipInput: "", tipAmount: 0 },
        { id: 2, method: "cash", amount: 0, itemIds: [], paid: false, cashReceived: "", tipMode: "percent", tipInput: "", tipAmount: 0 },
      ]);
    }
    setSplitStep("pay");
  }

  function calcPartTotal(part: SplitPart): number {
    return parseFloat((part.amount + part.tipAmount).toFixed(2));
  }

  function calcPartAmount(itemIds: number[]): number {
    if (!order?.items) return 0;
    return order.items
      .filter((item) => itemIds.includes(item.id))
      .reduce((sum, item) => sum + parseFloat(String(item.product_price)) * item.quantity, 0);
  }

  function toggleItemInPart(partId: number, itemId: number) {
    setSplitParts((prev) =>
      prev.map((part) => {
        if (part.id === partId) {
          const hasItem = part.itemIds.includes(itemId);
          const newItemIds = hasItem
            ? part.itemIds.filter((id) => id !== itemId)
            : [...part.itemIds, itemId];
          return { ...part, itemIds: newItemIds, amount: calcPartAmount(newItemIds) };
        }
        const filtered = part.itemIds.filter((id) => id !== itemId);
        return { ...part, itemIds: filtered, amount: calcPartAmount(filtered) };
      })
    );
  }

  async function handlePaySplitPart(partId: number) {
    if (!token || !orderId) return;
    const part = splitParts.find((p) => p.id === partId);
    if (!part) return;

    const partTotal = calcPartTotal(part);
    if (part.method === "cash" && (!part.cashReceived || Number(part.cashReceived) < partTotal)) {
      setSplitError(`Persona ${partId}: ingresa el efectivo recibido (mínimo $${partTotal.toFixed(2)})`);
      return;
    }

    setSplitLoading(true);
    setSplitError("");
    try {
      const result = await apiRequest<{
        success: boolean;
        paid: number;
        remaining: number;
        order_closed: boolean;
      }>(`/restaurant/orders/${orderId}/split-payment`, {
        method: "POST",
        token,
        body: JSON.stringify({
          amount: part.amount,
          method: part.method,
          item_ids: part.itemIds,
          tip: part.tipAmount,
        }),
      });

      setSplitParts((prev) =>
        prev.map((p) => (p.id === partId ? { ...p, paid: true } : p))
      );

      if (result.order_closed) {
        navigate("/restaurant/map");
      }
    } catch (err) {
      setSplitError(err instanceof Error ? err.message : "Error al registrar el pago");
    } finally {
      setSplitLoading(false);
    }
  }

  function closeSplitModal() {
    setShowSplitModal(false);
    setSplitStep("config");
    setSplitParts([]);
    setSplitDiners(2);
    setSplitMode("equal");
    setSplitError("");
    setSplitNumpadOpen(null);
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
        <div className="flex-center gap-xl">
          <button
            className="button ghost btn-close shrink-0"
            type="button"
            onClick={() => navigate("/restaurant/map")}
            aria-label="Volver al mapa"
          >
            ←
          </button>
          <div>
            <h2 className="m0">
              {order.table_name ?? `Mesa ${order.table_id}`}
            </h2>
            <p className="muted m0 text-sm">
              Comanda #{order.order_number}
              {" · "}
              {order.diners_count} comensal{order.diners_count !== 1 ? "es" : ""}
              {order.zone_name ? ` · ${order.zone_name}` : ""}
            </p>
          </div>
        </div>

        <div className="flex-center gap-lg">
          {order.status === "bill_requested" && (
            <span
              className="status-badge badge-bill-requested"
            >
              Cuenta pedida
            </span>
          )}
          {order.status === "bill_requested" && canMutateOrders(user?.role) && (
            <>
              <button
                className="button btn-surface"
                type="button"
                disabled={orderTotal === 0}
                onClick={() => {
                  if (orderTotal === 0) return;
                  setSplitError("");
                  setSplitStep("config");
                  setShowSplitModal(true);
                }}
              >
                Dividir cuenta
              </button>
              <button
                className={orderTotal === 0 ? "button btn-muted" : "button btn-pay"}
                type="button"
                disabled={orderTotal === 0}
                onClick={() => {
                  if (orderTotal === 0) return;
                  setCashReceived(""); setPayTip(0); setTipPercent(0); setTipMode("percent"); setTipInputValue(""); setShowNumpad(false);
                  setShowPayModal(true);
                }}
              >
                Cobrar
              </button>
            </>
          )}
          {userCanMutate && order.status === "open" && (
            <>
              <button
                className="button btn-danger-gradient"
                type="button"
                disabled={actionLoading}
                onClick={handleRequestBill}
              >
                {actionLoading ? "..." : "Pedir cuenta"}
              </button>
              {(order.items ?? []).length === 0 && (
                <button
                  className="button ghost btn-danger-outline"
                  type="button"
                  disabled={actionLoading}
                  onClick={handleCancelOrder}
                >
                  Cancelar orden
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      {/* ── Two-column layout ── */}
      <div className="order-layout">

        {/* ── LEFT — Product search ── */}
        <div className="panel page-grid">
          <div className="panel-header">
            <strong>Agregar productos</strong>
          </div>

          {isReadOnly ? (
            <p className="muted m0 modal-subtitle">
              La comanda está cerrada — no se pueden agregar productos.
            </p>
          ) : (
            <>
              <input
                type="text"
                placeholder="Buscar producto..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="m0"
              />

              {productsLoading && (
                <p className="muted m0 text-sm">Buscando...</p>
              )}

              {!productsLoading && products.length === 0 && (
                <p className="muted m0 text-sm">Sin resultados.</p>
              )}

              {!productsLoading && products.length > 0 && (
                <div className="product-grid">
                  {products.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className="catalog-card"
                      disabled={modifierLoading}
                      onClick={() => handleProductClick(product)}
                    >
                      <strong className="modal-subtitle">{product.name}</strong>
                      {product.category && (
                        <span className="muted text-xs">{product.category}</span>
                      )}
                      <span className="product-price">
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
                className="button ghost btn-sm"
                type="button"
                disabled={actionLoading}
                onClick={handleSendToKitchen}
              >
                {actionLoading ? "Enviando..." : `Enviar a cocina (${pendingItems.length})`}
              </button>
            )}
          </div>

          {/* Items list */}
          {(order.items ?? []).length === 0 ? (
            <div className="empty-state-card">
              <p className="muted m0">
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
                    className="order-item-card"
                  >
                    {/* Name + badge */}
                    <div className="flex-between--top">
                      <span className="item-name">
                        {item.product_name}
                      </span>
                      <span
                        className={`status-badge ${badge.className} shrink-0`}
                      >
                        {badge.label}
                      </span>
                    </div>

                    {/* Modifiers */}
                    {item.modifiers && item.modifiers.length > 0 && (
                      <div className="flex-wrap-center gap-xs">
                        {item.modifiers.map((m: RestaurantOrderItemModifier, i: number) => (
                          <span
                            key={i}
                            className="status-badge badge-modifier"
                          >
                            {m.name}{Number(m.price_delta) > 0 ? ` +${formatCurrency(Number(m.price_delta))}` : ""}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Notes */}
                    {item.notes && (
                      <p className="muted m0 text-xs">
                        📝 {item.notes}
                      </p>
                    )}

                    {/* Quantity × price = subtotal */}
                    <div className="flex-between">
                      <span className="muted text-sm">
                        x{item.quantity} × {formatCurrency(item.product_price)}
                      </span>
                      <span className="text-price">
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
            className="total-box total-box--row mt-sm"
          >
            <span className="muted">Total</span>
            <span className="total-price">{formatCurrency(orderTotal)}</span>
          </div>
        </div>
      </div>

      {/* ── Quick-add modal ── */}
      {quickAdd && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="panel-header">
              <h3 className="m0">{quickAdd.product.name}</h3>
              <button
                className="button ghost btn-close"
                type="button"
                onClick={() => { setQuickAdd(null); setAddError(""); }}
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>

            <p className="muted m0 modal-subtitle mt-sm">
              {formatCurrency(quickAdd.product.price)} por unidad
            </p>

            {addError && <p className="error-text mt-sm">{addError}</p>}

            <div className="grid-form mt-lg">
              <label>
                Cantidad
                <div className="quantity-control">
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => setQuickAdd((q) => q && q.quantity > 1 ? { ...q, quantity: q.quantity - 1 } : q)}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={quickAdd.quantity}
                    onChange={(e) => setQuickAdd((q) => q ? { ...q, quantity: Math.max(1, Number(e.target.value) || 1) } : q)}
                    className="text-center"
                    style={{ width: "72px" }}
                  />
                  <button
                    className="button ghost"
                    type="button"
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

            <div className="flex-between mt-xl">
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

      {/* ── Modifier modal ── */}
      {modifierModal.product && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card modal-card--narrow">
            <div className="panel-header">
              <h3 className="m0">{modifierModal.product.name}</h3>
              <button
                className="button ghost btn-close"
                type="button"
                onClick={() => setModifierModal({ product: null, groups: [], selected: {} })}
                aria-label="Cerrar"
              >✕</button>
            </div>

            <div className="grid-stack gap-2xl">
              {modifierModal.groups.map((group) => (
                <div key={group.group_id}>
                  <p className="section-label m0">
                    {group.group_name}
                    {group.required && (
                      <span style={{ color: "var(--danger)", marginLeft: "4px" }}>*</span>
                    )}
                    <span className="muted text-xs" style={{ fontWeight: 400, marginLeft: "6px" }}>
                      {group.multi_select ? "(varios)" : "(uno)"}
                    </span>
                  </p>
                  <div className="flex-wrap-center gap-md">
                    {group.options.map((opt) => {
                      const isSelected = modifierModal.selected[group.group_id]?.some((o) => o.id === opt.id) ?? false;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          className={isSelected ? "button btn-sm" : "button ghost btn-sm"}
                          onClick={() => {
                            setModifierModal((prev) => {
                              const current = prev.selected[group.group_id] ?? [];
                              let next: RestaurantModifierOption[];
                              if (group.multi_select) {
                                next = isSelected
                                  ? current.filter((o) => o.id !== opt.id)
                                  : [...current, opt];
                              } else {
                                next = isSelected ? [] : [opt];
                              }
                              return { ...prev, selected: { ...prev.selected, [group.group_id]: next } };
                            });
                          }}
                        >
                          {opt.name}
                          {Number(opt.price_delta) > 0 && (
                            <span style={{ marginLeft: "4px", opacity: 0.8 }}>

                              +{formatCurrency(Number(opt.price_delta))}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Resumen de precio */}
            <div
              className="total-box total-box--row mt-lg"
            >
              <span className="muted">Total</span>
              <span className="total-price" style={{ fontSize: "1.15rem" }}>
                {formatCurrency(
                  Number(modifierModal.product.price) +
                  Object.values(modifierModal.selected).flat().reduce((s, o) => s + Number(o.price_delta), 0)
                )}
              </span>
            </div>

            <div className="inline-actions inline-actions--end mt-xl">
              <button className="button" type="button" onClick={handleModifierConfirm}>
                Agregar a comanda
              </button>
              <button
                className="button ghost"
                type="button"
                onClick={() => setModifierModal({ product: null, groups: [], selected: {} })}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Split modal ── */}
      {showSplitModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card modal-card--medium">

            <div className="panel-header">
              <h3 className="m0">Dividir cuenta</h3>
              <button
                className="button ghost btn-close"
                type="button"
                onClick={closeSplitModal}
              >✕</button>
            </div>

            {splitError && (
              <p className="error-text mt-md">{splitError}</p>
            )}

            {splitStep === "config" && (
              <div className="grid-stack gap-2xl">
                <div>
                  <p className="section-label">
                    ¿Cómo dividir?
                  </p>
                  <div className="flex-center gap-md">
                    <button
                      type="button"
                      className={splitMode === "equal" ? "button flex-1" : "button ghost flex-1"}
                      onClick={() => setSplitMode("equal")}
                    >
                      Por igual
                    </button>
                    <button
                      type="button"
                      className={splitMode === "byItem" ? "button flex-1" : "button ghost flex-1"}
                      onClick={() => setSplitMode("byItem")}
                    >
                      Por ítem
                    </button>
                  </div>
                </div>

                {splitMode === "equal" && (
                  <div>
                    <p className="section-label">
                      Número de personas
                    </p>
                    <div className="flex-center gap-lg">
                      <button
                        type="button"
                        className="button ghost btn-qty"
                        onClick={() => setSplitDiners((n) => Math.max(2, n - 1))}
                      >−</button>
                      <span className="quantity-display">
                        {splitDiners}
                      </span>
                      <button
                        type="button"
                        className="button ghost btn-qty"
                        onClick={() => setSplitDiners((n) => Math.min(10, n + 1))}
                      >+</button>
                    </div>
                    <p className="muted text-sm" style={{ marginTop: "0.4rem" }}>
                      ${(grandTotal / splitDiners).toFixed(2)} por persona
                    </p>
                  </div>
                )}

                <div className="total-box total-box--row">
                  <span className="muted">Total a dividir</span>
                  <span className="text-bold">{formatCurrency(grandTotal)}</span>
                </div>

                <div className="inline-actions inline-actions--end">
                  <button className="button ghost" type="button" onClick={closeSplitModal}>
                    Cancelar
                  </button>
                  <button className="button" type="button" onClick={initSplitParts}>
                    Continuar
                  </button>
                </div>
              </div>
            )}

            {splitStep === "pay" && (
              <div className="grid-stack gap-xl">

                {splitMode === "byItem" && (
                  <div className="mb-sm">
                    <p className="section-label" style={{ fontSize: "0.88rem" }}>
                      Asigna cada ítem a una persona:
                    </p>
                    {order?.items?.map((item) => {
                      const assignedTo = splitParts.find((p) => p.itemIds.includes(item.id));
                      return (
                        <div
                          key={item.id}
                          className="split-item-row"
                        >
                          <span>{item.quantity}× {item.product_name} — {formatCurrency(item.product_price * item.quantity)}</span>
                          <div className="flex-center gap-sm">
                            {splitParts.map((part) => (
                              <button
                                key={part.id}
                                type="button"
                                className={part.itemIds.includes(item.id) ? "button btn-assign" : "button ghost btn-assign"}
                                onClick={() => toggleItemInPart(part.id, item.id)}
                                disabled={part.paid}
                              >
                                P{part.id}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {splitParts.map((part) => (
                  <div
                    key={part.id}
                    className={part.paid ? "split-part split-part--paid" : "split-part"}
                  >
                    <div className="flex-between mb-sm">
                      <strong style={{ fontSize: "0.9rem" }}>
                        Persona {part.id}
                        {part.paid && <span className="paid-mark">✓ Pagado</span>}
                      </strong>
                      <span className="text-bold">
                        {formatCurrency(calcPartTotal(part))}
                        {part.tipAmount > 0 && (
                          <span className="muted" style={{ fontSize: "0.75rem", fontWeight: 400, marginLeft: "4px" }}>
                            (incl. propina)
                          </span>
                        )}
                      </span>
                    </div>

                    {!part.paid && (
                      <>
                        <select
                          value={part.method}
                          onChange={(e) =>
                            setSplitParts((prev) =>
                              prev.map((p) =>
                                p.id === part.id
                                  ? { ...p, method: e.target.value as SplitPart["method"] }
                                  : p
                              )
                            )
                          }
                          className="w-full mb-sm"
                        >
                          <option value="cash">Efectivo</option>
                          <option value="card">Tarjeta</option>
                          <option value="transfer">Transferencia</option>
                        </select>

                        {/* ── Propina ── */}
                        <div className="mb-sm">
                          <p className="muted text-sm" style={{ marginBottom: "0.3rem" }}>
                            Propina (opcional)
                          </p>
                          <div className="flex-wrap-center gap-sm">
                            <button
                              type="button"
                              className={part.tipMode === "percent" ? "button btn-xs" : "button ghost btn-xs"}
                              onClick={() =>
                                setSplitParts((prev) =>
                                  prev.map((p) =>
                                    p.id === part.id
                                      ? { ...p, tipMode: "percent", tipInput: "", tipAmount: 0 }
                                      : p
                                  )
                                )
                              }
                            >%</button>
                            <button
                              type="button"
                              className={part.tipMode === "fixed" ? "button btn-xs" : "button ghost btn-xs"}
                              onClick={() =>
                                setSplitParts((prev) =>
                                  prev.map((p) =>
                                    p.id === part.id
                                      ? { ...p, tipMode: "fixed", tipInput: "", tipAmount: 0 }
                                      : p
                                  )
                                )
                              }
                            >$</button>
                            {part.tipMode === "percent" && [10, 15, 20].map((pct) => (
                              <button
                                key={pct}
                                type="button"
                                className={part.tipInput === String(pct) ? "button btn-xs" : "button ghost btn-xs"}
                                onClick={() => {
                                  const isActive = part.tipInput === String(pct);
                                  const newInput = isActive ? "" : String(pct);
                                  const newTip = isActive ? 0 : parseFloat(((part.amount * pct) / 100).toFixed(2));
                                  setSplitParts((prev) =>
                                    prev.map((p) =>
                                      p.id === part.id
                                        ? { ...p, tipInput: newInput, tipAmount: newTip }
                                        : p
                                    )
                                  );
                                }}
                              >
                                {pct}%
                              </button>
                            ))}
                            <input
                              type="number"
                              min={0}
                              step={part.tipMode === "percent" ? "1" : "0.01"}
                              placeholder={part.tipMode === "percent" ? "7%" : "$0.00"}
                              value={part.tipInput}
                              onChange={(e) => {
                                const val = e.target.value;
                                const num = parseFloat(val) || 0;
                                const newTip =
                                  part.tipMode === "percent"
                                    ? parseFloat(((part.amount * num) / 100).toFixed(2))
                                    : parseFloat(num.toFixed(2));
                                setSplitParts((prev) =>
                                  prev.map((p) =>
                                    p.id === part.id
                                      ? { ...p, tipInput: val, tipAmount: newTip }
                                      : p
                                  )
                                );
                              }}
                              className="tip-input" style={{ width: "90px" }}
                            />
                          </div>
                          {part.tipAmount > 0 && (
                            <p className="muted text-xs m0" style={{ marginTop: "0.3rem" }}>
                              ${part.amount.toFixed(2)} + ${part.tipAmount.toFixed(2)} propina
                              {" = "}
                              <strong>${calcPartTotal(part).toFixed(2)}</strong>
                            </p>
                          )}
                        </div>

                        {part.method === "cash" && (
                          <div className="mb-sm">
                            <div className="flex-center gap-md">
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                placeholder={`Mínimo $${calcPartTotal(part).toFixed(2)}`}
                                value={part.cashReceived}
                                onChange={(e) =>
                                  setSplitParts((prev) =>
                                    prev.map((p) =>
                                      p.id === part.id ? { ...p, cashReceived: e.target.value } : p
                                    )
                                  )
                                }
                                onFocus={() => setSplitNumpadOpen(null)}
                                className="flex-1"
                              />
                              <button
                                type="button"
                                className="button ghost btn-numpad-toggle"
                                onClick={() =>
                                  setSplitNumpadOpen((prev) => (prev === part.id ? null : part.id))
                                }
                                aria-label="Teclado numérico"
                              >
                                🔢
                              </button>
                            </div>

                            {splitNumpadOpen === part.id && (
                              <NumericKeypad
                                value={part.cashReceived}
                                onChange={(v) =>
                                  setSplitParts((prev) =>
                                    prev.map((p) =>
                                      p.id === part.id ? { ...p, cashReceived: v } : p
                                    )
                                  )
                                }
                              />
                            )}
                          </div>
                        )}

                        <button
                          type="button"
                          className="button btn-pay"
                          disabled={splitLoading || part.amount <= 0}
                          onClick={() => handlePaySplitPart(part.id)}
                        >
                          {splitLoading ? "Procesando..." : `Cobrar $${calcPartTotal(part).toFixed(2)}`}
                        </button>
                      </>
                    )}
                  </div>
                ))}

                <button className="button ghost" type="button" onClick={closeSplitModal} style={{ marginTop: "0.25rem" }}>

                  Cancelar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Pay modal ── */}
      {showPayModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">

            <div className="panel-header">
              <h3 className="m0">Cobrar mesa</h3>
              <button
                className="button ghost btn-close"
                type="button"
                onClick={() => { setShowPayModal(false); setPayError(""); setTipInputValue(""); setInvoiceClientMode("manual"); }}
                aria-label="Cerrar"
              >✕</button>
            </div>

            <p className="muted m0 modal-subtitle mt-sm">
              {order.table_name ?? `Mesa ${order.table_id}`} · Comanda #{order.order_number}
            </p>

            {payError && <p className="error-text mt-sm">{payError}</p>}

            <div className="grid-form mt-lg">
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
              {cfdiAddonActive && (
                <label>
                  Tipo de salida
                  <select
                    value={saleType}
                    onChange={(e) => setSaleType(e.target.value as "ticket" | "invoice")}
                  >
                    <option value="ticket">Ticket</option>
                    <option value="invoice">Factura</option>
                  </select>
                </label>
              )}
              <label>
                Propina
                <div className="flex-wrap-center gap-md">
                  <div className="tip-toggle-group">
                    <button
                      type="button"
                      className={tipMode === "percent" ? "tip-toggle-btn tip-toggle-btn--active" : "tip-toggle-btn"}
                      onClick={() => { setTipMode("percent"); setPayTip(0); setTipInputValue(""); }}
                    >%</button>
                    <button
                      type="button"
                      className={tipMode === "fixed" ? "tip-toggle-btn tip-toggle-btn--active" : "tip-toggle-btn"}
                      onClick={() => { setTipMode("fixed"); setTipPercent(0); setTipInputValue(""); }}
                    >$</button>
                  </div>
                  {tipMode === "percent" && [10, 15, 20].map(p => (
                    <button
                      key={p}
                      type="button"
                      className={tipInputValue === String(p) ? "tip-pct-btn tip-pct-btn--active" : "tip-pct-btn"}
                      onClick={() => {
                        const isActive = tipInputValue === String(p);
                        const newVal = isActive ? "" : String(p);
                        setTipInputValue(newVal);
                        setTipPercent(isActive ? 0 : p);
                      }}
                    >{p}%</button>
                  ))}
                  <input
                    type="number"
                    min={0}
                    step={tipMode === "percent" ? "1" : "0.01"}
                    placeholder={tipMode === "percent" ? "7%" : "$0.00"}
                    value={tipInputValue}
                    onChange={(e) => {
                      const val = e.target.value;
                      const num = parseFloat(val) || 0;
                      setTipInputValue(val);
                      if (tipMode === "percent") {
                        setTipPercent(Math.max(0, num));
                      } else {
                        setPayTip(Math.max(0, num));
                      }
                    }}
                    className="tip-input"
                  />
                </div>
                {tipAmount > 0 && (
                  <span className="muted text-xs" style={{ marginTop: "0.25rem" }}>
                    Propina: {formatCurrency(tipAmount)}
                  </span>
                )}
              </label>
            </div>

            {cfdiAddonActive && saleType === "invoice" && (
              <div className="invoice-grid mt-md">
                <label>
                  Cliente
                  {invoiceClientMode === "select" ? (
                    <>
                      <select
                        value=""
                        onChange={(e) => {
                          const clientId = Number(e.target.value);
                          if (clientId === 0) {
                            setInvoiceData(p => ({ ...p, client_name: "Público en General", client_rfc: "XAXX010101000", client_email: "", client_tax_regime: "616" }));
                          } else {
                            const client = invoiceClients.find((c) => c.id === clientId);
                            if (client) {
                              setInvoiceData(p => ({ ...p, client_name: client.name, client_rfc: client.tax_id || "", client_email: client.email || "" }));
                            }
                          }
                        }}
                      >
                        <option value="">— Seleccionar cliente —</option>
                        <option value="0">Público en General</option>
                        {invoiceClients.map((client) => (
                          <option key={client.id} value={client.id}>{client.name}{client.tax_id ? ` (${client.tax_id})` : ""}</option>
                        ))}
                      </select>
                      <button className="button ghost btn-link" onClick={() => setInvoiceClientMode("manual")} type="button">Escribir manualmente</button>
                    </>
                  ) : (
                    <>
                      <input value={invoiceData.client_name} onChange={(e) => setInvoiceData(p => ({ ...p, client_name: e.target.value }))} placeholder="Nombre o razón social" />
                      <button className="button ghost btn-link" onClick={() => setInvoiceClientMode("select")} type="button">Seleccionar cliente</button>
                    </>
                  )}
                </label>
                <label>
                  RFC
                  <input
                    value={invoiceData.client_rfc}
                    onChange={(e) => setInvoiceData(p => ({ ...p, client_rfc: e.target.value }))}
                    placeholder="XAXX010101000"
                  />
                </label>
                <label>
                  Correo electrónico
                  <input
                    value={invoiceData.client_email}
                    onChange={(e) => setInvoiceData(p => ({ ...p, client_email: e.target.value }))}
                    placeholder="correo@ejemplo.com"
                  />
                </label>
                <label>
                  Uso CFDI
                  <select value={invoiceData.cfdi_use} onChange={(e) => setInvoiceData(p => ({ ...p, cfdi_use: e.target.value }))}>
                    <option value="G01">G01 — Adquisición de mercancías</option>
                    <option value="G02">G02 — Devoluciones, descuentos o bonificaciones</option>
                    <option value="G03">G03 — Gastos en general</option>
                    <option value="I01">I01 — Construcciones</option>
                    <option value="I02">I02 — Mobiliario y equipo de oficina</option>
                    <option value="I03">I03 — Equipo de transporte</option>
                    <option value="I04">I04 — Equipo de cómputo y accesorios</option>
                    <option value="I08">I08 — Otra maquinaria y equipo</option>
                    <option value="D01">D01 — Honorarios médicos, dentales y gastos hospitalarios</option>
                    <option value="D10">D10 — Pagos por servicios educativos</option>
                    <option value="S01">S01 — Sin efectos fiscales</option>
                    <option value="CP01">CP01 — Pagos</option>
                    <option value="CN01">CN01 — Nómina</option>
                  </select>
                </label>
                <label>
                  Régimen fiscal receptor
                  <select value={invoiceData.client_tax_regime} onChange={(e) => setInvoiceData(p => ({ ...p, client_tax_regime: e.target.value }))}>
                    <option value="601">601 — General de Ley Personas Morales</option>
                    <option value="603">603 — Personas Morales con Fines no Lucrativos</option>
                    <option value="605">605 — Sueldos y Salarios e Ingresos Asimilados a Salarios</option>
                    <option value="606">606 — Arrendamiento</option>
                    <option value="607">607 — Régimen de Enajenación o Adquisición de Bienes</option>
                    <option value="608">608 — Demás ingresos</option>
                    <option value="610">610 — Residentes en el Extranjero sin Establecimiento Permanente en México</option>
                    <option value="611">611 — Ingresos por Dividendos (socios y accionistas)</option>
                    <option value="612">612 — Personas Físicas con Actividades Empresariales y Profesionales</option>
                    <option value="614">614 — Ingresos por intereses</option>
                    <option value="615">615 — Régimen de los ingresos por obtención de premios</option>
                    <option value="616">616 — Sin obligaciones fiscales</option>
                    <option value="620">620 — Sociedades Cooperativas de Producción que optan por diferir sus ingresos</option>
                    <option value="621">621 — Incorporación Fiscal</option>
                    <option value="622">622 — Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras</option>
                    <option value="623">623 — Opcional para Grupos de Sociedades</option>
                    <option value="624">624 — Coordinados</option>
                    <option value="625">625 — Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas</option>
                    <option value="626">626 — Régimen Simplificado de Confianza (RESICO)</option>
                  </select>
                </label>
              </div>
            )}

            {payMethod === "cash" && (
              <div className="grid-form mt-md">
                <label>Dinero recibido</label>
                <div className="flex-center gap-md">
                  <input
                    type="number"
                    min={0}
                    placeholder={`$${grandTotal.toFixed(2)}`}
                    value={cashReceived}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "" || (/^\d*\.?\d{0,2}$/).test(val)) setCashReceived(val);
                    }}
                    className="flex-1"
                  />
                  <button
                    type="button"
                    className="button ghost btn-numpad-toggle"
                    onClick={() => setShowNumpad((v) => !v)}
                    aria-label="Teclado numérico"
                  >
                    🔢
                  </button>
                </div>
                {showNumpad && (
                  <NumericKeypad
                    value={cashReceived}
                    onChange={setCashReceived}
                  />
                )}
              </div>
            )}

            <div className="total-box total-box--col mt-lg">
              {tipAmount > 0 && (
                <div className="flex-between">
                  <span className="muted modal-subtitle">Subtotal</span>
                  <span style={{ fontSize: "0.95rem" }}>{formatCurrency(orderTotal)}</span>
                </div>
              )}
              {tipAmount > 0 && (
                <div className="flex-between">
                  <span className="muted modal-subtitle">Propina</span>
                  <span style={{ fontSize: "0.95rem" }}>{formatCurrency(tipAmount)}</span>
                </div>
              )}
              <div className="flex-between">
                <span className="muted">Total</span>
                <span className="total-price">{formatCurrency(grandTotal)}</span>
              </div>
              {payMethod === "cash" && Number(cashReceived) > 0 && (
                <div className="flex-between cambio-row">
                  <span className="muted">Cambio</span>
                  <span className={Number(cashReceived) >= grandTotal ? "cambio-amount cambio-amount--ok" : "cambio-amount cambio-amount--short"}>
                    {Number(cashReceived) >= grandTotal
                      ? formatCurrency(Number(cashReceived) - grandTotal)
                      : `Faltan ${formatCurrency(grandTotal - Number(cashReceived))}`}
                  </span>
                </div>
              )}
            </div>

            <div className="inline-actions inline-actions--end mt-xl">
              <button
                className="button btn-pay"
                type="button"
                disabled={payLoading || grandTotal === 0 || (payMethod === "cash" && Number(cashReceived) > 0 && Number(cashReceived) < grandTotal)}
                onClick={handleCloseOrder}
              >
                {payLoading ? "Procesando..." : `Cobrar ${formatCurrency(grandTotal)}`}
              </button>
              <button
                className="button ghost"
                type="button"
                onClick={() => { setShowPayModal(false); setPayError(""); setTipInputValue(""); setInvoiceClientMode("manual"); }}
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
