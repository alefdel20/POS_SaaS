import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const links = [
  { to: "/", label: "Resumen", roles: ["superadmin"] },
  { to: "/sales", label: "Ventas", roles: ["superadmin", "user"] },
  { to: "/products", label: "Productos", roles: ["superadmin"] },
  { to: "/users", label: "Usuarios", roles: ["superadmin"] },
  { to: "/sales-history", label: "Historial", roles: ["superadmin"] },
  { to: "/daily-cut", label: "Corte Diario", roles: ["superadmin"] },
  { to: "/reminders", label: "Recordatorios", roles: ["superadmin", "user"] }
];

export function Sidebar() {
  const { user } = useAuth();

  return (
    <aside className="sidebar">
      <div>
        <div className="brand">POS APP</div>
        <p className="brand-subtitle">Dark retail dashboard</p>
      </div>
      <nav className="nav-list">
        {links
          .filter((link) => user && link.roles.includes(user.role))
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
