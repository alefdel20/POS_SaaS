const roleAliases = {
  superusuario: "superusuario",
  superadmin: "superusuario",
  admin: "admin",
  soporte: "soporte",
  support: "soporte",
  cajero: "cajero",
  cashier: "cajero",
  user: "cajero"
};

function normalizeRole(role) {
  if (!role) {
    return null;
  }

  return roleAliases[String(role).toLowerCase()] || null;
}

function isManagementRole(role) {
  const normalizedRole = normalizeRole(role);
  return normalizedRole === "superusuario" || normalizedRole === "admin";
}

function getAssignableRoles(actorRole) {
  const normalizedRole = normalizeRole(actorRole);

  if (normalizedRole === "superusuario") {
    return ["superusuario", "admin", "cajero", "soporte"];
  }

  if (normalizedRole === "admin") {
    return ["admin", "cajero"];
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
