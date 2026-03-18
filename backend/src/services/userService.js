const bcrypt = require("bcryptjs");
const crypto = require("crypto");
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
    pos_type: user.pos_type || "Otro",
    must_change_password: Boolean(user.must_change_password)
  };
}

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  const { password_hash, ...safeUser } = user;
  return mapUser(safeUser);
}

async function countActiveSuperusers(client = pool) {
  const { rows } = await client.query(
    "SELECT COUNT(*)::int AS total FROM users WHERE role = 'superusuario' AND is_active = TRUE"
  );
  return Number(rows[0]?.total || 0);
}

async function ensureSuperuserRemains(currentUser, nextRole, nextIsActive, client = pool) {
  if (currentUser.role !== "superusuario") {
    return;
  }

  if (nextRole === "superusuario" && nextIsActive) {
    return;
  }

  const total = await countActiveSuperusers(client);
  if (total <= 1 && currentUser.is_active) {
    throw new ApiError(409, "At least one active superusuario must remain");
  }
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
    "SELECT id, username, email, full_name, role, pos_type, is_active, must_change_password, created_at, updated_at FROM users ORDER BY created_at DESC"
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
    `INSERT INTO users (username, email, full_name, password_hash, role, pos_type, is_active, must_change_password, password_changed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     RETURNING id, username, email, full_name, role, pos_type, is_active, must_change_password, created_at, updated_at`,
    [
      payload.username,
      payload.email,
      payload.full_name,
      passwordHash,
      normalizedRole,
      payload.pos_type || "Otro",
      payload.is_active ?? true,
      payload.must_change_password ?? false
    ]
  );
  return mapUser(rows[0]);
}

async function updateUser(id, payload, actor) {
  const current = await getUserById(id);

  if (!current) {
    throw new ApiError(404, "User not found");
  }

  const actorRole = normalizeRole(actor?.role);
  const nextRole = payload.role ? normalizeRole(payload.role) : current.role;
  const nextIsActive = payload.is_active ?? current.is_active;

  if (!nextRole) {
    throw new ApiError(400, "Invalid role");
  }
  if (payload.role && actorRole !== "superusuario") {
    throw new ApiError(403, "Forbidden role assignment");
  }
  if (payload.role && !canAssignRole(actorRole, nextRole)) {
    throw new ApiError(403, "Forbidden role assignment");
  }
  if (actorRole !== "superusuario" && current.role === "superusuario") {
    throw new ApiError(403, "Forbidden");
  }

  await ensureSuperuserRemains(current, nextRole, nextIsActive);

  const passwordHash = payload.password
    ? await bcrypt.hash(payload.password, 10)
    : current.password_hash;

  const { rows } = await pool.query(
    `UPDATE users
     SET username = $1,
         email = $2,
         full_name = $3,
         password_hash = $4,
         role = $5,
         pos_type = $6,
         is_active = $7,
         must_change_password = $8,
         password_changed_at = CASE WHEN $9::boolean THEN NOW() ELSE password_changed_at END,
         updated_at = NOW()
     WHERE id = $10
     RETURNING id, username, email, full_name, role, pos_type, is_active, must_change_password, created_at, updated_at`,
    [
      payload.username ?? current.username,
      payload.email ?? current.email,
      payload.full_name ?? current.full_name,
      passwordHash,
      nextRole,
      actorRole === "superusuario" ? (payload.pos_type ?? current.pos_type ?? "Otro") : (current.pos_type ?? "Otro"),
      nextIsActive,
      payload.must_change_password ?? current.must_change_password ?? false,
      Boolean(payload.password),
      id
    ]
  );
  return mapUser(rows[0]);
}

async function updateUserStatus(id, isActive, actor) {
  const current = await getUserById(id);
  if (!current) {
    throw new ApiError(404, "User not found");
  }

  await ensureSuperuserRemains(current, current.role, isActive);

  const { rows } = await pool.query(
    `UPDATE users SET is_active = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, username, email, full_name, role, pos_type, is_active, must_change_password, created_at, updated_at`,
    [isActive, id]
  );

  return mapUser(rows[0]);
}

async function resetUserPassword(targetUserId, payload, actor) {
  const actorRole = normalizeRole(actor?.role);
  if (actorRole !== "superusuario") {
    throw new ApiError(403, "Forbidden");
  }

  const target = await getUserById(targetUserId);
  if (!target) {
    throw new ApiError(404, "User not found");
  }

  const generatedPassword = payload.new_password?.trim() || crypto.randomBytes(6).toString("base64url");
  if (generatedPassword.length < 8) {
    throw new ApiError(400, "Password must be at least 8 characters");
  }

  const passwordHash = await bcrypt.hash(generatedPassword, 10);
  await pool.query(
    `UPDATE users
     SET password_hash = $1,
         must_change_password = $2,
         password_reset_by = $3,
         password_reset_at = NOW(),
         updated_at = NOW()
     WHERE id = $4`,
    [
      passwordHash,
      payload.force_change ?? true,
      actor.id,
      targetUserId
    ]
  );

  return {
    temporary_password: generatedPassword,
    must_change_password: payload.force_change ?? true,
    reset_by: actor.id,
    user_id: targetUserId
  };
}

async function changeOwnPassword(userId, payload) {
  const user = await getUserById(userId);
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  const passwordMatches = await bcrypt.compare(payload.current_password, user.password_hash);
  if (!passwordMatches) {
    throw new ApiError(401, "Invalid credentials");
  }

  const passwordHash = await bcrypt.hash(payload.new_password, 10);
  await pool.query(
    `UPDATE users
     SET password_hash = $1,
         must_change_password = FALSE,
         password_changed_at = NOW(),
         updated_at = NOW()
     WHERE id = $2`,
    [passwordHash, userId]
  );

  return { success: true };
}

async function logSupportAccess(targetUserId, actor, reason = "") {
  const actorRole = normalizeRole(actor?.role);
  if (!["superusuario", "soporte"].includes(actorRole || "")) {
    throw new ApiError(403, "Forbidden");
  }

  const target = await getUserById(targetUserId);
  if (!target) {
    throw new ApiError(404, "User not found");
  }

  const { rows } = await pool.query(
    `INSERT INTO support_access_logs (actor_user_id, target_user_id, reason)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [actor.id, targetUserId, reason || ""]
  );

  return rows[0];
}

module.exports = {
  sanitizeUser,
  getUserById,
  getUserByLogin,
  listUsers,
  createUser,
  updateUser,
  updateUserStatus,
  resetUserPassword,
  changeOwnPassword,
  logSupportAccess
};
