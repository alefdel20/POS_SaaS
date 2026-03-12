import { useAuth } from "../context/AuthContext";

export function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="header">
      <div>
        <p className="header-title">Punto de Venta</p>
        <p className="header-subtitle">{user?.full_name} · {user?.role}</p>
      </div>
      <button className="button ghost" onClick={logout}>
        Cerrar sesion
      </button>
    </header>
  );
}
