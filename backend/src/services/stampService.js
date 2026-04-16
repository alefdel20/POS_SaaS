const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { isSuperUser } = require("../utils/tenant");
const { saveAuditLog } = require("./auditLogService");

async function ensureDefaultCompanyProfile(businessId, actorId, client = pool) {
  const { rows: existingRows } = await client.query(
    `SELECT *
     FROM company_profiles
     WHERE business_id = $1
       AND profile_key = 'default'
     LIMIT 1`,
    [Number(businessId)]
  );

  if (existingRows[0]) {
    return existingRows[0];
  }

  const { rows } = await client.query(
    `INSERT INTO company_profiles (business_id, profile_key, general_settings, is_active, created_by, updated_by)
     VALUES ($1, 'default', '{}'::jsonb, TRUE, $2, $2)
     RETURNING *`,
    [Number(businessId), actorId || null]
  );
  return rows[0];
}

async function loadStampsForBusiness(businessId, payload, actor) {
  if (!isSuperUser(actor)) {
    throw new ApiError(403, "Forbidden");
  }

  const quantity = Number(payload.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ApiError(400, "Invalid stamp quantity");
  }

  const note = String(payload.note || "").trim();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: businessRows } = await client.query(
      "SELECT id, name FROM businesses WHERE id = $1 LIMIT 1",
      [Number(businessId)]
    );
    const business = businessRows[0];
    if (!business) {
      throw new ApiError(404, "Business not found");
    }

    const profile = await ensureDefaultCompanyProfile(businessId, actor.id, client);
    const balanceBefore = Number(profile.stamps_available || 0);
    const balanceAfter = balanceBefore + quantity;

    await client.query(
      `UPDATE company_profiles
       SET stamps_available = $1,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $3
         AND business_id = $4`,
      [balanceAfter, actor.id, profile.id, Number(businessId)]
    );

    const { rows: movementRows } = await client.query(
      `INSERT INTO company_stamp_movements (
         company_profile_id,
         movement_type,
         quantity,
         balance_before,
         balance_after,
         note,
         created_by,
         business_id
       )
       VALUES ($1, 'load', $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [profile.id, quantity, balanceBefore, balanceAfter, note, actor.id, Number(businessId)]
    );

    await saveAuditLog({
      business_id: Number(businessId),
      usuario_id: actor.id,
      modulo: "stamps",
      accion: "manual_stamp_load",
      entidad_tipo: "company_stamp_movement",
      entidad_id: String(movementRows[0].id),
      detalle_nuevo: {
        business_name: business.name,
        quantity,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        note
      },
      motivo: note
    }, { client });

    await client.query("COMMIT");
    return {
      ...movementRows[0],
      business_name: business.name,
      balance_before: balanceBefore,
      balance_after: balanceAfter
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listStampMovementsForBusiness(businessId, actor) {
  if (!isSuperUser(actor)) {
    throw new ApiError(403, "Forbidden");
  }

  const { rows } = await pool.query(
    `SELECT
       csm.*,
       u.full_name AS actor_name
     FROM company_stamp_movements csm
     LEFT JOIN users u ON u.id = csm.created_by
     WHERE csm.business_id = $1
     ORDER BY csm.created_at DESC, csm.id DESC
     LIMIT 25`,
    [Number(businessId)]
  );
  return rows;
}

module.exports = {
  loadStampsForBusiness,
  listStampMovementsForBusiness
};
