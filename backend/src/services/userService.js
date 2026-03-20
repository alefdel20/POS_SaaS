const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { canAssignRole, normalizeRole } = require("../utils/roles");
const { saveAuditLog } = require("./auditLogService");

function mapUser(user) {
  if (!user) {
    return null;
  }

  return {
    ...user,
    role: normalizeRole(user.role),
    pos_type: user.pos_type || "Otro",
    must_change_password: Boolean(user.must_change_password),
    support_mode_active: Boolean(user.support_mode_active)
  };
}

function buildAuditSnapshot(user) {
  if (!user) {
    return {};
  }

  const mappedUser = mapUser(user);
  const { password_hash, ...safeUser } = mappedUser;
  return safeUser;
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
    "SELECT id, username, email, full_name, role, pos_type, is_active, must_change_password, support_mode_active, created_at, updated_at FROM users ORDER BY created_at DESC"
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
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO users (username, email, full_name, password_hash, role, pos_type, is_active, must_change_password, password_changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING id, username, email, full_name, role, pos_type, is_active, must_change_password, support_mode_active, created_at, updated_at`,
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

    await saveAuditLog({
      usuario_id: actor?.id,
      modulo: "users",
      accion: "create_user",
      entidad_tipo: "user",
      entidad_id: rows[0].id,
      detalle_anterior: {},
      detalle_nuevo: {
        entity: "user",
        entity_id: rows[0].id,
        snapshot: buildAuditSnapshot(rows[0]),
        source: "userService.createUser",
        version: 1
      },
      motivo: "",
      metadata: { actor_role: normalizeRole(actor?.role) }
    }, { client });

    await client.query("COMMIT");
    return mapUser(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
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
       RETURNING id, username, email, full_name, role, pos_type, is_active, must_change_password, support_mode_active, created_at, updated_at`,
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

    await saveAuditLog({
      usuario_id: actor?.id,
      modulo: "users",
      accion: "update_user",
      entidad_tipo: "user",
      entidad_id: id,
      detalle_anterior: {
        entity: "user",
        entity_id: id,
        snapshot: buildAuditSnapshot(current),
        source: "userService.updateUser",
        version: 1
      },
      detalle_nuevo: {
        entity: "user",
        entity_id: id,
        snapshot: buildAuditSnapshot(rows[0]),
        source: "userService.updateUser",
        version: 1
      },
      motivo: "",
      metadata: { actor_role: actorRole }
    }, { client });

    await client.query("COMMIT");
    return mapUser(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateUserStatus(id, isActive, actor) {
  const current = await getUserById(id);
  if (!current) {
    throw new ApiError(404, "User not found");
  }

  const actorRole = normalizeRole(actor?.role);
  if (actorRole !== "superusuario" && current.role === "superusuario") {
    throw new ApiError(403, "Forbidden");
  }

  await ensureSuperuserRemains(current, current.role, isActive);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE users SET is_active = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, username, email, full_name, role, pos_type, is_active, must_change_password, support_mode_active, created_at, updated_at`,
      [isActive, id]
    );

    await saveAuditLog({
      usuario_id: actor?.id,
      modulo: "users",
      accion: "update_user_status",
      entidad_tipo: "user",
      entidad_id: id,
      detalle_anterior: {
        entity: "user",
        entity_id: id,
        snapshot: buildAuditSnapshot(current),
        source: "userService.updateUserStatus",
        version: 1
      },
      detalle_nuevo: {
        entity: "user",
        entity_id: id,
        snapshot: buildAuditSnapshot(rows[0]),
        source: "userService.updateUserStatus",
        version: 1
      },
      motivo: "",
      metadata: { actor_role: actorRole }
    }, { client });

    await client.query("COMMIT");
    return mapUser(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
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

    await saveAuditLog({
      usuario_id: actor.id,
      modulo: "users",
      accion: "reset_password",
      entidad_tipo: "user",
      entidad_id: targetUserId,
      detalle_anterior: {
        entity: "user",
        entity_id: targetUserId,
        snapshot: buildAuditSnapshot(target),
        source: "userService.resetUserPassword",
        version: 1
      },
      detalle_nuevo: {
        entity: "user",
        entity_id: targetUserId,
        snapshot: {
          ...buildAuditSnapshot(target),
          must_change_password: payload.force_change ?? true,
          password_reset_by: actor.id
        },
        source: "userService.resetUserPassword",
        version: 1
      },
      motivo: payload.reason || "",
      metadata: { actor_role: actorRole }
    }, { client });

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

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
  if (actorRole === "soporte" && !actor?.support_mode_active) {
    throw new ApiError(403, "Support mode must be active");
  }

  const target = await getUserById(targetUserId);
  if (!target) {
    throw new ApiError(404, "User not found");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO support_access_logs (actor_user_id, target_user_id, reason)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [actor.id, targetUserId, reason || ""]
    );

    await saveAuditLog({
      usuario_id: actor.id,
      modulo: "users",
      accion: "log_support_access",
      entidad_tipo: "support_access_log",
      entidad_id: rows[0].id,
      detalle_anterior: {},
      detalle_nuevo: {
        entity: "support_access_log",
        entity_id: rows[0].id,
        snapshot: rows[0],
        source: "userService.logSupportAccess",
        version: 1
      },
      motivo: reason || "",
      metadata: { actor_role: actorRole, target_user_role: target.role }
    }, { client });

    await client.query("COMMIT");
    return rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function setSupportMode(targetUserId, actor, nextState, reason = "") {
  const actorRole = normalizeRole(actor?.role);
  if (!["superusuario", "soporte"].includes(actorRole || "")) {
    throw new ApiError(403, "Forbidden");
  }

  const target = await getUserById(targetUserId);
  if (!target) {
    throw new ApiError(404, "User not found");
  }

  if (target.role !== "soporte") {
    throw new ApiError(409, "Support mode is only available for soporte users");
  }

  if (actorRole === "soporte" && actor.id !== targetUserId) {
    throw new ApiError(403, "Support users can only manage their own support mode");
  }

  if (nextState && !target.is_active) {
    throw new ApiError(409, "Support mode requires an active user");
  }

  if (target.support_mode_active === nextState) {
    return sanitizeUser(target);
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE users
       SET support_mode_active = $1,
           support_mode_activated_at = CASE WHEN $1::boolean THEN NOW() ELSE support_mode_activated_at END,
           support_mode_deactivated_at = CASE WHEN $1::boolean THEN support_mode_deactivated_at ELSE NOW() END,
           support_mode_updated_by = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [nextState, actor.id, targetUserId]
    );

    await client.query(
      `INSERT INTO support_access_logs (actor_user_id, target_user_id, reason)
       VALUES ($1, $2, $3)`,
      [actor.id, targetUserId, reason || (nextState ? "Support mode activated" : "Support mode deactivated")]
    );

    await saveAuditLog({
      usuario_id: actor.id,
      modulo: "users",
      accion: nextState ? "activate_support_mode" : "deactivate_support_mode",
      entidad_tipo: "user",
      entidad_id: targetUserId,
      detalle_anterior: {
        entity: "user",
        entity_id: targetUserId,
        snapshot: buildAuditSnapshot(target),
        source: "userService.setSupportMode",
        version: 1
      },
      detalle_nuevo: {
        entity: "user",
        entity_id: targetUserId,
        snapshot: buildAuditSnapshot(rows[0]),
        source: "userService.setSupportMode",
        version: 1
      },
      motivo: reason || "",
      metadata: { actor_role: actorRole }
    }, { client });

    await client.query("COMMIT");
    return sanitizeUser(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function activateSupportMode(targetUserId, actor, reason = "") {
  return setSupportMode(targetUserId, actor, true, reason);
}

async function deactivateSupportMode(targetUserId, actor, reason = "") {
  return setSupportMode(targetUserId, actor, false, reason);
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
  logSupportAccess,
  activateSupportMode,
  deactivateSupportMode
};
