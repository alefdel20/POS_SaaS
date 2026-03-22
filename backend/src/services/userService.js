const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { canAssignRole, normalizeRole } = require("../utils/roles");
const { saveAuditLog } = require("./auditLogService");
const { isSuperUser, requireActorBusinessId } = require("../utils/tenant");

const USER_FIELDS = `
  u.*,
  b.name AS business_name,
  b.slug AS business_slug,
  b.pos_type AS business_pos_type
`;

function mapUser(user) {
  if (!user) return null;
  return {
    ...user,
    role: normalizeRole(user.role),
    business_id: Number(user.business_id),
    pos_type: user.business_pos_type || user.pos_type || "Otro",
    must_change_password: Boolean(user.must_change_password),
    support_mode_active: Boolean(user.support_mode_active)
  };
}

function buildAuditSnapshot(user) {
  if (!user) return {};
  const { password_hash, ...safe } = mapUser(user);
  return safe;
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return mapUser(safe);
}

function isProtectedSupportUser(user) {
  if (!user) return false;
  const role = normalizeRole(user.role);
  const username = String(user.username || "").toLowerCase();
  const email = String(user.email || "").toLowerCase();
  const fullName = String(user.full_name || "").toLowerCase();

  return role === "soporte"
    && (
      username.startsWith("soporte")
      || email.startsWith("soporte+")
      || email.endsWith("@ankode.local")
      || fullName.startsWith("soporte")
    );
}

function assertMutableUser(target, action = "modify") {
  if (isProtectedSupportUser(target)) {
    throw new ApiError(403, `Protected support user cannot be ${action}`);
  }
}

async function getBusinessById(id, client = pool) {
  const { rows } = await client.query("SELECT * FROM businesses WHERE id = $1", [id]);
  return rows[0] || null;
}

async function countActiveSuperusers(businessId, client = pool) {
  const { rows } = await client.query(
    "SELECT COUNT(*)::int AS total FROM users WHERE role = 'superusuario' AND is_active = TRUE AND business_id = $1",
    [businessId]
  );
  return Number(rows[0]?.total || 0);
}

async function ensureSuperuserRemains(currentUser, nextRole, nextIsActive, client = pool) {
  if (currentUser.role !== "superusuario") return;
  if (nextRole === "superusuario" && nextIsActive) return;
  if (currentUser.is_active && (await countActiveSuperusers(currentUser.business_id, client)) <= 1) {
    throw new ApiError(409, "At least one active superusuario must remain");
  }
}

async function getUserById(id, businessId) {
  const scopedBusinessId = requireActorBusinessId({ business_id: businessId });
  const { rows } = await pool.query(
    `SELECT ${USER_FIELDS}
     FROM users u
     LEFT JOIN businesses b ON b.id = u.business_id
     WHERE u.id = $1 AND u.business_id = $2`,
    [id, scopedBusinessId]
  );
  return mapUser(rows[0] || null);
}

async function getUserByLogin(identifier) {
  const { rows } = await pool.query(
    `SELECT ${USER_FIELDS}
     FROM users u
     LEFT JOIN businesses b ON b.id = u.business_id
     WHERE (u.username = $1 OR u.email = $1)
       AND u.business_id IS NOT NULL`,
    [identifier]
  );
  return mapUser(rows[0] || null);
}

async function getScopedUser(id, actor, client = pool) {
  const params = [id, requireActorBusinessId(actor)];
  const where = "u.id = $1 AND u.business_id = $2";

  const { rows } = await client.query(
    `SELECT ${USER_FIELDS}
     FROM users u
     LEFT JOIN businesses b ON b.id = u.business_id
     WHERE ${where}`,
    params
  );
  return mapUser(rows[0] || null);
}

async function listUsers(actor) {
  const params = [requireActorBusinessId(actor)];
  const where = "WHERE u.business_id = $1";

  const { rows } = await pool.query(
    `SELECT
       u.id, u.username, u.email, u.full_name, u.role, u.pos_type, u.business_id,
       u.is_active, u.must_change_password, u.support_mode_active, u.created_at, u.updated_at,
       b.name AS business_name, b.slug AS business_slug, b.pos_type AS business_pos_type
     FROM users u
     LEFT JOIN businesses b ON b.id = u.business_id
     ${where}
     ORDER BY u.created_at DESC`,
    params
  );
  return rows.map(mapUser);
}

async function resolveTargetBusiness(payload, actor, client = pool) {
  const businessId = requireActorBusinessId(actor);

  const business = await getBusinessById(businessId, client);
  if (!business) {
    throw new ApiError(404, "Business not found");
  }

  return business;
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
  if (!normalizedRole) throw new ApiError(400, "Invalid role");
  if (!canAssignRole(actor?.role, normalizedRole)) throw new ApiError(403, "Forbidden role assignment");

  const passwordHash = await bcrypt.hash(payload.password, 10);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const business = await resolveTargetBusiness({}, actor, client);
    const { rows } = await client.query(
      `INSERT INTO users (
        username, email, full_name, password_hash, role, pos_type, business_id,
        is_active, must_change_password, password_changed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING *`,
      [
        payload.username,
        payload.email,
        payload.full_name,
        passwordHash,
        normalizedRole,
        business.pos_type,
        business.id,
        payload.is_active ?? true,
        payload.must_change_password ?? false
      ]
    );

    await saveAuditLog({
      business_id: business.id,
      usuario_id: actor?.id,
      modulo: "users",
      accion: "create_user",
      entidad_tipo: "user",
      entidad_id: rows[0].id,
      detalle_anterior: {},
      detalle_nuevo: { entity: "user", entity_id: rows[0].id, snapshot: buildAuditSnapshot({ ...rows[0], business_pos_type: business.pos_type }), version: 1 },
      metadata: { actor_role: normalizeRole(actor?.role) }
    }, { client });

    await client.query("COMMIT");
    return sanitizeUser({ ...rows[0], business_name: business.name, business_slug: business.slug, business_pos_type: business.pos_type });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateUser(id, payload, actor) {
  const current = await getScopedUser(id, actor);
  if (!current) throw new ApiError(404, "User not found");
  assertMutableUser(current, "updated");

  const actorRole = normalizeRole(actor?.role);
  const nextRole = payload.role ? normalizeRole(payload.role) : current.role;
  const nextIsActive = payload.is_active ?? current.is_active;

  if (!nextRole) throw new ApiError(400, "Invalid role");
  if (payload.role && !canAssignRole(actorRole, nextRole)) throw new ApiError(403, "Forbidden role assignment");
  if (!isSuperUser(actor) && current.role === "superusuario") throw new ApiError(403, "Forbidden");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureSuperuserRemains(current, nextRole, nextIsActive, client);
    const business = await resolveTargetBusiness({}, actor, client);
    const passwordHash = payload.password ? await bcrypt.hash(payload.password, 10) : current.password_hash;

    const { rows } = await client.query(
      `UPDATE users
       SET username = $1,
           email = $2,
           full_name = $3,
           password_hash = $4,
           role = $5,
           business_id = $6,
           pos_type = $7,
           is_active = $8,
           must_change_password = $9,
           password_changed_at = CASE WHEN $10::boolean THEN NOW() ELSE password_changed_at END,
           updated_at = NOW()
       WHERE id = $11 AND business_id = $12
       RETURNING *`,
      [
        payload.username ?? current.username,
        payload.email ?? current.email,
        payload.full_name ?? current.full_name,
        passwordHash,
        nextRole,
        business.id,
        business.pos_type,
        nextIsActive,
        payload.must_change_password ?? current.must_change_password ?? false,
        Boolean(payload.password),
        id,
        current.business_id
      ]
    );

    await saveAuditLog({
      business_id: business.id,
      usuario_id: actor?.id,
      modulo: "users",
      accion: "update_user",
      entidad_tipo: "user",
      entidad_id: id,
      detalle_anterior: { entity: "user", entity_id: id, snapshot: buildAuditSnapshot(current), version: 1 },
      detalle_nuevo: { entity: "user", entity_id: id, snapshot: buildAuditSnapshot({ ...rows[0], business_pos_type: business.pos_type }), version: 1 },
      metadata: { actor_role: actorRole }
    }, { client });

    await client.query("COMMIT");
    return sanitizeUser({ ...rows[0], business_name: business.name, business_slug: business.slug, business_pos_type: business.pos_type });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateUserStatus(id, isActive, actor) {
  const current = await getScopedUser(id, actor);
  if (!current) throw new ApiError(404, "User not found");
  assertMutableUser(current, "deactivated");
  if (!isSuperUser(actor) && current.role === "superusuario") throw new ApiError(403, "Forbidden");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureSuperuserRemains(current, current.role, isActive, client);
    const { rows } = await client.query(
      `UPDATE users SET is_active = $1, updated_at = NOW()
       WHERE id = $2 AND business_id = $3
       RETURNING *`,
      [isActive, id, current.business_id]
    );
    await saveAuditLog({
      business_id: current.business_id,
      usuario_id: actor?.id,
      modulo: "users",
      accion: "update_user_status",
      entidad_tipo: "user",
      entidad_id: id,
      detalle_anterior: { entity: "user", entity_id: id, snapshot: buildAuditSnapshot(current), version: 1 },
      detalle_nuevo: { entity: "user", entity_id: id, snapshot: buildAuditSnapshot({ ...rows[0], business_pos_type: current.pos_type }), version: 1 },
      metadata: { actor_role: normalizeRole(actor?.role) }
    }, { client });
    await client.query("COMMIT");
    return sanitizeUser({ ...rows[0], business_name: current.business_name, business_slug: current.business_slug, business_pos_type: current.pos_type });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function resetUserPassword(targetUserId, payload, actor) {
  if (!isSuperUser(actor)) throw new ApiError(403, "Forbidden");
  const target = await getScopedUser(targetUserId, actor);
  if (!target) throw new ApiError(404, "User not found");
  assertMutableUser(target, "reset");

  const generatedPassword = payload.new_password?.trim() || crypto.randomBytes(6).toString("base64url");
  if (generatedPassword.length < 8) throw new ApiError(400, "Password must be at least 8 characters");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE users
       SET password_hash = $1, must_change_password = $2, password_reset_by = $3, password_reset_at = NOW(), updated_at = NOW()
       WHERE id = $4 AND business_id = $5`,
      [await bcrypt.hash(generatedPassword, 10), payload.force_change ?? true, actor.id, targetUserId, target.business_id]
    );
    await saveAuditLog({
      business_id: target.business_id,
      usuario_id: actor.id,
      modulo: "users",
      accion: "reset_password",
      entidad_tipo: "user",
      entidad_id: targetUserId,
      detalle_anterior: { entity: "user", entity_id: targetUserId, snapshot: buildAuditSnapshot(target), version: 1 },
      detalle_nuevo: { entity: "user", entity_id: targetUserId, snapshot: { ...buildAuditSnapshot(target), must_change_password: payload.force_change ?? true }, version: 1 },
      motivo: payload.reason || "",
      metadata: { actor_role: normalizeRole(actor?.role) }
    }, { client });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { temporary_password: generatedPassword, must_change_password: payload.force_change ?? true, reset_by: actor.id, user_id: targetUserId };
}

async function changeOwnPassword(userId, payload) {
  const user = await getUserById(userId, payload.actor.business_id);
  if (!user) throw new ApiError(404, "User not found");
  if (!(await bcrypt.compare(payload.current_password, user.password_hash))) {
    throw new ApiError(401, "Invalid credentials");
  }
  await pool.query(
    `UPDATE users
     SET password_hash = $1, must_change_password = FALSE, password_changed_at = NOW(), updated_at = NOW()
     WHERE id = $2 AND business_id = $3`,
    [await bcrypt.hash(payload.new_password, 10), userId, user.business_id]
  );
  return { success: true };
}

async function logSupportAccess(targetUserId, actor, reason = "") {
  const actorRole = normalizeRole(actor?.role);
  const actorBusinessId = requireActorBusinessId(actor);
  if (!["superusuario", "soporte"].includes(actorRole || "")) throw new ApiError(403, "Forbidden");
  if (actorRole === "soporte" && !actor?.support_mode_active) throw new ApiError(403, "Support mode must be active");

  const target = await getScopedUser(targetUserId, actor);
  if (!target) throw new ApiError(404, "User not found");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO support_access_logs (actor_user_id, target_user_id, business_id, target_business_id, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [actor.id, targetUserId, actorBusinessId, target.business_id, reason || ""]
    );
    await saveAuditLog({
      business_id: target.business_id,
      usuario_id: actor.id,
      modulo: "users",
      accion: "log_support_access",
      entidad_tipo: "support_access_log",
      entidad_id: rows[0].id,
      detalle_anterior: {},
      detalle_nuevo: { entity: "support_access_log", entity_id: rows[0].id, snapshot: rows[0], version: 1 },
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
  const actorBusinessId = requireActorBusinessId(actor);
  if (!["superusuario", "soporte"].includes(actorRole || "")) throw new ApiError(403, "Forbidden");

  const target = await getScopedUser(targetUserId, actor);
  if (!target) throw new ApiError(404, "User not found");
  if (target.role !== "soporte") throw new ApiError(409, "Support mode is only available for soporte users");
  if (!isProtectedSupportUser(target)) throw new ApiError(409, "Support mode is only available for protected support users");
  if (actorRole === "soporte" && actor.id !== targetUserId) throw new ApiError(403, "Support users can only manage their own support mode");
  if (nextState && !target.is_active) throw new ApiError(409, "Support mode requires an active user");
  if (target.support_mode_active === nextState) return sanitizeUser(target);

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
       WHERE id = $3 AND business_id = $4
       RETURNING *`,
      [nextState, actor.id, targetUserId, target.business_id]
    );
    await client.query(
      `INSERT INTO support_access_logs (actor_user_id, target_user_id, business_id, target_business_id, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [actor.id, targetUserId, actorBusinessId, target.business_id, reason || (nextState ? "Support mode activated" : "Support mode deactivated")]
    );
    await saveAuditLog({
      business_id: target.business_id,
      usuario_id: actor.id,
      modulo: "users",
      accion: nextState ? "activate_support_mode" : "deactivate_support_mode",
      entidad_tipo: "user",
      entidad_id: targetUserId,
      detalle_anterior: { entity: "user", entity_id: targetUserId, snapshot: buildAuditSnapshot(target), version: 1 },
      detalle_nuevo: { entity: "user", entity_id: targetUserId, snapshot: buildAuditSnapshot({ ...rows[0], business_pos_type: target.pos_type }), version: 1 },
      motivo: reason || "",
      metadata: { actor_role: actorRole }
    }, { client });
    await client.query("COMMIT");
    return sanitizeUser({ ...rows[0], business_name: target.business_name, business_slug: target.business_slug, business_pos_type: target.pos_type });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
  activateSupportMode: (id, actor, reason = "") => setSupportMode(id, actor, true, reason),
  deactivateSupportMode: (id, actor, reason = "") => setSupportMode(id, actor, false, reason)
};
