const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { saveAuditLog } = require("./auditLogService");
const { normalizeRole } = require("../utils/roles");
const { requireActorBusinessId } = require("../utils/tenant");
const { buildStoredBusinessAssetPath, deleteStoredBusinessAsset } = require("../utils/businessAssets");
const { getBusinessSubscriptionSummary } = require("./businessSubscriptionService");

function isSchemaError(error) {
  return ["42P01", "42703", "42704"].includes(String(error?.code || ""));
}

function mapProfile(profile, subscription = null) {
  if (!profile) return null;
  const generalSettings = profile.general_settings || {};
  const hasFiscalProfile = Boolean(profile.fiscal_rfc && profile.fiscal_business_name && profile.fiscal_regime && profile.fiscal_address);
  const stampAlertThreshold = Number(profile.stamp_alert_threshold || 0);
  const stampsAvailable = Number(profile.stamps_available || 0);
  return {
    id: profile.id,
    business_id: profile.business_id,
    profile_key: profile.profile_key,
    owner_name: profile.owner_name,
    company_name: profile.company_name,
    phone: profile.phone,
    email: profile.email,
    address: profile.address,
    general_settings: generalSettings,
    theme: generalSettings.theme === "light" ? "light" : "dark",
    accent_palette: ["default", "ocean", "forest", "ember"].includes(generalSettings.accent_palette)
      ? generalSettings.accent_palette
      : "default",
    business_image_path: generalSettings.business_image_path || null,
    professional_license: generalSettings.professional_license || null,
    signature_image_path: generalSettings.signature_image_path || null,
    bank_name: profile.bank_name,
    bank_clabe: profile.bank_clabe,
    bank_beneficiary: profile.bank_beneficiary,
    card_terminal: generalSettings.card_terminal || null,
    card_bank: generalSettings.card_bank || null,
    card_instructions: generalSettings.card_instructions || null,
    card_commission: generalSettings.card_commission === undefined || generalSettings.card_commission === null ? null : Number(generalSettings.card_commission),
    fiscal_rfc: profile.fiscal_rfc,
    fiscal_business_name: profile.fiscal_business_name,
    fiscal_regime: profile.fiscal_regime,
    fiscal_address: profile.fiscal_address,
    pac_provider: profile.pac_provider,
    pac_mode: profile.pac_mode,
    stamps_available: stampsAvailable,
    stamps_used: Number(profile.stamps_used || 0),
    stamp_alert_threshold: stampAlertThreshold,
    has_fiscal_profile: hasFiscalProfile,
    billing_ready: hasFiscalProfile && stampsAvailable > 0,
    stamp_alert_active: stampAlertThreshold > 0 && stampsAvailable <= stampAlertThreshold,
    subscription,
    is_active: Boolean(profile.is_active),
    created_at: profile.created_at,
    updated_at: profile.updated_at
  };
}

function ensureProfileManagementAccess(actor, section) {
  const actorRole = normalizeRole(actor?.role);
  if (!["superusuario", "admin"].includes(actorRole || "")) throw new ApiError(403, "Forbidden");
  if (section === "stamps" && actorRole !== "superusuario") throw new ApiError(403, "Forbidden");
}

function getTargetBusinessId(actor) {
  return requireActorBusinessId(actor);
}

async function getDefaultProfile(actor, client = pool) {
  const businessId = getTargetBusinessId(actor);
  const { rows } = await client.query(
    `SELECT *
     FROM company_profiles
     WHERE business_id = $1 AND profile_key = 'default'
     LIMIT 1`,
    [businessId]
  );
  return rows[0] || null;
}

async function ensureDefaultProfile(actor, client = pool) {
  const businessId = getTargetBusinessId(actor);
  const existing = await getDefaultProfile(actor, client);
  if (existing) return existing;
  const { rows } = await client.query(
    `INSERT INTO company_profiles (business_id, profile_key, general_settings, is_active)
     VALUES ($1, 'default', '{}'::jsonb, TRUE)
     RETURNING *`,
    [businessId]
  );
  return rows[0];
}

async function getProfile(actor) {
  const profile = await ensureDefaultProfile(actor);
  const subscription = await getBusinessSubscriptionSummary(profile.business_id);
  return mapProfile(profile, subscription);
}

async function getDoctorProfile(actor) {
  const businessId = getTargetBusinessId(actor);
  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT id, business_id, full_name, email, phone, professional_license, COALESCE(medical_specialty, specialty) AS specialty, theme_preference, role
       FROM users
       WHERE id = $1 AND business_id = $2
       LIMIT 1`,
      [actor.id, businessId]
    ));
  } catch (error) {
    if (isSchemaError(error)) {
      console.error("[DOCTOR-PROFILE] Schema error while loading profile", error);
      throw new ApiError(503, "Feature schema is not ready");
    }
    throw error;
  }
  if (!rows[0]) {
    throw new ApiError(404, "User not found");
  }

  return {
    id: Number(rows[0].id),
    business_id: Number(rows[0].business_id),
    full_name: rows[0].full_name,
    email: rows[0].email,
    phone: rows[0].phone || "",
    professional_license: rows[0].professional_license || "",
    specialty: rows[0].specialty || "",
    theme_preference: rows[0].theme_preference === "light" ? "light" : "dark",
    role: normalizeRole(rows[0].role)
  };
}

async function updateDoctorProfile(payload, actor) {
  const businessId = getTargetBusinessId(actor);
  const actorRole = normalizeRole(actor?.role);
  if (!["superusuario", "admin", "clinico"].includes(actorRole || "")) {
    throw new ApiError(403, "Forbidden");
  }
  console.info("[DOCTOR-PROFILE] Updating doctor profile", { businessId, actorId: actor.id });

  const { rows: currentRows } = await pool.query(
    `SELECT id, business_id, full_name, email, phone, professional_license, COALESCE(medical_specialty, specialty) AS specialty, theme_preference, role
     FROM users
     WHERE id = $1 AND business_id = $2
     LIMIT 1`,
    [actor.id, businessId]
  );
  if (!currentRows[0]) {
    throw new ApiError(404, "User not found");
  }

  const current = currentRows[0];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE users
       SET full_name = $1,
           email = $2,
           phone = $3,
           professional_license = $4,
           specialty = $5,
           medical_specialty = $5,
           theme_preference = $6,
           updated_at = NOW()
       WHERE id = $7 AND business_id = $8
       RETURNING id, business_id, full_name, email, phone, professional_license, COALESCE(medical_specialty, specialty) AS specialty, theme_preference, role`,
      [
        payload.full_name ?? current.full_name,
        payload.email ?? current.email,
        payload.phone ?? current.phone,
        payload.professional_license ?? current.professional_license,
        payload.specialty ?? current.specialty,
        payload.theme_preference === "light" ? "light" : "dark",
        actor.id,
        businessId
      ]
    );

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "doctor_profile",
      accion: "update_doctor_profile",
      entidad_tipo: "user",
      entidad_id: actor.id,
      detalle_anterior: { snapshot: current },
      detalle_nuevo: { snapshot: rows[0] },
      metadata: { log_tag: "[DOCTOR-PROFILE]" }
    }, { client });

    await client.query("COMMIT");
    return {
      id: Number(rows[0].id),
      business_id: Number(rows[0].business_id),
      full_name: rows[0].full_name,
      email: rows[0].email,
      phone: rows[0].phone || "",
      professional_license: rows[0].professional_license || "",
      specialty: rows[0].specialty || "",
      theme_preference: rows[0].theme_preference === "light" ? "light" : "dark",
      role: normalizeRole(rows[0].role)
    };
  } catch (error) {
    await client.query("ROLLBACK");
    if (isSchemaError(error)) {
      console.error("[DOCTOR-PROFILE] Schema error while updating profile", error);
      throw new ApiError(503, "Feature schema is not ready");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function updateProfileSection(payload, actor, section) {
  ensureProfileManagementAccess(actor, section);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await ensureDefaultProfile(actor, client);
    const updates = { ...current };
    const generalSettings = { ...(current.general_settings || {}) };
    if (section === "general") Object.assign(updates, { owner_name: payload.owner_name ?? current.owner_name, company_name: payload.company_name ?? current.company_name, phone: payload.phone ?? current.phone, email: payload.email ?? current.email, address: payload.address ?? current.address });
    if (section === "general" && payload.theme !== undefined) {
      generalSettings.theme = payload.theme === "light" ? "light" : "dark";
    }
    if (section === "general" && payload.accent_palette !== undefined) {
      generalSettings.accent_palette = ["default", "ocean", "forest", "ember"].includes(payload.accent_palette)
        ? payload.accent_palette
        : "default";
    }
    if (section === "general" && payload.professional_license !== undefined) {
      generalSettings.professional_license = payload.professional_license || "";
    }
    if (section === "banking") {
      Object.assign(updates, { bank_name: payload.bank_name ?? current.bank_name, bank_clabe: payload.bank_clabe ?? current.bank_clabe, bank_beneficiary: payload.bank_beneficiary ?? current.bank_beneficiary });
      generalSettings.card_terminal = payload.card_terminal ?? generalSettings.card_terminal ?? "";
      generalSettings.card_bank = payload.card_bank ?? generalSettings.card_bank ?? "";
      generalSettings.card_instructions = payload.card_instructions ?? generalSettings.card_instructions ?? "";
      generalSettings.card_commission = payload.card_commission ?? generalSettings.card_commission ?? null;
    }
    if (section === "fiscal") Object.assign(updates, { fiscal_rfc: payload.fiscal_rfc ?? current.fiscal_rfc, fiscal_business_name: payload.fiscal_business_name ?? current.fiscal_business_name, fiscal_regime: payload.fiscal_regime ?? current.fiscal_regime, fiscal_address: payload.fiscal_address ?? current.fiscal_address });
    if (section === "stamps") Object.assign(updates, { fiscal_rfc: payload.fiscal_rfc ?? current.fiscal_rfc, stamps_available: payload.stamps_available ?? current.stamps_available, stamps_used: payload.stamps_used ?? current.stamps_used, stamp_alert_threshold: payload.stamp_alert_threshold ?? current.stamp_alert_threshold, pac_provider: payload.pac_provider ?? current.pac_provider, pac_mode: payload.pac_mode ?? current.pac_mode });

    const { rows } = await client.query(
      `UPDATE company_profiles
       SET owner_name = $1, company_name = $2, phone = $3, email = $4, address = $5, bank_name = $6, bank_clabe = $7, bank_beneficiary = $8,
           general_settings = $9, fiscal_rfc = $10, fiscal_business_name = $11, fiscal_regime = $12, fiscal_address = $13, pac_provider = $14,
           pac_mode = $15, stamps_available = $16, stamps_used = $17, stamp_alert_threshold = $18, updated_by = $19, updated_at = NOW()
       WHERE id = $20 AND business_id = $21
       RETURNING *`,
      [updates.owner_name, updates.company_name, updates.phone, updates.email, updates.address, updates.bank_name, updates.bank_clabe, updates.bank_beneficiary, JSON.stringify(generalSettings), updates.fiscal_rfc, updates.fiscal_business_name, updates.fiscal_regime, updates.fiscal_address, updates.pac_provider, updates.pac_mode, updates.stamps_available, updates.stamps_used, updates.stamp_alert_threshold, actor.id, current.id, current.business_id]
    );
    await saveAuditLog({ business_id: current.business_id, usuario_id: actor.id, modulo: "profile", accion: `update_${section}`, entidad_tipo: "company_profile", entidad_id: current.id, detalle_anterior: { entity: "company_profile", entity_id: current.id, snapshot: mapProfile(current), version: 1 }, detalle_nuevo: { entity: "company_profile", entity_id: current.id, snapshot: mapProfile(rows[0]), version: 1 }, motivo: payload.reason || "", metadata: { section } }, { client });
    await client.query("COMMIT");
    const subscription = await getBusinessSubscriptionSummary(current.business_id, client);
    return mapProfile(rows[0], subscription);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function resolveProfileAssetSettingKey(assetType) {
  if (assetType === "business_image") return "business_image_path";
  if (assetType === "signature") return "signature_image_path";
  throw new ApiError(400, "Invalid profile asset type");
}

async function uploadProfileAsset(assetType, file, actor) {
  if (!file) throw new ApiError(400, "Profile image file is required");

  const client = await pool.connect();
  let previousAssetPath = null;
  try {
    await client.query("BEGIN");
    const current = await ensureDefaultProfile(actor, client);
    const generalSettings = { ...(current.general_settings || {}) };
    const settingKey = resolveProfileAssetSettingKey(assetType);
    previousAssetPath = generalSettings[settingKey] || null;
    generalSettings[settingKey] = buildStoredBusinessAssetPath(file.filename);

    const { rows } = await client.query(
      `UPDATE company_profiles
       SET general_settings = $1, updated_by = $2, updated_at = NOW()
       WHERE id = $3 AND business_id = $4
       RETURNING *`,
      [JSON.stringify(generalSettings), actor.id, current.id, current.business_id]
    );

    await client.query("COMMIT");
    if (previousAssetPath && previousAssetPath !== generalSettings[settingKey]) {
      await deleteStoredBusinessAsset(previousAssetPath).catch(() => {});
    }
    const subscription = await getBusinessSubscriptionSummary(current.business_id, client);
    return mapProfile(rows[0], subscription);
  } catch (error) {
    await client.query("ROLLBACK");
    await deleteStoredBusinessAsset(buildStoredBusinessAssetPath(file.filename)).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function removeProfileAsset(assetType, actor) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await ensureDefaultProfile(actor, client);
    const generalSettings = { ...(current.general_settings || {}) };
    const settingKey = resolveProfileAssetSettingKey(assetType);
    const previousAssetPath = generalSettings[settingKey] || null;
    generalSettings[settingKey] = null;

    const { rows } = await client.query(
      `UPDATE company_profiles
       SET general_settings = $1, updated_by = $2, updated_at = NOW()
       WHERE id = $3 AND business_id = $4
       RETURNING *`,
      [JSON.stringify(generalSettings), actor.id, current.id, current.business_id]
    );

    await client.query("COMMIT");
    if (previousAssetPath) {
      await deleteStoredBusinessAsset(previousAssetPath).catch(() => {});
    }
    const subscription = await getBusinessSubscriptionSummary(current.business_id, client);
    return mapProfile(rows[0], subscription);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { getProfile, getDoctorProfile, updateDoctorProfile, updateProfileSection, uploadProfileAsset, removeProfileAsset };
