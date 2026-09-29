import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { setBundleSkipped } from "../services/storage";
import type { OnboardingBundleResponse } from "../types";

export const ONBOARDING_BUNDLE_PATH = "/onboarding/bundle";
export const ONBOARDING_BUNDLE_REVIEW_PATH = "/onboarding/bundle/review";
export const ONBOARDING_BUNDLE_DONE_PATH = "/onboarding/bundle/done";
export const SALES_PATH = "/sales";

const POS_TYPE_LABELS: Record<string, string> = {
  Papeleria: "Papelería",
  Tienda: "Tienda",
  Tlapaleria: "Ferretería / Tlapalería"
};
// Mismo conjunto que POS_TYPES_WITH_GUIDED_BUNDLE en el backend (initialCatalogSeedService.js).
const POS_TYPES_WITH_GUIDED_BUNDLE = ["Papeleria", "Tienda", "Tlapaleria"];

export function OnboardingBundleStartPage() {
  const { token, user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // AppLayout ya resolvio el GET cuando redirige aqui; solo se vuelve a pedir en entrada directa por URL.
  const passedBundle = (location.state as { bundle?: OnboardingBundleResponse } | null)?.bundle ?? null;
  const [bundle, setBundle] = useState<OnboardingBundleResponse | null>(passedBundle);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [changingPosType, setChangingPosType] = useState(false);
  const [nextPosType, setNextPosType] = useState("");
  const [changeError, setChangeError] = useState("");
  const [submittingChange, setSubmittingChange] = useState(false);

  useEffect(() => {
    if (bundle) return;
    let cancelled = false;
    setError("");
    apiRequest<OnboardingBundleResponse>("/onboarding/bundle", { token })
      .then((response) => {
        if (!cancelled) setBundle(response);
      })
      .catch((requestError: Error) => {
        if (!cancelled) setError(requestError.message);
      });
    return () => {
      cancelled = true;
    };
  }, [token, attempt, bundle]);

  function skipWizard() {
    setBundleSkipped(user?.business_id);
    navigate(SALES_PATH, { replace: true });
  }

  function openPosTypeChange() {
    setNextPosType("");
    setChangeError("");
    setChangingPosType(true);
  }

  function cancelPosTypeChange() {
    setChangingPosType(false);
    setNextPosType("");
    setChangeError("");
  }

  async function confirmPosTypeChange() {
    if (!nextPosType) return;
    setSubmittingChange(true);
    setChangeError("");
    try {
      await apiRequest("/onboarding/bundle/giro", {
        method: "PUT",
        token,
        body: JSON.stringify({ pos_type: nextPosType })
      });
    } catch (requestError) {
      setChangeError(requestError instanceof Error ? requestError.message : "No fue posible cambiar el giro");
      setSubmittingChange(false);
      return;
    }
    // El proximo login trae el giro nuevo y AppLayout vuelve a abrir el wizard desde el Paso 1.
    setBundleSkipped(user?.business_id, false);
    logout();
    navigate("/login", { replace: true });
  }

  if (bundle && !bundle.needsBundle) {
    return <Navigate replace to={SALES_PATH} />;
  }

  if (error) {
    return (
      <section className="panel onboarding-bundle-panel">
        <h1>No pudimos cargar tu paquete</h1>
        <p className="error-text">{error}</p>
        <div className="onboarding-bundle-actions">
          <button className="button" type="button" onClick={() => setAttempt((current) => current + 1)}>Reintentar</button>
          <button className="button ghost" type="button" onClick={skipWizard}>Continuar sin paquete</button>
        </div>
      </section>
    );
  }

  if (!bundle) {
    return (
      <section className="panel onboarding-bundle-panel">
        <p className="muted">Cargando…</p>
      </section>
    );
  }

  const posLabel = POS_TYPE_LABELS[bundle.posType || ""] || bundle.posType || "tu negocio";
  const alternativePosTypes = POS_TYPES_WITH_GUIDED_BUNDLE.filter((posType) => posType !== bundle.posType);

  if (changingPosType) {
    return (
      <section className="panel onboarding-bundle-panel">
        <p className="eyebrow">Paso 1 de 3</p>
        <h1>Elige tu giro</h1>
        <p>
          Tu negocio está registrado como <strong>{posLabel}</strong>. Elige el giro correcto y cargaremos su paquete de productos.
        </p>
        <fieldset className="info-card" disabled={submittingChange}>
          {alternativePosTypes.map((posType) => (
            <label key={posType}>
              <input
                type="radio"
                name="next-pos-type"
                value={posType}
                checked={nextPosType === posType}
                onChange={() => setNextPosType(posType)}
              />{" "}
              {POS_TYPE_LABELS[posType] || posType}
            </label>
          ))}
        </fieldset>
        <p className="muted">Al confirmar se cerrará tu sesión; vuelve a entrar para continuar con el paquete del nuevo giro.</p>
        {changeError ? <p className="error-text">{changeError}</p> : null}
        <div className="onboarding-bundle-actions">
          <button className="button" type="button" disabled={!nextPosType || submittingChange} onClick={confirmPosTypeChange}>
            {submittingChange ? "Cambiando giro…" : "Confirmar cambio"}
          </button>
          <button className="button ghost" type="button" disabled={submittingChange} onClick={cancelPosTypeChange}>
            Cancelar
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel onboarding-bundle-panel">
      <p className="eyebrow">Paso 1 de 3</p>
      <h1>Confirma tu giro</h1>
      <p>
        Tu negocio está registrado como <strong>{posLabel}</strong>. Preparamos un paquete de{" "}
        <strong>{bundle.items.length} productos</strong> comunes de este giro para que no empieces desde cero.
      </p>
      <div className="info-card">
        <p className="muted">Podrás revisar cada producto, ajustar su precio o quitarlo antes de agregarlo a tu catálogo.</p>
      </div>
      <div className="onboarding-bundle-actions">
        <button className="button" type="button" onClick={() => navigate(ONBOARDING_BUNDLE_REVIEW_PATH, { state: { bundle } })}>
          Revisar paquete
        </button>
        <button className="button ghost" type="button" onClick={openPosTypeChange}>No es mi giro</button>
        <button className="button ghost" type="button" onClick={skipWizard}>Prefiero empezar sin productos</button>
      </div>
    </section>
  );
}
