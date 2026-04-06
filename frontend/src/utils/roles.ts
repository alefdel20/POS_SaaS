import type { Role } from "../types";
import { normalizeUserRole } from "./domainEnums";

export const ROLE_SUPERUSER = "superusuario" as const;
export const ROLE_ADMIN = "admin" as const;
export const ROLE_CLINICAL = "clinico" as const;
export const ROLE_SUPPORT = "soporte" as const;
export const ROLE_CASHIER = "cajero" as const;

export const ROUTE_ROLES = {
  sales: [ROLE_SUPERUSER, ROLE_ADMIN, ROLE_CASHIER] as const,
  users: [ROLE_SUPERUSER, ROLE_ADMIN, ROLE_SUPPORT] as const,
  dailyCut: [ROLE_SUPERUSER, ROLE_ADMIN, ROLE_CASHIER] as const,
  management: [ROLE_SUPERUSER, ROLE_ADMIN] as const,
  clinical: [ROLE_SUPERUSER, ROLE_ADMIN, ROLE_CLINICAL] as const,
  invoices: [ROLE_SUPERUSER, ROLE_ADMIN, ROLE_SUPPORT] as const,
  businesses: [ROLE_SUPERUSER] as const,
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

export function canAccessDailyCut(role?: string | null) {
  return hasAnyRole(role, ROUTE_ROLES.dailyCut);
}

export function canAccessInvoices(role?: string | null) {
  return hasAnyRole(role, ROUTE_ROLES.invoices);
}

export function canAccessBusinesses(role?: string | null) {
  return hasAnyRole(role, ROUTE_ROLES.businesses);
}

export function canEditAdministrativeInvoices(role?: string | null) {
  return hasAnyRole(role, ROUTE_ROLES.management);
}

export function isCashierRole(role?: string | null) {
  return normalizeRole(role) === ROLE_CASHIER;
}

export function getDefaultRouteForRole(role?: string | null) {
  const normalized = normalizeRole(role);
  if (normalized === ROLE_SUPPORT) {
    return "/users";
  }

  if (normalized === ROLE_CLINICAL) {
    return "/health/patients";
  }

  return isManagementRole(role) ? "/dashboard" : "/sales";
}
