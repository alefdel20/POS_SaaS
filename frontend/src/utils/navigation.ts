import type { PosType } from "../types";
import { canAccessBusinesses, canAccessClinical, canAccessDailyCut, canAccessFinancialDashboard, canAccessInvoices, canAccessRestaurantKds, canAccessRestaurantStaff, canAccessSales, canViewUsers, isManagementRole, normalizeRole, ROLE_MANAGER } from "./roles";
import { getClinicalPatientLabel, getHealthcareSidebarTitle, getMedicalHistoryNavLabel, hidesAesthetics, usesPatientLabel, usesHumanPatientsOnly } from "./pos";

export type SidebarRoleGroup = "sales" | "users" | "dailyCut" | "management" | "gerente" | "clinical" | "profile" | "invoices" | "businesses" | "financialDashboard" | "restaurantStaff" | "kitchen" | "all";

export type SidebarMenuItem = {
  label: string;
  to?: string;
  roles?: SidebarRoleGroup;
  children?: SidebarMenuItem[];
  activeMatch?: string[];
};

export type SidebarMenuSection = {
  title: string;
  items: SidebarMenuItem[];
};

export type CatalogScope = "food-accessories" | "medications-supplies";
export type BusinessVertical = "healthcare" | "retail" | "restaurant";

const HEALTHCARE_POS_TYPES = new Set<PosType>(["Veterinaria", "Dentista", "Farmacia", "FarmaciaConsultorio", "ClinicaChica"]);

const ADMIN_LINKS: SidebarMenuItem[] = [
  { label: "Aprobaciones", to: "/product-update-requests", roles: "management", activeMatch: ["/product-update-requests", "/retail/admin/approvals", "/health/admin/approvals"] },
  { label: "Credito y Cobranza", to: "/credit-collections", roles: "gerente", activeMatch: ["/credit-collections"] },
  { label: "Corte Diario", to: "/daily-cut", roles: "dailyCut", activeMatch: ["/daily-cut"] },
  { label: "Finanzas", to: "/finances", roles: "gerente", activeMatch: ["/finances"] },
  { label: "Facturas", to: "/invoices", roles: "invoices", activeMatch: ["/invoices"] },
  {
    label: "Recordatorios",
    roles: "all",
    children: [
      { label: "Recordatorios", to: "/reminders", roles: "all", activeMatch: ["/reminders", "/retail/admin/reminders", "/health/admin/reminders"] },
      { label: "Nuevo", to: "/reminders/new", roles: "all", activeMatch: ["/reminders/new", "/retail/admin/reminders/new", "/health/admin/reminders/new"] },
      { label: "Calendario", to: "/reminders/calendar", roles: "all", activeMatch: ["/reminders/calendar", "/retail/admin/reminders/calendar", "/health/admin/reminders/calendar"] }
    ]
  },
  { label: "Resumen", to: "/dashboard", roles: "gerente", activeMatch: ["/dashboard"] },
  { label: "Usuarios", to: "/users", roles: "users", activeMatch: ["/users"] },
  { label: "Sucursales", to: "/branches", roles: "management", activeMatch: ["/branches", "/retail/admin/branches", "/health/admin/branches"] },
  { label: "Alertas", to: "/alertas", roles: "profile", activeMatch: ["/alertas"] },
  { label: "Perfil", to: "/profile", roles: "profile", activeMatch: ["/profile", "/retail/admin/profile", "/health/admin/profile", "/health/doctor/profile"] }
];

function getAdminLinksByRole(role?: string | null): SidebarMenuItem[] {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "superusuario") {
    return [
      { label: "Negocios", to: "/businesses", roles: "businesses", activeMatch: withAlias("/retail/admin/businesses", "/businesses") },
      { label: "Dashboard Financiero", to: "/admin/dashboard", roles: "financialDashboard", activeMatch: ["/admin/dashboard"] },
      ...ADMIN_LINKS.filter((item) => item.label !== "Usuarios")
    ];
  }
  return ADMIN_LINKS;
}

function withAlias(aliasPath: string, targetPath: string) {
  return [aliasPath, targetPath];
}

function isRoleAllowed(role?: string | null, roleGroup: SidebarRoleGroup = "all") {
  // Cocina es un rol acotado: solo ve el item KDS, nunca un grupo genérico "all".
  if (normalizeRole(role) === "cocina") return roleGroup === "kitchen";
  if (roleGroup === "all") return true;
  if (roleGroup === "restaurantStaff") return canAccessRestaurantStaff(role);
  if (roleGroup === "kitchen") return canAccessRestaurantKds(role);
  if (roleGroup === "sales") return canAccessSales(role);
  if (roleGroup === "users") return canViewUsers(role);
  if (roleGroup === "dailyCut") return canAccessDailyCut(role);
  if (roleGroup === "management") return isManagementRole(role);
  if (roleGroup === "gerente") return isManagementRole(role) || normalizeRole(role) === ROLE_MANAGER;
  if (roleGroup === "clinical") return canAccessClinical(role);
  if (roleGroup === "profile") return isManagementRole(role) || normalizeRole(role) === "clinico" || normalizeRole(role) === ROLE_MANAGER;
  if (roleGroup === "invoices") return canAccessInvoices(role);
  if (roleGroup === "businesses") return canAccessBusinesses(role);
  if (roleGroup === "financialDashboard") return canAccessFinancialDashboard(role);
  return false;
}

function filterByBusinessContext(items: SidebarMenuItem[], posType?: string | null, role?: string | null): SidebarMenuItem[] {
  const shouldHideAesthetics = hidesAesthetics(posType);
  const patientLabelOnly = usesPatientLabel(posType);
  const humanPatientsOnly = usesHumanPatientsOnly(posType);

  return items
    .map((item) => {
      const children = item.children ? filterByBusinessContext(item.children, posType, role) : undefined;
      const nextItem = children ? { ...item, children } : item;

      if (shouldHideAesthetics && nextItem.to === "/health/appointments/estetica") return null;
      if (patientLabelOnly && nextItem.to === "/health/clients") return null;
      if (normalizeRole(role) === "cajero") {
        if (
          nextItem.to === "/products/restock"
          || nextItem.to === "/retail/products/restock"
          || nextItem.to === "/health/products/accessories/restock"
          || nextItem.to === "/health/products/medications/restock"
          || nextItem.to === "/health/products/restock"
        ) {
          return { ...nextItem, roles: "sales" };
        }
        if (nextItem.to && ["/health/sales/accessories", "/health/products/accessories", "/health/suppliers/accessories", "/health/suppliers/medications"].includes(nextItem.to)) {
          return null;
        }
      }

      if (humanPatientsOnly && nextItem.to === "/health/medical-history/calendar") return null;
      if (humanPatientsOnly && nextItem.to === "/clients") return null;
      return nextItem;
    })
    .filter((item): item is SidebarMenuItem => Boolean(item))
    .filter((item) => item.to || item.children?.length);
}

function filterMenuItems(items: SidebarMenuItem[], role?: string | null, canShowCreditCollections = true, canShowAlerts = true): SidebarMenuItem[] {
  return items
    .map((item) => {
      const children = item.children ? filterMenuItems(item.children, role, canShowCreditCollections, canShowAlerts) : undefined;
      const isAllowed = isRoleAllowed(role, item.roles || "all")
        && (item.to !== "/credit-collections" || canShowCreditCollections)
        && (item.to !== "/alertas" || canShowAlerts);

      if (children?.length) {
        return { ...item, children };
      }

      if (!item.to || !isAllowed) {
        return null;
      }

      return item;
    })
    .filter((item): item is SidebarMenuItem => Boolean(item))
    .filter((item) => item.to || item.children?.length);
}

export function resolveBusinessVertical(posType?: string | null): BusinessVertical {
  if (posType === "Restaurante") return "restaurant";
  return HEALTHCARE_POS_TYPES.has((posType || "Otro") as PosType) ? "healthcare" : "retail";
}

export function getCatalogScopeLabel(scope?: CatalogScope | null) {
  if (scope === "food-accessories") return "Alimentos y accesorios";
  if (scope === "medications-supplies") return "Medicamentos e insumos";
  return "Productos";
}

export function getCatalogTypeFromScope(scope?: CatalogScope | null) {
  if (scope === "food-accessories") return "accessories" as const;
  if (scope === "medications-supplies") return "medications" as const;
  return null;
}

export function getCatalogScopeFromPath(pathname: string): CatalogScope | null {
  if (
    pathname.startsWith("/health/sales/accessories")
    || pathname.startsWith("/health/products/accessories")
    || pathname.startsWith("/health/suppliers/accessories")
  ) {
    return "food-accessories";
  }

  if (
    pathname.startsWith("/health/sales/medications")
    || pathname.startsWith("/health/products/medications")
    || pathname.startsWith("/health/suppliers/medications")
  ) {
    return "medications-supplies";
  }

  return null;
}

export function getAppointmentAreaFromPath(pathname: string): "ESTETICA" | "CLINICA" | null {
  if (pathname.startsWith("/health/appointments/estetica")) return "ESTETICA";
  if (pathname.startsWith("/health/appointments/medica")) return "CLINICA";
  return null;
}

export function getMedicalHistoryViewFromPath(pathname: string): "carnet" | "calendar" {
  if (pathname.startsWith("/health/medical-history/calendar")) return "calendar";
  return "carnet";
}

export function getConsultationModeFromPath(pathname: string): "consultations" | "recipes" {
  if (pathname.startsWith("/health/consultations/recetas")) return "recipes";
  return "consultations";
}

export function getDefaultRouteForUser(role?: string | null, posType?: string | null) {
  if (role?.toLowerCase() === "soporte" || role?.toLowerCase() === "support") {
    return "/users";
  }

  // Cocina solo opera el KDS, independientemente de cómo se resuelva el vertical.
  if (normalizeRole(role) === "cocina") {
    return "/restaurant/kds";
  }

  const vertical = resolveBusinessVertical(posType);

  if (vertical === "restaurant") {
    // gerente / cajero / admin → mapa de mesas; cocina ya salió arriba al KDS.
    return "/restaurant/map";
  }

  const managementHome = vertical === "healthcare" ? "/health/admin/summary" : "/retail/admin/summary";
  const salesHome = vertical === "healthcare"
    ? (isPharmacyPos(posType) ? "/health/sales" : "/health/sales/accessories")
    : "/retail/sales";
  if (normalizeRole(role) === "clinico") {
    return "/health/patients";
  }
  return isManagementRole(role) ? managementHome : salesHome;
}

const PHARMACY_POS_TYPES = new Set<PosType>(["Farmacia", "FarmaciaConsultorio", "ClinicaChica"]);

function isPharmacyPos(posType?: string | null) {
  return PHARMACY_POS_TYPES.has((posType || "Otro") as PosType);
}

export function getSidebarSectionsForVertical(posType?: string | null, role?: string | null, canShowCreditCollections = true, canShowAlerts = true): SidebarMenuSection[] {
  const vertical = resolveBusinessVertical(posType);
  const healthAccessoriesProductChildren: SidebarMenuItem[] = [
    { label: "Nuevo producto", to: "/health/products/accessories/new", roles: "gerente", activeMatch: ["/health/products/accessories/new"] },
    { label: "Productos", to: "/health/products/accessories", roles: "gerente", activeMatch: withAlias("/health/products/accessories", "/products") },
    { label: "Productos por reabastecer", to: "/health/products/accessories/restock", roles: "sales", activeMatch: ["/health/products/accessories/restock"] }
  ];
  const healthMedicationProductChildren: SidebarMenuItem[] = [
    { label: "Nuevo producto", to: "/health/products/medications/new", roles: "gerente", activeMatch: ["/health/products/medications/new"] },
    { label: "Productos", to: "/health/products/medications", roles: "gerente", activeMatch: ["/health/products/medications"] },
    { label: "Productos por reabastecer", to: "/health/products/medications/restock", roles: "sales", activeMatch: ["/health/products/medications/restock"] }
  ];
  const healthUnifiedProductChildren: SidebarMenuItem[] = [
    { label: "Nuevo producto", to: "/health/products/new", roles: "gerente", activeMatch: ["/health/products/new"] },
    { label: "Productos", to: "/health/products", roles: "gerente", activeMatch: ["/health/products"] },
    { label: "Productos por reabastecer", to: "/health/products/restock", roles: "sales", activeMatch: ["/health/products/restock"] }
  ];
  const retailProductChildren: SidebarMenuItem[] = [
    { label: "Nuevo producto", to: "/retail/products/new", roles: "gerente", activeMatch: ["/retail/products/new"] },
    { label: "Productos", to: "/retail/products", roles: "gerente", activeMatch: withAlias("/retail/products", "/products") },
    { label: "Productos por reabastecer", to: "/retail/products/restock", roles: "sales", activeMatch: ["/retail/products/restock"] }
  ];

  const healthcareSections: SidebarMenuSection[] = [
    {
      title: getHealthcareSidebarTitle(posType),
      items: [
        ...(isPharmacyPos(posType) ? [
          {
            label: "Productos",
            children: [
              { label: "Ventas", to: "/health/sales", roles: "sales" as const, activeMatch: ["/health/sales", "/health/sales/accessories", "/health/sales/medications", "/sales"] },
              { label: "Productos", roles: "gerente" as const, children: healthUnifiedProductChildren },
              { label: "Proveedores", to: "/health/suppliers", roles: "gerente" as const, activeMatch: ["/health/suppliers", "/health/suppliers/accessories", "/health/suppliers/medications", "/suppliers"] }
            ]
          }
        ] : [
          {
            label: "Alimentos y accesorios",
            children: [
              { label: "Ventas", to: "/health/sales/accessories", roles: "sales" as const, activeMatch: withAlias("/health/sales/accessories", "/sales") },
              { label: "Productos", roles: "gerente" as const, children: healthAccessoriesProductChildren },
              { label: "Proveedores", to: "/health/suppliers/accessories", roles: "gerente" as const, activeMatch: withAlias("/health/suppliers/accessories", "/suppliers") }
            ]
          },
          {
            label: "Medicamentos e insumos",
            children: [
              { label: "Ventas", to: "/health/sales/medications", roles: "sales" as const, activeMatch: ["/health/sales/medications"] },
              { label: "Productos", roles: "gerente" as const, children: healthMedicationProductChildren },
              { label: "Proveedores", to: "/health/suppliers/medications", roles: "gerente" as const, activeMatch: ["/health/suppliers/medications"] }
            ]
          }
        ]),
        {
          label: "Atencion medica o clinica",
          children: [
            {
              label: "Citas",
              children: [
                { label: "Estetica", to: "/health/appointments/estetica", roles: "clinical", activeMatch: ["/health/appointments/estetica"] },
                { label: "Medica", to: "/health/appointments/medica", roles: "clinical", activeMatch: withAlias("/health/appointments/medica", "/medical-appointments") }
              ]
            },
            {
              label: "Consultas",
              children: [
                { label: "Recetas", to: "/health/consultations/recetas", roles: "clinical", activeMatch: ["/health/consultations", "/medical-consultations"] }
              ]
            },
            {
              label: "Historial medico",
              children: [
                { label: "Carnet", to: "/health/medical-history/carnet", roles: "clinical", activeMatch: withAlias("/health/medical-history/carnet", "/medical-history") },
                { label: getMedicalHistoryNavLabel(posType), to: "/health/medical-history/calendar", roles: "clinical", activeMatch: ["/health/medical-history/calendar"] }
              ]
            }
          ]
        },
        {
          label: "Clientes y pacientes",
          children: [
            { label: "Clientes / Tutor(es)", to: "/health/clients", roles: "clinical", activeMatch: withAlias("/health/clients", "/clients") },
            { label: getClinicalPatientLabel(posType), to: "/health/patients", roles: "clinical", activeMatch: withAlias("/health/patients", "/patients") }
          ]
        },
        ...(normalizeRole(role) === "clinico"
          ? [{
            label: "Mi perfil",
            children: [
              { label: "Perfil", to: "/health/doctor/profile", roles: "profile" as const, activeMatch: ["/health/doctor/profile", "/profile"] }
            ]
          }]
          : []),
        {
          label: "Administracion",
          children: [
            ...getAdminLinksByRole(role).map((item) => ({
              ...item,
              to: item.label === "Resumen"
                ? "/health/admin/summary"
                : item.label === "Aprobaciones"
                  ? "/health/admin/approvals"
                : item.label === "Usuarios"
                  ? "/health/admin/users"
                    : item.label === "Perfil"
                      ? "/health/admin/profile"
                      : item.label === "Negocios"
                        ? "/businesses"
                      : item.label === "Recordatorios"
                        ? "/health/admin/reminders"
                        : item.label === "Facturas"
                          ? "/health/admin/invoices"
                        : item.label === "Finanzas"
                          ? "/health/admin/finances"
                          : item.label === "Corte Diario"
                            ? "/health/admin/daily-cut"
                            : "/health/admin/credit-collections",
              activeMatch: item.activeMatch
            })).filter((item) => !(normalizeRole(role) === "clinico" && item.label === "Perfil"))
          ]
        }
      ]
    }
  ];

  const retailSections: SidebarMenuSection[] = [
    {
      title: "Operacion",
      items: [
        { label: "Ventas", to: "/retail/sales", roles: "sales", activeMatch: withAlias("/retail/sales", "/sales") },
        { label: "Productos", roles: "gerente", children: retailProductChildren },
        { label: "Proveedores", to: "/retail/suppliers", roles: "gerente", activeMatch: withAlias("/retail/suppliers", "/suppliers") },
        { label: "Historial", to: "/retail/history", roles: "gerente", activeMatch: withAlias("/retail/history", "/sales-history") }
      ]
    },
    {
      title: "Administracion",
      items: [
        ...getAdminLinksByRole(role)
      ].map((item) => ({
        ...item,
        to: item.to === "/credit-collections"
          ? "/retail/admin/credit-collections"
          : item.to === "/product-update-requests"
            ? "/retail/admin/approvals"
          : item.to === "/daily-cut"
            ? "/retail/admin/daily-cut"
            : item.to === "/finances"
              ? "/retail/admin/finances"
              : item.to === "/invoices"
                ? "/retail/admin/invoices"
                : item.to === "/reminders"
                  ? "/retail/admin/reminders"
                  : item.to === "/dashboard"
                    ? "/retail/admin/summary"
                    : item.to === "/businesses"
                      ? "/retail/admin/businesses"
                    : item.to === "/branches"
                      ? "/retail/admin/branches"
                    : item.to === "/users"
                      ? "/retail/admin/users"
                      : item.to === "/profile"
                        ? "/retail/admin/profile"
                        : item.to
      }))
    }
  ];

  const restaurantSections: SidebarMenuSection[] = [
    {
      title: "Restaurante",
      items: [
        { label: "Mapa de Mesas", to: "/restaurant/map", roles: "restaurantStaff", activeMatch: ["/restaurant/map", "/restaurant/orders"] },
        { label: "Cocina", to: "/restaurant/kds", roles: "kitchen", activeMatch: ["/restaurant/kds"] }
      ]
    },
    {
      title: "Operación",
      items: [
        { label: "Productos", to: "/products", roles: "restaurantStaff", activeMatch: ["/products"] },
        { label: "Historial", to: "/sales-history", roles: "restaurantStaff", activeMatch: ["/sales-history"] }
      ]
    },
    {
      title: "Administración",
      items: [
        { label: "Configuracion", to: "/restaurant/admin", roles: "management", activeMatch: ["/restaurant/admin"] },
        { label: "Usuarios", to: "/users", roles: "users", activeMatch: ["/users"] },
        { label: "Alertas", to: "/alertas", roles: "profile", activeMatch: ["/alertas"] },
        { label: "Perfil", to: "/profile", roles: "profile", activeMatch: ["/profile"] }
      ]
    }
  ];

  const baseSections = vertical === "restaurant" ? restaurantSections
    : vertical === "healthcare" ? healthcareSections
    : retailSections;

  const filterFn = vertical === "restaurant"
    ? (section: SidebarMenuSection) => ({
      ...section,
      items: filterMenuItems(section.items, role, canShowCreditCollections, canShowAlerts)
    })
    : (section: SidebarMenuSection) => ({
      ...section,
      items: filterByBusinessContext(filterMenuItems(section.items, role, canShowCreditCollections), posType, role)
    });

  return baseSections
    .map(filterFn)
    .filter((section) => section.items.length > 0);
}
