import { useCallback, useEffect, useState } from "react";
import { TicketApiError, apiListRecentPurchaseTickets } from "../../api/purchaseTicket";
import type { TicketRecentItem } from "../../types/purchaseTicket";
import { currency, formatDate } from "../../utils/format";
import { TicketVoidDialog } from "./TicketVoidDialog";
import { ticketAlertStyle, ticketSuccessStyle } from "./ticketUi";

interface TicketPurchasesListProps {
  token: string;
  isMobile: boolean;
  onChanged: () => void;
}

function statusBadge(item: TicketRecentItem) {
  const tone = item.status === "voided" ? "var(--danger)" : "var(--accent)";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.15rem 0.5rem",
        borderRadius: "999px",
        fontSize: "0.75rem",
        whiteSpace: "nowrap",
        color: "var(--text)",
        background: `color-mix(in srgb, ${tone} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${tone} 45%, transparent)`
      }}
    >
      {item.status === "voided" ? "Anulada" : "Confirmada"}
    </span>
  );
}

function ticketFacts(item: TicketRecentItem) {
  return [
    { label: "Fecha", value: formatDate(item.ticket_date) || item.ticket_date },
    { label: "Proveedor", value: item.supplier_name || "Sin proveedor" },
    { label: "Total", value: currency(item.total) },
    { label: "Folio", value: item.folio || "Sin folio" }
  ];
}

// GET /products/restock/ticket/recent: los ultimos 30 tickets del negocio.
export function TicketPurchasesList({ token, isMobile, onChanged }: TicketPurchasesListProps) {
  const [items, setItems] = useState<TicketRecentItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [voiding, setVoiding] = useState<TicketRecentItem | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    return apiListRecentPurchaseTickets(token, signal)
      .then((next) => setItems(next))
      .catch((loadError) => {
        if ((loadError as { name?: string })?.name === "AbortError") return;
        setError(loadError instanceof TicketApiError ? loadError.message : "No se pudieron cargar las compras.");
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [load]);

  function renderAction(item: TicketRecentItem) {
    if (item.status !== "confirmed") return null;
    return (
      <button aria-label={`Anular compra del ${formatDate(item.ticket_date) || item.ticket_date}${item.folio ? `, folio ${item.folio}` : ""}`} className="button ghost" onClick={() => setVoiding(item)} type="button">
        Anular
      </button>
    );
  }

  function renderVoidReason(item: TicketRecentItem) {
    if (item.status !== "voided" || !item.void_reason) return null;
    return <span className="muted" style={{ display: "block", fontSize: "0.78rem", overflowWrap: "anywhere" }}>Motivo: {item.void_reason}</span>;
  }

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      {notice ? <p role="status" style={ticketSuccessStyle}>{notice}</p> : null}
      {error ? <p role="alert" style={ticketAlertStyle}>{error}</p> : null}
      {loading && !items ? <span className="muted" role="status">Cargando compras...</span> : null}
      {items && !items.length ? <p className="muted" style={{ margin: 0 }}>Todavía no hay compras cargadas con ticket.</p> : null}

      {items && items.length ? (
        isMobile ? (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.75rem" }}>
            {items.map((item) => (
              <li key={item.id} style={{ display: "grid", gap: "0.4rem", padding: "0.75rem", borderRadius: "12px", border: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "flex-start" }}>
                  <strong style={{ overflowWrap: "anywhere" }}>{item.supplier_name || "Sin proveedor"}</strong>
                  {statusBadge(item)}
                </div>
                <span style={{ fontSize: "0.85rem" }}>
                  {formatDate(item.ticket_date) || item.ticket_date} · {currency(item.total)}{item.folio ? ` · Folio ${item.folio}` : ""}
                </span>
                <span className="muted" style={{ fontSize: "0.8rem" }}>Cargó: {item.created_by || "Sin dato"} · {item.line_count} {item.line_count === 1 ? "línea" : "líneas"}</span>
                {renderVoidReason(item)}
                {renderAction(item) ? <div>{renderAction(item)}</div> : null}
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Proveedor</th>
                  <th scope="col">Total</th>
                  <th scope="col">Folio</th>
                  <th scope="col">Cargó</th>
                  <th scope="col">Estado</th>
                  <th aria-label="Acciones" scope="col" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{formatDate(item.ticket_date) || item.ticket_date}</td>
                    <td style={{ overflowWrap: "anywhere" }}>{item.supplier_name || "Sin proveedor"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{currency(item.total)}</td>
                    <td style={{ overflowWrap: "anywhere" }}>{item.folio || "—"}</td>
                    <td style={{ overflowWrap: "anywhere" }}>{item.created_by || "Sin dato"}</td>
                    <td>{statusBadge(item)}{renderVoidReason(item)}</td>
                    <td>{renderAction(item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {voiding ? (
        <TicketVoidDialog
          facts={ticketFacts(voiding)}
          onClose={() => setVoiding(null)}
          onVoided={() => {
            setVoiding(null);
            setNotice("Compra anulada. El stock y el egreso se revirtieron.");
            onChanged();
            load().catch(() => undefined);
          }}
          ticketId={voiding.id}
          token={token}
        />
      ) : null}
    </div>
  );
}
