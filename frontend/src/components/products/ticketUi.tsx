import { type CSSProperties, type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";

// Piezas compartidas por el modal "Cargar ticket" y sus dialogos. Solo
// variables del tema: se ve igual en claro y oscuro.

export const ticketAlertStyle: CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderRadius: "10px",
  background: "color-mix(in srgb, var(--danger) 12%, transparent)",
  border: "1px solid color-mix(in srgb, var(--danger) 40%, transparent)",
  color: "var(--text)",
  fontSize: "0.82rem",
  margin: "0 0 0.75rem"
};

export const ticketWarningStyle: CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderRadius: "10px",
  background: "color-mix(in srgb, var(--warning) 14%, transparent)",
  border: "1px solid color-mix(in srgb, var(--warning) 45%, transparent)",
  color: "var(--text)",
  fontSize: "0.85rem",
  margin: "0 0 0.75rem"
};

export const ticketSuccessStyle: CSSProperties = {
  padding: "0.6rem 0.75rem",
  borderRadius: "10px",
  background: "color-mix(in srgb, var(--accent) 14%, transparent)",
  border: "1px solid color-mix(in srgb, var(--accent) 45%, transparent)",
  color: "var(--text)",
  fontSize: "0.9rem",
  fontWeight: 600,
  margin: "0 0 1rem"
};

export const ticketFieldStyle: CSSProperties = { display: "grid", gap: "0.35rem", margin: 0, fontSize: "0.85rem" };

export function ticketInvalidStyle(invalid: boolean): CSSProperties {
  return invalid ? { borderColor: "var(--danger)" } : {};
}

// Lista de dato: valor (resumenes de confirmar, resultado y anulacion).
export function TicketFacts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.35rem 0.9rem", margin: "0 0 1rem", fontSize: "0.9rem" }}>
      {items.map((item) => (
        <div key={item.label} style={{ display: "contents" }}>
          <dt className="muted">{item.label}</dt>
          <dd style={{ margin: 0, overflowWrap: "anywhere", fontWeight: 600 }}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface TicketSubDialogProps {
  title: string;
  onClose: () => void;
  // Mientras se envia no se cierra (ni con Escape): evita perder la respuesta.
  closeDisabled?: boolean;
  children: ReactNode;
  footer: ReactNode;
}

// Dialogo encima del modal principal: foco propio, Escape y Tab se quedan
// aqui (no llegan al modal de abajo) y el foco vuelve al cerrar.
export function TicketSubDialog({ title, onClose, closeDisabled = false, children, footer }: TicketSubDialogProps) {
  const titleId = useId();
  const isMobile = useMediaQuery("(max-width: 640px)");
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const first = dialogRef.current?.querySelector<HTMLElement>(
      "input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)"
    );
    (first ?? dialogRef.current)?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (!closeDisabled) onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)"
      ) || []
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" style={isMobile ? { padding: 0, placeItems: "stretch" } : undefined}>
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal-card"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
        style={isMobile
          ? { width: "100%", maxWidth: "none", height: "100dvh", maxHeight: "none", borderRadius: 0, padding: "1rem" }
          : { width: "min(520px, 100%)" }}
        tabIndex={-1}
      >
        <h3 id={titleId}>{title}</h3>
        {children}
        <div className="inline-actions modal-actions-end" style={{ marginTop: "1rem", flexWrap: "wrap" }}>
          {footer}
        </div>
      </div>
    </div>
  );
}
