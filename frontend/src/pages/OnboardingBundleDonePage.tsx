import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { SALES_PATH } from "./OnboardingBundleStartPage";

export function OnboardingBundleDonePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const inserted = (location.state as { inserted?: number } | null)?.inserted;

  // Entrada directa por URL: no hay resultado que mostrar.
  if (typeof inserted !== "number") {
    return <Navigate replace to={SALES_PATH} />;
  }

  return (
    <section className="panel onboarding-bundle-panel">
      <p className="eyebrow">Paso 3 de 3</p>
      <h1>¡Listo!</h1>
      <p className="success-text">
        {inserted === 1 ? "Se agregó 1 producto" : `Se agregaron ${inserted} productos`} a tu catálogo.
      </p>
      <p className="muted">Puedes editar precios, stock y agregar más productos cuando quieras desde Productos.</p>
      <div className="onboarding-bundle-actions">
        <button className="button" type="button" onClick={() => navigate(SALES_PATH, { replace: true })}>Ir a Ventas</button>
      </div>
    </section>
  );
}
