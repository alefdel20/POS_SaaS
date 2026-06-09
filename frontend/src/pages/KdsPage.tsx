import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";

interface KdsModifier {
  name: string;
  price_delta: number;
}

interface KdsItem {
  id: number;
  order_id: number;
  product_name: string;
  quantity: number;
  notes?: string | null;
  status: "sent" | "preparing" | "prepared";
  sent_to_kitchen_at?: string | null;
  table_name: string;
  table_id: number;
  modifiers?: KdsModifier[];
}

interface KdsTable {
  id: number;
  name: string;
  status: string;
  zone_id: number;
  capacity?: number;
}

const API_URL =
  (import.meta as any).env.VITE_API_BASE_URL ||
  "http://pos-apis-chatbots-backen-kv6lbk-0befdc-31-97-214-24.traefik.me/api";

function groupByTable(items: KdsItem[]) {
  const map = new Map<number, { tableId: number; tableName: string; tableItems: KdsItem[] }>();
  for (const item of items) {
    if (!map.has(item.table_id)) {
      map.set(item.table_id, { tableId: item.table_id, tableName: item.table_name, tableItems: [] });
    }
    map.get(item.table_id)!.tableItems.push(item);
  }
  return Array.from(map.values());
}

export function KdsPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<KdsItem[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  function handleSSEEvent(event: { type: string; [key: string]: unknown }) {
    switch (event.type) {
      case "init": {
        const pending = (event.pendingItems as KdsItem[]) || [];
        setItems(pending);
        break;
      }
      case "items_sent": {
        const newItems = (event.items as KdsItem[]).map((i) => ({
          ...i,
          table_name: event.tableName as string,
          table_id: event.tableId as number,
        }));
        setItems((prev) => {
          const ids = new Set(prev.map((x) => x.id));
          return [...prev, ...newItems.filter((i) => !ids.has(i.id))];
        });
        break;
      }
      case "item_updated": {
        const itemId = event.itemId as number;
        const status = event.status as string;
        if (status === "prepared" || status === "ready" || status === "served") {
          setItems((prev) => prev.filter((i) => i.id !== itemId));
        } else {
          setItems((prev) =>
            prev.map((i) =>
              i.id === itemId ? { ...i, status: status as KdsItem["status"] } : i
            )
          );
        }
        break;
      }
      case "order_closed": {
        const orderId = event.orderId as number;
        setItems((prev) => prev.filter((i) => i.order_id !== orderId));
        break;
      }
    }
  }

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    abortRef.current = controller;

    async function connect() {
      try {
        const response = await fetch(`${API_URL}/restaurant/sse`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          setError("No se pudo conectar con la cocina.");
          return;
        }

        setConnected(true);
        setError("");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const parsed = JSON.parse(line.slice(6).trim());
              handleSSEEvent(parsed);
            } catch (_) {}
          }
        }
      } catch (err: unknown) {
        if ((err as Error).name !== "AbortError") {
          setConnected(false);
          setError("Conexión perdida. Reconectando...");
          setTimeout(connect, 3000);
        }
      }
    }

    connect();
    return () => {
      controller.abort();
      setConnected(false);
    };
  }, [token]);

  async function markPrepared(itemId: number) {
    try {
      await fetch(`${API_URL}/restaurant/kds/items/${itemId}/prepared`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
    } catch (err) {
      console.error("[KDS] Error marking item prepared:", err);
    }
  }

  return (
    <div style={{ padding: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
        <h1 className="page-title" style={{ margin: 0 }}>Pantalla de Cocina</h1>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            fontSize: "0.8rem",
            padding: "0.25rem 0.75rem",
            borderRadius: "9999px",
            background: connected ? "rgba(74,222,128,0.15)" : "rgba(239,68,68,0.15)",
            color: connected ? "#4ade80" : "#ef4444",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: connected ? "#4ade80" : "#ef4444",
              animation: connected ? "kds-pulse 2s infinite" : "none",
            }}
          />
          {connected ? "En vivo" : "Desconectado"}
        </span>
      </div>

      {error && <p style={{ color: "#ef4444", marginBottom: "1rem" }}>{error}</p>}

      {items.length === 0 ? (
        <div className="panel" style={{ textAlign: "center", padding: "3rem" }}>
          <p style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>👨‍🍳</p>
          <p className="muted">No hay pedidos pendientes en cocina.</p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "1rem",
          }}
        >
          {groupByTable(items).map(({ tableId, tableName, tableItems }) => (
            <div key={tableId} className="panel" style={{ borderTop: "3px solid #7c3aed" }}>
              <div
                className="panel-header"
                style={{ marginBottom: "0.75rem" }}
              >
                <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{tableName}</h2>
                <span className="muted" style={{ fontSize: "0.8rem" }}>
                  {tableItems.length} {tableItems.length === 1 ? "platillo" : "platillos"}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                {tableItems.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      padding: "0.6rem 0.75rem",
                      background:
                        item.status === "preparing"
                          ? "rgba(124,58,237,0.08)"
                          : "var(--surface-2, #1e293b)",
                      borderRadius: "6px",
                      borderLeft: `3px solid ${item.status === "preparing" ? "#7c3aed" : "#334155"}`,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                        {item.quantity}× {item.product_name}
                      </div>
                      {item.modifiers && item.modifiers.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.25rem" }}>
                          {item.modifiers.map((m, i) => (
                            <span
                              key={i}
                              style={{
                                fontSize: "0.78rem",
                                background: "rgba(251,191,36,0.15)",
                                color: "#fbbf24",
                                borderRadius: "6px",
                                padding: "0.15rem 0.45rem",
                                border: "1px solid rgba(251,191,36,0.3)"
                              }}
                            >
                              {m.name}{Number(m.price_delta) > 0 ? ` +$${Number(m.price_delta).toFixed(2)}` : ""}
                            </span>
                          ))}
                        </div>
                      )}
                      {item.notes && (
                        <div
                          style={{ fontSize: "0.8rem", color: "#f59e0b", marginTop: "0.2rem" }}
                        >
                          📝 {item.notes}
                        </div>
                      )}
                      <div
                        style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.2rem" }}
                      >
                        {item.status === "preparing" ? "🔥 Preparando" : "⏳ Pendiente"}
                      </div>
                    </div>
                    <button
                      className="button"
                      onClick={() => markPrepared(item.id)}
                      style={{
                        marginLeft: "0.5rem",
                        padding: "0.4rem 0.75rem",
                        fontSize: "0.8rem",
                        background: "#4ade80",
                        color: "#0f172a",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      ✓ Listo
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes kds-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
