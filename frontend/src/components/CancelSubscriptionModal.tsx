import { useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";

interface Props {
  nextPaymentDate: string | null;
  onClose: () => void;
  onCancelled: (accessUntil: string | null) => void;
}

function formatDateEs(dateString: string | null): string {
  if (!dateString) return "fin del período pagado";
  return new Date(dateString + "T12:00:00Z").toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

export function CancelSubscriptionModal({ nextPaymentDate, onClose, onCancelled }: Props) {
  const { token } = useAuth();
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [accessUntil, setAccessUntil] = useState<string | null>(null);

  async function handleConfirm() {
    if (!token) return;
    setStatus("loading");
    setErrorMsg("");
    try {
      const result = await apiRequest<{ success: boolean; access_until: string | null }>(
        "/subscription/cancel",
        { method: "POST", token, body: JSON.stringify({ reason }) }
      );
      setAccessUntil(result.access_until);
      setStatus("success");
      onCancelled(result.access_until);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No fue posible cancelar la suscripción. Intenta más tarde."
      );
      setStatus("error");
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {status === "success" ? (
          <>
            <h3>Suscripción cancelada</h3>
            <p>
              Tu solicitud fue procesada. Conservarás acceso hasta el{" "}
              <strong>{formatDateEs(accessUntil)}</strong>. Después de esa fecha tu cuenta
              quedará desactivada.
            </p>
            <div className="inline-actions modal-actions-end">
              <button className="button" onClick={onClose} type="button">
                Entendido
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>¿Cancelar suscripción?</h3>
            <p>
              Conservarás acceso hasta el{" "}
              <strong>{formatDateEs(nextPaymentDate)}</strong>. Después de esa fecha tu
              cuenta quedará desactivada.
            </p>
            <label>
              Motivo de cancelación (opcional)
              <textarea
                disabled={status === "loading"}
                placeholder="¿Por qué cancelas?"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {status === "error" ? <p className="error-text">{errorMsg}</p> : null}
            <div className="inline-actions modal-actions-end">
              <button
                className="button ghost"
                disabled={status === "loading"}
                onClick={onClose}
                type="button"
              >
                Mantener suscripción
              </button>
              <button
                className="button"
                disabled={status === "loading"}
                style={{ background: "#c0392b", color: "#fff" }}
                onClick={handleConfirm}
                type="button"
              >
                {status === "loading" ? "Cancelando..." : "Cancelar suscripción"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
