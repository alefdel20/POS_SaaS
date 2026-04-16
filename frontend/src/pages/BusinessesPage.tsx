import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { AuthResponse, Business, BusinessSubscription, PosType, Role, User } from "../types";
import { POS_TYPE_OPTIONS, getPosTypeLabel } from "../utils/pos";
import { shortDate, shortDateTime } from "../utils/format";
import { getRoleLabel } from "../utils/uiLabels";
import { normalizeRole } from "../utils/roles";

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

const MANAGED_USER_ROLES: Role[] = ["admin", "clinico", "cajero", "soporte"];

const emptyBusinessForm = {
  name: "",
  slug: "",
  pos_type: "Tienda" as PosType
};

const emptyUserForm = {
  username: "",
  email: "",
  full_name: "",
  password: "",
  role: "cajero" as Role
};

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

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

function isProtectedSupportUser(user: User) {
  const role = normalizeRole(user.role);
  const username = String(user.username || "").toLowerCase();
  const email = String(user.email || "").toLowerCase();
  const fullName = String(user.full_name || "").toLowerCase();

  return role === "soporte"
    && (
      username.startsWith("soporte")
      || email.startsWith("soporte+")
      || email.endsWith("@ankode.local")
      || fullName.startsWith("soporte")
    );
}

export function BusinessesPage() {
  const { token, user: currentUser, setSession } = useAuth();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState(emptyBusinessForm);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [selectedBusinessId, setSelectedBusinessId] = useState<number | null>(null);
  const [subscriptionForm, setSubscriptionForm] = useState(() => toSubscriptionForm(null));
  const [paymentDate, setPaymentDate] = useState(getTodayIsoDate());
  const [paymentNote, setPaymentNote] = useState("");
  const [stampQuantity, setStampQuantity] = useState("1");
  const [stampNote, setStampNote] = useState("");
  const [stampMovements, setStampMovements] = useState<StampMovement[]>([]);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [savingSubscription, setSavingSubscription] = useState(false);
  const [registeringPayment, setRegisteringPayment] = useState(false);
  const [loadingStamps, setLoadingStamps] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [savingUser, setSavingUser] = useState(false);

  const selectedBusiness = useMemo(
    () => businesses.find((business) => business.id === selectedBusinessId) || null,
    [businesses, selectedBusinessId]
  );

  const selectedBusinessUsers = useMemo(
    () => users.filter((item) => item.business_id === selectedBusinessId),
    [users, selectedBusinessId]
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

  async function loadUsers() {
    if (!token) return;
    try {
      setLoadingUsers(true);
      const response = await apiRequest<User[]>("/users", { token });
      setUsers(response);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar usuarios");
      setUsers([]);
    } finally {
      setLoadingUsers(false);
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
    loadUsers().catch(() => undefined);
  }, [token]);

  useEffect(() => {
    setSubscriptionForm(toSubscriptionForm(selectedBusiness?.subscription));
    setPaymentDate(getTodayIsoDate());
    setPaymentNote("");
    setStampQuantity("1");
    setStampNote("");
    setUserForm(emptyUserForm);
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
      await loadUsers();
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
      setInfo("Suscripcion actualizada correctamente");
      await loadBusinesses();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible actualizar la suscripcion");
    } finally {
      setSavingSubscription(false);
    }
  }

  async function handleRegisterPayment(event: FormEvent) {
    event.preventDefault();
    if (!token || !selectedBusiness) return;

    try {
      setRegisteringPayment(true);
      setError("");
      setInfo("");
      await apiRequest<BusinessSubscription>(`/businesses/${selectedBusiness.id}/subscription/register-payment`, {
        method: "POST",
        token,
        body: JSON.stringify({
          paid_at: paymentDate || undefined,
          note: paymentNote.trim() || undefined
        })
      });
      setInfo("Pago de suscripcion registrado");
      setPaymentNote("");
      await loadBusinesses();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible registrar el pago");
    } finally {
      setRegisteringPayment(false);
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

  async function handleCreateUser(event: FormEvent) {
    event.preventDefault();
    if (!token || !selectedBusiness) return;

    try {
      setSavingUser(true);
      setError("");
      setInfo("");
      await apiRequest<User>("/users", {
        method: "POST",
        token,
        body: JSON.stringify({
          ...userForm,
          business_id: selectedBusiness.id
        })
      });
      setUserForm(emptyUserForm);
      setInfo("Usuario creado correctamente");
      await loadBusinesses();
      await loadUsers();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible crear el usuario");
    } finally {
      setSavingUser(false);
    }
  }

  async function updateRole(target: User, role: Role) {
    if (!token || isProtectedSupportUser(target)) return;
    try {
      setError("");
      setInfo("");
      await apiRequest<User>(`/users/${target.id}`, {
        method: "PUT",
        token,
        body: JSON.stringify({
          username: target.username,
          email: target.email,
          full_name: target.full_name,
          role,
          business_id: target.business_id,
          is_active: target.is_active
        })
      });
      await loadUsers();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "No fue posible actualizar el rol");
    }
  }

  async function toggleUserStatus(target: User) {
    if (!token || isProtectedSupportUser(target)) return;
    try {
      setError("");
      setInfo("");
      await apiRequest<User>(`/users/${target.id}/status`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ is_active: !target.is_active })
      });
      await loadBusinesses();
      await loadUsers();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "No fue posible actualizar el usuario");
    }
  }

  async function resetPassword(target: User) {
    if (!token || isProtectedSupportUser(target)) return;
    const newPassword = window.prompt(`Nueva contrasena para ${target.username} (deja vacio para generacion automatica):`, "") || "";
    const forceChange = window.confirm("Forzar cambio en el siguiente login?");

    try {
      setError("");
      const response = await apiRequest<{ temporary_password: string }>(`/users/${target.id}/reset-password`, {
        method: "POST",
        token,
        body: JSON.stringify({
          new_password: newPassword.trim() || undefined,
          force_change: forceChange
        })
      });
      setInfo(`Contrasena temporal para ${target.username}: ${response.temporary_password}`);
      await loadUsers();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "No fue posible resetear la contrasena");
    }
  }

  async function toggleSupportMode(target: User) {
    if (!token || normalizeRole(target.role) === "superusuario" || isProtectedSupportUser(target)) return;
    const isCurrentSupportTarget = currentUser?.support_context?.target_user_id === target.id;
    const reason = window.prompt(
      isCurrentSupportTarget ? "Motivo de salida de soporte:" : "Motivo de activacion de soporte:",
      isCurrentSupportTarget ? "Salida manual de soporte" : "Revision operativa"
    );
    if (!reason?.trim()) return;

    try {
      setError("");
      setInfo("");
      const endpoint = `/users/${target.id}/support-mode/${isCurrentSupportTarget ? "deactivate" : "activate"}`;
      const response = await apiRequest<AuthResponse>(endpoint, {
        method: "POST",
        token,
        body: JSON.stringify({ reason: reason.trim() })
      });
      setSession(response);
      await loadUsers();
      setInfo(isCurrentSupportTarget ? "Modo soporte desactivado" : "Modo soporte activado");
    } catch (supportError) {
      setError(supportError instanceof Error ? supportError.message : "No fue posible actualizar el modo soporte");
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
            <p className="muted">Selecciona un negocio para gestionar usuarios, suscripcion y timbres desde un solo contexto.</p>
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
                <th>Proximo pago</th>
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
                <h2>Suscripcion de {selectedBusiness.name}</h2>
                <p className="muted">Ajuste de plan y fechas sin perder trazabilidad.</p>
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
              Proxima fecha de pago
              <input
                type="date"
                value={subscriptionForm.next_payment_date}
                onChange={(event) => setSubscriptionForm((current) => ({ ...current, next_payment_date: event.target.value }))}
              />
            </label>
            <label>
              Dias de gracia
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
              <span>Habilitar bloqueo automatico por falta de pago</span>
            </label>
            <label className="form-span-2">
              Motivo del ajuste manual
              <textarea
                value={subscriptionForm.manual_adjustment_reason}
                onChange={(event) => setSubscriptionForm((current) => ({ ...current, manual_adjustment_reason: event.target.value }))}
                placeholder="Ejemplo: regularizacion de cliente existente"
              />
            </label>
            <div className="info-card form-span-2">
              <p><strong>Estado actual:</strong> {getSubscriptionStatusLabel(selectedBusiness.subscription)}</p>
              <p><strong>Enforcement:</strong> {selectedBusiness.subscription?.enforcement_enabled ? "Activo" : "Desactivado"}</p>
              <p><strong>Proximo pago visible para el negocio:</strong> {selectedBusiness.subscription?.next_payment_date ? shortDate(selectedBusiness.subscription.next_payment_date) : "Sin configurar"}</p>
              <p><strong>Ultimo pago registrado:</strong> {selectedBusiness.subscription?.last_payment_date ? shortDate(selectedBusiness.subscription.last_payment_date) : "Sin registro"}</p>
            </div>
            <button className="button" disabled={savingSubscription} type="submit">
              {savingSubscription ? "Guardando..." : "Guardar suscripcion"}
            </button>
          </form>

          <form className="panel grid-form" onSubmit={handleRegisterPayment}>
            <div className="panel-header">
              <div>
                <h2>Registrar pago</h2>
                <p className="muted">Confirma pago manual para recalcular proxima fecha y evitar bloqueos indebidos.</p>
              </div>
            </div>
            <label>
              Fecha de pago
              <input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
            </label>
            <label className="form-span-2">
              Nota de pago
              <textarea value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} placeholder="Referencia, folio o comentario" />
            </label>
            <button className="button" disabled={registeringPayment} type="submit">
              {registeringPayment ? "Registrando..." : "Marcar como pagado"}
            </button>
          </form>

          <form className="panel grid-form" onSubmit={handleCreateUser}>
            <div className="panel-header">
              <div>
                <h2>Crear usuario para {selectedBusiness.name}</h2>
                <p className="muted">Alta directa dentro del contexto del negocio seleccionado.</p>
              </div>
            </div>
            <label>
              Nombre completo *
              <input value={userForm.full_name} onChange={(event) => setUserForm((current) => ({ ...current, full_name: event.target.value }))} required />
            </label>
            <label>
              Usuario *
              <input value={userForm.username} onChange={(event) => setUserForm((current) => ({ ...current, username: event.target.value }))} required />
            </label>
            <label>
              Correo *
              <input type="email" value={userForm.email} onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))} required />
            </label>
            <label>
              Contrasena *
              <input type="text" value={userForm.password} onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))} required />
            </label>
            <label>
              Rol *
              <select value={userForm.role} onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value as Role }))}>
                {MANAGED_USER_ROLES.map((role) => (
                  <option key={role} value={role}>{getRoleLabel(role)}</option>
                ))}
              </select>
            </label>
            <button className="button" disabled={savingUser} type="submit">
              {savingUser ? "Creando..." : "Crear usuario"}
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
                <h2>Usuarios de {selectedBusiness.name}</h2>
                <p className="muted">Activar/desactivar, resetear contrasena y activar soporte desde la vista de negocios.</p>
              </div>
            </div>
            {loadingUsers ? <p className="muted">Cargando usuarios...</p> : null}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Seguridad</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedBusinessUsers.map((item) => {
                    const isCurrentSupportTarget = currentUser?.support_context?.target_user_id === item.id;
                    return (
                      <tr key={item.id}>
                        <td>{item.full_name}</td>
                        <td>{item.username}</td>
                        <td>
                          {isProtectedSupportUser(item) || normalizeRole(item.role) === "superusuario" ? (
                            getRoleLabel(item.role)
                          ) : (
                            <select
                              value={normalizeRole(item.role) || "cajero"}
                              onChange={(event) => updateRole(item, event.target.value as Role)}
                            >
                              {MANAGED_USER_ROLES.map((role) => (
                                <option key={role} value={role}>{getRoleLabel(role)}</option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td>{item.is_active ? "Activo" : "Inactivo"}</td>
                        <td>{isProtectedSupportUser(item) ? "Protegido" : item.must_change_password ? "Cambio requerido" : "Normal"}</td>
                        <td>
                          <div className="inline-actions">
                            {!isProtectedSupportUser(item) && normalizeRole(item.role) !== "superusuario" ? (
                              <button className="button ghost" onClick={() => toggleUserStatus(item)} type="button">
                                {item.is_active ? "Desactivar" : "Activar"}
                              </button>
                            ) : null}
                            {!isProtectedSupportUser(item) && normalizeRole(item.role) !== "superusuario" ? (
                              <button className="button ghost" onClick={() => resetPassword(item)} type="button">Resetear contrasena</button>
                            ) : null}
                            {!isProtectedSupportUser(item) && normalizeRole(item.role) !== "superusuario" ? (
                              <button className="button ghost" onClick={() => toggleSupportMode(item)} type="button">
                                {isCurrentSupportTarget ? "Desactivar soporte" : "Activar soporte"}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!loadingUsers && !selectedBusinessUsers.length ? (
                    <tr>
                      <td className="muted" colSpan={6}>No hay usuarios registrados para este negocio.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel form-span-2">
            <div className="panel-header">
              <div>
                <h2>Ultimos movimientos de timbres</h2>
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
                    <th>Saldo despues</th>
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
