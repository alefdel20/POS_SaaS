const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
// Fix (2026): mirrors every genuinely-new client into healthcare.pet_owners —
// see healthcareSubjectTranslation.js for why. syncClientToHealthcare is only
// called on the real INSERT branch below, never on the "found existing"
// branch or the 23505 race-retry branch — findOrCreateClient's whole point is
// that those two don't create anything new to mirror.
// syncClientToHealthcareOnUpdate (Fase 2) runs from updateClient below, inside
// the same transaction as the public.clients UPDATE.
const { syncClientToHealthcare, syncClientToHealthcareOnUpdate } = require("../utils/healthcareSubjectTranslation");

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
       AND is_active = TRUE
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
    await syncClientToHealthcare(rows[0], null, conn);
    return rows[0] || null;
  } catch (err) {
    // Narrowed to the exact unique index this retry exists for: a 23505 from
    // syncClientToHealthcare above (e.g. a genuinely unexpected constraint hit
    // on healthcare.pet_owners) must NOT be swallowed here and reinterpreted
    // as "the client row already existed" — it needs to propagate so the
    // caller's transaction (or this INSERT, for callers without one) fails
    // loudly instead of leaving a public.clients row without its mirror.
    if (err.code === "23505" && err.constraint === "clients_business_name_phone_uq") {
      const { rows: retry } = await conn.query(
        `SELECT * FROM clients
         WHERE business_id = $1
           AND LOWER(TRIM(name)) = $2
           AND COALESCE(LOWER(TRIM(phone)), '') = $3
           AND is_active = TRUE
         LIMIT 1`,
        [businessId, nName, nPhone]
      );
      return retry[0] || null;
    }
    throw err;
  }
}

// Fase 2 read-model overlay: LEFT JOIN healthcare.pet_owners (never INNER —
// mirror coverage is not 100%, see healthcareSubjectTranslation.js) and prefer
// its columns via COALESCE when the mirror row exists, falling back to the
// public.clients column otherwise. `c.*` still supplies every column this
// overlay doesn't touch (id, is_active, created_at, deleted_at, ...); the
// appended COALESCE columns come after it in the SELECT list, so pg's
// row-object construction lets them win over the raw c.* duplicates of the
// same name.
async function listClients(businessId, { search, includeDeleted } = {}) {
  const conditions = ["c.business_id = $1"];
  const values = [businessId];

  // includeDeleted/include_deleted is the existing query-param name (kept as-is
  // for API compatibility) — what changed is which column decides "alive":
  // is_active, not deleted_at (see infra/postgres/45-clients-unify-soft-delete.sql).
  if (!includeDeleted) {
    conditions.push("c.is_active = TRUE");
  }

  if (search) {
    values.push(`%${String(search).trim()}%`);
    conditions.push(`(c.name ILIKE $${values.length} OR COALESCE(c.phone, '') ILIKE $${values.length})`);
  }

  const { rows } = await pool.query(
    `SELECT
       c.*,
       COALESCE(NULLIF(TRIM(CONCAT_WS(' ', hpo.first_name, hpo.last_name)), ''), c.name) AS name,
       COALESCE(hpo.email, c.email) AS email,
       COALESCE(hpo.phone, c.phone) AS phone,
       COALESCE(hpo.tax_id, c.tax_id) AS tax_id,
       COALESCE(hpo.address, c.address) AS address,
       COALESCE(hpo.notes, c.notes) AS notes,
       COALESCE(hpo.credit_limit, c.credit_limit) AS credit_limit,
       COALESCE(hpo.credit_days, c.credit_days) AS credit_days
     FROM clients c
     LEFT JOIN healthcare.pet_owners hpo ON hpo.client_id = c.id AND hpo.business_id = c.business_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY name ASC`,
    values
  );
  return rows;
}

// PUT is a full-replace, not a merge-patch (unset fields go blank/null) — same
// contract as before this change. is_active is the one exception: passing it
// reactivates/deactivates the client; omitting it preserves whatever is
// already in the row (COALESCE against the existing column), so a plain
// name/phone edit never accidentally flips is_active. No row-level is_active
// filter in the WHERE clause on purpose — this is also how a soft-deleted
// client gets reactivated (PUT with is_active: true), per
// infra/postgres/45-clients-unify-soft-delete.sql.
//
// Wrapped in a transaction (Fase 2) so the healthcare.pet_owners mirror sync
// below rolls back together with the public.clients UPDATE on failure — same
// atomicity guarantee createClient/updateClient already give in
// clinicalService.js. `actor` is optional (defaults to null) because the only
// caller today (clientController.updateClient) is the sole place threading
// req.user through; a null actor just means the mirror's updated_by falls
// back to whatever the row already had (see syncClientToHealthcareOnUpdate).
async function updateClient(businessId, clientId, { name, phone, email, notes, is_active }, actor = null) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) throw new ApiError(400, "Client name is required");
  const nextIsActive = is_active === undefined ? null : Boolean(is_active);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE clients
       SET name = $1, phone = $2, email = $3, notes = $4,
           is_active = COALESCE($5, is_active),
           updated_at = NOW()
       WHERE id = $6 AND business_id = $7
       RETURNING *`,
      [trimmedName, String(phone || "").trim() || null, email || null, notes || "", nextIsActive, clientId, businessId]
    );

    if (!rows[0]) throw new ApiError(404, "Client not found");

    await syncClientToHealthcareOnUpdate(rows[0], actor, client);

    await client.query("COMMIT");
    return rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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

  // Both columns set on purpose: is_active = FALSE is the operational source
  // of truth going forward (everything that decides "is this client alive"
  // reads is_active now); deleted_at stays as a historical/audit marker of
  // when this happened, not cleared on reactivation. See
  // infra/postgres/45-clients-unify-soft-delete.sql.
  const { rows } = await pool.query(
    `UPDATE clients SET deleted_at = NOW(), is_active = FALSE, updated_at = NOW()
     WHERE id = $1 AND business_id = $2 AND is_active = TRUE
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
         AND is_active = TRUE
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
