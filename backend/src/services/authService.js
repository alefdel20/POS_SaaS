const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const { jwtSecret } = require("../config/env");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");
const { normalizeRole } = require("../utils/roles");
const { saveAuditLog } = require("./auditLogService");
const { resolveBusinessClassification } = require("../utils/business");
const userService = require("./userService");

function signToken(user, options = {}) {
  const businessId = requireActorBusinessId(user);
  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      businessId,
      supportSessionId: options.supportSessionId || null
    },
    jwtSecret,
    { expiresIn: "12h" }
  );
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function resolveOnboardingClassification(payload) {
  const businessName = payload.business_name?.trim();
  const classification = resolveBusinessClassification(payload);
  const businessType = classification.business_type;
  const posType = classification.pos_type?.trim();

  if (!businessName) throw new ApiError(400, "Business name is required");
  if (!businessType) throw new ApiError(400, "Business type is required");
  if (businessType === "Otro" && !posType) throw new ApiError(400, "POS type is required when business type is Otro");
  if (!posType) throw new ApiError(400, "Business POS type is required");

  return { businessName, businessType, posType };
}

async function login(identifier, password) {
  const user = await userService.getUserByLogin(identifier);

  if (!user || !user.is_active) {
    throw new ApiError(401, "Invalid credentials");
  }

  requireActorBusinessId(user);

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    throw new ApiError(401, "Invalid credentials");
  }

  return {
    token: signToken(user),
    user: userService.sanitizeUser(user)
  };
}

async function registerBusiness(payload) {
  const normalizedRole = normalizeRole(payload.role);
  if (!["superusuario", "admin"].includes(normalizedRole || "")) {
    throw new ApiError(400, "Invalid onboarding role");
  }

  const { businessName, businessType, posType } = resolveOnboardingClassification(payload);
  const slugBase = slugify(payload.business_slug || businessName) || "negocio";
  const [existingUsername, existingEmail] = await Promise.all([
    userService.getUserByLogin(payload.username),
    userService.getUserByLogin(payload.email)
  ]);
  if (existingUsername || existingEmail) {
    throw new ApiError(409, "Username or email already exists");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existingBusinessRows } = await client.query(
      "SELECT id FROM businesses WHERE LOWER(name) = LOWER($1) LIMIT 1",
      [businessName]
    );
    if (existingBusinessRows[0]) {
      throw new ApiError(409, "Business already exists");
    }

    let slug = slugBase;
    let counter = 1;
    while (true) {
      const { rows } = await client.query("SELECT id FROM businesses WHERE slug = $1 LIMIT 1", [slug]);
      if (!rows[0]) break;
      counter += 1;
      slug = `${slugBase}-${counter}`;
    }

    const { rows: businessRows } = await client.query(
      `INSERT INTO businesses (name, slug, business_type, pos_type, is_active, created_by, updated_by)
       VALUES ($1, $2, $3, $4, TRUE, NULL, NULL)
       RETURNING *`,
      [businessName, slug, businessType, posType]
    );
    const business = businessRows[0];

    const passwordHash = await bcrypt.hash(payload.password, 10);
    const { rows: userRows } = await client.query(
      `INSERT INTO users (
        username, email, full_name, password_hash, role, pos_type, business_id,
        is_active, must_change_password, password_changed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, FALSE, NOW())
      RETURNING *`,
      [payload.username.trim(), payload.email.trim(), payload.full_name.trim(), passwordHash, normalizedRole, posType, business.id]
    );
    const user = userRows[0];

    await client.query(
      `UPDATE businesses
       SET created_by = $1, updated_by = $1, updated_at = NOW()
       WHERE id = $2`,
      [user.id, business.id]
    );

    await client.query(
      `INSERT INTO company_profiles (business_id, profile_key, general_settings, is_active, created_by, updated_by)
       VALUES ($1, 'default', '{}'::jsonb, TRUE, $2, $2)
       ON CONFLICT (business_id, profile_key) DO NOTHING`,
      [business.id, user.id]
    );

    await saveAuditLog({
      business_id: business.id,
      usuario_id: user.id,
      modulo: "auth",
      accion: "register_business",
      entidad_tipo: "business",
      entidad_id: business.id,
      detalle_anterior: {},
      detalle_nuevo: {
        entity: "business_onboarding",
        business,
        owner_user_id: user.id
      },
      motivo: "business onboarding",
      metadata: { onboarding: true, role: normalizedRole }
    }, { client });

    await client.query("COMMIT");

    const authenticatedUser = userService.sanitizeUser({
      ...user,
      business_name: business.name,
      business_slug: business.slug,
      business_pos_type: business.pos_type
    });

    return {
      token: signToken(authenticatedUser),
      user: authenticatedUser,
      business
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  login,
  registerBusiness,
  signToken
};
