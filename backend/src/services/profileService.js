const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { saveAuditLog } = require("./auditLogService");
const { normalizeRole } = require("../utils/roles");

function mapProfile(profile) {
  if (!profile) {
    return null;
  }

  return {
    id: profile.id,
    profile_key: profile.profile_key,
    owner_name: profile.owner_name,
    company_name: profile.company_name,
    phone: profile.phone,
    email: profile.email,
    address: profile.address,
    general_settings: profile.general_settings || {},
    bank_name: profile.bank_name,
    bank_clabe: profile.bank_clabe,
    bank_beneficiary: profile.bank_beneficiary,
    fiscal_rfc: profile.fiscal_rfc,
    fiscal_business_name: profile.fiscal_business_name,
    fiscal_regime: profile.fiscal_regime,
    fiscal_address: profile.fiscal_address,
    pac_provider: profile.pac_provider,
    pac_mode: profile.pac_mode,
    stamps_available: Number(profile.stamps_available || 0),
    stamps_used: Number(profile.stamps_used || 0),
    stamp_alert_threshold: Number(profile.stamp_alert_threshold || 0),
    is_active: Boolean(profile.is_active),
    created_at: profile.created_at,
    updated_at: profile.updated_at
  };
}

async function getDefaultProfile(client = pool) {
  const { rows } = await client.query(
    `SELECT *
     FROM company_profiles
     WHERE profile_key = 'default'
     LIMIT 1`
  );

  return rows[0] || null;
}

async function ensureDefaultProfile(client = pool) {
  let profile = await getDefaultProfile(client);

  if (profile) {
    return profile;
  }

  const { rows } = await client.query(
    `INSERT INTO company_profiles (profile_key, general_settings, is_active)
     VALUES ('default', '{}'::jsonb, TRUE)
     RETURNING *`
  );

  return rows[0];
}

function ensureProfileManagementAccess(actor) {
  const actorRole = normalizeRole(actor?.role);
  if (!["superusuario", "admin"].includes(actorRole || "")) {
    throw new ApiError(403, "Forbidden");
  }
}

async function getProfile() {
  return mapProfile(await ensureDefaultProfile());
}

async function updateProfileSection(payload, actor, section) {
  ensureProfileManagementAccess(actor);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const current = await ensureDefaultProfile(client);
    const updates = {
      owner_name: current.owner_name,
      company_name: current.company_name,
      phone: current.phone,
      email: current.email,
      address: current.address,
      bank_name: current.bank_name,
      bank_clabe: current.bank_clabe,
      bank_beneficiary: current.bank_beneficiary,
      fiscal_rfc: current.fiscal_rfc,
      fiscal_business_name: current.fiscal_business_name,
      fiscal_regime: current.fiscal_regime,
      fiscal_address: current.fiscal_address,
      pac_provider: current.pac_provider,
      pac_mode: current.pac_mode,
      stamps_available: Number(current.stamps_available || 0),
      stamps_used: Number(current.stamps_used || 0),
      stamp_alert_threshold: Number(current.stamp_alert_threshold || 10)
    };

    if (section === "general") {
      updates.owner_name = payload.owner_name ?? current.owner_name;
      updates.company_name = payload.company_name ?? current.company_name;
      updates.phone = payload.phone ?? current.phone;
      updates.email = payload.email ?? current.email;
      updates.address = payload.address ?? current.address;
    }

    if (section === "banking") {
      updates.bank_name = payload.bank_name ?? current.bank_name;
      updates.bank_clabe = payload.bank_clabe ?? current.bank_clabe;
      updates.bank_beneficiary = payload.bank_beneficiary ?? current.bank_beneficiary;
    }

    if (section === "fiscal") {
      updates.fiscal_rfc = payload.fiscal_rfc ?? current.fiscal_rfc;
      updates.fiscal_business_name = payload.fiscal_business_name ?? current.fiscal_business_name;
      updates.fiscal_regime = payload.fiscal_regime ?? current.fiscal_regime;
      updates.fiscal_address = payload.fiscal_address ?? current.fiscal_address;
    }

    if (section === "stamps") {
      updates.stamps_available = payload.stamps_available ?? updates.stamps_available;
      updates.stamps_used = payload.stamps_used ?? updates.stamps_used;
      updates.stamp_alert_threshold = payload.stamp_alert_threshold ?? updates.stamp_alert_threshold;
      updates.pac_provider = payload.pac_provider ?? current.pac_provider;
      updates.pac_mode = payload.pac_mode ?? current.pac_mode;
    }

    const { rows } = await client.query(
      `UPDATE company_profiles
       SET owner_name = $1,
           company_name = $2,
           phone = $3,
           email = $4,
           address = $5,
           bank_name = $6,
           bank_clabe = $7,
           bank_beneficiary = $8,
           fiscal_rfc = $9,
           fiscal_business_name = $10,
           fiscal_regime = $11,
           fiscal_address = $12,
           pac_provider = $13,
           pac_mode = $14,
           stamps_available = $15,
           stamps_used = $16,
           stamp_alert_threshold = $17,
           updated_by = $18,
           updated_at = NOW()
       WHERE id = $19
       RETURNING *`,
      [
        updates.owner_name,
        updates.company_name,
        updates.phone,
        updates.email,
        updates.address,
        updates.bank_name,
        updates.bank_clabe,
        updates.bank_beneficiary,
        updates.fiscal_rfc,
        updates.fiscal_business_name,
        updates.fiscal_regime,
        updates.fiscal_address,
        updates.pac_provider,
        updates.pac_mode,
        updates.stamps_available,
        updates.stamps_used,
        updates.stamp_alert_threshold,
        actor.id,
        current.id
      ]
    );

    const updated = rows[0];

    await saveAuditLog({
      usuario_id: actor.id,
      modulo: "profile",
      accion: `update_${section}`,
      entidad_tipo: "company_profile",
      entidad_id: updated.id,
      detalle_anterior: {
        entity: "company_profile",
        entity_id: current.id,
        snapshot: mapProfile(current),
        source: "profileService.updateProfileSection",
        version: 1
      },
      detalle_nuevo: {
        entity: "company_profile",
        entity_id: updated.id,
        snapshot: mapProfile(updated),
        source: "profileService.updateProfileSection",
        version: 1
      },
      motivo: payload.reason || "",
      metadata: { section }
    }, { client });

    await client.query("COMMIT");
    return mapProfile(updated);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getProfile,
  updateProfileSection
};
