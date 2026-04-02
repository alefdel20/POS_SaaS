import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import type { AuthResponse } from "../types";
import { getRoleLabel } from "../utils/uiLabels";

export function Header() {
  const { token, user, logout, setSession } = useAuth();

  async function exitSupportMode() {
    if (!token || !user?.support_context) return;
    const response = await apiRequest<AuthResponse>(`/users/${user.support_context.target_user_id}/support-mode/deactivate`, {
      method: "POST",
      token,
      body: JSON.stringify({ reason: "Salida manual de soporte" })
    });
    setSession(response);
  }

  return (
    <>
      {user?.support_context ? (
        <div className="support-banner">
          <div className="support-banner-copy">
            <strong>Estas en modo soporte</strong>
            <span>Negocio: {user.support_context.business_name}</span>
            <span>Motivo: {user.support_context.reason}</span>
          </div>
          <button className="button ghost" onClick={exitSupportMode} type="button">
            Salir de soporte
          </button>
        </div>
      ) : null}
      <header className="header">
        <div className="header-brand-block">
          <p className="header-title">POS APP</p>
          <p className="header-subtitle">
            {user?.full_name} | {getRoleLabel(user?.role)}{user?.business_name ? ` | ${user.business_name}` : ""}
          </p>
        </div>
        <button className="button ghost" onClick={logout}>
          Cerrar sesion
        </button>
      </header>
    </>
  );
}
