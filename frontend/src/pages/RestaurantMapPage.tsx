import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { RestaurantTable, RestaurantTableStatus, RestaurantZoneWithTables } from "../types/restaurant";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function elapsedMinutes(openedAt: string): number {
  const utc = openedAt.endsWith("Z") ? openedAt : openedAt + "Z";
  return Math.floor((Date.now() - new Date(utc).getTime()) / 60_000);
}

function heatBorderColor(minutes: number): string {
  if (minutes < 15) return "var(--accent)";
  if (minutes < 30) return "var(--accent-2)";
  return "var(--danger)";
}

function formatElapsed(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
}

function getStatusConfig(status: RestaurantTableStatus): { label: string; color: string } {
  switch (status) {
    case "available":      return { label: "Libre",         color: "var(--accent)"   };
    case "occupied":       return { label: "Ocupada",       color: "var(--accent-2)" };
    case "bill_requested": return { label: "Cuenta pedida", color: "var(--danger)"   };
    case "reserved":       return { label: "Reservada",     color: "var(--muted)"    };
    case "cleaning":       return { label: "Limpiando",     color: "var(--muted)"    };
  }
}

function canOpenOrders(role?: string | null): boolean {
  return role === "superusuario" || role === "superadmin" || role === "admin" || role === "cajero";
}

// ─── Component ───────────────────────────────────────────────────────────────

interface OpenOrderModal {
  table: RestaurantTable;
  diners: string;
  notes: string;
  saving: boolean;
  error: string;
}

export function RestaurantMapPage() {
  const { user, token } = useAuth();
  const navigate = useNavigate();

  const [zones, setZones] = useState<RestaurantZoneWithTables[]>([]);
  const [activeZoneId, setActiveZoneId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<OpenOrderModal | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMap = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiRequest<RestaurantZoneWithTables[]>("/restaurant/tables/map", { token });
      setZones(data);
      setActiveZoneId((prev) => prev ?? (data[0]?.id ?? null));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar el mapa de mesas");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchMap();
    intervalRef.current = setInterval(fetchMap, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchMap]);

  function handleTableClick(table: RestaurantTable) {
    if (table.status === "available") {
      if (!canOpenOrders(user?.role)) return;
      setModal({ table, diners: "1", notes: "", saving: false, error: "" });
    } else if (table.current_order_id) {
      navigate(`/restaurant/orders/${table.current_order_id}`);
    }
  }

  async function handleOpenOrder() {
    if (!modal || !token) return;
    setModal((m) => m ? { ...m, saving: true, error: "" } : m);
    try {
      const order = await apiRequest<{ id: number }>(`/restaurant/tables/${modal.table.id}/orders`, {
        method: "POST",
        token,
        body: JSON.stringify({
          diners_count: Math.max(1, Number(modal.diners) || 1),
          ...(modal.notes.trim() ? { notes: modal.notes.trim() } : {})
        })
      });
      setModal(null);
      navigate(`/restaurant/orders/${order.id}`);
    } catch (err) {
      setModal((m) => m ? { ...m, saving: false, error: err instanceof Error ? err.message : "Error al abrir la mesa" } : m);
    }
  }

  const activeZone = zones.find((z) => z.id === activeZoneId);
  const userCanOpen = canOpenOrders(user?.role);

  if (loading) {
    return (
      <div className="content">
        <p className="muted">Cargando mapa de mesas...</p>
      </div>
    );
  }

  return (
    <div className="content page-grid">

      {/* ── Header ── */}
      <div className="panel-header">
        <div>
          <h2 style={{ margin: 0 }}>Mapa de Mesas</h2>
          {user?.business_name && (
            <p className="muted" style={{ margin: "0.2rem 0 0" }}>{user.business_name}</p>
          )}
        </div>
        <button className="button ghost" type="button" onClick={fetchMap}>
          ↺ Actualizar
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      {/* ── Empty state ── */}
      {zones.length === 0 && !error && (
        <div className="empty-state-card">
          <strong>Sin zonas configuradas</strong>
          <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
            Configura las zonas y mesas desde el panel de administración.
          </p>
        </div>
      )}

      {zones.length > 0 && (
        <>
          {/* ── Zone tabs ── */}
          <div className="tab-row">
            {zones.map((zone) => (
              <button
                key={zone.id}
                type="button"
                className={`button ghost${activeZoneId === zone.id ? " active-filter" : ""}`}
                onClick={() => setActiveZoneId(zone.id)}
              >
                {zone.name}
                <span className="muted" style={{ marginLeft: "0.4rem", fontSize: "0.8rem" }}>
                  ({zone.table_count})
                </span>
              </button>
            ))}
          </div>

          {/* ── Table grid ── */}
          {!activeZone || activeZone.tables.length === 0 ? (
            <div className="empty-state-card">
              <p className="muted" style={{ margin: 0 }}>No hay mesas activas en esta zona.</p>
            </div>
          ) : (
            <div className="product-grid">
              {activeZone.tables.map((table) => {
                const isActive = table.status === "occupied" || table.status === "bill_requested";
                const elapsed = isActive && table.current_order_opened_at
                  ? elapsedMinutes(table.current_order_opened_at)
                  : 0;
                const borderColor = isActive && table.current_order_opened_at
                  ? heatBorderColor(elapsed)
                  : "var(--border)";
                const { label, color } = getStatusConfig(table.status);
                const isClickable = (table.status === "available" && userCanOpen)
                  || (isActive && Boolean(table.current_order_id));

                return (
                  <button
                    key={table.id}
                    type="button"
                    className="catalog-card"
                    onClick={() => handleTableClick(table)}
                    style={{
                      border: `2px solid ${borderColor}`,
                      cursor: isClickable ? "pointer" : "default",
                      textAlign: "left",
                      gap: "0.45rem",
                      display: "grid"
                    }}
                  >
                    {/* Name + status badge */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                      <strong style={{ fontSize: "1rem" }}>{table.name}</strong>
                      <span
                        className="status-badge"
                        style={{ background: `color-mix(in srgb, ${color} 20%, transparent)`, color, marginTop: 0, flexShrink: 0 }}
                      >
                        {label}
                      </span>
                    </div>

                    {/* Capacity */}
                    <span className="muted" style={{ fontSize: "0.82rem" }}>
                      👥 {table.capacity} personas
                    </span>

                    {/* Occupied info */}
                    {isActive && table.current_order_opened_at && (
                      <>
                        <span style={{ fontSize: "0.88rem", color: borderColor, fontWeight: 600 }}>
                          ⏱ {formatElapsed(elapsed)}
                        </span>
                        {table.current_order_total != null && (
                          <span style={{ fontSize: "0.95rem", fontWeight: 700 }}>
                            {formatCurrency(table.current_order_total)}
                          </span>
                        )}
                        {table.current_order_number && (
                          <span className="muted" style={{ fontSize: "0.73rem" }}>
                            #{table.current_order_number}
                          </span>
                        )}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Open order modal ── */}
      {modal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="panel-header">
              <h3 style={{ margin: 0 }}>Abrir mesa — {modal.table.name}</h3>
              <button
                className="button ghost"
                type="button"
                onClick={() => setModal(null)}
                aria-label="Cerrar"
                style={{ padding: "0.5rem 0.75rem" }}
              >
                ✕
              </button>
            </div>

            {modal.error && <p className="error-text" style={{ marginTop: "0.75rem" }}>{modal.error}</p>}

            <div className="grid-form" style={{ marginTop: "1rem" }}>
              <label>
                Número de comensales
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={modal.diners}
                  onChange={(e) => setModal((m) => m ? { ...m, diners: e.target.value } : m)}
                />
              </label>
              <label>
                Notas (opcional)
                <input
                  type="text"
                  placeholder="Ej: sin gluten, alergia a nuez..."
                  value={modal.notes}
                  onChange={(e) => setModal((m) => m ? { ...m, notes: e.target.value } : m)}
                />
              </label>
            </div>

            <div className="inline-actions" style={{ marginTop: "1.25rem" }}>
              <button
                className="button"
                type="button"
                disabled={modal.saving}
                onClick={handleOpenOrder}
              >
                {modal.saving ? "Abriendo..." : "Abrir comanda"}
              </button>
              <button className="button ghost" type="button" onClick={() => setModal(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
