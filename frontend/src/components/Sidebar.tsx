import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { AnkodeLogo } from "./AnkodeLogo";
import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../api/client";
import { getSidebarSectionsForVertical, type SidebarMenuItem, type SidebarMenuSection } from "../utils/navigation";
import { canUseCreditCollections } from "../utils/pos";
import type { ProductUpdateRequestPendingSummary } from "../types";
import { canAccessDashboard, isManagementRole } from "../utils/roles";

const NEW_TAB_ALLOWED_ROUTES = new Set<string>([
  "/products",
  "/retail/products",
  "/health/products",
  "/health/products/food",
  "/health/products/accessories",
  "/health/products/medications",
  "/suppliers",
  "/retail/suppliers",
  "/health/suppliers/food",
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

// Estas tres categorias se agrupan visualmente bajo "Catalogo" (punto 3 del rediseño),
// pero siguen siendo nodos independientes en los datos de navegacion.
const CATALOG_LABELS = ["Alimentos", "Accesorios", "Medicamentos e insumos"];
const PINNED_LABEL = "Atencion medica o clinica";
const ADMIN_LABEL_PATTERN = /^administraci/i;

const BRANCH_ICONS: Record<string, string> = {
  "Catalogo": "🗂️",
  "Alimentos": "🦴",
  "Accesorios": "🛍️",
  "Medicamentos e insumos": "💉",
  "Atencion medica o clinica": "🩺",
  "Clientes y pacientes": "👥"
};

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

const TOUR_ROUTE_MAP: Record<string, string> = {
  "/sales": "nav-sales",
  "/retail/sales": "nav-sales",
  "/health/sales": "nav-sales",
  "/health/sales/food": "nav-sales",
  "/health/sales/accessories": "nav-sales",
  "/health/sales/medications": "nav-sales",
  "/products": "nav-products",
  "/retail/products": "nav-products",
  "/health/products/food": "nav-products",
  "/health/products/accessories": "nav-products",
  "/health/products/medications": "nav-products",
  "/health/products": "nav-products",
  "/finances": "nav-finances",
  "/retail/admin/finances": "nav-finances",
  "/health/admin/finances": "nav-finances",
  "/patients": "nav-patients",
  "/health/patients": "nav-patients",
  "/medical-appointments": "nav-appointments",
  "/health/appointments/medica": "nav-appointments",
  "/health/appointments/estetica": "nav-appointments",
  "/restaurant/map": "nav-restaurant-map",
  "/daily-cut": "nav-daily-cut",
  "/retail/admin/daily-cut": "nav-daily-cut",
  "/health/admin/daily-cut": "nav-daily-cut"
};

function getTourId(to?: string): string | undefined {
  return to ? TOUR_ROUTE_MAP[to] : undefined;
}

const LABEL_OVERRIDES: Record<string, string> = {
  "/products": "Inventario",
  "/retail/products": "Inventario",
  "/health/products": "Inventario",
  "/health/products/food": "Inventario",
  "/health/products/accessories": "Inventario",
  "/health/products/medications": "Inventario"
};

function getDisplayLabel(item: SidebarMenuItem): string {
  return (item.to && LABEL_OVERRIDES[item.to]) || item.label;
}

function canOpenInNewTab(item: SidebarMenuItem) {
  return item.to ? NEW_TAB_ALLOWED_ROUTES.has(item.to) : false;
}

// Tipo puramente visual: superset de SidebarMenuItem que solo agrega la marca
// "accordionGroup" para que sus hijos se comporten como acordeon de un solo nivel abierto.
// No se exporta ni se usa fuera del sidebar: las rutas/roles siguen viviendo en navigation.ts.
type SidebarVisualItem = Omit<SidebarMenuItem, "children"> & {
  accordionGroup?: boolean;
  children?: SidebarVisualItem[];
};

type SidebarVisualSection = {
  title: string;
  items: SidebarVisualItem[];
};

function extractAlerts(items: SidebarVisualItem[]): { alerts: SidebarVisualItem | null; rest: SidebarVisualItem[] } {
  let alerts: SidebarVisualItem | null = null;
  const rest = items.filter((item) => {
    if (item.label === "Alertas") {
      alerts = item;
      return false;
    }
    return true;
  });
  return { alerts, rest };
}

// Reorganiza los datos de navigation.ts en la nueva jerarquia visual (Catalogo, Mas usado,
// Configuracion) sin tocar labels, rutas ni roles de los nodos originales.
function buildVisualStructure(sections: SidebarMenuSection[]) {
  let configItems: SidebarVisualItem[] = [];
  let alertsItem: SidebarVisualItem | null = null;
  let pinnedItem: SidebarVisualItem | null = null;

  const treeSections: SidebarVisualSection[] = [];

  sections.forEach((section) => {
    if (ADMIN_LABEL_PATTERN.test(section.title)) {
      const { alerts, rest } = extractAlerts(section.items);
      if (alerts) alertsItem = alerts;
      configItems = configItems.concat(rest);
      return;
    }

    const catalogChildren = section.items
      .filter((item) => CATALOG_LABELS.includes(item.label))
      .sort((a, b) => CATALOG_LABELS.indexOf(a.label) - CATALOG_LABELS.indexOf(b.label));

    const items: SidebarVisualItem[] = [];
    let catalogInserted = false;

    section.items.forEach((item) => {
      if (CATALOG_LABELS.includes(item.label)) {
        if (!catalogInserted) {
          items.push({ label: "Catalogo", accordionGroup: true, children: catalogChildren });
          catalogInserted = true;
        }
        return;
      }

      if (ADMIN_LABEL_PATTERN.test(item.label) && item.children?.length) {
        const { alerts, rest } = extractAlerts(item.children);
        if (alerts) alertsItem = alerts;
        configItems = configItems.concat(rest);
        return;
      }

      if (item.label === PINNED_LABEL && !pinnedItem) {
        pinnedItem = item;
      }

      items.push(item);
    });

    if (items.length) {
      treeSections.push({ title: section.title, items });
    }
  });

  return { treeSections, configItems, alertsItem, pinnedItem };
}

type SearchLeaf = { label: string; to: string; breadcrumb: string };

function collectLeaves(items: SidebarVisualItem[], trail: string[], out: SearchLeaf[]) {
  items.forEach((item) => {
    const nextTrail = [...trail, item.label];
    if (item.children?.length) {
      collectLeaves(item.children, nextTrail, out);
    } else if (item.to) {
      out.push({ label: getDisplayLabel(item), to: item.to, breadcrumb: trail.join(" / ") || "Menu" });
    }
  });
}

type SidebarBranchProps = {
  item: SidebarVisualItem;
  nodeKey: string;
  pathname: string;
  badges?: Record<string, number>;
  expandedItems: Record<string, boolean>;
  onToggle: (key: string, siblings?: string[]) => void;
  onNavigate: () => void;
  onOpenHere: (to: string) => void;
  onOpenInNewTab: (to: string) => void;
  openContextMenuKey: string | null;
  setOpenContextMenuKey: (key: string | null) => void;
  level?: number;
  accordionSiblings?: string[];
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
  level = 0,
  accordionSiblings
}: SidebarBranchProps) {
  const isActive = itemMatchesPath(item, pathname);
  const hasActiveDescendant = itemHasActiveDescendant(item, pathname);
  const isOpen = hasActiveDescendant || Boolean(expandedItems[nodeKey]);
  const badgeValue = item.to ? badges[item.to] || 0 : 0;
  const hasContextMenu = canOpenInNewTab(item);
  const isContextMenuOpen = openContextMenuKey === nodeKey;
  const submenuId = toDomId(nodeKey);
  const icon = BRANCH_ICONS[item.label];

  if (item.children?.length) {
    const childAccordionSiblings = item.accordionGroup
      ? item.children.map((child, childIndex) => buildNodeKey(nodeKey, child, childIndex))
      : undefined;

    return (
      <div className={`nav-tree-item nav-tree-level-${level}`}>
        <button
          aria-controls={submenuId}
          aria-expanded={isOpen}
          className={`nav-tree-toggle ${isOpen ? "expanded" : ""} ${hasActiveDescendant ? "has-active-child" : ""}`}
          data-tour-expand={item.label === "Productos" ? "productos" : undefined}
          onClick={() => onToggle(nodeKey, accordionSiblings)}
          type="button"
        >
          <span>
            {icon ? <span aria-hidden="true" className="nav-tree-icon">{icon}</span> : null}
            {item.label}
          </span>
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
                  accordionSiblings={childAccordionSiblings}
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
    const tourId = getTourId(item.to);
    return (
      <div className={`nav-link-with-menu nav-link-level-${level}`}>
        <NavLink
          to={item.to}
          className={() => `nav-link ${isActive ? "active" : ""}`}
          data-tour={tourId}
          end
          onClick={handleLinkClick}
        >
          <span>{getDisplayLabel(item)}</span>
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
      data-tour={getTourId(item.to)}
      end
      onClick={handleLinkClick}
    >
      <span>{getDisplayLabel(item)}</span>
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
  const canShowAlerts = user?.plan_features?.stock_alerts !== false;
  const [badges, setBadges] = useState<Record<string, number>>({});
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [openContextMenuKey, setOpenContextMenuKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [configOpen, setConfigOpen] = useState(false);

  const sections = useMemo(
    () => getSidebarSectionsForVertical(user?.pos_type, currentRole, canShowCreditCollections, canShowAlerts),
    [canShowAlerts, canShowCreditCollections, currentRole, user?.pos_type]
  );

  const { treeSections, configItems, alertsItem, pinnedItem } = useMemo(
    () => buildVisualStructure(sections),
    [sections]
  );

  const searchIndex = useMemo(() => {
    const leaves: SearchLeaf[] = [];
    treeSections.forEach((section) => collectLeaves(section.items, [section.title], leaves));
    collectLeaves(configItems, ["Configuración"], leaves);
    if (alertsItem?.to) {
      leaves.push({ label: alertsItem.label, to: alertsItem.to, breadcrumb: "Configuración" });
    }
    return leaves;
  }, [treeSections, configItems, alertsItem]);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!trimmedQuery) return [];
    return searchIndex.filter((leaf) => leaf.label.toLowerCase().includes(trimmedQuery)).slice(0, 20);
  }, [searchIndex, trimmedQuery]);

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
    setSearchQuery("");
  }, [location.pathname]);

  useEffect(() => {
    setExpandedItems((current) => {
      const next = { ...current };
      let hasChanges = false;

      // Devuelve true si el propio item o alguno de sus descendientes coincide con la ruta activa.
      // Cuando `enforceSingleOpen` es true, colapsa a los hermanos que no contienen la rama activa
      // (acordeon de un solo nivel abierto: Catalogo/Atencion medica/Clientes y pacientes en el
      // primer nivel, y Alimentos/Accesorios/Medicamentos dentro de Catalogo).
      function markActiveBranches(items: SidebarVisualItem[], parentKey: string, enforceSingleOpen: boolean): boolean {
        let anyActive = false;
        const activeGroupKeys: string[] = [];

        items.forEach((item, index) => {
          const itemKey = buildNodeKey(parentKey, item, index);
          const selfActive = itemMatchesPath(item, location.pathname);
          let childActive = false;

          if (item.children?.length) {
            childActive = markActiveBranches(item.children, itemKey, Boolean(item.accordionGroup));
            if (childActive) {
              if (!next[itemKey]) {
                next[itemKey] = true;
                hasChanges = true;
              }
              activeGroupKeys.push(itemKey);
            }
          }

          if (selfActive || childActive) anyActive = true;
        });

        if (enforceSingleOpen && activeGroupKeys.length) {
          items.forEach((item, index) => {
            if (!item.children?.length) return;
            const itemKey = buildNodeKey(parentKey, item, index);
            if (!activeGroupKeys.includes(itemKey) && next[itemKey]) {
              next[itemKey] = false;
              hasChanges = true;
            }
          });
        }

        return anyActive;
      }

      treeSections.forEach((section, sectionIndex) => {
        const sectionKey = `section-${sectionIndex}-${section.title}`;
        markActiveBranches(section.items, sectionKey, true);
      });

      if (pinnedItem?.children?.length) {
        markActiveBranches(pinnedItem.children, "pinned-root", false);
      }

      markActiveBranches(configItems, "config-root", false);

      return hasChanges ? next : current;
    });
  }, [location.pathname, treeSections, configItems, pinnedItem]);

  const handleToggle = useCallback((key: string, siblings?: string[]) => {
    setExpandedItems((current) => {
      const willOpen = !current[key];
      if (willOpen && siblings?.length) {
        const next = { ...current };
        siblings.forEach((siblingKey) => {
          if (siblingKey !== key) next[siblingKey] = false;
        });
        next[key] = true;
        return next;
      }
      return {
        ...current,
        [key]: !current[key]
      };
    });
    setOpenContextMenuKey(null);
  }, []);

  const handleNavigate = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleOpenInCurrentTab = useCallback((to: string) => {
    setOpenContextMenuKey(null);
    setSearchQuery("");
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

  const handleSearchChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  }, []);

  const handleSearchKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && searchResults.length) {
      handleOpenInCurrentTab(searchResults[0].to);
    }
  }, [handleOpenInCurrentTab, searchResults]);

  const isSearching = trimmedQuery.length > 0;

  return (
    <aside
      aria-hidden={!isOpen}
      className={`sidebar ${isOpen ? "open" : ""}`}
      data-tour="sidebar"
      id="app-sidebar"
      onClick={handleSidebarClick}
    >
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <AnkodeLogo className="sidebar-logo" size={30} variant="icon" alt="ANKODE K" />
          <div className="brand">Menú</div>
        </div>
        {canAccessDashboard(currentRole) ? (
          <NavLink className="brand-subtitle brand-subtitle-link" to="/dashboard">Panel comercial</NavLink>
        ) : (
          <p className="brand-subtitle">Panel comercial</p>
        )}
      </div>

      <div className="sidebar-search">
        <div className="sidebar-search-input-wrap">
          <span aria-hidden="true" className="sidebar-search-icon">🔍</span>
          <input
            aria-label="Buscar en el menú"
            className="sidebar-search-input"
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            placeholder="Buscar en el menú..."
            type="search"
            value={searchQuery}
          />
        </div>
        {isSearching ? (
          <div className="sidebar-search-results" role="listbox">
            {searchResults.length ? searchResults.map((result) => (
              <button
                className="sidebar-search-result"
                key={result.to}
                onClick={() => handleOpenInCurrentTab(result.to)}
                role="option"
                aria-selected="false"
                type="button"
              >
                <span className="sidebar-search-result-label">{result.label}</span>
                <span className="sidebar-search-result-path">{result.breadcrumb}</span>
              </button>
            )) : (
              <p className="sidebar-search-empty">Sin resultados</p>
            )}
          </div>
        ) : null}
      </div>

      {!isSearching && pinnedItem?.children?.length ? (
        <div className="nav-section nav-section-pinned">
          <p className="nav-section-title">Más usado</p>
          <div className="nav-pinned-heading">
            <span aria-hidden="true">🩺</span> {pinnedItem.label === PINNED_LABEL ? "Atención médica o clínica" : pinnedItem.label}
          </div>
          <div className="nav-tree">
            {pinnedItem.children.map((child, childIndex) => {
              const childKey = buildNodeKey("pinned-root", child, childIndex);
              return (
                <SidebarBranch
                  item={child}
                  key={childKey}
                  nodeKey={childKey}
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
      ) : null}

      {!isSearching ? (
        <nav className="nav-list">
          {treeSections.map((section, sectionIndex) => {
            const sectionKey = `section-${sectionIndex}-${section.title}`;
            const groupSiblingKeys = section.items
              .map((item, itemIndex) => (item.children?.length ? buildNodeKey(sectionKey, item, itemIndex) : null))
              .filter((key): key is string => Boolean(key));

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
                        accordionSiblings={item.children?.length ? groupSiblingKeys : undefined}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      ) : null}

      <div className="sidebar-footer">
        <div className="sidebar-footer-quicklinks">
          {alertsItem?.to ? (
            <NavLink
              className={({ isActive }) => `sidebar-footer-link ${isActive ? "active" : ""}`}
              onClick={handleNavigate}
              to={alertsItem.to}
            >
              <span aria-hidden="true">🔔</span> {alertsItem.label}
            </NavLink>
          ) : null}
          <button
            aria-expanded={configOpen}
            className="sidebar-footer-config-toggle"
            onClick={() => setConfigOpen((current) => !current)}
            type="button"
          >
            <span aria-hidden="true">⚙️</span> Configuración
            <span aria-hidden="true" className="nav-tree-indicator">{configOpen ? "▾" : "▸"}</span>
          </button>
        </div>
        {configOpen ? (
          <div className="sidebar-footer-panel">
            <div className="nav-tree">
              {configItems.map((item, itemIndex) => {
                const itemKey = buildNodeKey("config-root", item, itemIndex);
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
        ) : null}
      </div>
    </aside>
  );
}
