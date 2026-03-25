import { NavLink } from "react-router-dom";
import { AnkodeLogo } from "./AnkodeLogo";
import { useAuth } from "../context/AuthContext";
import {
  canAccessBusinesses,
  canAccessDailyCut,
  canAccessInvoices,
  canAccessSales,
  canViewUsers,
  isManagementRole
} from "../utils/roles";

const links = [
  { to: "/profile", label: "Perfil", isVisible: isManagementRole, pinned: true },
  { to: "/businesses", label: "Negocios", isVisible: canAccessBusinesses },
  { to: "/credit-collections", label: "Credito y Cobranza", isVisible: isManagementRole },
  { to: "/daily-cut", label: "Corte Diario", isVisible: canAccessDailyCut },
  { to: "/finances", label: "Finanzas", isVisible: isManagementRole },
  { to: "/invoices", label: "Facturas", isVisible: canAccessInvoices },
  { to: "/sales-history", label: "Historial", isVisible: isManagementRole },
  { to: "/products", label: "Productos", isVisible: isManagementRole },
  { to: "/remate", label: "Remate", isVisible: isManagementRole },
  { to: "/reminders", label: "Recordatorios", isVisible: () => true },
  { to: "/dashboard", label: "Resumen", isVisible: isManagementRole },
  { to: "/suppliers", label: "Proveedores", isVisible: isManagementRole },
  { to: "/users", label: "Usuarios", isVisible: canViewUsers },
  { to: "/sales", label: "Ventas", isVisible: canAccessSales }
];

export function Sidebar() {
  const { user } = useAuth();
  const currentRole = user?.role;

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
          .filter((link) => link.isVisible(currentRole))
          .sort((left, right) => {
            if (left.pinned) return -1;
            if (right.pinned) return 1;
            return left.label.localeCompare(right.label, "es");
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
