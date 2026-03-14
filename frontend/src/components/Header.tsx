import { useAuth } from "../context/AuthContext";
import { getRoleLabel } from "../utils/uiLabels";

export function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="header">
      <div>
        <p className="header-title">Punto de Venta</p>
        <p className="header-subtitle">{user?.full_name} | {getRoleLabel(user?.role)}</p>
      </div>
      <button className="button ghost" onClick={logout}>
        Cerrar sesion
      </button>
    </header>
  );
}
