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
import { canUseCreditCollections, getSidebarSectionsForPosType } from "../utils/pos";

function isRoleAllowed(role?: string | null, roleGroup: "sales" | "users" | "dailyCut" | "management" | "invoices" | "businesses" | "all" = "all") {
  if (roleGroup === "all") return true;
  if (roleGroup === "sales") return canAccessSales(role);
  if (roleGroup === "users") return canViewUsers(role);
  if (roleGroup === "dailyCut") return canAccessDailyCut(role);
  if (roleGroup === "management") return isManagementRole(role);
  if (roleGroup === "invoices") return canAccessInvoices(role);
  if (roleGroup === "businesses") return canAccessBusinesses(role);
  return false;
}

export function Sidebar() {
  const { user } = useAuth();
  const currentRole = user?.role;
  const canShowCreditCollections = canUseCreditCollections(user?.pos_type);
  const sections = getSidebarSectionsForPosType(user?.pos_type)
    .map((section) => ({
      ...section,
      links: section.links
        .filter((link) => isRoleAllowed(currentRole, link.roles || "all"))
        .filter((link) => link.to !== "/credit-collections" || canShowCreditCollections)
    }))
    .filter((section) => section.links.length > 0);

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
        {sections.map((section) => (
          <div className="nav-section" key={section.title}>
            <p className="nav-section-title">{section.title}</p>
            <div className="nav-section-links">
              {section.links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
                >
                  {link.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
