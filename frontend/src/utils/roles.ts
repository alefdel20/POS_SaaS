import type { Role } from "../types";

export function normalizeRole(role?: string | null): Role | null {
  if (!role) {
    return null;
  }

  const normalized = role.toLowerCase();
  if (normalized === "superusuario" || normalized === "superadmin") {
    return "superusuario";
  }

  if (normalized === "admin") {
    return "admin";
  }

  if (normalized === "soporte" || normalized === "support") {
    return "soporte";
  }

  if (normalized === "cajero" || normalized === "cashier" || normalized === "user") {
    return "cajero";
  }

  return null;
}

export function isManagementRole(role?: string | null) {
  const normalized = normalizeRole(role);
  return normalized === "superusuario" || normalized === "admin";
}

export function canViewUsers(role?: string | null) {
  const normalized = normalizeRole(role);
  return normalized === "superusuario" || normalized === "admin" || normalized === "soporte";
}

export function getDefaultRouteForRole(role?: string | null) {
  return isManagementRole(role) ? "/dashboard" : "/sales";
}
