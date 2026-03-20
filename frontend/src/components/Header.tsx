import { useAuth } from "../context/AuthContext";
import { getRoleLabel } from "../utils/uiLabels";

export function Header() {
  const { user, logout } = useAuth();

  return (
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
  );
}
