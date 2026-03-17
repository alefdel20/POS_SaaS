import { AnkodeLogo } from "./AnkodeLogo";
import { useAuth } from "../context/AuthContext";
import { getRoleLabel } from "../utils/uiLabels";

export function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="header">
      <div className="header-brand-block">
        <div className="header-brand">
          <AnkodeLogo className="header-logo" size={34} />
          <p className="header-title">POS APP</p>
        </div>
        <p className="header-subtitle">{user?.full_name} | {getRoleLabel(user?.role)}</p>
      </div>
      <button className="button ghost" onClick={logout}>
        Cerrar sesion
      </button>
    </header>
  );
}
