export const USER_ROLES = ["superusuario", "admin", "clinico", "cajero", "soporte"] as const;
export const PRODUCT_CATALOG_TYPES = ["accessories", "medications"] as const;
export const REMINDER_CATEGORIES = ["administrative", "clinical"] as const;
export const REMINDER_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export const PRESCRIPTION_STATUSES = ["draft", "issued", "cancelled"] as const;
export const PREVENTIVE_EVENT_TYPES = ["vaccination", "deworming"] as const;
export const PREVENTIVE_EVENT_STATUSES = ["scheduled", "completed", "cancelled"] as const;

const USER_ROLE_ALIASES: Record<string, typeof USER_ROLES[number]> = {
  superusuario: "superusuario",
  superadmin: "superusuario",
  admin: "admin",
  clinico: "clinico",
  medico: "clinico",
  veterinario: "clinico",
  cajero: "cajero",
  cashier: "cajero",
  user: "cajero",
  soporte: "soporte",
  support: "soporte"
};

export function normalizeUserRole(value?: string | null) {
  if (!value) return null;
  return USER_ROLE_ALIASES[String(value).trim().toLowerCase()] || null;
}
