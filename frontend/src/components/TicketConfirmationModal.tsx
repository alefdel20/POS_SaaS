import { useState } from "react";
import type { TicketProductRow, RestockItem } from "../types/aiChat";

interface Props {
  products: TicketProductRow[];
  onConfirm: (items: RestockItem[]) => Promise<void>;
  onCancel: () => void;
}

export function TicketConfirmationModal({ products, onConfirm, onCancel }: Props) {
  const [rows, setRows] = useState<TicketProductRow[]>(products);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");

  function updateRow(index: number, field: keyof TicketProductRow, value: string | number | null) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value } : r))
    );
  }

  function addRow() {
    setRows((prev) => [...prev, { name: "", quantity: null, unit_price: null, product_id: null }]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleConfirm() {
    const validItems: RestockItem[] = rows
      .filter((r) => r.product_id !== null && r.product_id > 0 && r.quantity !== null && r.quantity > 0)
      .map((r) => ({
        product_id: r.product_id as number,
        stock: r.quantity as number,
        reason: "Restock desde ticket de proveedor (IA)"
      }));

    if (validItems.length === 0) {
      setConfirmError("Ingresa el ID de producto y cantidad para al menos una fila.");
      return;
    }

    setConfirming(true);
    setConfirmError("");
    try {
      await onConfirm(validItems);
    } catch {
      setConfirmError("Error al registrar el restock. Intenta de nuevo.");
      setConfirming(false);
    }
  }

  const skipped = rows.filter((r) => !r.product_id || !r.quantity).length;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        style={{
          background: "var(--modal-panel)",
          border: "1px solid var(--border)",
          borderRadius: "20px",
          boxShadow: "var(--modal-shadow)",
          width: "min(700px, calc(100vw - 2rem))",
          maxHeight: "calc(100vh - 4rem)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "1rem 1.25rem 0.75rem",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: "1rem" }}>Confirmar restock desde ticket</div>
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.2rem" }}>
            Ingresa el <strong>ID del producto</strong> en tu inventario para cada fila antes de confirmar.
            Las filas sin ID o sin cantidad serán omitidas.
          </div>
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem 1.25rem" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={thStyle}>Producto (ticket)</th>
                <th style={{ ...thStyle, width: "110px" }}>ID Producto</th>
                <th style={{ ...thStyle, width: "100px" }}>Cantidad</th>
                <th style={{ ...thStyle, width: "110px" }}>Precio unit.</th>
                <th style={{ ...thStyle, width: "40px" }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={{ borderBottom: "1px solid rgba(128,128,128,0.1)" }}>
                  <td style={tdStyle}>
                    <span style={{ color: "var(--text)", fontSize: "0.83rem" }}>{row.name || "—"}</span>
                  </td>
                  <td style={tdStyle}>
                    <input
                      type="number"
                      min={1}
                      value={row.product_id ?? ""}
                      onChange={(e) =>
                        updateRow(i, "product_id", e.target.value ? Number(e.target.value) : null)
                      }
                      placeholder="ID"
                      style={inputStyle}
                    />
                  </td>
                  <td style={tdStyle}>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.quantity ?? ""}
                      onChange={(e) =>
                        updateRow(i, "quantity", e.target.value ? Number(e.target.value) : null)
                      }
                      placeholder="0"
                      style={inputStyle}
                    />
                  </td>
                  <td style={tdStyle}>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.unit_price ?? ""}
                      onChange={(e) =>
                        updateRow(i, "unit_price", e.target.value ? Number(e.target.value) : null)
                      }
                      placeholder="0.00"
                      style={{ ...inputStyle, color: "var(--muted)" }}
                    />
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <button
                      onClick={() => removeRow(i)}
                      style={iconBtnStyle}
                      title="Eliminar fila"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button onClick={addRow} style={addRowBtnStyle}>
            + Agregar fila
          </button>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "0.75rem 1.25rem 1rem",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          {confirmError && (
            <div
              style={{
                marginBottom: "0.6rem",
                padding: "0.4rem 0.75rem",
                borderRadius: "8px",
                background: "rgba(255,123,123,0.12)",
                border: "1px solid rgba(255,123,123,0.25)",
                color: "#ffd1d1",
                fontSize: "0.8rem",
              }}
            >
              {confirmError}
            </div>
          )}

          {skipped > 0 && !confirmError && (
            <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginBottom: "0.6rem" }}>
              {skipped} fila(s) sin ID o cantidad serán omitidas.
            </div>
          )}

          <div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end" }}>
            <button onClick={onCancel} disabled={confirming} style={cancelBtnStyle}>
              Cancelar
            </button>
            <button onClick={handleConfirm} disabled={confirming} style={confirmBtnStyle}>
              {confirming ? "Registrando..." : "Confirmar y agregar al inventario"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "0.4rem 0.5rem",
  textAlign: "left",
  fontWeight: 600,
  color: "var(--muted)",
  fontSize: "0.78rem",
};

const tdStyle: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  verticalAlign: "middle",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.3rem 0.5rem",
  borderRadius: "8px",
  border: "1px solid var(--border)",
  background: "var(--field-bg)",
  color: "var(--text)",
  fontSize: "0.83rem",
};

const iconBtnStyle: React.CSSProperties = {
  width: "24px",
  height: "24px",
  borderRadius: "6px",
  border: "1px solid rgba(255,123,123,0.3)",
  background: "transparent",
  color: "#ffa0a0",
  cursor: "pointer",
  fontSize: "0.7rem",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};

const addRowBtnStyle: React.CSSProperties = {
  marginTop: "0.6rem",
  padding: "0.35rem 0.85rem",
  borderRadius: "8px",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: "0.8rem",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  borderRadius: "10px",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: "0.85rem",
};

const confirmBtnStyle: React.CSSProperties = {
  padding: "0.5rem 1.25rem",
  borderRadius: "10px",
  border: "none",
  background: "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 42%, #2f82ff))",
  color: "var(--accent-contrast)",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "0.85rem",
};
