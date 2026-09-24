import { useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { OnboardingBundleResponse } from "../types";
import {
  ONBOARDING_BUNDLE_DONE_PATH,
  ONBOARDING_BUNDLE_PATH,
  SALES_PATH
} from "./OnboardingBundleStartPage";

type Selection = { included: boolean; price: string };

function requiredLabel(text: string) {
  return `${text} *`;
}

function isValidPrice(value: string) {
  const numeric = Number(value);
  if (value.trim() === "" || !Number.isFinite(numeric) || numeric <= 0) return false;
  // El backend acepta maximo 5 decimales.
  return Math.abs(numeric * 100000 - Math.round(numeric * 100000)) <= 1e-9;
}

export function OnboardingBundleReviewPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const bundle = (location.state as { bundle?: OnboardingBundleResponse } | null)?.bundle ?? null;
  const items = bundle?.items ?? [];

  const [selections, setSelections] = useState<Record<number, Selection>>(() =>
    Object.fromEntries(items.map((item) => [item.bundle_index, { included: true, price: String(item.price) }]))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const groups = useMemo(() => {
    const byCategory = new Map<string, typeof items>();
    for (const item of items) {
      const category = item.category || "General";
      byCategory.set(category, [...(byCategory.get(category) || []), item]);
    }
    return Array.from(byCategory.entries());
  }, [items]);

  // Entrada directa a este paso sin haber pasado por el Paso 1 (no hay items): volver al inicio del wizard.
  if (!bundle || !bundle.needsBundle) {
    return <Navigate replace to={ONBOARDING_BUNDLE_PATH} />;
  }

  const includedItems = items.filter((item) => selections[item.bundle_index]?.included);
  const hasInvalidPrice = includedItems.some((item) => !isValidPrice(selections[item.bundle_index].price));
  const canConfirm = includedItems.length > 0 && !hasInvalidPrice && !submitting;

  function updateSelection(index: number, patch: Partial<Selection>) {
    setSelections((current) => ({ ...current, [index]: { ...current[index], ...patch } }));
  }

  function toggleCategory(categoryItems: typeof items, included: boolean) {
    setSelections((current) => {
      const next = { ...current };
      for (const item of categoryItems) next[item.bundle_index] = { ...next[item.bundle_index], included };
      return next;
    });
  }

  async function confirm() {
    if (!canConfirm) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await apiRequest<{ inserted: number }>("/onboarding/bundle/confirm", {
        method: "POST",
        token,
        body: JSON.stringify({
          selections: items.map((item) => ({
            bundle_index: item.bundle_index,
            price: Number(selections[item.bundle_index].price),
            included: selections[item.bundle_index].included
          }))
        })
      });
      navigate(ONBOARDING_BUNDLE_DONE_PATH, { replace: true, state: { inserted: response.inserted } });
    } catch (requestError) {
      if ((requestError as { status?: number }).status === 409) {
        // Condicion de carrera esperada (dos pestanas, doble click): el paquete ya se confirmo.
        setInfo("Tu paquete ya se confirmó antes. Te llevamos a Ventas.");
        window.setTimeout(() => navigate(SALES_PATH, { replace: true }), 1800);
        return;
      }
      setError((requestError as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <section className="panel onboarding-bundle-panel onboarding-bundle-panel-wide">
      <p className="eyebrow">Paso 2 de 3</p>
      <h1>Revisa tu paquete</h1>
      <p className="muted">
        Desmarca lo que no vendes y ajusta los precios. {requiredLabel("Precio")} debe ser mayor a 0.
      </p>

      {groups.map(([category, categoryItems]) => {
        const allIncluded = categoryItems.every((item) => selections[item.bundle_index].included);
        return (
          <div className="onboarding-bundle-group" key={category}>
            <label className="onboarding-bundle-group-header">
              <input
                checked={allIncluded}
                disabled={submitting}
                type="checkbox"
                onChange={(event) => toggleCategory(categoryItems, event.target.checked)}
              />
              <strong>{category}</strong>
              <span className="muted">({categoryItems.length})</span>
            </label>
            {categoryItems.map((item) => {
              const selection = selections[item.bundle_index];
              const priceInvalid = selection.included && !isValidPrice(selection.price);
              return (
                <div className={`onboarding-bundle-row ${selection.included ? "" : "is-excluded"}`} key={item.bundle_index}>
                  <input
                    aria-label={`Incluir ${item.name}`}
                    checked={selection.included}
                    disabled={submitting}
                    type="checkbox"
                    onChange={(event) => updateSelection(item.bundle_index, { included: event.target.checked })}
                  />
                  <span className="onboarding-bundle-name">{item.name}</span>
                  <span className="muted onboarding-bundle-unit">{item.unit}</span>
                  <input
                    aria-invalid={priceInvalid}
                    aria-label={`Precio de ${item.name}`}
                    className={priceInvalid ? "onboarding-bundle-price is-invalid" : "onboarding-bundle-price"}
                    disabled={!selection.included || submitting}
                    min="0"
                    step="0.00001"
                    type="number"
                    value={selection.price}
                    onChange={(event) => updateSelection(item.bundle_index, { price: event.target.value })}
                  />
                </div>
              );
            })}
          </div>
        );
      })}

      {error ? <p className="error-text">{error}</p> : null}
      {info ? <p className="success-text">{info}</p> : null}

      <div className="onboarding-bundle-footer">
        <span className="muted">{includedItems.length} de {items.length} productos seleccionados</span>
        <div className="onboarding-bundle-actions">
          <button className="button ghost" disabled={submitting} type="button" onClick={() => navigate(ONBOARDING_BUNDLE_PATH, { state: { bundle } })}>
            Atrás
          </button>
          <button className={`button ${canConfirm ? "" : "button-disabled"}`} disabled={!canConfirm} type="button" onClick={confirm}>
            {submitting ? "Guardando…" : "Confirmar productos"}
          </button>
        </div>
      </div>
    </section>
  );
}
