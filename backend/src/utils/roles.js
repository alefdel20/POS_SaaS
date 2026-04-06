const { USER_ROLES, normalizeUserRole } = require("./domainEnums");

function normalizeRole(role) {
  return normalizeUserRole(role);
}

function isManagementRole(role) {
  const normalizedRole = normalizeRole(role);
  return normalizedRole === "superusuario" || normalizedRole === "admin";
}

function getAssignableRoles(actorRole) {
  const normalizedRole = normalizeRole(actorRole);

  if (normalizedRole === "superusuario") {
    return [...USER_ROLES];
  }

  if (normalizedRole === "admin") {
    return ["admin", "clinico", "cajero"];
  }

  return [];
}

function canAssignRole(actorRole, targetRole) {
  const normalizedTargetRole = normalizeRole(targetRole);

  if (!normalizedTargetRole) {
    return false;
  }

  return getAssignableRoles(actorRole).includes(normalizedTargetRole);
}

module.exports = {
  normalizeRole,
  isManagementRole,
  getAssignableRoles,
  canAssignRole
};
