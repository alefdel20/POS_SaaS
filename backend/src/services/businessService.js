const crypto = require("crypto");
const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { isSuperUser, requireActorBusinessId } = require("../utils/tenant");
const { resolveBusinessClassification } = require("../utils/business");
const {
  mapBusinessSubscription,
  getBusinessSubscriptionSummary,
  initializeBusinessSubscriptionForNewBusiness,
  updateBusinessSubscription,
  registerBusinessSubscriptionPayment
} = require("./businessSubscriptionService");
const { loadStampsForBusiness, listStampMovementsForBusiness } = require("./stampService");

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function resolveBusinessPayload(payload) {
  const name = payload.name?.trim();
  const classification = resolveBusinessClassification(payload);
  const businessType = classification.business_type;
  const posType = classification.pos_type?.trim();

  if (!name) throw new ApiError(400, "Business name is required");
  if (!businessType) throw new ApiError(400, "Business type is required");
  if (businessType === "Otro" && !posType) throw new ApiError(400, "POS type is required when business type is Otro");
  if (!posType) throw new ApiError(400, "Business POS type is required");

  return { name, businessType, posType };
}

async function listBusinesses(actor) {
  const params = [];
  let whereClause = "";

  if (!isSuperUser(actor)) {
    params.push(requireActorBusinessId(actor));
    whereClause = "WHERE businesses.id = $1";
  }

  const { rows } = await pool.query(
    `SELECT
       businesses.*,
       COUNT(users.id)::int AS user_count,
       COALESCE(MAX(company_profiles.stamps_available), 0)::int AS stamps_available,
       MAX(company_profiles.stamps_used)::int AS stamps_used,
       bs.plan_type,
       bs.billing_anchor_date,
       bs.next_payment_date,
       bs.last_payment_date,
       bs.last_payment_note,
       bs.grace_period_days,
       bs.enforcement_enabled,
       bs.manual_adjustment_reason
     FROM businesses
     LEFT JOIN users ON users.business_id = businesses.id
     LEFT JOIN company_profiles ON company_profiles.business_id = businesses.id
       AND company_profiles.profile_key = 'default'
     LEFT JOIN business_subscriptions bs ON bs.business_id = businesses.id
     ${whereClause}
     GROUP BY
       businesses.id,
       bs.business_id,
       bs.plan_type,
       bs.billing_anchor_date,
       bs.next_payment_date,
       bs.last_payment_date,
       bs.last_payment_note,
       bs.grace_period_days,
       bs.enforcement_enabled,
       bs.manual_adjustment_reason
     ORDER BY businesses.name ASC`,
    params
  );

  return rows.map((row) => ({
    ...row,
    stamps_available: Number(row.stamps_available || 0),
    stamps_used: Number(row.stamps_used || 0),
    subscription: mapBusinessSubscription({
      business_id: row.id,
      plan_type: row.plan_type,
      billing_anchor_date: row.billing_anchor_date,
      next_payment_date: row.next_payment_date,
      last_payment_date: row.last_payment_date,
      last_payment_note: row.last_payment_note,
      grace_period_days: row.grace_period_days,
      enforcement_enabled: row.enforcement_enabled,
      manual_adjustment_reason: row.manual_adjustment_reason
    })
  }));
}

async function createBusiness(payload, actor) {
  if (!isSuperUser(actor)) throw new ApiError(403, "Forbidden");
  const { name, businessType, posType } = resolveBusinessPayload(payload);

  const slugBase = slugify(payload.slug || name) || "negocio";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let slug = slugBase;
    let counter = 1;
    while (true) {
      const { rows } = await client.query("SELECT id FROM businesses WHERE slug = $1", [slug]);
      if (!rows[0]) break;
      counter += 1;
      slug = `${slugBase}-${counter}`;
    }

    const { rows } = await client.query(
      `INSERT INTO businesses (name, slug, business_type, pos_type, is_active, created_by, updated_by)
       VALUES ($1, $2, $3, $4, TRUE, $5, $5)
       RETURNING *`,
      [name, slug, businessType, posType, actor.id]
    );
    const business = rows[0];
    await client.query(
      `INSERT INTO company_profiles (business_id, profile_key, general_settings, is_active, created_by, updated_by)
       VALUES ($1, 'default', '{}'::jsonb, TRUE, $2, $2)`,
      [business.id, actor.id]
    );
    await initializeBusinessSubscriptionForNewBusiness(business, actor.id, client);
    await client.query(
      `INSERT INTO users (
        username, email, full_name, password_hash, role, pos_type, business_id, is_active, must_change_password, password_changed_at
      ) VALUES ($1, $2, $3, $4, 'soporte', $5, $6, TRUE, TRUE, NOW())`,
      [`soporte_${business.slug}`, `soporte+${business.slug}@ankode.local`, `Soporte ${business.name}`, crypto.randomBytes(16).toString("hex"), business.pos_type, business.id]
    );
    await client.query("COMMIT");
    return {
      ...business,
      subscription: await getBusinessSubscriptionSummary(business.id)
    };
  } catch (error) {
    await client.query("ROLLBACK");
    if (String(error.message || "").includes("duplicate")) throw new ApiError(409, "Business already exists");
    throw error;
  } finally {
    client.release();
  }
}

async function updateBusinessSubscriptionSettings(businessId, payload, actor) {
  return updateBusinessSubscription(businessId, payload, actor);
}

async function registerBusinessSubscriptionPaymentAction(businessId, payload, actor) {
  return registerBusinessSubscriptionPayment(businessId, payload, actor);
}

async function manualLoadBusinessStamps(businessId, payload, actor) {
  return loadStampsForBusiness(businessId, payload, actor);
}

async function listBusinessStampMovements(businessId, actor) {
  return listStampMovementsForBusiness(businessId, actor);
}

module.exports = {
  listBusinesses,
  createBusiness,
  updateBusinessSubscriptionSettings,
  registerBusinessSubscriptionPaymentAction,
  manualLoadBusinessStamps,
  listBusinessStampMovements
};
