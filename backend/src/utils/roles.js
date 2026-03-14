const roleAliases = {
  admin: "superadmin",
  superadmin: "superadmin",
  cajero: "user",
  cashier: "user",
  user: "user"
};

function normalizeRole(role) {
  if (!role) {
    return role;
  }

  return roleAliases[String(role).toLowerCase()] || role;
}

module.exports = {
  normalizeRole
};
