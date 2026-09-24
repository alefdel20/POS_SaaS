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

export function OnboardingBundleStartPage() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // AppLayout ya resolvio el GET cuando redirige aqui; solo se vuelve a pedir en entrada directa por URL.
  const passedBundle = (location.state as { bundle?: OnboardingBundleResponse } | null)?.bundle ?? null;
  const [bundle, setBundle] = useState<OnboardingBundleResponse | null>(passedBundle);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

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
        <button className="button ghost" type="button" onClick={skipWizard}>No es mi giro</button>
        <button className="button ghost" type="button" onClick={skipWizard}>Prefiero empezar sin productos</button>
      </div>
    </section>
  );
}
