import { useId, useState } from "react";
import { TicketApiError, apiVoidPurchaseTicket } from "../../api/purchaseTicket";
import type { TicketInsufficientProduct, TicketVoidResponse } from "../../types/purchaseTicket";
import { TicketFacts, TicketSubDialog, ticketAlertStyle, ticketFieldStyle, ticketInvalidStyle, ticketWarningStyle } from "./ticketUi";

// Mismos limites que voidPurchaseTicket en el backend.
const MIN_REASON_LENGTH = 5;
const MAX_REASON_LENGTH = 500;

interface TicketVoidDialogProps {
  token: string;
  ticketId: number;
  facts: { label: string; value: string }[];
  onClose: () => void;
  onVoided: (result: TicketVoidResponse) => void;
}

function insufficientProducts(error: TicketApiError): TicketInsufficientProduct[] {
  const products = error.details?.products;
  return Array.isArray(products) ? (products as TicketInsufficientProduct[]) : [];
}

export function TicketVoidDialog({ token, ticketId, facts, onClose, onVoided }: TicketVoidDialogProps) {
  const reasonId = useId();
  const hintId = useId();
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [blocking, setBlocking] = useState<TicketInsufficientProduct[]>([]);

  const trimmed = reason.trim();
  const reasonValid = trimmed.length >= MIN_REASON_LENGTH && trimmed.length <= MAX_REASON_LENGTH;

  async function submit() {
    setTouched(true);
    if (!reasonValid || submitting) return;
    setSubmitting(true);
    setError("");
    setBlocking([]);
    try {
      const result = await apiVoidPurchaseTicket(token, ticketId, trimmed);
      onVoided(result);
    } catch (voidError) {
      if (voidError instanceof TicketApiError && voidError.status === 409 && voidError.reason === "insufficient_stock") {
        setBlocking(insufficientProducts(voidError));
        setError("No se puede anular: estos productos ya se vendieron o se movieron y quedarían con stock negativo.");
      } else {
        setError(voidError instanceof TicketApiError ? voidError.message : "No se pudo anular la compra. Intenta de nuevo.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <TicketSubDialog
      closeDisabled={submitting}
      footer={(
        <>
          <button className="button ghost" disabled={submitting} onClick={onClose} type="button">Volver</button>
          <button className="button" disabled={submitting || !reasonValid} onClick={() => submit().catch(() => undefined)} type="button">
            {submitting ? "Anulando..." : "Sí, anular compra"}
          </button>
        </>
      )}
      onClose={onClose}
      title="Anular compra"
    >
      <p style={ticketWarningStyle}>
        Al anular se resta el stock que sumó esta compra, se regresa el costo anterior si nadie lo cambió y se anula el egreso.
        Los productos que creó la compra no se borran.
      </p>
      <TicketFacts items={facts} />
      {error ? (
        <div role="alert" style={ticketAlertStyle}>
          <p style={{ margin: blocking.length ? "0 0 0.4rem" : 0 }}>{error}</p>
          {blocking.length ? (
            <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
              {blocking.map((product) => (
                <li key={product.product_id}>
                  {product.name || `Producto #${product.product_id}`}: hay {product.stock}, la compra sumó {product.required}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <label htmlFor={reasonId} style={ticketFieldStyle}>
        Motivo (obligatorio)
        <textarea
          aria-describedby={hintId}
          aria-invalid={touched && !reasonValid}
          disabled={submitting}
          id={reasonId}
          maxLength={MAX_REASON_LENGTH}
          onBlur={() => setTouched(true)}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          style={ticketInvalidStyle(touched && !reasonValid)}
          value={reason}
        />
        <span className="muted" id={hintId} style={{ fontSize: "0.78rem", ...(touched && !reasonValid ? { color: "var(--danger)" } : {}) }}>
          Al menos {MIN_REASON_LENGTH} caracteres.
        </span>
      </label>
    </TicketSubDialog>
  );
}
