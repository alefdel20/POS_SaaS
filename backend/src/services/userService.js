const bcrypt = require("bcryptjs");
const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  const { password_hash, ...safeUser } = user;
  return safeUser;
}

async function getUserById(id) {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] || null;
}

async function getUserByLogin(identifier) {
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE username = $1 OR email = $1",
    [identifier]
  );
  return rows[0] || null;
}

async function listUsers() {
  const { rows } = await pool.query(
    "SELECT id, username, email, full_name, role, is_active, created_at, updated_at FROM users ORDER BY created_at DESC"
  );
  return rows;
}

async function createUser(payload) {
  const [existingUsername, existingEmail] = await Promise.all([
    getUserByLogin(payload.username),
    getUserByLogin(payload.email)
  ]);

  if (existingUsername || existingEmail) {
    throw new ApiError(409, "Username or email already exists");
  }

  const passwordHash = await bcrypt.hash(payload.password, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, full_name, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, username, email, full_name, role, is_active, created_at, updated_at`,
    [
      payload.username,
      payload.email,
      payload.full_name,
      passwordHash,
      payload.role,
      payload.is_active ?? true
    ]
  );
  return rows[0];
}

async function updateUser(id, payload) {
  const current = await getUserById(id);

  if (!current) {
    throw new ApiError(404, "User not found");
  }

  const passwordHash = payload.password
    ? await bcrypt.hash(payload.password, 10)
    : current.password_hash;

  const { rows } = await pool.query(
    `UPDATE users
     SET username = $1, email = $2, full_name = $3, password_hash = $4, role = $5, is_active = $6, updated_at = NOW()
     WHERE id = $7
     RETURNING id, username, email, full_name, role, is_active, created_at, updated_at`,
    [
      payload.username ?? current.username,
      payload.email ?? current.email,
      payload.full_name ?? current.full_name,
      passwordHash,
      payload.role ?? current.role,
      payload.is_active ?? current.is_active,
      id
    ]
  );
  return rows[0];
}

async function updateUserStatus(id, isActive) {
  const { rows } = await pool.query(
    `UPDATE users SET is_active = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, username, email, full_name, role, is_active, created_at, updated_at`,
    [isActive, id]
  );

  if (!rows[0]) {
    throw new ApiError(404, "User not found");
  }

  return rows[0];
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
