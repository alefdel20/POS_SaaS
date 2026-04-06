import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { AnkodeLogo } from "./AnkodeLogo";
import { useAuth } from "../context/AuthContext";
import { getSidebarSectionsForVertical, type SidebarMenuItem } from "../utils/navigation";
import { canUseCreditCollections } from "../utils/pos";

function itemIsActive(item: SidebarMenuItem, pathname: string) {
  const matches = item.activeMatch || (item.to ? [item.to] : []);
  if (matches.some((match) => pathname === match || pathname.startsWith(`${match}/`))) {
    return true;
  }
  return Boolean(item.children?.some((child) => itemIsActive(child, pathname)));
}

type SidebarBranchProps = {
  item: SidebarMenuItem;
  pathname: string;
  level?: number;
};

function SidebarBranch({ item, pathname, level = 0 }: SidebarBranchProps) {
  const isActive = itemIsActive(item, pathname);
  const [isOpen, setIsOpen] = useState(isActive);

  useEffect(() => {
    if (isActive) {
      setIsOpen(true);
    }
  }, [isActive]);

  if (item.children?.length) {
    return (
      <div className={`nav-tree-item nav-tree-level-${level}`}>
        <button
          className={`nav-tree-toggle ${isActive ? "active" : ""}`}
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          <span>{item.label}</span>
          <span className="nav-tree-indicator">{isOpen ? "−" : "+"}</span>
        </button>
        {isOpen ? (
          <div className="nav-tree-children">
            {item.children.map((child) => (
              <SidebarBranch item={child} key={`${item.label}-${child.label}-${child.to || "group"}`} level={level + 1} pathname={pathname} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (!item.to) return null;

  return (
    <NavLink
      to={item.to}
      className={({ isActive: isCurrentRoute }) => `nav-link nav-link-level-${level} ${isCurrentRoute || isActive ? "active" : ""}`}
      end
    >
      {item.label}
    </NavLink>
  );
}

export function Sidebar() {
  const { user } = useAuth();
  const location = useLocation();
  const currentRole = user?.role;
  const canShowCreditCollections = canUseCreditCollections(user?.pos_type);
  const sections = useMemo(
    () => getSidebarSectionsForVertical(user?.pos_type, currentRole, canShowCreditCollections),
    [canShowCreditCollections, currentRole, user?.pos_type]
  );

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
            <div className="nav-tree">
              {section.items.map((item) => (
                <SidebarBranch item={item} key={`${section.title}-${item.label}-${item.to || "group"}`} pathname={location.pathname} />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
