import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { isIntegerUnit } from "../constants/saleUnits";
import type { OnboardingBundleResponse } from "../types";
import {
  ONBOARDING_BUNDLE_DONE_PATH,
  ONBOARDING_BUNDLE_PATH,
  SALES_PATH
} from "./OnboardingBundleStartPage";

type Selection = { included: boolean; price: string; stock: string; reviewed: boolean };

function requiredLabel(text: string) {
  return `${text} *`;
}

function isValidPrice(value: string) {
  const numeric = Number(value);
  if (value.trim() === "" || !Number.isFinite(numeric) || numeric <= 0) return false;
  // El backend acepta maximo 5 decimales.
  return Math.abs(numeric * 100000 - Math.round(numeric * 100000)) <= 1e-9;
}

// Stock opcional: vacio es valido. Misma regla que el alta manual y el backend:
// >= 0, entero para pieza/caja/pliego/hoja, hasta 3 decimales para kg/litro/metro.
function isValidStock(value: string, unit: string) {
  if (value.trim() === "") return true;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return false;
  if (isIntegerUnit(unit)) return Number.isInteger(numeric);
  return Math.abs(numeric * 1000 - Math.round(numeric * 1000)) <= 1e-9;
}

// Formatea a 2 decimales al perder foco; si el precio tiene mas precision (hasta 5) no se recorta.
function formatPriceOnBlur(value: string) {
  if (!isValidPrice(value)) return value;
  const numeric = Number(value);
  return Math.abs(numeric * 100 - Math.round(numeric * 100)) <= 1e-9 ? numeric.toFixed(2) : value;
}

export function OnboardingBundleReviewPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const bundle = (location.state as { bundle?: OnboardingBundleResponse } | null)?.bundle ?? null;
  const items = bundle?.items ?? [];

  const [selections, setSelections] = useState<Record<number, Selection>>(() =>
    Object.fromEntries(
      items.map((item) => [item.bundle_index, { included: true, price: String(item.price), stock: "", reviewed: false }])
    )
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const priceRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const blockerRef = useRef<HTMLParagraphElement | null>(null);

  const groups = useMemo(() => {
    const byCategory = new Map<string, typeof items>();
    for (const item of items) {
      const category = item.category || "General";
      byCategory.set(category, [...(byCategory.get(category) || []), item]);
    }
    return Array.from(byCategory.entries());
  }, [items]);

  const [activeCategory, setActiveCategory] = useState<string>(() => groups[0]?.[0] ?? "");

  // Entrada directa a este paso sin haber pasado por el Paso 1 (no hay items): volver al inicio del wizard.
  if (!bundle || !bundle.needsBundle) {
    return <Navigate replace to={ONBOARDING_BUNDLE_PATH} />;
  }

  // Todo lo que sigue se calcula sobre el arreglo COMPLETO de items (todas las categorias).
  const total = items.length;
  const includedItems = items.filter((item) => selections[item.bundle_index]?.included);
  const resolvedCount = items.filter((item) => {
    const selection = selections[item.bundle_index];
    return !selection.included || selection.reviewed;
  }).length;
  const allResolved = resolvedCount === total;
  const pendingCount = includedItems.filter((item) => {
    const selection = selections[item.bundle_index];
    return !selection.reviewed || !isValidPrice(selection.price);
  }).length;
  const hasInvalidStock = includedItems.some((item) => !isValidStock(selections[item.bundle_index].stock, item.unit));
  const canConfirm =
    includedItems.length > 0 && allResolved && pendingCount === 0 && !hasInvalidStock && !submitting;
  const progressPercent = total === 0 ? 0 : Math.round((resolvedCount / total) * 100);

  const activeGroup = groups.find(([category]) => category === activeCategory) ?? groups[0];
  const [visibleCategory, visibleItems] = activeGroup ?? ["", [] as typeof items];

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

  function markCategoryReviewed(categoryItems: typeof items) {
    setSelections((current) => {
      const next = { ...current };
      for (const item of categoryItems) {
        if (next[item.bundle_index].included) next[item.bundle_index] = { ...next[item.bundle_index], reviewed: true };
      }
      return next;
    });
  }

  function focusAfterCategory(categoryIndex: number) {
    const nextCategory = groups[categoryIndex + 1]?.[0];
    if (nextCategory) {
      chipRefs.current[nextCategory]?.focus();
    } else {
      (confirmRef.current ?? blockerRef.current)?.focus();
    }
  }

  function handlePriceEnter(event: KeyboardEvent<HTMLInputElement>, position: number) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const next = visibleItems.slice(position + 1).find((item) => selections[item.bundle_index].included);
    if (next) {
      priceRefs.current[next.bundle_index]?.focus();
      return;
    }
    focusAfterCategory(groups.findIndex(([category]) => category === visibleCategory));
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
          selections: items.map((item) => {
            const selection = selections[item.bundle_index];
            const payload: { bundle_index: number; price: number; included: boolean; stock?: number } = {
              bundle_index: item.bundle_index,
              price: Number(selection.price),
              included: selection.included
            };
            // stock es opcional: solo se manda si el usuario escribio algo.
            if (selection.included && selection.stock.trim() !== "") payload.stock = Number(selection.stock);
            return payload;
          })
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

  const visibleAllIncluded = visibleItems.every((item) => selections[item.bundle_index].included);
  const visibleIncluded = visibleItems.filter((item) => selections[item.bundle_index].included);
  const visibleAllReviewed = visibleIncluded.every((item) => selections[item.bundle_index].reviewed);

  let blockerMessage = "";
  if (!canConfirm && !submitting) {
    if (includedItems.length === 0) blockerMessage = "Selecciona al menos un producto";
    else if (pendingCount > 0) blockerMessage = `Faltan ${pendingCount} ${pendingCount === 1 ? "precio" : "precios"} por revisar`;
    else if (hasInvalidStock) blockerMessage = "Revisa las cantidades marcadas en rojo";
  }

  return (
    <section className="panel onboarding-bundle-panel onboarding-bundle-panel-wide">
      <div className="onboarding-bundle-top">
        <div>
          <p className="eyebrow">Paso 2 de 3</p>
          <h1>Revisa tu paquete</h1>
        </div>
        <div className="onboarding-bundle-progress" aria-live="polite">
          <span className="muted">{resolvedCount} de {total} revisados</span>
          <div
            aria-label="Progreso de revisión"
            aria-valuemax={total}
            aria-valuemin={0}
            aria-valuenow={resolvedCount}
            className="onboarding-bundle-progress-track"
            role="progressbar"
          >
            <div className="onboarding-bundle-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      </div>
      <p className="muted">
        Desmarca lo que no vendes, ajusta los precios y toca "Está bien" en cada uno. {requiredLabel("Precio")} debe ser mayor a 0.
      </p>

      <div className="onboarding-bundle-chips" role="tablist">
        {groups.map(([category, categoryItems]) => {
          const includedCount = categoryItems.filter((item) => selections[item.bundle_index].included).length;
          const isActive = category === visibleCategory;
          return (
            <button
              aria-selected={isActive}
              className={`onboarding-bundle-chip ${isActive ? "is-active" : ""}`}
              key={category}
              ref={(node) => { chipRefs.current[category] = node; }}
              role="tab"
              type="button"
              onClick={() => setActiveCategory(category)}
            >
              {category} · {includedCount}
            </button>
          );
        })}
      </div>

      <div className="onboarding-bundle-group">
        <div className="onboarding-bundle-group-top">
          <label className="onboarding-bundle-group-header">
            <input
              checked={visibleAllIncluded}
              disabled={submitting}
              type="checkbox"
              onChange={(event) => toggleCategory(visibleItems, event.target.checked)}
            />
            <strong>{visibleCategory}</strong>
            <span className="muted">({visibleItems.length})</span>
          </label>
          <button
            className="button ghost"
            disabled={submitting || visibleIncluded.length === 0 || visibleAllReviewed}
            type="button"
            onClick={() => markCategoryReviewed(visibleItems)}
          >
            Todos los precios de {visibleCategory} están bien
          </button>
        </div>

        <div className="onboarding-bundle-row onboarding-bundle-row-head muted" aria-hidden="true">
          <span />
          <span>Producto</span>
          <span>Tu precio</span>
          <span>¿Cuántos tienes?</span>
          <span />
        </div>

        {visibleItems.map((item, position) => {
          const selection = selections[item.bundle_index];
          const priceInvalid = selection.included && !isValidPrice(selection.price);
          const stockInvalid = selection.included && !isValidStock(selection.stock, item.unit);
          const pending = selection.included && !selection.reviewed;
          const priceClass = [
            "onboarding-bundle-price",
            priceInvalid ? "is-invalid" : pending ? "is-pending" : ""
          ].filter(Boolean).join(" ");
          const stockClass = [
            "onboarding-bundle-stock",
            stockInvalid ? "is-invalid" : pending ? "is-pending" : ""
          ].filter(Boolean).join(" ");
          return (
            <div className={`onboarding-bundle-row ${selection.included ? "" : "is-excluded"}`} key={item.bundle_index}>
              <input
                aria-label={`Incluir ${item.name}`}
                checked={selection.included}
                disabled={submitting}
                type="checkbox"
                onChange={(event) => updateSelection(item.bundle_index, { included: event.target.checked })}
              />
              <span className="onboarding-bundle-name">
                {item.name} <span className="muted onboarding-bundle-unit">· {item.unit}</span>
              </span>
              <span className="onboarding-bundle-price-wrap">
                <span aria-hidden="true" className="onboarding-bundle-currency">$</span>
                <input
                  aria-invalid={priceInvalid}
                  aria-label={`Precio de ${item.name}`}
                  className={priceClass}
                  disabled={!selection.included || submitting}
                  min="0"
                  ref={(node) => { priceRefs.current[item.bundle_index] = node; }}
                  step="0.00001"
                  type="number"
                  value={selection.price}
                  onBlur={() => updateSelection(item.bundle_index, { price: formatPriceOnBlur(selection.price) })}
                  onChange={(event) => updateSelection(item.bundle_index, { price: event.target.value })}
                  onKeyDown={(event) => handlePriceEnter(event, position)}
                />
              </span>
              <input
                aria-invalid={stockInvalid}
                aria-label={`Cantidad inicial de ${item.name}`}
                className={stockClass}
                disabled={!selection.included || submitting}
                min="0"
                placeholder="Opcional"
                step={isIntegerUnit(item.unit) ? "1" : "0.001"}
                type="number"
                value={selection.stock}
                onChange={(event) => updateSelection(item.bundle_index, { stock: event.target.value })}
              />
              {!selection.included ? (
                <span />
              ) : selection.reviewed ? (
                <button
                  className="pill success onboarding-bundle-status"
                  disabled={submitting}
                  type="button"
                  onClick={() => updateSelection(item.bundle_index, { reviewed: false })}
                >
                  Revisado
                </button>
              ) : (
                <button
                  className="button ghost onboarding-bundle-status is-pending"
                  disabled={submitting}
                  type="button"
                  onClick={() => updateSelection(item.bundle_index, { reviewed: true })}
                >
                  Está bien
                </button>
              )}
            </div>
          );
        })}
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {info ? <p className="success-text">{info}</p> : null}

      <div className="onboarding-bundle-footer">
        <span className="muted">{includedItems.length} de {total} productos seleccionados</span>
        <div className="onboarding-bundle-actions">
          <button className="button ghost" disabled={submitting} type="button" onClick={() => navigate(ONBOARDING_BUNDLE_PATH, { state: { bundle } })}>
            Atrás
          </button>
          {canConfirm || submitting ? (
            <button className="button" disabled={!canConfirm} ref={confirmRef} type="button" onClick={confirm}>
              {submitting ? "Guardando…" : "Confirmar productos"}
            </button>
          ) : (
            <p className="warning-text" ref={blockerRef} tabIndex={-1}>{blockerMessage}</p>
          )}
        </div>
      </div>
    </section>
  );
}
