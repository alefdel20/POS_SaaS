const bcrypt = require("bcryptjs");
const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { canAssignRole, normalizeRole } = require("../utils/roles");

function mapUser(user) {
  if (!user) {
    return null;
  }

  return {
    ...user,
    role: normalizeRole(user.role),
    pos_type: user.pos_type || "Otro"
  };
}

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  const { password_hash, ...safeUser } = user;
  return mapUser(safeUser);
}

async function getUserById(id) {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return mapUser(rows[0] || null);
}

async function getUserByLogin(identifier) {
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE username = $1 OR email = $1",
    [identifier]
  );
  return mapUser(rows[0] || null);
}

async function listUsers() {
  const { rows } = await pool.query(
    "SELECT id, username, email, full_name, role, pos_type, is_active, created_at, updated_at FROM users ORDER BY created_at DESC"
  );
  return rows.map(mapUser);
}

async function createUser(payload, actor) {
  const [existingUsername, existingEmail] = await Promise.all([
    getUserByLogin(payload.username),
    getUserByLogin(payload.email)
  ]);

  if (existingUsername || existingEmail) {
    throw new ApiError(409, "Username or email already exists");
  }

  const normalizedRole = normalizeRole(payload.role);
  if (!normalizedRole) {
    throw new ApiError(400, "Invalid role");
  }
  if (!canAssignRole(actor?.role, normalizedRole)) {
    throw new ApiError(403, "Forbidden role assignment");
  }

  const passwordHash = await bcrypt.hash(payload.password, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, full_name, password_hash, role, pos_type, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, username, email, full_name, role, pos_type, is_active, created_at, updated_at`,
    [
      payload.username,
      payload.email,
      payload.full_name,
      passwordHash,
      normalizedRole,
      payload.pos_type || "Otro",
      payload.is_active ?? true
    ]
  );
  return mapUser(rows[0]);
}

async function updateUser(id, payload, actor) {
  const current = await getUserById(id);

  if (!current) {
    throw new ApiError(404, "User not found");
  }

  const nextRole = payload.role ? normalizeRole(payload.role) : current.role;
  if (!nextRole) {
    throw new ApiError(400, "Invalid role");
  }
  if (payload.role && !canAssignRole(actor?.role, nextRole)) {
    throw new ApiError(403, "Forbidden role assignment");
  }
  if (normalizeRole(actor?.role) !== "superusuario" && current.role === "superusuario") {
    throw new ApiError(403, "Forbidden");
  }

  const passwordHash = payload.password
    ? await bcrypt.hash(payload.password, 10)
    : current.password_hash;

  const { rows } = await pool.query(
    `UPDATE users
     SET username = $1, email = $2, full_name = $3, password_hash = $4, role = $5, pos_type = $6, is_active = $7, updated_at = NOW()
     WHERE id = $8
     RETURNING id, username, email, full_name, role, pos_type, is_active, created_at, updated_at`,
    [
      payload.username ?? current.username,
      payload.email ?? current.email,
      payload.full_name ?? current.full_name,
      passwordHash,
      nextRole,
      payload.pos_type ?? current.pos_type ?? "Otro",
      payload.is_active ?? current.is_active,
      id
    ]
  );
  return mapUser(rows[0]);
}

async function updateUserStatus(id, isActive) {
  const { rows } = await pool.query(
    `UPDATE users SET is_active = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, username, email, full_name, role, pos_type, is_active, created_at, updated_at`,
    [isActive, id]
  );

  if (!rows[0]) {
    throw new ApiError(404, "User not found");
  }

  return mapUser(rows[0]);
}

module.exports = {
  sanitizeUser,
  getUserById,
  getUserByLogin,
  listUsers,
  createUser,
  updateUser,
  updateUserStatus
};
