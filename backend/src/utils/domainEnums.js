const USER_ROLES = ["superusuario", "admin", "clinico", "cajero", "soporte"];
const USER_ROLE_ALIASES = {
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

const PRODUCT_CATALOG_TYPES = ["accessories", "medications"];
const PRODUCT_CATALOG_TYPE_ALIASES = {
  accessories: "accessories",
  accessory: "accessories",
  alimentos: "accessories",
  alimentos_accesorios: "accessories",
  "food-accessories": "accessories",
  medications: "medications",
  medication: "medications",
  medicines: "medications",
  "medications-supplies": "medications",
  medico: "medications",
  medical: "medications"
};

const REMINDER_CATEGORIES = ["administrative", "clinical"];
const REMINDER_CATEGORY_ALIASES = {
  administrative: "administrative",
  admin: "administrative",
  administrativo: "administrative",
  clinical: "clinical",
  clinic: "clinical",
  medical: "clinical",
  medico: "clinical"
};

const REMINDER_STATUSES = ["pending", "in_progress", "completed", "cancelled"];
const REMINDER_STATUS_ALIASES = {
  pending: "pending",
  pendiente: "pending",
  in_progress: "in_progress",
  progreso: "in_progress",
  completed: "completed",
  complete: "completed",
  completado: "completed",
  cancelled: "cancelled",
  canceled: "cancelled",
  cancelado: "cancelled"
};

const PRESCRIPTION_STATUSES = ["draft", "issued", "cancelled"];
const PRESCRIPTION_STATUS_ALIASES = {
  draft: "draft",
  borrador: "draft",
  issued: "issued",
  emitida: "issued",
  cancelled: "cancelled",
  canceled: "cancelled",
  cancelada: "cancelled"
};

const PREVENTIVE_EVENT_TYPES = ["vaccination", "deworming"];
const PREVENTIVE_EVENT_TYPE_ALIASES = {
  vaccination: "vaccination",
  vacuna: "vaccination",
  vacunacion: "vaccination",
  deworming: "deworming",
  desparasitacion: "deworming",
  desparasitación: "deworming"
};

const PREVENTIVE_EVENT_STATUSES = ["scheduled", "completed", "cancelled"];
const PREVENTIVE_EVENT_STATUS_ALIASES = {
  scheduled: "scheduled",
  programado: "scheduled",
  completed: "completed",
  completado: "completed",
  cancelled: "cancelled",
  canceled: "cancelled",
  cancelado: "cancelled"
};

function normalizeFromAliases(value, aliases) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return aliases[String(value).trim().toLowerCase()] || null;
}

function normalizeUserRole(value) {
  return normalizeFromAliases(value, USER_ROLE_ALIASES);
}

function normalizeProductCatalogType(value) {
  return normalizeFromAliases(value, PRODUCT_CATALOG_TYPE_ALIASES);
}

function normalizeReminderCategory(value) {
  return normalizeFromAliases(value, REMINDER_CATEGORY_ALIASES);
}

function normalizeReminderStatus(value) {
  return normalizeFromAliases(value, REMINDER_STATUS_ALIASES);
}

function normalizePrescriptionStatus(value) {
  return normalizeFromAliases(value, PRESCRIPTION_STATUS_ALIASES);
}

function normalizePreventiveEventType(value) {
  return normalizeFromAliases(value, PREVENTIVE_EVENT_TYPE_ALIASES);
}

function normalizePreventiveEventStatus(value) {
  return normalizeFromAliases(value, PREVENTIVE_EVENT_STATUS_ALIASES);
}

module.exports = {
  USER_ROLES,
  PRODUCT_CATALOG_TYPES,
  REMINDER_CATEGORIES,
  REMINDER_STATUSES,
  PRESCRIPTION_STATUSES,
  PREVENTIVE_EVENT_TYPES,
  PREVENTIVE_EVENT_STATUSES,
  normalizeUserRole,
  normalizeProductCatalogType,
  normalizeReminderCategory,
  normalizeReminderStatus,
  normalizePrescriptionStatus,
  normalizePreventiveEventType,
  normalizePreventiveEventStatus
};
