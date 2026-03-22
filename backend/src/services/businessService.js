const crypto = require("crypto");
const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { isSuperUser, requireActorBusinessId } = require("../utils/tenant");
const { resolveBusinessClassification } = require("../utils/business");

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
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `SELECT businesses.*, COUNT(users.id)::int AS user_count
     FROM businesses
     LEFT JOIN users ON users.business_id = businesses.id
     WHERE businesses.id = $1
     GROUP BY businesses.id
     ORDER BY businesses.name ASC`,
    [businessId]
  );
  return rows;
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
    await client.query(
      `INSERT INTO users (
        username, email, full_name, password_hash, role, pos_type, business_id, is_active, must_change_password, password_changed_at
      ) VALUES ($1, $2, $3, $4, 'soporte', $5, $6, TRUE, TRUE, NOW())`,
      [`soporte_${business.slug}`, `soporte+${business.slug}@ankode.local`, `Soporte ${business.name}`, crypto.randomBytes(16).toString("hex"), business.pos_type, business.id]
    );
    await client.query("COMMIT");
    return business;
  } catch (error) {
    await client.query("ROLLBACK");
    if (String(error.message || "").includes("duplicate")) throw new ApiError(409, "Business already exists");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { listBusinesses, createBusiness };
