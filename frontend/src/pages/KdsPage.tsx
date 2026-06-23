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

import { API_BASE_URL } from "../api/config";

const API_URL = API_BASE_URL;

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
    <div>
      <div className="kds-header">
        <h1 className="page-title">Pantalla de Cocina</h1>
        <span className={`kds-connection-badge ${connected ? "connected" : "disconnected"}`}>
          <span className="kds-connection-dot" />
          {connected ? "En vivo" : "Desconectado"}
        </span>
      </div>

      {error && <p className="kds-error">{error}</p>}

      {items.length === 0 ? (
        <div className="panel kds-empty">
          <p className="kds-empty-icon">👨‍🍳</p>
          <p className="muted">No hay pedidos pendientes en cocina.</p>
        </div>
      ) : (
        <div className="kds-tables-grid">
          {groupByTable(items).map(({ tableId, tableName, tableItems }) => (
            <div key={tableId} className="panel kds-table-card">
              <div className="panel-header kds-table-header">
                <h2 className="kds-table-name">{tableName}</h2>
                <span className="muted kds-table-count">
                  {tableItems.length} {tableItems.length === 1 ? "platillo" : "platillos"}
                </span>
              </div>
              <div className="kds-items-list">
                {tableItems.map((item) => (
                  <div
                    key={item.id}
                    className={`kds-item-row ${item.status === "preparing" ? "preparing" : "pending"}`}
                  >
                    <div className="kds-item-content">
                      <div className="kds-item-name">
                        {item.quantity}× {item.product_name}
                      </div>
                      {item.modifiers && item.modifiers.length > 0 && (
                        <div className="kds-modifiers">
                          {item.modifiers.map((m, i) => (
                            <span key={i} className="kds-modifier-badge">
                              {m.name}{Number(m.price_delta) > 0 ? ` +$${Number(m.price_delta).toFixed(2)}` : ""}
                            </span>
                          ))}
                        </div>
                      )}
                      {item.notes && (
                        <div className="kds-note">
                          📝 {item.notes}
                        </div>
                      )}
                      <div className="kds-status">
                        {item.status === "preparing" ? "🔥 Preparando" : "⏳ Pendiente"}
                      </div>
                    </div>
                    <button
                      className="kds-ready-button"
                      onClick={() => markPrepared(item.id)}
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
    </div>
  );
}
