import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { PosType, Role, User } from "../types";
import { getRoleLabel } from "../utils/uiLabels";
import { canViewUsers, normalizeRole } from "../utils/roles";

const POS_TYPES: PosType[] = ["Tlapaleria", "Tienda", "Farmacia", "Papeleria", "Otro"];

const emptyUser = {
  username: "",
  email: "",
  full_name: "",
  password: "",
  role: "cajero" as Role,
  pos_type: "Otro" as PosType
};

function generatePassword() {
  return Math.random().toString(36).slice(2, 8) + "A9!";
}

export function UsersPage() {
  const { token, user: currentUser, refreshUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState(emptyUser);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [forceChange, setForceChange] = useState(true);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);

  const currentRole = normalizeRole(currentUser?.role);
  const canCreateUsers = currentRole === "superusuario" || currentRole === "admin";
  const canResetPasswords = currentRole === "superusuario";
  const canEditRoles = currentRole === "superusuario";

  const roleOptions = useMemo(() => {
    if (currentRole === "superusuario") {
      return ["superusuario", "admin", "cajero", "soporte"] as const;
    }

    if (currentRole === "admin") {
      return ["cajero"] as const;
    }

    return [] as const;
  }, [currentRole]);

  function loadUsers() {
    if (!token || !canViewUsers(currentRole)) return;
    apiRequest<User[]>("/users", { token })
      .then(setUsers)
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar usuarios");
      });
  }

  useEffect(() => {
    loadUsers();
  }, [token, currentRole]);

  useEffect(() => {
    if (roleOptions.length && !roleOptions.includes(form.role as typeof roleOptions[number])) {
      setForm((current) => ({ ...current, role: roleOptions[0] }));
    }
  }, [roleOptions]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token || !canCreateUsers) return;

    try {
      setError("");
      setInfo("");
      await apiRequest<User>("/users", {
        method: "POST",
        token,
        body: JSON.stringify(form)
      });
      setForm({ ...emptyUser, role: roleOptions[0] || "cajero" });
      loadUsers();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible crear el usuario");
    }
  }

  async function toggleUserStatus(user: User) {
    if (!token || currentRole === "soporte") return;
    try {
      setError("");
      setInfo("");
      await apiRequest<User>(`/users/${user.id}/status`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ is_active: !user.is_active })
      });
      loadUsers();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "No fue posible actualizar el usuario");
    }
  }

  async function updateRole(user: User, role: Role) {
    if (!token || !canEditRoles) return;
    try {
      setError("");
      setInfo("");
      await apiRequest<User>(`/users/${user.id}`, {
        method: "PUT",
        token,
        body: JSON.stringify({
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          role,
          pos_type: user.pos_type || "Otro",
          is_active: user.is_active
        })
      });
      loadUsers();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "No fue posible actualizar el rol");
    }
  }

  async function submitResetPassword() {
    if (!token || !resetTarget) return;

    try {
      setError("");
      const response = await apiRequest<{ temporary_password: string }>("/users/" + resetTarget.id + "/reset-password", {
        method: "POST",
        token,
        body: JSON.stringify({
          new_password: resetPassword || undefined,
          force_change: forceChange
        })
      });
      setInfo(`Contrasena temporal para ${resetTarget.username}: ${response.temporary_password}`);
      setResetTarget(null);
      setResetPassword("");
      setForceChange(true);
      loadUsers();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "No fue posible resetear la contrasena");
    }
  }

  async function toggleSupportMode(targetUser: User) {
    if (!token) return;
    const targetRole = normalizeRole(targetUser.role);
    if (targetRole !== "soporte") return;
    const nextAction = targetUser.support_mode_active ? "deactivate" : "activate";

    try {
      setError("");
      setInfo("");
      await apiRequest(`/users/${targetUser.id}/support-mode/${nextAction}`, {
        method: "POST",
        token,
        body: JSON.stringify({ reason: "Revision operativa" })
      });
      if (currentUser?.id === targetUser.id) {
        await refreshUser();
      }
      loadUsers();
    } catch (supportError) {
      setError(supportError instanceof Error ? supportError.message : "No fue posible actualizar el modo soporte");
    }
  }

  return (
    <section className="page-grid two-columns">
      <form className="panel grid-form" onSubmit={handleSubmit}>
        <div className="panel-header">
          <h2>Nuevo usuario</h2>
        </div>
        <label>
          Nombre completo *
          <input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} required />
        </label>
        <label>
          Usuario *
          <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required />
        </label>
        <label>
          Correo electrónico *
          <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
        </label>
        <label>
          Contraseña *
          <div className="input-with-action">
            <input
              type={showCreatePassword ? "text" : "password"}
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              required
            />
            <button className="button ghost input-action-button" onClick={() => setShowCreatePassword((current) => !current)} type="button">
              {showCreatePassword ? "Ocultar" : "Mostrar"}
            </button>
          </div>
        </label>
        <label>
          Rol *
          <select disabled={!canCreateUsers} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>
            {roleOptions.map((role) => (
              <option key={role} value={role}>{getRoleLabel(role)}</option>
            ))}
          </select>
        </label>
        <label>
          Tipo de POS *
          <select disabled={!canCreateUsers || currentRole !== "superusuario"} value={form.pos_type} onChange={(event) => setForm({ ...form, pos_type: event.target.value as PosType })}>
            {POS_TYPES.map((posType) => (
              <option key={posType} value={posType}>{posType}</option>
            ))}
          </select>
        </label>
        <button className="button" disabled={!canCreateUsers || !roleOptions.length} type="submit">Crear usuario</button>
      </form>

      <div className="panel form-span-2">
        <div className="panel-header">
          <div>
            <h2>Usuarios retail</h2>
            <p className="muted">Soporte solo puede consultar. Reset y cambio de roles solo para superusuario.</p>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        {info ? <p className="success-text">{info}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Usuario</th>
                <th>Rol</th>
                <th>POS</th>
                <th>Estado</th>
                <th>Seguridad</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.full_name}</td>
                  <td>{user.username}</td>
                  <td>
                    {canEditRoles ? (
                      <select
                        value={normalizeRole(user.role) || "cajero"}
                        onChange={(event) => updateRole(user, event.target.value as Role)}
                      >
                        <option value="superusuario">Superusuario</option>
                        <option value="admin">Admin</option>
                        <option value="cajero">Cajero</option>
                        <option value="soporte">Soporte</option>
                      </select>
                    ) : (
                      getRoleLabel(user.role)
                    )}
                  </td>
                  <td>{user.pos_type || "Otro"}</td>
                  <td>{user.is_active ? "Activo" : "Inactivo"}</td>
                  <td>{user.must_change_password ? "Cambio requerido" : "Normal"}</td>
                  <td>
                    <div className="inline-actions">
                      {currentRole !== "soporte" ? (
                        <button className="button ghost" onClick={() => toggleUserStatus(user)} type="button">
                          {user.is_active ? "Desactivar" : "Activar"}
                        </button>
                      ) : null}
                      {canResetPasswords ? (
                        <button className="button ghost" onClick={() => setResetTarget(user)} type="button">Resetear contrasena</button>
                      ) : null}
                      {(currentRole === "superusuario" || currentRole === "soporte") && normalizeRole(user.role) === "soporte"
                        ? (
                            <button className="button ghost" onClick={() => toggleSupportMode(user)} type="button">
                              {user.support_mode_active ? "Desactivar soporte" : "Activar soporte"}
                            </button>
                          )
                        : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {resetTarget ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card">
            <h3>Resetear contraseña</h3>
            <p>Asigna una contraseña manual o genera una temporal para {resetTarget.username}.</p>
            <label>
              Nueva contraseña
              <div className="input-with-action">
                <input
                  type={showResetPassword ? "text" : "password"}
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  placeholder="Dejar vacío para generar"
                />
                <button className="button ghost input-action-button" onClick={() => setShowResetPassword((current) => !current)} type="button">
                  {showResetPassword ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </label>
            <label className="checkbox-row">
              <input checked={forceChange} onChange={(event) => setForceChange(event.target.checked)} type="checkbox" />
              <span>Forzar cambio en siguiente login</span>
            </label>
            <div className="inline-actions">
              <button className="button ghost" onClick={() => setResetPassword(generatePassword())} type="button">Generar automatica</button>
              <button className="button" onClick={submitResetPassword} type="button">Confirmar</button>
              <button className="button ghost" onClick={() => setResetTarget(null)} type="button">Cancelar</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
