import { NavLink } from "react-router-dom";
import { AnkodeLogo } from "./AnkodeLogo";
import { useAuth } from "../context/AuthContext";
import { canViewUsers, isManagementRole, normalizeRole } from "../utils/roles";

const links = [
  { to: "/dashboard", label: "Resumen", managementOnly: true },
  { to: "/sales", label: "Ventas", salesOnly: true },
  { to: "/profile", label: "Perfil", managementOnly: true },
  { to: "/products", label: "Productos", managementOnly: true },
  { to: "/remate", label: "Remate", managementOnly: true },
  { to: "/finances", label: "Finanzas", managementOnly: true },
  { to: "/users", label: "Usuarios", managementOnly: false, usersOnly: true },
  { to: "/sales-history", label: "Historial", managementOnly: true },
  { to: "/credit-collections", label: "Credito y Cobranza", managementOnly: true },
  { to: "/daily-cut", label: "Corte Diario", managementOnly: true },
  { to: "/reminders", label: "Recordatorios" }
];

export function Sidebar() {
  const { user } = useAuth();
  const managementUser = isManagementRole(user?.role);
  const usersViewer = canViewUsers(user?.role);
  const role = normalizeRole(user?.role);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <AnkodeLogo className="sidebar-logo" size={30} variant="icon" alt="ANKODE K" />
          <div className="brand">POS APP</div>
        </div>
        <p className="brand-subtitle">Panel comercial oscuro</p>
      </div>
      <nav className="nav-list">
        {links
          .filter((link) => {
            if (!role) return false;
            if (link.usersOnly) {
              return usersViewer;
            }
            if (link.salesOnly) {
              return role === "superusuario" || role === "admin" || role === "cajero";
            }
            return !link.managementOnly || managementUser;
          })
          .map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            >
              {link.label}
            </NavLink>
          ))}
      </nav>
    </aside>
  );
}
