import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { apiRequest } from "../../api/client";
import type { Product } from "../../types";
import { isIntegerUnit } from "../../constants/saleUnits";
import { getResolvedSaleUnit } from "../../utils/productForm";
import { UNIT_SHORT_LABELS, formatQuantity, toNumber } from "../../utils/productStatus";

const MIN_REASON_LENGTH = 5;

// Solo estos campos: lo abren la lista de Inventario (Product) y Reabastecer (RestockProductItem).
export type StockAdjustProduct = Pick<Product, "id" | "name" | "stock" | "unidad_de_venta">;

type StockAdjustDialogProps = {
  product: StockAdjustProduct;
  token: string;
  onClose: () => void;
  onSaved: (product: Product) => void;
  // 403: el interruptor se apago a mitad de sesion (cajero).
  onForbidden?: () => void;
  // Boton que abrio el dialogo (Safari no le da foco al hacer clic). Sin el: activeElement.
  returnFocusTo?: HTMLElement | null;
  // Si al cerrar ese elemento ya no esta en la pagina (p. ej. una recarga quito la fila).
  onReturnFocusMissing?: () => void;
};

// "Bajar existencias": POST /products/:id/stock-adjustment con la cantidad a RESTAR y motivo.
// Las reglas de cantidad replican las del backend (enteros o 3 decimales, sin quedar < 0).
export function StockAdjustDialog({ product, token, onClose, onSaved, onForbidden, returnFocusTo, onReturnFocusMissing }: StockAdjustDialogProps) {
  const titleId = useId();
  const quantityId = useId();
  const reasonId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const quantityRef = useRef<HTMLInputElement | null>(null);
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Se leen al desmontar (efecto de una sola vez): ref para no usar valores viejos.
  const returnFocusMissingRef = useRef(onReturnFocusMissing);
  returnFocusMissingRef.current = onReturnFocusMissing;

  const unit =getResolvedSaleUnit(product.unidad_de_venta);
  const unitLabel = UNIT_SHORT_LABELS[unit] || unit;
  const integerOnly = isIntegerUnit(unit);
  const currentStock = toNumber(product.stock);
  const parsedQuantity = Number(quantity);
  const trimmedReason = reason.trim();

  let quantityError = "";
  if (quantity.trim() !== "") {
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      quantityError = "La cantidad debe ser mayor que cero.";
    } else if (integerOnly && !Number.isInteger(parsedQuantity)) {
      quantityError = "Esta unidad solo acepta números enteros.";
    } else if (Math.abs(parsedQuantity * 1000 - Math.round(parsedQuantity * 1000)) > 1e-9) {
      quantityError = "Máximo 3 decimales.";
    } else if (parsedQuantity > currentStock) {
      quantityError = `No puedes restar más de lo que hay (${formatQuantity(currentStock, unit)} ${unitLabel}).`;
    }
  }
  const quantityValid = quantity.trim() !== "" && !quantityError;
  const reasonValid = trimmedReason.length >= MIN_REASON_LENGTH;
  const remainingStock = quantityValid ? Math.round((currentStock - parsedQuantity) * 1000) / 1000 : null;
  const canSubmit = quantityValid && reasonValid && !submitting;

  // Foco inicial en la cantidad y regreso al elemento que abrio el dialogo al cerrar.
  useEffect(() => {
    const previouslyFocused = returnFocusTo ?? (document.activeElement as HTMLElement | null);
    quantityRef.current?.focus();
    return () => {
      if (previouslyFocused && !previouslyFocused.isConnected && returnFocusMissingRef.current) {
        returnFocusMissingRef.current();
        return;
      }
      previouslyFocused?.focus?.();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!submitting) onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled)") || []
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

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const updated = await apiRequest<Product>(`/products/${product.id}/stock-adjustment`, {
        method: "POST",
        token,
        body: JSON.stringify({ quantity: parsedQuantity, reason: trimmedReason })
      });
      onSaved(updated);
    } catch (submitError) {
      const status = (submitError as { status?: number })?.status;
      if (status === 403) onForbidden?.();
      setError(submitError instanceof Error ? submitError.message : "No fue posible bajar las existencias");
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal-card stock-adjust-dialog"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <h3 id={titleId}>Bajar existencias</h3>
        <p className="stock-adjust-product">{product.name}</p>
        <p className="muted stock-adjust-current">Hoy hay {formatQuantity(currentStock, unit)} {unitLabel}</p>

        <label htmlFor={quantityId}>
          Cantidad a restar
          <input
            aria-describedby={quantityError ? `${quantityId}-error` : undefined}
            aria-invalid={Boolean(quantityError)}
            disabled={submitting}
            id={quantityId}
            inputMode={integerOnly ? "numeric" : "decimal"}
            min="0"
            onChange={(event) => setQuantity(event.target.value)}
            ref={quantityRef}
            step={integerOnly ? "1" : "0.001"}
            type="number"
            value={quantity}
          />
        </label>
        {quantityError ? <p className="error-text stock-adjust-field-error" id={`${quantityId}-error`}>{quantityError}</p> : null}

        <label htmlFor={reasonId}>
          Motivo *
          <textarea
            aria-describedby={`${reasonId}-counter`}
            aria-invalid={reasonTouched && !reasonValid}
            disabled={submitting}
            id={reasonId}
            onBlur={() => setReasonTouched(true)}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ej. producto dañado, merma, conteo físico"
            value={reason}
          />
        </label>
        <p
          className={`stock-adjust-counter${reasonTouched && !reasonValid ? " is-invalid" : ""}`}
          id={`${reasonId}-counter`}
        >
          {trimmedReason.length} caracteres · mínimo {MIN_REASON_LENGTH}
        </p>

        <p aria-live="polite" className="stock-adjust-result">
          {remainingStock !== null ? <>Quedará en <strong>{formatQuantity(remainingStock, unit)} {unitLabel}</strong></> : null}
        </p>

        {error ? <p className="error-text" role="alert">{error}</p> : null}

        <div className="inline-actions modal-actions-end stock-adjust-actions">
          <button className="button ghost" disabled={submitting} onClick={onClose} type="button">Cancelar</button>
          <button className="button" disabled={!canSubmit} onClick={() => handleSubmit().catch(() => undefined)} type="button">
            {submitting ? "Guardando..." : "Bajar existencias"}
          </button>
        </div>
      </div>
    </div>
  );
}
