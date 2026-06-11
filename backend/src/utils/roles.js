const { USER_ROLES, CLINICAL_POS_TYPES, normalizeUserRole } = require("./domainEnums");

function normalizeRole(role) {
  return normalizeUserRole(role);
}

function isManagementRole(role) {
  const normalizedRole = normalizeRole(role);
  return normalizedRole === "superusuario" || normalizedRole === "admin";
}

function getAssignableRoles(actorRole, posType = null) {
  const normalizedRole = normalizeRole(actorRole);
  const isClinical = CLINICAL_POS_TYPES.includes(posType);
  const clinicalRoles = isClinical ? ["clinico"] : [];
  // El rol cocina solo aplica a negocios de tipo restaurante.
  const isRestaurant = posType === "Restaurante";
  const kitchenRoles = isRestaurant ? ["cocina"] : [];

  if (normalizedRole === "superusuario") {
    return [...USER_ROLES];
  }

  if (normalizedRole === "admin") {
    return ["admin", "gerente", "cajero", ...clinicalRoles, ...kitchenRoles];
  }

  if (normalizedRole === "gerente") {
    return ["cajero", ...clinicalRoles, ...kitchenRoles];
  }

  return [];
}

function canAssignRole(actorRole, targetRole, posType = null) {
  const normalizedTargetRole = normalizeRole(targetRole);

  if (!normalizedTargetRole) {
    return false;
  }

  return getAssignableRoles(actorRole, posType).includes(normalizedTargetRole);
}

module.exports = {
  normalizeRole,
  isManagementRole,
  getAssignableRoles,
  canAssignRole
};
