import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { AnkodeLogo } from "./AnkodeLogo";
import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../api/client";
import { getSidebarSectionsForVertical, type SidebarMenuItem } from "../utils/navigation";
import { canUseCreditCollections } from "../utils/pos";
import type { ProductUpdateRequestPendingSummary } from "../types";
import { isManagementRole } from "../utils/roles";

const NEW_TAB_ALLOWED_ROUTES = new Set<string>([
  "/products",
  "/retail/products",
  "/health/products/accessories",
  "/health/products/medications",
  "/suppliers",
  "/retail/suppliers",
  "/health/suppliers/accessories",
  "/health/suppliers/medications",
  "/sales-history",
  "/retail/history",
  "/finances",
  "/retail/admin/finances",
  "/health/admin/finances",
  "/invoices",
  "/retail/admin/invoices",
  "/health/admin/invoices",
  "/reminders",
  "/retail/admin/reminders",
  "/health/admin/reminders",
  "/users",
  "/retail/admin/users",
  "/health/admin/users",
  "/dashboard",
  "/retail/admin/summary",
  "/health/admin/summary"
]);

function itemMatchesPath(item: SidebarMenuItem, pathname: string) {
  const matches = item.activeMatch || (item.to ? [item.to] : []);
  return matches.some((match) => pathname === match);
}

function itemHasActiveDescendant(item: SidebarMenuItem, pathname: string) {
  return Boolean(item.children?.some((child) => itemMatchesPath(child, pathname) || itemHasActiveDescendant(child, pathname)));
}

function buildNodeKey(parentKey: string, item: SidebarMenuItem, index: number) {
  return `${parentKey}-${item.label}-${item.to || "group"}-${index}`;
}

function toDomId(value: string) {
  return `sidebar-${value.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function canOpenInNewTab(item: SidebarMenuItem) {
  return item.to ? NEW_TAB_ALLOWED_ROUTES.has(item.to) : false;
}

type SidebarBranchProps = {
  item: SidebarMenuItem;
  nodeKey: string;
  pathname: string;
  badges?: Record<string, number>;
  expandedItems: Record<string, boolean>;
  onToggle: (key: string) => void;
  onNavigate: () => void;
  onOpenHere: (to: string) => void;
  onOpenInNewTab: (to: string) => void;
  openContextMenuKey: string | null;
  setOpenContextMenuKey: (key: string | null) => void;
  level?: number;
};

function SidebarBranch({
  item,
  nodeKey,
  pathname,
  badges = {},
  expandedItems,
  onToggle,
  onNavigate,
  onOpenHere,
  onOpenInNewTab,
  openContextMenuKey,
  setOpenContextMenuKey,
  level = 0
}: SidebarBranchProps) {
  const isActive = itemMatchesPath(item, pathname);
  const hasActiveDescendant = itemHasActiveDescendant(item, pathname);
  const isOpen = hasActiveDescendant || Boolean(expandedItems[nodeKey]);
  const badgeValue = item.to ? badges[item.to] || 0 : 0;
  const hasContextMenu = canOpenInNewTab(item);
  const isContextMenuOpen = openContextMenuKey === nodeKey;
  const submenuId = toDomId(nodeKey);

  if (item.children?.length) {
    return (
      <div className={`nav-tree-item nav-tree-level-${level}`}>
        <button
          aria-controls={submenuId}
          aria-expanded={isOpen}
          className={`nav-tree-toggle ${isOpen ? "expanded" : ""} ${hasActiveDescendant ? "has-active-child" : ""}`}
          onClick={() => onToggle(nodeKey)}
          type="button"
        >
          <span>{item.label}</span>
          <span aria-hidden="true" className="nav-tree-indicator">{isOpen ? "▾" : "▸"}</span>
        </button>
        {isOpen ? (
          <div className="nav-tree-children" id={submenuId}>
            {item.children.map((child, childIndex) => {
              const childKey = buildNodeKey(nodeKey, child, childIndex);
              return (
                <SidebarBranch
                  item={child}
                  key={childKey}
                  nodeKey={childKey}
                  badges={badges}
                  expandedItems={expandedItems}
                  level={level + 1}
                  onNavigate={onNavigate}
                  onOpenHere={onOpenHere}
                  onOpenInNewTab={onOpenInNewTab}
                  onToggle={onToggle}
                  openContextMenuKey={openContextMenuKey}
                  pathname={pathname}
                  setOpenContextMenuKey={setOpenContextMenuKey}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  if (!item.to) return null;

  const handleLinkClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    onNavigate();
    setOpenContextMenuKey(null);
  };

  if (hasContextMenu) {
    return (
      <div className={`nav-link-with-menu nav-link-level-${level}`}>
        <NavLink
          to={item.to}
          className={() => `nav-link ${isActive ? "active" : ""}`}
          end
          onClick={handleLinkClick}
        >
          <span>{item.label}</span>
          {badgeValue > 0 ? <span className="status-badge">{badgeValue}</span> : null}
        </NavLink>
        <div className="nav-link-menu-wrap" data-context-menu="true">
          <button
            aria-expanded={isContextMenuOpen}
            aria-haspopup="menu"
            aria-label={`Opciones de ${item.label}`}
            className="nav-link-menu-trigger"
            data-context-menu="true"
            onClick={(event) => {
              event.stopPropagation();
              setOpenContextMenuKey(isContextMenuOpen ? null : nodeKey);
            }}
            type="button"
          >
            ⋮
          </button>
          {isContextMenuOpen ? (
            <div className="nav-context-menu" data-context-menu="true" role="menu">
              <button
                className="nav-context-action"
                onClick={() => onOpenHere(item.to!)}
                role="menuitem"
                type="button"
              >
                Abrir aquí
              </button>
              <button
                className="nav-context-action"
                onClick={() => onOpenInNewTab(item.to!)}
                role="menuitem"
                type="button"
              >
                Abrir en nueva pestaña
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <NavLink
      to={item.to}
      className={() => `nav-link nav-link-level-${level} ${isActive ? "active" : ""}`}
      end
      onClick={handleLinkClick}
    >
      <span>{item.label}</span>
      {badgeValue > 0 ? <span className="status-badge">{badgeValue}</span> : null}
    </NavLink>
  );
}

type SidebarProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { user, token } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const currentRole = user?.role;
  const canShowCreditCollections = canUseCreditCollections(user?.pos_type);
  const [badges, setBadges] = useState<Record<string, number>>({});
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [openContextMenuKey, setOpenContextMenuKey] = useState<string | null>(null);
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

  useEffect(() => {
    setOpenContextMenuKey(null);
  }, [isOpen, location.pathname]);

  useEffect(() => {
    setExpandedItems((current) => {
      const next = { ...current };
      let hasChanges = false;

      function markActiveBranches(item: SidebarMenuItem, itemKey: string): boolean {
        const selfActive = itemMatchesPath(item, location.pathname);
        if (!item.children?.length) {
          return selfActive;
        }

        const childActive = item.children.some((child, childIndex) => markActiveBranches(child, buildNodeKey(itemKey, child, childIndex)));
        if (childActive && !next[itemKey]) {
          next[itemKey] = true;
          hasChanges = true;
        }
        return selfActive || childActive;
      }

      sections.forEach((section, sectionIndex) => {
        const sectionKey = `section-${sectionIndex}-${section.title}`;
        section.items.forEach((item, itemIndex) => {
          markActiveBranches(item, buildNodeKey(sectionKey, item, itemIndex));
        });
      });

      return hasChanges ? next : current;
    });
  }, [location.pathname, sections]);

  const handleToggle = useCallback((key: string) => {
    setExpandedItems((current) => ({
      ...current,
      [key]: !current[key]
    }));
    setOpenContextMenuKey(null);
  }, []);

  const handleNavigate = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleOpenInCurrentTab = useCallback((to: string) => {
    setOpenContextMenuKey(null);
    navigate(to);
    onClose();
  }, [navigate, onClose]);

  const handleOpenInNewTab = useCallback((to: string) => {
    setOpenContextMenuKey(null);
    window.open(to, "_blank");
  }, []);

  const handleSidebarClick = useCallback((event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (!target.closest("[data-context-menu='true']")) {
      setOpenContextMenuKey(null);
    }
  }, []);

  return (
    <aside
      aria-hidden={!isOpen}
      className={`sidebar ${isOpen ? "open" : ""}`}
      id="app-sidebar"
      onClick={handleSidebarClick}
    >
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <AnkodeLogo className="sidebar-logo" size={30} variant="icon" alt="ANKODE K" />
          <div className="brand">Menú</div>
        </div>
        <p className="brand-subtitle">Panel comercial</p>
      </div>
      <nav className="nav-list">
        {sections.map((section, sectionIndex) => {
          const sectionKey = `section-${sectionIndex}-${section.title}`;
          return (
            <div className="nav-section" key={section.title}>
              <p className="nav-section-title">{section.title}</p>
              <div className="nav-tree">
                {section.items.map((item, itemIndex) => {
                  const itemKey = buildNodeKey(sectionKey, item, itemIndex);
                  return (
                    <SidebarBranch
                      item={item}
                      key={itemKey}
                      nodeKey={itemKey}
                      badges={badges}
                      expandedItems={expandedItems}
                      onNavigate={handleNavigate}
                      onOpenHere={handleOpenInCurrentTab}
                      onOpenInNewTab={handleOpenInNewTab}
                      onToggle={handleToggle}
                      openContextMenuKey={openContextMenuKey}
                      pathname={location.pathname}
                      setOpenContextMenuKey={setOpenContextMenuKey}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
