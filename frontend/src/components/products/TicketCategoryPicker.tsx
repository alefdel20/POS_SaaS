import { useEffect, useId, useRef, useState } from "react";
import { apiSearchProductCategories } from "../../api/purchaseTicket";
import { ticketAlertStyle, ticketInvalidStyle } from "./ticketUi";

const SEARCH_DEBOUNCE_MS = 300;

interface TicketCategoryPickerProps {
  token: string;
  lineName: string;
  value: string;
  invalid: boolean;
  onChange: (category: string) => void;
}

// Solo categorias que ya existen en el negocio (GET /products/categories).
// El endpoint devuelve 20 como maximo: al abrir muestra las primeras y el
// texto filtra en el servidor. No se puede escribir una categoria nueva.
export function TicketCategoryPicker({ token, lineName, value, invalid, onChange }: TicketCategoryPickerProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else {
      setQuery("");
      setResults(null);
      setLoadError("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setLoadError("");
      apiSearchProductCategories(token, query, controller.signal)
        .then((items) => setResults(items))
        .catch((error) => {
          if ((error as { name?: string })?.name !== "AbortError") setLoadError("No se pudieron cargar las categorías.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, query ? SEARCH_DEBOUNCE_MS : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, token]);

  function choose(category: string) {
    onChange(category);
    setOpen(false);
  }

  return (
    <div style={{ display: "grid", gap: "0.35rem" }}>
      <button
        aria-expanded={open}
        aria-invalid={invalid}
        aria-label={`Categoría del producto nuevo para ${lineName}`}
        className="button ghost"
        onClick={() => setOpen(!open)}
        style={{ justifyContent: "space-between", textAlign: "left", width: "100%", ...ticketInvalidStyle(invalid) }}
        type="button"
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{value || "Elegir categoría"}</span>
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setOpen(false);
            }
          }}
          style={{
            display: "grid",
            gap: "0.35rem",
            padding: "0.5rem",
            borderRadius: "10px",
            border: "1px solid var(--border)",
            background: "var(--panel-alt)"
          }}
        >
          <input
            aria-controls={listId}
            aria-label={`Buscar categoría para ${lineName}`}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar categoría"
            ref={inputRef}
            type="search"
            value={query}
          />
          {loading ? <span className="muted" role="status" style={{ fontSize: "0.8rem" }}>Buscando...</span> : null}
          {loadError ? <span role="alert" style={{ ...ticketAlertStyle, margin: 0 }}>{loadError}</span> : null}
          <ul id={listId} style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.25rem", maxHeight: "12rem", overflowY: "auto" }}>
            {(results || []).map((category) => (
              <li key={category}>
                <button
                  aria-pressed={category === value}
                  className="button ghost"
                  onClick={() => choose(category)}
                  style={{
                    width: "100%",
                    justifyContent: "flex-start",
                    textAlign: "left",
                    ...(category === value ? { borderColor: "var(--accent)" } : {})
                  }}
                  type="button"
                >
                  {category}
                </button>
              </li>
            ))}
            {results && !results.length && !loading ? (
              <li className="muted" style={{ fontSize: "0.8rem", padding: "0.25rem" }}>
                {query ? "Ninguna categoría coincide." : "El negocio aún no tiene categorías. Créala primero en Productos."}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
