import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { AnkodeLogo } from "./AnkodeLogo";
import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../api/client";
import { getSidebarSectionsForVertical, type SidebarMenuItem } from "../utils/navigation";
import { canUseCreditCollections } from "../utils/pos";
import type { ProductUpdateRequestPendingSummary } from "../types";
import { isManagementRole } from "../utils/roles";

function itemMatchesPath(item: SidebarMenuItem, pathname: string) {
  const matches = item.activeMatch || (item.to ? [item.to] : []);
  return matches.some((match) => pathname === match);
}

function itemHasActiveDescendant(item: SidebarMenuItem, pathname: string) {
  return Boolean(item.children?.some((child) => itemMatchesPath(child, pathname) || itemHasActiveDescendant(child, pathname)));
}

type SidebarBranchProps = {
  item: SidebarMenuItem;
  pathname: string;
  badges?: Record<string, number>;
  level?: number;
};

function SidebarBranch({ item, pathname, badges = {}, level = 0 }: SidebarBranchProps) {
  const isActive = itemMatchesPath(item, pathname);
  const hasActiveDescendant = itemHasActiveDescendant(item, pathname);
  const [isOpen, setIsOpen] = useState(hasActiveDescendant);
  const badgeValue = item.to ? badges[item.to] || 0 : 0;

  useEffect(() => {
    if (hasActiveDescendant) {
      setIsOpen(true);
    }
  }, [hasActiveDescendant]);

  if (item.children?.length) {
    return (
      <div className={`nav-tree-item nav-tree-level-${level}`}>
        <button
          className={`nav-tree-toggle ${isOpen ? "expanded" : ""}`}
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          <span>{item.label}</span>
          <span className="nav-tree-indicator">{isOpen ? "−" : "+"}</span>
        </button>
        {isOpen ? (
          <div className="nav-tree-children">
            {item.children.map((child) => (
              <SidebarBranch item={child} key={`${item.label}-${child.label}-${child.to || "group"}`} badges={badges} level={level + 1} pathname={pathname} />
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
      className={() => `nav-link nav-link-level-${level} ${isActive ? "active" : ""}`}
      end
    >
      <span>{item.label}</span>
      {badgeValue > 0 ? <span className="status-badge">{badgeValue}</span> : null}
    </NavLink>
  );
}

export function Sidebar() {
  const { user, token } = useAuth();
  const location = useLocation();
  const currentRole = user?.role;
  const canShowCreditCollections = canUseCreditCollections(user?.pos_type);
  const [badges, setBadges] = useState<Record<string, number>>({});
  const sections = useMemo(
    () => getSidebarSectionsForVertical(user?.pos_type, currentRole, canShowCreditCollections),
    [canShowCreditCollections, currentRole, user?.pos_type]
  );

  useEffect(() => {
    if (!token || !user?.business_id || !isManagementRole(user.role)) {
      setBadges({});
      return;
    }

    let cancelled = false;
    async function loadBadges() {
      const response = await apiRequest<ProductUpdateRequestPendingSummary>("/product-update-requests/pending-summary", { token });
      if (!cancelled) {
        setBadges({
          "/product-update-requests": response.pending_count
        });
      }
    }

    function refreshBadges() {
      loadBadges().catch(() => {
        if (!cancelled) {
          setBadges({});
        }
      });
    }

    refreshBadges();
    window.addEventListener("product-update-requests:refresh-banner", refreshBadges);
    return () => {
      cancelled = true;
      window.removeEventListener("product-update-requests:refresh-banner", refreshBadges);
    };
  }, [token, user?.business_id, user?.role]);

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
                <SidebarBranch item={item} key={`${section.title}-${item.label}-${item.to || "group"}`} badges={badges} pathname={location.pathname} />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
