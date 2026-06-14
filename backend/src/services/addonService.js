const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");

const CFDI_ADDON_KEY = "cfdi_addon";

// Obtiene el estado del addon para un negocio
async function getAddonStatus(businessId, addonKey) {
  const { rows } = await pool.query(
    `SELECT * FROM business_addons WHERE business_id = $1 AND addon_key = $2`,
    [businessId, addonKey]
  );
  return rows[0] || null;
}

// Activa un addon (solo superusuario)
async function activateAddon(businessId, addonKey, activatedByUserId, notes = "") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO business_addons (business_id, addon_key, status, activated_at, activated_by, notes, updated_at)
       VALUES ($1, $2, 'active', NOW(), $3, $4, NOW())
       ON CONFLICT (business_id, addon_key)
       DO UPDATE SET status = 'active', activated_at = NOW(), activated_by = $3,
                     notes = $4, deactivated_at = NULL, updated_at = NOW()
       RETURNING *`,
      [businessId, addonKey, activatedByUserId, notes]
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Desactiva un addon (solo superusuario)
async function deactivateAddon(businessId, addonKey, deactivatedByUserId, notes = "") {
  const { rows } = await pool.query(
    `UPDATE business_addons
     SET status = 'inactive', deactivated_at = NOW(), notes = $4, updated_at = NOW()
     WHERE business_id = $1 AND addon_key = $2 AND status = 'active'
     RETURNING *`,
    [businessId, addonKey, deactivatedByUserId, notes]
  );
  if (!rows[0]) throw new ApiError(404, "Addon no encontrado o ya inactivo");
  return rows[0];
}

module.exports = { getAddonStatus, activateAddon, deactivateAddon, CFDI_ADDON_KEY };
