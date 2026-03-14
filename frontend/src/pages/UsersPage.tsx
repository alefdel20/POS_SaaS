import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { User } from "../types";
import { getRoleLabel } from "../utils/uiLabels";

const emptyUser = {
  username: "",
  email: "",
  full_name: "",
  password: "",
  role: "user"
};

export function UsersPage() {
  const { token } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState(emptyUser);

  function loadUsers() {
    if (!token) return;
    apiRequest<User[]>("/users", { token }).then(setUsers).catch(console.error);
  }

  useEffect(() => {
    loadUsers();
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    await apiRequest<User>("/users", {
      method: "POST",
      token,
      body: JSON.stringify(form)
    });
    setForm(emptyUser);
    loadUsers();
  }

  async function toggleUserStatus(user: User) {
    if (!token) return;
    await apiRequest<User>(`/users/${user.id}/status`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ is_active: !user.is_active })
    });
    loadUsers();
  }

  return (
    <section className="page-grid two-columns">
      <div className="panel">
        <div className="panel-header">
          <h2>Usuarios</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Usuario</th>
                <th>Rol</th>
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
                  <td>{user.is_active ? "Activo" : "Inactivo"}</td>
                  <td>
                    <button className="button ghost" onClick={() => toggleUserStatus(user)}>
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
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as "user" | "superadmin" })}>
            <option value="user">{getRoleLabel("user")}</option>
            <option value="superadmin">{getRoleLabel("superadmin")}</option>
          </select>
        </label>
        <button className="button" type="submit">Crear usuario</button>
      </form>
    </section>
  );
}
