// paymentProvisioningService.js
// Orchestrates automatic business provisioning after an OpenPay payment succeeds.
//
// WHY this does not call authService.registerBusiness():
//   registerBusiness() always calls bcrypt.hash(payload.password, 10) treating the
//   input as plain text. pending_onboardings stores a pre-hashed password_hash.
//   Calling registerBusiness with a bcrypt hash as "password" would double-hash it,
//   making those credentials permanently unusable. This service replicates the same
//   DB transaction logic directly, inserting the pre-hashed value as-is.
//
// WHY onboardingService.js was not modified:
//   That file handles the in-app first-run wizard (categories, POS template, settings).
//   This file handles the payment-triggered automatic account creation. Separate concerns.

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { resolveBusinessClassification } = require("../utils/business");
const { initializeBusinessSubscriptionForNewBusiness } = require("./businessSubscriptionService");
const { saveAuditLog } = require("./auditLogService");
const { sendPaymentFailedEmail } = require("./emailService");

// ---------------------------------------------------------------------------
// Internal helpers (same logic as authService / businessService)
// ---------------------------------------------------------------------------

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Derive a username from the owner's email address.
// "owner@clinica.mx" → "owner"
function usernameFromEmail(email) {
  const local = String(email || "").split("@")[0];
  return slugify(local) || "admin";
}

// ---------------------------------------------------------------------------
// createPendingOnboarding
// Persists a row to pending_onboardings BEFORE the card is charged.
// The plain-text password is bcrypt-hashed here so it is never stored at rest.
//
// payload: {
//   order_id        {string}  required — OpenPay order_id or equivalent unique ID
//   business_name   {string}  required
//   owner_name      {string}  required
//   email           {string}  required — becomes the admin login email
//   password        {string}  required — plain text; hashed before insert
//   pos_type        {string}  required — e.g. "Tienda", "Dentista"
//   plan_type       {string}  default "monthly"
//   plan_name       {string}  required — human-readable plan label
//   amount          {number}  required — charge amount
//   openpay_customer_id?    {string}
//   openpay_plan_id?        {string}
//   openpay_subscription_id? {string}
//   raw_checkout_payload?   {object}
// }
// ---------------------------------------------------------------------------

async function createPendingOnboarding(payload) {
  const {
    order_id,
    business_name,
    owner_name,
    email,
    password,
    pos_type,
    plan_type = "monthly",
    plan_name,
    amount,
    openpay_customer_id = null,
    openpay_plan_id = null,
    openpay_subscription_id = null,
    raw_checkout_payload = null
  } = payload;

  if (!order_id) throw new ApiError(400, "order_id is required");
  if (!business_name) throw new ApiError(400, "business_name is required");
  if (!owner_name) throw new ApiError(400, "owner_name is required");
  if (!email) throw new ApiError(400, "email is required");
  if (!password) throw new ApiError(400, "password is required");
  if (!pos_type) throw new ApiError(400, "pos_type is required");
  if (!plan_name) throw new ApiError(400, "plan_name is required");
  if (amount === undefined || amount === null) throw new ApiError(400, "amount is required");

  const password_hash = await bcrypt.hash(password, 10);
  const idempotency_key = crypto.randomUUID();

  const { rows } = await pool.query(
    `INSERT INTO pending_onboardings (
       order_id,
       openpay_customer_id,
       openpay_plan_id,
       openpay_subscription_id,
       business_name,
       owner_name,
       email,
       password_hash,
       pos_type,
       plan_type,
       plan_name,
       amount,
       currency,
       status,
       idempotency_key,
       raw_checkout_payload,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'MXN', 'pending', $13, $14, NOW(), NOW())
     RETURNING *`,
    [
      String(order_id),
      openpay_customer_id || null,
      openpay_plan_id || null,
      openpay_subscription_id || null,
      String(business_name).trim(),
      String(owner_name).trim(),
      String(email).trim().toLowerCase(),
      password_hash,
      String(pos_type),
      String(plan_type),
      String(plan_name),
      Number(amount),
      idempotency_key,
      raw_checkout_payload ? JSON.stringify(raw_checkout_payload) : null
    ]
  );

  console.info(`[PROVISIONING] Pending onboarding created: order_id=${order_id}, email=${email}`);
  return rows[0];
}

// ---------------------------------------------------------------------------
// provisionBusinessFromOnboarding
// Called by handleWebhook after charge.succeeded.
// Idempotent: safe to call multiple times for the same order_id.
//
// Provisions in a single transaction:
//   1. businesses row
//   2. users row (role=admin, pre-stored password_hash inserted directly)
//   3. company_profiles row
//   4. business_subscriptions row (via initializeBusinessSubscriptionForNewBusiness)
//   5. audit log entry
// Then marks pending_onboarding as 'provisioned' and sends welcome email.
// ---------------------------------------------------------------------------

async function provisionBusinessFromOnboarding(orderId) {
  const row = await getPendingOnboarding(orderId);

  if (!row) {
    // No pending onboarding for this order — may be a recurring subscription renewal
    console.info(`[PROVISIONING] No pending onboarding for order_id=${orderId}, skipping`);
    return null;
  }

  // Idempotency guard — webhook may fire more than once for the same charge
  if (row.status === "provisioned") {
    console.info(`[PROVISIONING] order_id=${orderId} already provisioned, skipping`);
    return {
      alreadyProvisioned: true,
      provisioned_business_id: row.provisioned_business_id,
      provisioned_user_id: row.provisioned_user_id
    };
  }

  // A failed onboarding must not be auto-retried — requires manual review
  if (row.status === "failed") {
    throw new ApiError(
      409,
      `Onboarding for order_id=${orderId} is in failed state and cannot be re-provisioned automatically`
    );
  }

  const { business_name, owner_name, email, password_hash, pos_type, plan_name } = row;

  // Derive business_type and normalized pos_type (same utility as authService)
  const classification = resolveBusinessClassification({ pos_type });
  const businessType = classification.business_type;
  const resolvedPosType = classification.pos_type;

  if (!businessType || !resolvedPosType) {
    const reason = `Invalid pos_type "${pos_type}" — cannot resolve business classification`;
    await _markFailed(orderId, reason);
    throw new ApiError(400, reason);
  }

  const slugBase = slugify(business_name) || "negocio";
  const baseUsername = usernameFromEmail(email);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Guard: business name must be unique (case-insensitive), same as registerBusiness
    const { rows: existingBusiness } = await client.query(
      "SELECT id FROM businesses WHERE LOWER(name) = LOWER($1) LIMIT 1",
      [business_name]
    );
    if (existingBusiness[0]) {
      const reason = `Business "${business_name}" already exists`;
      await _markFailed(orderId, reason);
      throw new ApiError(409, reason);
    }

    // Slug uniqueness loop — same algorithm as registerBusiness and createBusiness
    let slug = slugBase;
    let counter = 1;
    while (true) {
      const { rows } = await client.query(
        "SELECT id FROM businesses WHERE slug = $1 LIMIT 1",
        [slug]
      );
      if (!rows[0]) break;
      counter += 1;
      slug = `${slugBase}-${counter}`;
    }

    // 1. Create the business row
    const { rows: businessRows } = await client.query(
      `INSERT INTO businesses (name, slug, business_type, pos_type, is_active, created_by, updated_by)
       VALUES ($1, $2, $3, $4, TRUE, NULL, NULL)
       RETURNING *`,
      [String(business_name).trim(), slug, businessType, resolvedPosType]
    );
    const business = businessRows[0];

    // Ensure username is unique; add random suffix if already taken
    const { rows: existingUserRows } = await client.query(
      "SELECT id FROM users WHERE username = $1 OR email = $2 LIMIT 1",
      [baseUsername, String(email).trim().toLowerCase()]
    );
    const username = existingUserRows[0]
      ? `${baseUsername}_${crypto.randomBytes(3).toString("hex")}`
      : baseUsername;

    // 2. Create the admin user — password_hash is already hashed, insert directly (no re-hash)
    const { rows: userRows } = await client.query(
      `INSERT INTO users (
         username, email, full_name, password_hash, role, pos_type, business_id,
         is_active, must_change_password, password_changed_at
       )
       VALUES ($1, $2, $3, $4, 'admin', $5, $6, TRUE, FALSE, NOW())
       RETURNING *`,
      [
        username,
        String(email).trim().toLowerCase(),
        String(owner_name).trim(),
        password_hash,
        resolvedPosType,
        business.id
      ]
    );
    const user = userRows[0];

    // 3. Back-patch created_by on the business (same pattern as registerBusiness)
    await client.query(
      `UPDATE businesses
       SET created_by = $1, updated_by = $1, updated_at = NOW()
       WHERE id = $2`,
      [user.id, business.id]
    );

    // 4. Create the company profile
    await client.query(
      `INSERT INTO company_profiles (business_id, profile_key, general_settings, is_active, created_by, updated_by)
       VALUES ($1, 'default', '{}'::jsonb, TRUE, $2, $2)
       ON CONFLICT (business_id, profile_key) DO NOTHING`,
      [business.id, user.id]
    );

    // 5. Initialize subscription (enforcement=true, monthly, anchor=today)
    await initializeBusinessSubscriptionForNewBusiness(business, user.id, client);

    // 5a. Persist plan_name from the onboarding record into business_subscriptions
    if (plan_name) {
      await client.query(
        `UPDATE business_subscriptions SET plan_name = $1, updated_at = NOW() WHERE business_id = $2`,
        [String(plan_name), business.id]
      );
    }

    // 6. Audit log entry consistent with registerBusiness
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
        source: "openpay_webhook",
        order_id: orderId,
        business,
        owner_user_id: user.id
      },
      motivo: "Automated provisioning after payment",
      metadata: { onboarding: true, role: "admin", order_id: orderId }
    }, { client });

    await client.query("COMMIT");

    // Mark onboarding as provisioned — separate from the business transaction so a
    // failure here does not roll back the already-created business
    await pool.query(
      `UPDATE pending_onboardings
       SET status = 'provisioned',
           provisioned_business_id = $1,
           provisioned_user_id = $2,
           updated_at = NOW()
       WHERE order_id = $3`,
      [business.id, user.id, orderId]
    );

    console.info(
      `[PROVISIONING] Business provisioned: order_id=${orderId}, ` +
      `business_id=${business.id}, user_id=${user.id}`
    );

    return { business, user };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// markOnboardingFailed
// Called by handleWebhook after charge.failed / subscription.charge.failed.
// Safe to call when no pending onboarding exists (e.g., renewal charges).
// ---------------------------------------------------------------------------

async function markOnboardingFailed(orderId, reason = "") {
  const row = await getPendingOnboarding(orderId);

  if (!row) {
    console.info(`[PROVISIONING] No pending onboarding for order_id=${orderId}, nothing to mark failed`);
    return null;
  }

  // Already provisioned means a subsequent charge failure on a live subscription — not our concern here
  if (row.status === "provisioned") {
    console.info(`[PROVISIONING] order_id=${orderId} already provisioned, skipping failure mark`);
    return row;
  }

  await _markFailed(orderId, reason);

  await sendPaymentFailedEmail(row.email, {
    businessName: row.business_name,
    ownerName: row.owner_name,
    amount: row.amount,
    currency: row.currency || "MXN"
  });

  return { ...row, status: "failed", failure_reason: reason };
}

// ---------------------------------------------------------------------------
// getPendingOnboarding
// Simple lookup by order_id. Returns null if not found.
// ---------------------------------------------------------------------------

async function getPendingOnboarding(orderId) {
  const { rows } = await pool.query(
    `SELECT *
     FROM pending_onboardings
     WHERE order_id = $1
     LIMIT 1`,
    [String(orderId)]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Internal: write failure status without sending email (used inside transactions)
// ---------------------------------------------------------------------------

async function _markFailed(orderId, reason) {
  await pool.query(
    `UPDATE pending_onboardings
     SET status = 'failed', failure_reason = $1, updated_at = NOW()
     WHERE order_id = $2`,
    [String(reason || "Unknown error").slice(0, 500), String(orderId)]
  ).catch((dbError) => {
    console.error(`[PROVISIONING] Failed to write failure status for order_id=${orderId}:`, dbError.message);
  });
  console.warn(`[PROVISIONING] Marked failed: order_id=${orderId}, reason=${reason}`);
}

module.exports = {
  createPendingOnboarding,
  provisionBusinessFromOnboarding,
  markOnboardingFailed,
  getPendingOnboarding
};
