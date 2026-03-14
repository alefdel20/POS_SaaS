import type { Role } from "../types";

export function normalizeRole(role?: string | null): Role | null {
  if (!role) {
    return null;
  }

  const normalized = role.toLowerCase();
  if (normalized === "admin" || normalized === "superadmin") {
    return "superadmin";
  }

  if (normalized === "cajero" || normalized === "cashier" || normalized === "user") {
    return "user";
  }

  return null;
}

export function isManagementRole(role?: string | null) {
  return normalizeRole(role) === "superadmin";
}

export function getDefaultRouteForRole(role?: string | null) {
  return isManagementRole(role) ? "/dashboard" : "/sales";
}
