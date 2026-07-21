import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
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

// ---------------------------------------------------------------------------
// Todo lo de abajo hasta SidebarBranch es compartido entre el layout legacy
// (todos los pos_type) y el layout nuevo (solo Veterinaria, ver mas abajo).
// ---------------------------------------------------------------------------

// Tipo puramente visual: superset de SidebarMenuItem usado unicamente por
// VeterinariaSidebar: no se exporta ni se usa fuera del sidebar, las
// rutas/roles siguen viviendo en navigation.ts.
type SidebarVisualItem = Omit<SidebarMenuItem, "children"> & {
  children?: SidebarVisualItem[];
};

type SidebarVisualSection = {
  title: string;
  items: SidebarVisualItem[];
};

// Estas tres categorias se agrupan visualmente bajo "Catalogo" (solo Veterinaria),
// pero siguen siendo nodos independientes en los datos de navegacion.
const CATALOG_LABELS = ["Alimentos", "Accesorios", "Medicamentos e insumos"];
const CLINICAL_GROUP_LABEL = "Atencion medica o clinica";
// "Mas usado" es una lista curada de items individuales (no la categoria
// clinica completa clonada) — estos tres son hijos de CLINICAL_GROUP_LABEL,
// ya no se combinan con los hijos de "Catalogo" (esos viven solo bajo
// "Catalogo", ver buildVisualStructure). Los nodos referenciados aqui son
// los MISMOS objetos que ya aparecen en su ubicacion normal del arbol, asi
// que "Mas usado" es un acceso directo, no una copia de la categoria.
const PINNED_CLINICAL_CHILD_LABELS = ["Citas", "Consultas", "Calendario"];
const ADMIN_LABEL_PATTERN = /^administraci/i;

const BRANCH_ICONS: Record<string, string> = {
  "Catalogo": "🗂️",
  "Alimentos": "🦴",
  "Accesorios": "🛍️",
  "Medicamentos e insumos": "💉",
  "Atencion medica o clinica": "🩺",
  "Clientes y pacientes": "👥"
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
// Solo se invoca para pos_type === "Veterinaria".
function buildVisualStructure(sections: SidebarMenuSection[]) {
  let configItems: SidebarVisualItem[] = [];
  let alertsItem: SidebarVisualItem | null = null;
  let pinnedItems: SidebarVisualItem[] = [];

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

    const clinicalGroup = section.items.find((item) => item.label === CLINICAL_GROUP_LABEL);
    const clinicalPinnedChildren = (clinicalGroup?.children || [])
      .filter((child) => PINNED_CLINICAL_CHILD_LABELS.includes(child.label))
      .sort((a, b) => PINNED_CLINICAL_CHILD_LABELS.indexOf(a.label) - PINNED_CLINICAL_CHILD_LABELS.indexOf(b.label));

    pinnedItems = pinnedItems.concat(clinicalPinnedChildren);

    const items: SidebarVisualItem[] = [];
    let catalogInserted = false;

    section.items.forEach((item) => {
      if (CATALOG_LABELS.includes(item.label)) {
        if (!catalogInserted) {
          items.push({ label: "Catalogo", children: catalogChildren });
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

      items.push(item);
    });

    if (items.length) {
      treeSections.push({ title: section.title, items });
    }
  });

  return { treeSections, configItems, alertsItem, pinnedItems };
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
  // Solo usados por el nodo de primer nivel del panel de Veterinaria: resalta con
  // acento violeta/azul la categoria que quedo abierta (por rail o por clic directo)
  // y expone el contenedor via ref para poder hacerle scrollIntoView.
  highlighted?: boolean;
  containerRef?: (el: HTMLDivElement | null) => void;
};

// Renderer generico de nodos del arbol, compartido por el layout legacy y el nuevo.
// El acordeon (un solo submenu hermano abierto a la vez) es siempre-on en todos
// los niveles: cada grupo calcula las claves de sus propios hijos-grupo y se las
// pasa como `accordionSiblings`, y el padre le pasa a este nodo sus propias
// `accordionSiblings` (via la seccion/fold que lo renderiza). Si nadie pasa
// `accordionSiblings` al nodo raiz de un nivel, ese nivel simplemente no colapsa
// hermanos (toggle independiente), pero eso ya no deberia pasar en ningun layout.
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
  accordionSiblings,
  highlighted = false,
  containerRef
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
    const childAccordionSiblings = item.children.map((child, childIndex) => buildNodeKey(nodeKey, child, childIndex));

    return (
      <div className={`nav-tree-item nav-tree-level-${level} ${highlighted ? "nav-tree-item-highlighted" : ""}`} ref={containerRef}>
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

type SidebarNavProps = {
  isOpen: boolean;
  onClose: () => void;
  sections: SidebarMenuSection[];
  badges: Record<string, number>;
  currentRole?: string | null;
};

// ---------------------------------------------------------------------------
// Layout original (todos los pos_type excepto Veterinaria): arbol plano tal
// cual lo entrega getSidebarSectionsForVertical, sin buscador ni agrupaciones.
// Es intencionalmente una copia fiel del Sidebar previo al rediseño, para que
// sea trivial de comparar/revertir si algo se necesita ajustar.
// ---------------------------------------------------------------------------
function LegacySidebar({ isOpen, onClose, sections, badges, currentRole }: SidebarNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [openContextMenuKey, setOpenContextMenuKey] = useState<string | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setOpenContextMenuKey(null);
  }, [isOpen, location.pathname]);

  // Vuelve el scroll del panel al tope en cada navegacion: sin esto, si el
  // usuario estaba desplazado hasta el fondo (ej. Configuracion) y navega,
  // el sidebar se queda scrolleado y la nueva seccion activa puede quedar
  // fuera de vista.
  useEffect(() => {
    sidebarRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    setExpandedItems((current) => {
      const next = { ...current };
      let hasChanges = false;

      // Acordeon recursivo: en cada nivel, si un grupo hermano queda activo por
      // ruta se expande y los demas grupos hermanos (que no llevan a la rama
      // activa) se colapsan — mismo criterio que VeterinariaSidebar.
      function markActiveBranches(items: SidebarMenuItem[], parentKey: string): boolean {
        let anyActive = false;
        const activeGroupKeys: string[] = [];

        items.forEach((item, index) => {
          const itemKey = buildNodeKey(parentKey, item, index);
          const selfActive = itemMatchesPath(item, location.pathname);
          let childActive = false;

          if (item.children?.length) {
            childActive = markActiveBranches(item.children, itemKey);
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

        if (activeGroupKeys.length) {
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

      sections.forEach((section, sectionIndex) => {
        const sectionKey = `section-${sectionIndex}-${section.title}`;
        markActiveBranches(section.items, sectionKey);
      });

      return hasChanges ? next : current;
    });
  }, [location.pathname, sections]);

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
      data-tour="sidebar"
      id="app-sidebar"
      onClick={handleSidebarClick}
      ref={sidebarRef}
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
      <nav className="nav-list">
        {sections.map((section, sectionIndex) => {
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
    </aside>
  );
}

// Solicitud de foco disparada desde un icono del rail (VeterinariaSidebarRail): al
// expandir el panel, indica que ademas hay que abrir/enfocar algo especifico.
type RailFocusRequest =
  | { kind: "search"; nonce: number }
  | { kind: "masUsado"; nonce: number }
  | { kind: "group"; label: string; nonce: number }
  | { kind: "configuracion"; nonce: number };

type VeterinariaSidebarPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  badges: Record<string, number>;
  currentRole?: string | null;
  treeSections: SidebarVisualSection[];
  configItems: SidebarVisualItem[];
  alertsItem: SidebarVisualItem | null;
  pinnedItems: SidebarVisualItem[];
  focusRequest?: RailFocusRequest | null;
};

// ---------------------------------------------------------------------------
// Layout nuevo (solo pos_type === "Veterinaria"): buscador, bloque "Mas usado"
// fijo, agrupacion "Catalogo" con acordeon exclusivo, y "Configuracion" al pie.
// Se monta como panel expandido junto al rail (VeterinariaSidebarRail); la
// estructura visual (treeSections/configItems/alertsItem/pinnedItems) se calcula
// una sola vez en el rail y se recibe aqui por props.
// ---------------------------------------------------------------------------
function VeterinariaSidebar({ isOpen, onClose, badges, currentRole, treeSections, configItems, alertsItem, pinnedItems, focusRequest }: VeterinariaSidebarPanelProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [openContextMenuKey, setOpenContextMenuKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  // Contenedores de los grupos de primer nivel del arbol principal (Catalogo, Clientes y
  // pacientes, etc.), indexados por nodeKey. Se usan para el scrollIntoView al abrir un
  // grupo desde el rail.
  const groupRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const registerGroupRef = useCallback((key: string) => (el: HTMLDivElement | null) => {
    if (el) groupRefs.current.set(key, el);
    else groupRefs.current.delete(key);
  }, []);

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

  // Claves hermanas para el acordeon dentro de "Mas usado" y "Configuracion":
  // ambos son listas planas de primer nivel propio (no comparten padre con el
  // arbol principal), asi que cada una necesita su propio set de siblings.
  const pinnedAccordionKeys = useMemo(
    () => pinnedItems
      .map((item, itemIndex) => (item.children?.length ? buildNodeKey("pinned-root", item, itemIndex) : null))
      .filter((key): key is string => Boolean(key)),
    [pinnedItems]
  );

  const configAccordionKeys = useMemo(
    () => configItems
      .map((item, itemIndex) => (item.children?.length ? buildNodeKey("config-root", item, itemIndex) : null))
      .filter((key): key is string => Boolean(key)),
    [configItems]
  );

  useEffect(() => {
    setOpenContextMenuKey(null);
  }, [isOpen, location.pathname]);

  useEffect(() => {
    setSearchQuery("");
  }, [location.pathname]);

  // Vuelve el scroll del panel al tope en cada navegacion: sin esto, si el
  // usuario estaba desplazado hasta el fondo (ej. Configuracion) y navega,
  // el sidebar se queda scrolleado y la nueva seccion activa puede quedar
  // fuera de vista.
  useEffect(() => {
    sidebarRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    setExpandedItems((current) => {
      const next = { ...current };
      let hasChanges = false;

      // Devuelve true si el propio item o alguno de sus descendientes coincide con la ruta activa.
      // El acordeon es siempre-on: en cada nivel, colapsa a los hermanos-grupo que no
      // contienen la rama activa (Catalogo/Clientes y pacientes en el primer nivel,
      // Alimentos/Accesorios/Medicamentos dentro de Catalogo, etc.).
      function markActiveBranches(items: SidebarVisualItem[], parentKey: string): boolean {
        let anyActive = false;
        const activeGroupKeys: string[] = [];

        items.forEach((item, index) => {
          const itemKey = buildNodeKey(parentKey, item, index);
          const selfActive = itemMatchesPath(item, location.pathname);
          let childActive = false;

          if (item.children?.length) {
            childActive = markActiveBranches(item.children, itemKey);
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

        if (activeGroupKeys.length) {
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
        markActiveBranches(section.items, sectionKey);
      });

      if (pinnedItems.length) {
        markActiveBranches(pinnedItems, "pinned-root");
      }

      markActiveBranches(configItems, "config-root");

      return hasChanges ? next : current;
    });
  }, [location.pathname, treeSections, configItems, pinnedItems]);

  // Reacciona a un click en un icono del rail: enfoca el buscador, abre el panel de
  // Configuracion, o expande el grupo de primer nivel correspondiente (cerrando a sus
  // hermanos, igual que el resto del acordeon de un solo nivel).
  useEffect(() => {
    if (!focusRequest) return;

    if (focusRequest.kind === "search") {
      searchInputRef.current?.focus();
      return;
    }

    if (focusRequest.kind === "configuracion") {
      setConfigOpen(true);
      return;
    }

    if (focusRequest.kind === "group") {
      for (let sectionIndex = 0; sectionIndex < treeSections.length; sectionIndex += 1) {
        const section = treeSections[sectionIndex];
        const sectionKey = `section-${sectionIndex}-${section.title}`;
        const itemIndex = section.items.findIndex((item) => item.label === focusRequest.label);
        if (itemIndex === -1) continue;

        const groupKeys = section.items
          .map((item, idx) => (item.children?.length ? buildNodeKey(sectionKey, item, idx) : null))
          .filter((key): key is string => Boolean(key));
        const targetKey = buildNodeKey(sectionKey, section.items[itemIndex], itemIndex);

        setExpandedItems((current) => {
          const next = { ...current };
          groupKeys.forEach((key) => {
            next[key] = key === targetKey;
          });
          return next;
        });

        // Espera al siguiente frame para que el grupo ya este expandido en el DOM
        // antes de hacer scroll. Usamos "start" (no "nearest") a proposito: si no,
        // el navegador no mueve el scroll cuando el elemento ya es parcialmente
        // visible, y la categoria recien abierta queda a media pantalla en vez de
        // ser el foco inmediato.
        requestAnimationFrame(() => {
          groupRefs.current.get(targetKey)?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        break;
      }
    }
    // "masUsado" no requiere accion extra: el bloque "Mas usado" ya esta siempre visible al abrir el panel.
  }, [focusRequest, treeSections]);

  const handleToggle = useCallback((key: string, siblings?: string[]) => {
    let didOpen = false;
    setExpandedItems((current) => {
      const willOpen = !current[key];
      didOpen = willOpen;
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

    // Mismo scroll-to-start que al abrir desde el rail, pero disparado por un clic
    // directo en el panel. `groupRefs` solo tiene entradas para los grupos de primer
    // nivel del arbol principal, asi que esto no afecta a "Mas usado" ni a Configuracion.
    if (didOpen && groupRefs.current.has(key)) {
      requestAnimationFrame(() => {
        groupRefs.current.get(key)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
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
      ref={sidebarRef}
    >
      <div className="sidebar-header">
        <div className="sidebar-header-row">
          <div className="sidebar-brand">
            <AnkodeLogo className="sidebar-logo" size={30} variant="icon" alt="ANKODE K" />
            <div className="brand">Menú</div>
          </div>
          <button aria-label="Cerrar menú" className="sidebar-close-btn" onClick={onClose} type="button">✕</button>
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
            ref={searchInputRef}
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

      {!isSearching && pinnedItems.length ? (
        <div className="nav-section nav-section-pinned">
          <p className="nav-section-title">Más usado</p>
          <div className="nav-tree">
            {pinnedItems.map((child, childIndex) => {
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
                  accordionSiblings={pinnedAccordionKeys}
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
                    const isGroupItem = Boolean(item.children?.length);
                    // El resaltado sigue al ultimo grupo de primer nivel abierto, sea por
                    // click en el rail (focusRequest) o por click directo en el panel: como
                    // el acordeon de este nivel es exclusivo, alcanza con mirar cual esta abierto.
                    const isHighlighted = isGroupItem
                      && (itemHasActiveDescendant(item, location.pathname) || Boolean(expandedItems[itemKey]));
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
                        highlighted={isHighlighted}
                        containerRef={isGroupItem ? registerGroupRef(itemKey) : undefined}
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
                    accordionSiblings={configAccordionKeys}
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

type VeterinariaSidebarRailProps = {
  isOpen: boolean;
  onClose: () => void;
  onOpen?: () => void;
  sections: SidebarMenuSection[];
  badges: Record<string, number>;
  currentRole?: string | null;
};

// Rail angosto de solo iconos, fijo a la izquierda, siempre visible para
// pos_type === "Veterinaria" (reemplaza al boton "Menu" del Header). Un click en
// cualquier icono (excepto el logo, que navega directo) expande el panel completo
// (VeterinariaSidebar) con la seccion correspondiente ya abierta.
function VeterinariaSidebarRail({ isOpen, onClose, onOpen, sections, badges, currentRole }: VeterinariaSidebarRailProps) {
  const [focusRequest, setFocusRequest] = useState<RailFocusRequest | null>(null);

  const { treeSections, configItems, alertsItem, pinnedItems } = useMemo(
    () => buildVisualStructure(sections),
    [sections]
  );

  // Un icono por cada grupo de primer nivel del arbol principal.
  const railGroups = useMemo(() => {
    const seen = new Set<string>();
    const groups: SidebarVisualItem[] = [];
    treeSections.forEach((section) => {
      section.items.forEach((item) => {
        if (!item.children?.length || seen.has(item.label)) return;
        seen.add(item.label);
        groups.push(item);
      });
    });
    return groups;
  }, [treeSections]);

  const requestOpen = useCallback((request?: RailFocusRequest) => {
    if (request) setFocusRequest(request);
    onOpen?.();
  }, [onOpen]);

  return (
    <>
      {!isOpen ? (
        <nav aria-label="Menú principal" className="sidebar-rail">
          <Link aria-label="Ir al panel comercial" className="sidebar-rail-logo" to="/dashboard">
            <AnkodeLogo alt="ANKODE K" size={28} variant="icon" />
          </Link>

          <button
            aria-label="Buscar en el menú"
            className="sidebar-rail-btn"
            onClick={() => requestOpen({ kind: "search", nonce: Date.now() })}
            title="Buscar"
            type="button"
          >
            <span aria-hidden="true">🔍</span>
          </button>

          {pinnedItems.length ? (
            <button
              aria-label="Más usado"
              className="sidebar-rail-btn sidebar-rail-btn-highlight"
              onClick={() => requestOpen({ kind: "masUsado", nonce: Date.now() })}
              title="Más usado"
              type="button"
            >
              <span aria-hidden="true">⭐</span>
            </button>
          ) : null}

          {railGroups.map((item) => (
            <button
              aria-label={item.label}
              className="sidebar-rail-btn"
              key={item.label}
              onClick={() => requestOpen({ kind: "group", label: item.label, nonce: Date.now() })}
              title={item.label}
              type="button"
            >
              <span aria-hidden="true">{BRANCH_ICONS[item.label] || "📁"}</span>
            </button>
          ))}

          <div className="sidebar-rail-spacer" />

          {alertsItem?.to ? (
            <button
              aria-label="Alertas"
              className="sidebar-rail-btn"
              onClick={() => requestOpen()}
              title="Alertas"
              type="button"
            >
              <span aria-hidden="true">🔔</span>
            </button>
          ) : null}

          <button
            aria-label="Configuración"
            className="sidebar-rail-btn"
            onClick={() => requestOpen({ kind: "configuracion", nonce: Date.now() })}
            title="Configuración"
            type="button"
          >
            <span aria-hidden="true">⚙️</span>
          </button>
        </nav>
      ) : null}

      <VeterinariaSidebar
        alertsItem={alertsItem}
        badges={badges}
        configItems={configItems}
        currentRole={currentRole}
        focusRequest={focusRequest}
        isOpen={isOpen}
        onClose={onClose}
        pinnedItems={pinnedItems}
        treeSections={treeSections}
      />
    </>
  );
}

type SidebarProps = {
  isOpen: boolean;
  onClose: () => void;
  onOpen?: () => void;
};

// Punto unico donde se decide el layout por pos_type. Hoy solo "Veterinaria" usa
// el rediseño (rail + buscador/Mas usado/Catalogo/Configuracion); cualquier otro
// rubro cae al layout original. Para expandir el rediseño a otro rubro, agregarlo aqui.
export function Sidebar({ isOpen, onClose, onOpen }: SidebarProps) {
  const { user, token } = useAuth();
  const currentRole = user?.role;
  const canShowCreditCollections = canUseCreditCollections(user?.pos_type);
  const canShowAlerts = user?.plan_features?.stock_alerts !== false;
  const [badges, setBadges] = useState<Record<string, number>>({});

  const sections = useMemo(
    () => getSidebarSectionsForVertical(user?.pos_type, currentRole, canShowCreditCollections, canShowAlerts),
    [canShowAlerts, canShowCreditCollections, currentRole, user?.pos_type]
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

  if (user?.pos_type === "Veterinaria") {
    return <VeterinariaSidebarRail badges={badges} currentRole={currentRole} isOpen={isOpen} onClose={onClose} onOpen={onOpen} sections={sections} />;
  }

  return <LegacySidebar badges={badges} currentRole={currentRole} isOpen={isOpen} onClose={onClose} sections={sections} />;
}
