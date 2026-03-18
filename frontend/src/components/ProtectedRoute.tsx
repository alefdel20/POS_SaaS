import { FormEvent, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { Role } from "../types";
import { getDefaultRouteForRole, normalizeRole } from "../utils/roles";

function ForcedPasswordChange() {
  const { token, refreshUser, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;

    try {
      setSaving(true);
      setError("");
      await apiRequest("/auth/change-password", {
        method: "POST",
        token,
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword
        })
      });
      await refreshUser();
      setCurrentPassword("");
      setNewPassword("");
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "No fue posible cambiar la contrasena");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="screen-center">
      <form className="panel grid-form password-reset-panel" onSubmit={handleSubmit}>
        <div className="panel-header">
          <div>
            <h2>Cambio obligatorio de contrasena</h2>
            <p className="muted">Debes actualizar tu contrasena temporal antes de continuar.</p>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <label>
          Contrasena actual
          <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
        </label>
        <label>
          Nueva contrasena
          <input type="password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
        </label>
        <div className="inline-actions">
          <button className="button" disabled={saving} type="submit">{saving ? "Actualizando..." : "Cambiar contrasena"}</button>
          <button className="button ghost" onClick={logout} type="button">Cerrar sesion</button>
        </div>
      </form>
    </div>
  );
}

export function ProtectedRoute({ roles }: { roles?: Role[] }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="screen-center">Cargando...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.must_change_password) {
    return <ForcedPasswordChange />;
  }

  if (roles) {
    const userRole = normalizeRole(user.role);
    const allowedRoles = roles.map((role) => normalizeRole(role));

    if (!userRole || !allowedRoles.includes(userRole)) {
      return <Navigate to={getDefaultRouteForRole(user.role)} replace />;
    }
  }

  return <Outlet />;
}
