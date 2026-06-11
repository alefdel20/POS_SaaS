import type { Role } from "../types";
import { normalizeUserRole } from "./domainEnums";

export const ROLE_SUPERUSER = "superusuario" as const;
export const ROLE_ADMIN = "admin" as const;
export const ROLE_MANAGER = "gerente" as const;
export const ROLE_CLINICAL = "clinico" as const;
export const ROLE_SUPPORT = "soporte" as const;
export const ROLE_CASHIER = "cajero" as const;
export const ROLE_KITCHEN = "cocina" as const;

export const ROUTE_ROLES = {
  sales: [ROLE_SUPERUSER, ROLE_ADMIN, ROLE_MANAGER, ROLE_CASHIER] as const,
  users: [ROLE_SUPERUSER, ROLE_ADMIN, ROLE_SUPPORT, ROLE_MANAGER] as const,
  dailyCut: [ROLE_SUPERUSER, ROLE_ADMIN, ROLE_MANAGER, ROLE_CASHIER] as const,
  management: [ROLE_SUPERUSER, ROLE_ADMIN] as const,
  gerente: [ROLE_SUPERUSER, ROLE_ADMIN, ROLE_MANAGER] as const,
  clinical: [ROLE_SUPERUSER, ROLE_ADMIN, ROLE_CLINICAL] as const,
  invoices: [ROLE_SUPERUSER, ROLE_ADMIN, ROLE_SUPPORT] as const,
  businesses: [ROLE_SUPERUSER] as const,
  financialDashboard: [ROLE_SUPERUSER] as const,
  // Restaurante: staff de piso (excluye cocina) vs. KDS (incluye cocina)
  restaurantStaff: [ROLE_SUPERUSER, ROLE_ADMIN, ROLE_MANAGER, ROLE_CASHIER] as const,
  restaurantKds: [ROLE_SUPERUSER, ROLE_ADMIN, ROLE_MANAGER, ROLE_CASHIER, ROLE_KITCHEN] as const,
} as const;

export function normalizeRole(role?: string | null): Role | null {
  return normalizeUserRole(role);
}

export function hasAnyRole(role: string | null | undefined, allowedRoles: readonly string[]) {
  const normalized = normalizeRole(role);
  return Boolean(normalized && allowedRoles.includes(normalized));
}

export function isManagementRole(role?: string | null) {
  return hasAnyRole(role, ROUTE_ROLES.management);
}

export function canAccessClinical(role?: string | null) {
  return hasAnyRole(role, ROUTE_ROLES.clinical);
}

export function canViewUsers(role?: string | null) {
  return hasAnyRole(role, ROUTE_ROLES.users);
}

export function canAccessSales(role?: string | null) {
  return hasAnyRole(role, ROUTE_ROLES.sales);
}

export function canManageProducts(role?: string | null) {
  return isManagementRole(role) || isCashierRole(role) || normalizeRole(role) === ROLE_MANAGER;
}

export function canAccessDailyCut(role?: string | null) {
  return hasAnyRole(role, ROUTE_ROLES.dailyCut);
}

export function canAccessInvoices(role?: string | null) {
  return hasAnyRole(role, ROUTE_ROLES.invoices);
}

export function canAccessBusinesses(role?: string | null) {
  return hasAnyRole(role, ROUTE_ROLES.businesses);
}

export function canAccessFinancialDashboard(role?: string | null) {
  return hasAnyRole(role, ROUTE_ROLES.financialDashboard);
}

export function canEditAdministrativeInvoices(role?: string | null) {
  return hasAnyRole(role, ROUTE_ROLES.management);
}

export function isCashierRole(role?: string | null) {
  return normalizeRole(role) === ROLE_CASHIER;
}

export function isKitchenRole(role?: string | null) {
  return normalizeRole(role) === ROLE_KITCHEN;
}

export function canAccessDashboard(role?: string | null) {
  const normalized = normalizeRole(role);
  return normalized === ROLE_SUPERUSER || normalized === ROLE_ADMIN || normalized === ROLE_MANAGER;
}

export function canAccessRestaurantStaff(role?: string | null) {
  return hasAnyRole(role, ROUTE_ROLES.restaurantStaff);
}

export function canAccessRestaurantKds(role?: string | null) {
  return hasAnyRole(role, ROUTE_ROLES.restaurantKds);
}

export function getDefaultRouteForRole(role?: string | null) {
  const normalized = normalizeRole(role);
  if (normalized === ROLE_SUPPORT) {
    return "/users";
  }

  if (normalized === ROLE_KITCHEN) {
    return "/restaurant/kds";
  }

  if (normalized === ROLE_CLINICAL) {
    return "/health/patients";
  }

  return isManagementRole(role) ? "/dashboard" : "/sales";
}
