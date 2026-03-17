import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { PosType, Role, User } from "../types";
import { getRoleLabel } from "../utils/uiLabels";
import { normalizeRole } from "../utils/roles";

const POS_TYPES: PosType[] = ["Tlapaleria", "Tienda", "Farmacia", "Papeleria", "Otro"];

const emptyUser = {
  username: "",
  email: "",
  full_name: "",
  password: "",
  role: "cajero" as Role,
  pos_type: "Otro" as PosType
};

export function UsersPage() {
  const { token, user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState(emptyUser);
  const [error, setError] = useState("");

  const currentRole = normalizeRole(currentUser?.role);
  const roleOptions = useMemo(() => {
    if (currentRole === "superusuario") {
      return ["admin", "cajero"] as const;
    }

    if (currentRole === "admin") {
      return ["cajero"] as const;
    }

    return [] as const;
  }, [currentRole]);

  function loadUsers() {
    if (!token) return;
    apiRequest<User[]>("/users", { token })
      .then(setUsers)
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "No fue posible cargar usuarios");
      });
  }

  useEffect(() => {
    loadUsers();
  }, [token]);

  useEffect(() => {
    if (!roleOptions.includes(form.role as typeof roleOptions[number])) {
      setForm((current) => ({ ...current, role: roleOptions[0] || "cajero" }));
    }
  }, [roleOptions]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    try {
      setError("");
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
    if (!token) return;
    try {
      setError("");
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

  return (
    <section className="page-grid two-columns">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Usuarios retail</h2>
            <p className="muted">Superusuario crea admins y cajeros. Admin solo crea cajeros.</p>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Usuario</th>
                <th>Rol</th>
                <th>POS</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.full_name}</td>
                  <td>{user.username}</td>
                  <td>{getRoleLabel(user.role)}</td>
                  <td>{user.pos_type || "Otro"}</td>
                  <td>{user.is_active ? "Activo" : "Inactivo"}</td>
                  <td>
                    <button className="button ghost" onClick={() => toggleUserStatus(user)} type="button">
                      {user.is_active ? "Desactivar" : "Activar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <form className="panel grid-form" onSubmit={handleSubmit}>
        <div className="panel-header">
          <h2>Nuevo usuario</h2>
        </div>
        <label>
          Nombre completo
          <input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} required />
        </label>
        <label>
          Usuario
          <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required />
        </label>
        <label>
          Correo electronico
          <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
        </label>
        <label>
          Contrasena
          <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
        </label>
        <label>
          Rol
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>
            {roleOptions.map((role) => (
              <option key={role} value={role}>{getRoleLabel(role)}</option>
            ))}
          </select>
        </label>
        <label>
          Tipo de POS
          <select value={form.pos_type} onChange={(event) => setForm({ ...form, pos_type: event.target.value as PosType })}>
            {POS_TYPES.map((posType) => (
              <option key={posType} value={posType}>{posType}</option>
            ))}
          </select>
        </label>
        <button className="button" disabled={!roleOptions.length} type="submit">Crear usuario</button>
      </form>
    </section>
  );
}
