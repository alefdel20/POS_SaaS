import { useState } from "react";

const STORAGE_KEY = "ankode_whats_new_seen_v2026-05";

function hasSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "seen";
  } catch {
    return true;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "seen");
  } catch {
    // silencioso
  }
}

const novedades = [
  { icon: "🏦", texto: "Apertura de caja con fondo inicial — Registra el fondo al inicio de cada turno" },
  { icon: "💰", texto: "Descuento sobre el total — Aplica % o monto fijo sobre el carrito completo (gerente/admin)" },
  { icon: "💳", texto: "Límite de crédito por cliente — Controla cuánto puede deber cada cliente" },
  { icon: "👁️", texto: "Saldo visible al vender — Ve la deuda del cliente directamente en la pantalla de venta" },
  { icon: "📅", texto: "Fecha de vencimiento en cartera — Sabe exactamente cuándo vence cada crédito" },
  { icon: "💬", texto: "Nuevo modal de abono — Registra abonos de forma más rápida y clara" },
];

export function WhatsNewModal() {
  const [visible, setVisible] = useState(() => !hasSeen());

  function handleClose() {
    markSeen();
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={handleClose}>
      <div
        className="modal-card"
        style={{ maxWidth: 520 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>¿Qué hay de nuevo? 🎉</h3>
        <p style={{ marginBottom: "1rem", opacity: 0.7, fontSize: "0.9rem" }}>
          Actualizaciones de Mayo 2026
        </p>
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1.5rem 0", display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          {novedades.map((n) => (
            <li key={n.icon} style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
              <span style={{ fontSize: "1.1rem", lineHeight: 1.4 }}>{n.icon}</span>
              <span style={{ lineHeight: 1.4 }}>{n.texto}</span>
            </li>
          ))}
        </ul>
        <div className="inline-actions modal-actions-end">
          <button className="button" onClick={handleClose} type="button">
            ¡Entendido!
          </button>
        </div>
      </div>
    </div>
  );
}
