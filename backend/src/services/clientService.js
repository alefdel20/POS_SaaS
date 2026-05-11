const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").trim().toLowerCase() || null;
}

/**
 * Find an existing active client by (business_id, normalized name, normalized phone)
 * or create one. Pass a pg PoolClient to run inside an existing transaction.
 */
async function findOrCreateClient(businessId, { name, phone, email }, dbClient = null) {
  const conn = dbClient || pool;
  const trimmedName = String(name || "").trim();
  const trimmedPhone = String(phone || "").trim() || null;

  if (!trimmedName) return null;

  const nName = normalizeName(trimmedName);
  const nPhone = normalizePhone(trimmedPhone) || "";

  const { rows: existing } = await conn.query(
    `SELECT * FROM clients
     WHERE business_id = $1
       AND LOWER(TRIM(name)) = $2
       AND COALESCE(LOWER(TRIM(phone)), '') = $3
       AND deleted_at IS NULL
     LIMIT 1`,
    [businessId, nName, nPhone]
  );

  if (existing[0]) {
    await conn.query("UPDATE clients SET updated_at = NOW() WHERE id = $1", [existing[0].id]);
    return existing[0];
  }

  try {
    const { rows } = await conn.query(
      `INSERT INTO clients (business_id, name, phone, email, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '', NOW(), NOW())
       RETURNING *`,
      [businessId, trimmedName, trimmedPhone, email || null]
    );
    return rows[0] || null;
  } catch (err) {
    if (err.code === "23505") {
      const { rows: retry } = await conn.query(
        `SELECT * FROM clients
         WHERE business_id = $1
           AND LOWER(TRIM(name)) = $2
           AND COALESCE(LOWER(TRIM(phone)), '') = $3
           AND deleted_at IS NULL
         LIMIT 1`,
        [businessId, nName, nPhone]
      );
      return retry[0] || null;
    }
    throw err;
  }
}

async function listClients(businessId, { search, includeDeleted } = {}) {
  const conditions = ["business_id = $1"];
  const values = [businessId];

  if (!includeDeleted) {
    conditions.push("deleted_at IS NULL");
  }

  if (search) {
    values.push(`%${String(search).trim()}%`);
    conditions.push(`(name ILIKE $${values.length} OR COALESCE(phone, '') ILIKE $${values.length})`);
  }

  const { rows } = await pool.query(
    `SELECT * FROM clients WHERE ${conditions.join(" AND ")} ORDER BY name ASC`,
    values
  );
  return rows;
}

async function updateClient(businessId, clientId, { name, phone, email, notes }) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) throw new ApiError(400, "Client name is required");

  const { rows } = await pool.query(
    `UPDATE clients
     SET name = $1, phone = $2, email = $3, notes = $4, updated_at = NOW()
     WHERE id = $5 AND business_id = $6 AND deleted_at IS NULL
     RETURNING *`,
    [trimmedName, String(phone || "").trim() || null, email || null, notes || "", clientId, businessId]
  );

  if (!rows[0]) throw new ApiError(404, "Client not found");
  return rows[0];
}

async function softDeleteClient(businessId, clientId) {
  const { rows } = await pool.query(
    `UPDATE clients SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [clientId, businessId]
  );

  if (!rows[0]) throw new ApiError(404, "Client not found");
}

module.exports = { findOrCreateClient, listClients, updateClient, softDeleteClient };
