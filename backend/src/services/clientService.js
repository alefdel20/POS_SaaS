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
  const { rows: debtRows } = await pool.query(
    `SELECT COUNT(*) AS count FROM sales
     WHERE client_id = $1
       AND business_id = $2
       AND COALESCE(status, 'completed') <> 'cancelled'
       AND payment_method = 'credit'
       AND balance_due > 0`,
    [clientId, businessId]
  );
  if (Number(debtRows[0].count) > 0) {
    throw new ApiError(400, "No se puede eliminar un cliente con deuda activa");
  }

  const { rows } = await pool.query(
    `UPDATE clients SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [clientId, businessId]
  );

  if (!rows[0]) throw new ApiError(404, "Client not found");
}

async function backfillClientsFromSales(businessId) {
  const { rows: unlinked } = await pool.query(
    `SELECT DISTINCT customer_name, customer_phone
     FROM sales
     WHERE business_id = $1
       AND payment_method = 'credit'
       AND COALESCE(status, 'completed') <> 'cancelled'
       AND customer_name IS NOT NULL
       AND TRIM(customer_name) <> ''
       AND client_id IS NULL`,
    [businessId]
  );

  let processed = 0;
  let created = 0;

  for (const row of unlinked) {
    const nName = normalizeName(row.customer_name);
    const nPhone = normalizePhone(row.customer_phone) || "";

    const { rows: existing } = await pool.query(
      `SELECT id FROM clients
       WHERE business_id = $1
         AND LOWER(TRIM(name)) = $2
         AND COALESCE(LOWER(TRIM(phone)), '') = $3
         AND deleted_at IS NULL
       LIMIT 1`,
      [businessId, nName, nPhone]
    );

    const isNew = !existing[0];
    const client = await findOrCreateClient(businessId, {
      name: row.customer_name,
      phone: row.customer_phone
    });

    if (!client) continue;
    if (isNew) created++;

    await pool.query(
      `UPDATE sales
       SET client_id = $1
       WHERE business_id = $2
         AND LOWER(TRIM(customer_name)) = LOWER(TRIM($3))
         AND LOWER(TRIM(COALESCE(customer_phone, ''))) = LOWER(TRIM(COALESCE($4, '')))
         AND client_id IS NULL`,
      [client.id, businessId, row.customer_name, row.customer_phone]
    );

    processed++;
  }

  return { processed, created };
}

async function getClientPurchaseHistory(clientId, businessId, { page = 1, pageSize = 10 } = {}) {
  const offset = (page - 1) * pageSize;

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM sales
     WHERE client_id = $1 AND business_id = $2 AND status != 'cancelled'`,
    [clientId, businessId]
  );
  const total = countRows[0]?.total || 0;

  const { rows } = await pool.query(
    `SELECT
       s.id,
       s.sale_date,
       s.sale_time,
       s.total,
       s.subtotal,
       s.payment_method,
       s.sale_type,
       s.status,
       s.cart_discount_amount,
       COALESCE(
         json_agg(
           json_build_object(
             'product_name', si.product_name_snapshot,
             'quantity', si.quantity,
             'unit_price', si.unit_price,
             'subtotal', si.subtotal,
             'unidad_de_venta', si.unidad_de_venta
           ) ORDER BY si.id
         ) FILTER (WHERE si.id IS NOT NULL),
         '[]'
       ) AS items
     FROM sales s
     LEFT JOIN sale_items si ON si.sale_id = s.id AND si.business_id = s.business_id
     WHERE s.client_id = $1 AND s.business_id = $2 AND s.status != 'cancelled'
     GROUP BY s.id
     ORDER BY s.sale_date DESC, s.sale_time DESC
     LIMIT $3 OFFSET $4`,
    [clientId, businessId, pageSize, offset]
  );

  return {
    items: rows,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    }
  };
}

module.exports = { findOrCreateClient, listClients, updateClient, softDeleteClient, backfillClientsFromSales, getClientPurchaseHistory };
