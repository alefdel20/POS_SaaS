import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Business, BusinessSubscription, PosType } from "../types";
import { POS_TYPE_OPTIONS, getPosTypeLabel } from "../utils/pos";
import { shortDate, shortDateTime } from "../utils/format";

type StampMovement = {
  id: number;
  movement_type: string;
  quantity: number;
  balance_before: number;
  balance_after: number;
  note?: string;
  actor_name?: string | null;
  created_at: string;
};

const emptyBusinessForm = {
  name: "",
  slug: "",
  pos_type: "Tienda" as PosType
};

function toSubscriptionForm(subscription?: BusinessSubscription | null) {
  return {
    plan_type: subscription?.plan_type || "monthly",
    billing_anchor_date: subscription?.billing_anchor_date || "",
    next_payment_date: subscription?.next_payment_date || "",
    grace_period_days: String(subscription?.grace_period_days ?? 0),
    enforcement_enabled: subscription?.enforcement_enabled ?? false,
    manual_adjustment_reason: subscription?.manual_adjustment_reason || ""
  };
}

function getSubscriptionStatusLabel(subscription?: BusinessSubscription | null) {
  if (!subscription?.is_configured) return "Sin configurar";
  if (subscription.subscription_status === "due_soon") return "Por vencer";
  if (subscription.subscription_status === "overdue") return "Vencida";
  if (subscription.subscription_status === "blocked") return "Bloqueada";
  return "Activa";
}

function getPlanLabel(subscription?: BusinessSubscription | null) {
  if (subscription?.plan_type === "yearly") return "Anual";
  if (subscription?.plan_type === "monthly") return "Mensual";
  return "-";
}

export function BusinessesPage() {
  const { token } = useAuth();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [form, setForm] = useState(emptyBusinessForm);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [selectedBusinessId, setSelectedBusinessId] = useState<number | null>(null);
  const [subscriptionForm, setSubscriptionForm] = useState(() => toSubscriptionForm(null));
  const [stampQuantity, setStampQuantity] = useState("1");
  const [stampNote, setStampNote] = useState("");
  const [stampMovements, setStampMovements] = useState<StampMovement[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [savingSubscription, setSavingSubscription] = useState(false);
  const [loadingStamps, setLoadingStamps] = useState(false);

  const selectedBusiness = useMemo(
    () => businesses.find((business) => business.id === selectedBusinessId) || null,
    [businesses, selectedBusinessId]
  );

  async function loadBusinesses() {
    if (!token) return;
    try {
      const response = await apiRequest<Business[]>("/businesses", { token });
      setBusinesses(response);
      setSelectedBusinessId((current) => current ?? response[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar negocios");
    }
  }

  async function loadStampMovements(businessId: number) {
    if (!token) return;
    try {
      setLoadingMovements(true);
      const response = await apiRequest<StampMovement[]>(`/businesses/${businessId}/stamps/movements`, { token });
      setStampMovements(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar movimientos de timbres");
      setStampMovements([]);
    } finally {
      setLoadingMovements(false);
    }
  }

  useEffect(() => {
    loadBusinesses().catch(() => undefined);
  }, [token]);

  useEffect(() => {
    setSubscriptionForm(toSubscriptionForm(selectedBusiness?.subscription));
    setStampQuantity("1");
    setStampNote("");
    if (selectedBusiness?.id) {
      loadStampMovements(selectedBusiness.id).catch(() => undefined);
    } else {
      setStampMovements([]);
    }
  }, [selectedBusiness?.id, selectedBusiness?.subscription]);

  async function handleCreateBusiness(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    try {
      setError("");
      setInfo("");
      await apiRequest<Business>("/businesses", {
        method: "POST",
        token,
        body: JSON.stringify(form)
      });
      setForm(emptyBusinessForm);
      setInfo("Negocio creado correctamente");
      await loadBusinesses();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible crear el negocio");
    }
  }

  async function handleSaveSubscription(event: FormEvent) {
    event.preventDefault();
    if (!token || !selectedBusiness) return;

    try {
      setSavingSubscription(true);
      setError("");
      setInfo("");
      const body: Record<string, unknown> = {
        plan_type: subscriptionForm.plan_type,
        grace_period_days: Number(subscriptionForm.grace_period_days || 0),
        enforcement_enabled: subscriptionForm.enforcement_enabled,
        manual_adjustment_reason: subscriptionForm.manual_adjustment_reason.trim() || undefined
      };
      if (subscriptionForm.billing_anchor_date) {
        body.billing_anchor_date = subscriptionForm.billing_anchor_date;
      }
      if (subscriptionForm.next_payment_date) {
        body.next_payment_date = subscriptionForm.next_payment_date;
      }

      await apiRequest<BusinessSubscription>(`/businesses/${selectedBusiness.id}/subscription`, {
        method: "PUT",
        token,
        body: JSON.stringify(body)
      });
      setInfo("Suscripción actualizada correctamente");
      await loadBusinesses();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible actualizar la suscripción");
    } finally {
      setSavingSubscription(false);
    }
  }

  async function handleLoadStamps(event: FormEvent) {
    event.preventDefault();
    if (!token || !selectedBusiness) return;

    try {
      setLoadingStamps(true);
      setError("");
      setInfo("");
      await apiRequest(`/businesses/${selectedBusiness.id}/stamps/load`, {
        method: "POST",
        token,
        body: JSON.stringify({
          quantity: Number(stampQuantity || 0),
          note: stampNote.trim() || undefined
        })
      });
      setStampQuantity("1");
      setStampNote("");
      setInfo("Carga manual de timbres registrada");
      await loadBusinesses();
      await loadStampMovements(selectedBusiness.id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar timbres");
    } finally {
      setLoadingStamps(false);
    }
  }

  return (
    <section className="page-grid two-columns">
      <form className="panel grid-form" onSubmit={handleCreateBusiness}>
        <div className="panel-header">
          <h2>Nuevo negocio</h2>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {info ? <p className="success-text">{info}</p> : null}
        <label>
          Nombre *
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        </label>
        <label>
          Slug
          <input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} placeholder="opcional" />
        </label>
        <label>
          Tipo de POS *
          <select value={form.pos_type} onChange={(event) => setForm({ ...form, pos_type: event.target.value as PosType })}>
            {POS_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <button className="button" type="submit">Crear negocio</button>
      </form>

      <div className="panel form-span-2">
        <div className="panel-header">
          <div>
            <h2>Negocios</h2>
            <p className="muted">Cada alta crea soporte, perfil comercial y suscripción inicial mensual con enforcement activo.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>POS</th>
                <th>Usuarios</th>
                <th>Timbres</th>
                <th>Plan</th>
                <th>Inicio cobro</th>
                <th>Próximo pago</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {businesses.map((business) => (
                <tr
                  className={business.id === selectedBusinessId ? "table-row-active" : ""}
                  key={business.id}
                  onClick={() => setSelectedBusinessId(business.id)}
                >
                  <td>{business.name}</td>
                  <td>{getPosTypeLabel(business.pos_type)}</td>
                  <td>{business.user_count ?? 0}</td>
                  <td>{business.stamps_available ?? 0}</td>
                  <td>{getPlanLabel(business.subscription)}</td>
                  <td>{business.subscription?.billing_anchor_date ? shortDate(business.subscription.billing_anchor_date) : "-"}</td>
                  <td>{business.subscription?.next_payment_date ? shortDate(business.subscription.next_payment_date) : "-"}</td>
                  <td>{getSubscriptionStatusLabel(business.subscription)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedBusiness ? (
        <>
          <form className="panel grid-form" onSubmit={handleSaveSubscription}>
            <div className="panel-header">
              <div>
                <h2>Suscripción de {selectedBusiness.name}</h2>
                <p className="muted">Los campos de fecha pueden ajustarse manualmente. Si no envías próxima fecha, el backend la recalcula desde la fecha base.</p>
              </div>
            </div>
            <label>
              Tipo de plan
              <select
                value={subscriptionForm.plan_type}
                onChange={(event) => setSubscriptionForm((current) => ({ ...current, plan_type: event.target.value as "monthly" | "yearly" }))}
              >
                <option value="monthly">Mensual</option>
                <option value="yearly">Anual</option>
              </select>
            </label>
            <label>
              Fecha base de cobro
              <input
                type="date"
                value={subscriptionForm.billing_anchor_date}
                onChange={(event) => setSubscriptionForm((current) => ({ ...current, billing_anchor_date: event.target.value }))}
              />
            </label>
            <label>
              Próxima fecha de pago
              <input
                type="date"
                value={subscriptionForm.next_payment_date}
                onChange={(event) => setSubscriptionForm((current) => ({ ...current, next_payment_date: event.target.value }))}
              />
            </label>
            <label>
              Días de gracia
              <input
                min="0"
                type="number"
                value={subscriptionForm.grace_period_days}
                onChange={(event) => setSubscriptionForm((current) => ({ ...current, grace_period_days: event.target.value }))}
              />
            </label>
            <label className="checkbox-row">
              <input
                checked={subscriptionForm.enforcement_enabled}
                type="checkbox"
                onChange={(event) => setSubscriptionForm((current) => ({ ...current, enforcement_enabled: event.target.checked }))}
              />
              <span>Habilitar bloqueo automático por falta de pago</span>
            </label>
            <label className="form-span-2">
              Motivo del ajuste manual
              <textarea
                value={subscriptionForm.manual_adjustment_reason}
                onChange={(event) => setSubscriptionForm((current) => ({ ...current, manual_adjustment_reason: event.target.value }))}
                placeholder="Ejemplo: regularización de cliente existente"
              />
            </label>
            <div className="info-card form-span-2">
              <p><strong>Estado actual:</strong> {getSubscriptionStatusLabel(selectedBusiness.subscription)}</p>
              <p><strong>Enforcement:</strong> {selectedBusiness.subscription?.enforcement_enabled ? "Activo" : "Desactivado"}</p>
              <p><strong>Próximo pago visible para el negocio:</strong> {selectedBusiness.subscription?.next_payment_date ? shortDate(selectedBusiness.subscription.next_payment_date) : "Sin configurar"}</p>
            </div>
            <button className="button" disabled={savingSubscription} type="submit">
              {savingSubscription ? "Guardando..." : "Guardar suscripción"}
            </button>
          </form>

          <form className="panel grid-form" onSubmit={handleLoadStamps}>
            <div className="panel-header">
              <div>
                <h2>Carga manual de timbres</h2>
                <p className="muted">Cada carga genera movimiento auditable con actor, cantidad y saldo final.</p>
              </div>
            </div>
            <div className="info-card form-span-2">
              <p><strong>Timbres disponibles:</strong> {selectedBusiness.stamps_available ?? 0}</p>
              <p><strong>Timbres usados:</strong> {selectedBusiness.stamps_used ?? 0}</p>
            </div>
            <label>
              Cantidad
              <input min="1" type="number" value={stampQuantity} onChange={(event) => setStampQuantity(event.target.value)} required />
            </label>
            <label className="form-span-2">
              Nota o motivo
              <textarea value={stampNote} onChange={(event) => setStampNote(event.target.value)} placeholder="Opcional" />
            </label>
            <button className="button" disabled={loadingStamps} type="submit">
              {loadingStamps ? "Registrando..." : "Registrar carga de timbres"}
            </button>
          </form>

          <div className="panel form-span-2">
            <div className="panel-header">
              <div>
                <h2>Últimos movimientos de timbres</h2>
                <p className="muted">Historial reciente del negocio seleccionado.</p>
              </div>
            </div>
            {loadingMovements ? <p className="muted">Cargando movimientos...</p> : null}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Cantidad</th>
                    <th>Saldo antes</th>
                    <th>Saldo después</th>
                    <th>Actor</th>
                    <th>Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {stampMovements.map((movement) => (
                    <tr key={movement.id}>
                      <td>{shortDateTime(movement.created_at)}</td>
                      <td>{movement.movement_type}</td>
                      <td>{movement.quantity}</td>
                      <td>{movement.balance_before}</td>
                      <td>{movement.balance_after}</td>
                      <td>{movement.actor_name || "-"}</td>
                      <td>{movement.note || "-"}</td>
                    </tr>
                  ))}
                  {!loadingMovements && !stampMovements.length ? (
                    <tr>
                      <td className="muted" colSpan={7}>No hay movimientos registrados para este negocio.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
