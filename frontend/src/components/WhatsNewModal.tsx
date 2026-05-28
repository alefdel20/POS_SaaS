import { useState } from "react";

const STORAGE_KEY = "ankode_whats_new_seen";

interface Novedad {
  id: string;
  icon: string;
  title: string;
  description: string;
}

// ─────────────────────────────────────────────────────────────────────────
// AGREGAR NOVEDADES AQUÍ — solo añade un objeto con id único nuevo.
// El modal aparece automáticamente para usuarios que no hayan visto ese id.
// NUNCA borres ids viejos — solo agrega al final.
// ─────────────────────────────────────────────────────────────────────────
const novedades: Novedad[] = [
  {
    id: "upd-001",
    icon: "🤖",
    title: "Asistente IA disponible",
    description: "Ahora puedes hacer preguntas sobre tu inventario, ventas y clientes directamente desde el POS."
  },
  {
    id: "upd-002",
    icon: "🏷️",
    title: "Impresión de códigos de barras",
    description: "Imprime etiquetas con código de barras escaneables directamente desde la lista de productos."
  },
  {
    id: "upd-003",
    icon: "📊",
    title: "Exportar catálogo de productos",
    description: "Exporta tu inventario en Excel o PDF. Selecciona productos individuales o exporta todo con tus filtros activos."
  },
  {
    id: "upd-004",
    icon: "📦",
    title: "Catálogo prediseñado al registrarse",
    description: "Los nuevos negocios reciben automáticamente un catálogo de productos inicial según su tipo de negocio."
  },
  {
    id: "upd-005",
    icon: "📋",
    title: "Historial de créditos mejorado",
    description: "Consulta el historial completo de abonos y vencimientos por cliente desde el panel de deudores."
  },
  {
    id: "upd-006",
    icon: "🏪",
    title: "Soporte multi-sucursal",
    description: "Administra varias sucursales desde una sola cuenta con roles y permisos independientes por ubicación."
  }
];

function getSeenIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSeenIds(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // localStorage no disponible — falla silenciosamente
  }
}

export function WhatsNewModal() {
  const [itemsToShow] = useState<Novedad[]>(() =>
    novedades.filter((n) => !getSeenIds().includes(n.id))
  );
  const [visible, setVisible] = useState(() => itemsToShow.length > 0);

  if (!visible || itemsToShow.length === 0) return null;

  function handleConfirm() {
    const seenIds = getSeenIds();
    const newIds = itemsToShow.map((n) => n.id).filter((id) => !seenIds.includes(id));
    saveSeenIds([...seenIds, ...newIds]);
    setVisible(false);
  }

  return (
    <div className="modal-backdrop" style={{ zIndex: 9999 }}>
      <div
        className="modal-card"
        style={{ maxWidth: "480px", maxHeight: "80vh", overflowY: "auto" }}
      >
        <div style={{ textAlign: "center", paddingBottom: "8px" }}>
          <span style={{ fontSize: "28px" }}>✨</span>
          <h2 style={{ margin: "8px 0 4px", fontSize: "18px" }}>¿Qué hay de nuevo?</h2>
          <p style={{ fontSize: "13px", color: "var(--color-text-muted, #888)", margin: 0 }}>
            {itemsToShow.length === 1
              ? "Hay 1 novedad desde tu última visita"
              : `Hay ${itemsToShow.length} novedades desde tu última visita`}
          </p>
        </div>

        <hr style={{ margin: "12px 0", borderColor: "var(--color-border, #333)" }} />

        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
          {itemsToShow.map((item) => (
            <li
              key={item.id}
              style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}
            >
              <span style={{ fontSize: "22px", lineHeight: 1, flexShrink: 0 }}>{item.icon}</span>
              <div>
                <p style={{ margin: "0 0 2px", fontWeight: 600, fontSize: "14px" }}>{item.title}</p>
                <p style={{ margin: 0, fontSize: "13px", color: "var(--color-text-muted, #aaa)", lineHeight: 1.4 }}>
                  {item.description}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <div style={{ textAlign: "center", paddingTop: "20px" }}>
          <button
            className="button"
            type="button"
            onClick={handleConfirm}
            style={{ minWidth: "140px" }}
          >
            ¡Entendido!
          </button>
        </div>
      </div>
    </div>
  );
}
