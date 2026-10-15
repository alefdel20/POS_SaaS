import { currency, formatDate } from "../../utils/format";
import { TicketFacts, TicketSubDialog, ticketAlertStyle, ticketWarningStyle } from "./ticketUi";

export interface TicketConfirmSummary {
  supplierName: string | null;
  date: string;
  lineCount: number;
  newCount: number;
  restockCount: number;
  total: number;
  linesTotal: number;
  // Varias fotos: lineas que siguen marcadas como posible repetido entre fotos.
  possibleDuplicateCount: number;
}

interface TicketConfirmDialogProps {
  summary: TicketConfirmSummary;
  submitting: boolean;
  error: string;
  // 409 del backend: imagen ya confirmada o mismo proveedor+fecha+total+folio.
  conflict: "duplicate_image" | "possible_duplicate" | null;
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
  onBack: () => void;
  onConfirm: () => void;
  onShowPurchases: () => void;
}

export function TicketConfirmDialog({
  summary,
  submitting,
  error,
  conflict,
  acknowledged,
  onAcknowledgedChange,
  onBack,
  onConfirm,
  onShowPurchases
}: TicketConfirmDialogProps) {
  const difference = Math.round((summary.total - summary.linesTotal) * 100) / 100;
  const blocked = conflict === "duplicate_image" || (conflict === "possible_duplicate" && !acknowledged);

  return (
    <TicketSubDialog
      closeDisabled={submitting}
      footer={(
        <>
          <button className="button ghost" disabled={submitting} onClick={onBack} type="button">Volver</button>
          <button className="button" disabled={submitting || blocked} onClick={onConfirm} type="button">
            {submitting ? "Cargando compra..." : "Sí, cargar compra"}
          </button>
        </>
      )}
      onClose={onBack}
      title="Confirmar compra"
    >
      <TicketFacts
        items={[
          { label: "Proveedor", value: summary.supplierName || "Sin proveedor" },
          { label: "Fecha", value: formatDate(summary.date) || summary.date },
          { label: "Líneas", value: String(summary.lineCount) },
          { label: "Productos que se reabastecen", value: String(summary.restockCount) },
          { label: "Productos nuevos que se crearán", value: String(summary.newCount) },
          { label: "Total del ticket", value: currency(summary.total) },
          { label: "Total de las líneas", value: currency(summary.linesTotal) }
        ]}
      />
      {difference !== 0 ? (
        <p role="note" style={ticketWarningStyle}>
          El total del ticket y la suma de las líneas difieren por {currency(Math.abs(difference))}
          {difference > 0 ? " (el ticket es mayor)" : " (las líneas suman más)"}. Puede deberse a impuestos o descuentos.
          El egreso se registrará por el total del ticket: {currency(summary.total)}.
        </p>
      ) : null}
      {summary.possibleDuplicateCount > 0 ? (
        <p role="note" style={ticketWarningStyle}>
          {summary.possibleDuplicateCount === 1
            ? "1 línea sigue marcada como posible repetida entre fotos."
            : `${summary.possibleDuplicateCount} líneas siguen marcadas como posibles repetidas entre fotos.`}
          {" "}Si es el mismo renglón fotografiado dos veces, vuelve y quítala; si no, puedes cargar la compra así.
        </p>
      ) : null}
      <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.85rem" }}>
        Se registrará un egreso en efectivo con fecha de hoy por {currency(summary.total)}.
      </p>

      {conflict === "duplicate_image" ? (
        <div role="alert" style={ticketAlertStyle}>
          <p style={{ margin: "0 0 0.4rem" }}>Este ticket ya se cargó.</p>
          <button className="button ghost" onClick={onShowPurchases} type="button">Ver compras con ticket</button>
        </div>
      ) : null}
      {conflict === "possible_duplicate" ? (
        <div role="alert" style={ticketAlertStyle}>
          <p style={{ margin: "0 0 0.5rem" }}>
            Ya hay una compra confirmada con el mismo proveedor, fecha, total y folio. Si de verdad es otra compra, márcalo para continuar.
          </p>
          <label className="checkbox-row" style={{ margin: 0, display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              checked={acknowledged}
              disabled={submitting}
              onChange={(event) => onAcknowledgedChange(event.target.checked)}
              type="checkbox"
            />
            Es otra compra distinta
          </label>
        </div>
      ) : null}
      {error && !conflict ? <p role="alert" style={ticketAlertStyle}>{error}</p> : null}
    </TicketSubDialog>
  );
}
