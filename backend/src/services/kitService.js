const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");

function isOlderThan21Days(createdAt) {
  if (!createdAt) return false;
  return new Date(createdAt) <= new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
}

// Mirrors buildEffectivePriceCase from productService — single source of truth for component price calculation
function computeComponentEffectivePrice(product) {
  const price = Number(product.price || 0);
  if (product.status !== "activo") return price;

  // Active timed discount
  if (product.discount_type && product.discount_value !== null && product.discount_start) {
    const now = new Date();
    const start = new Date(product.discount_start);
    if (!Number.isNaN(start.getTime()) && now >= start) {
      const end = product.discount_end ? new Date(product.discount_end) : null;
      if (!end || now <= end) {
        if (product.discount_type === "percentage") {
          return Math.max(price - price * (Number(product.discount_value) / 100), 0);
        }
        if (product.discount_type === "fixed") {
          return Math.max(price - Number(product.discount_value), 0);
        }
      }
    }
  }

  // Liquidation price
  if (product.liquidation_price !== null) {
    const recentSold = Number(product.recent_units_sold || 0);
    const nearExpiry = Boolean(product.expires_at) && new Date(product.expires_at) <= new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    if ((recentSold === 0 && isOlderThan21Days(product.created_at)) || nearExpiry) {
      return Number(product.liquidation_price);
    }
  }

  return price;
}

function mapKitRow(row) {
  return {
    id: row.id,
    business_id: row.business_id,
    sku: row.sku || null,
    name: row.name,
    description: row.description || null,
    price_mode: row.price_mode,
    fixed_price: row.fixed_price !== null ? Number(row.fixed_price) : null,
    discount_pct: Number(row.discount_pct || 0),
    active: Boolean(row.active),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function insertKitItems(client, kitId, businessId, items) {
  for (const item of items) {
    await client.query(
      `INSERT INTO product_kit_items (kit_id, business_id, product_id, quantity)
       VALUES ($1, $2, $3, $4)`,
      [kitId, businessId, item.product_id, item.quantity]
    );
  }
}

async function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, "El kit debe tener al menos un producto componente");
  }
  for (const item of items) {
    if (!item.product_id || !Number.isInteger(Number(item.product_id))) {
      throw new ApiError(400, "Cada componente del kit debe tener un product_id válido");
    }
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new ApiError(400, `La cantidad del producto ${item.product_id} debe ser mayor a cero`);
    }
  }
}

async function createKit(businessId, payload) {
  const { sku, name, description, price_mode, fixed_price, discount_pct, items } = payload;

  if (!name?.trim()) throw new ApiError(400, "El nombre del kit es requerido");
  if (!["fixed", "calculated"].includes(price_mode)) throw new ApiError(400, "price_mode debe ser 'fixed' o 'calculated'");
  if (price_mode === "fixed" && (fixed_price === undefined || fixed_price === null)) {
    throw new ApiError(400, "fixed_price es requerido cuando price_mode es 'fixed'");
  }
  if (fixed_price !== undefined && fixed_price !== null && Number(fixed_price) < 0) {
    throw new ApiError(400, "fixed_price no puede ser negativo");
  }
  const discountPct = Number(discount_pct || 0);
  if (discountPct < 0 || discountPct > 100) throw new ApiError(400, "discount_pct debe estar entre 0 y 100");

  await validateItems(items);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO product_kits (business_id, sku, name, description, price_mode, fixed_price, discount_pct, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       RETURNING *`,
      [businessId, sku?.trim() || null, name.trim(), description?.trim() || null, price_mode, price_mode === "fixed" ? Number(fixed_price) : null, discountPct]
    );
    const kit = rows[0];

    try {
      await insertKitItems(client, kit.id, businessId, items);
    } catch (err) {
      if (err.code === "23503") {
        throw new ApiError(400, "Uno o más productos del kit no existen o no pertenecen a este negocio");
      }
      throw err;
    }

    await client.query("COMMIT");
    return getKitById(businessId, kit.id, client);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function updateKit(businessId, kitId, payload) {
  const { sku, name, description, price_mode, fixed_price, discount_pct, items } = payload;

  if (name !== undefined && !name?.trim()) throw new ApiError(400, "El nombre del kit no puede estar vacío");
  if (price_mode !== undefined && !["fixed", "calculated"].includes(price_mode)) {
    throw new ApiError(400, "price_mode debe ser 'fixed' o 'calculated'");
  }
  if (discount_pct !== undefined) {
    const pct = Number(discount_pct);
    if (pct < 0 || pct > 100) throw new ApiError(400, "discount_pct debe estar entre 0 y 100");
  }
  if (items !== undefined) await validateItems(items);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Fetch current to merge mode validations
    const { rows: existing } = await client.query(
      "SELECT * FROM product_kits WHERE id = $1 AND business_id = $2",
      [kitId, businessId]
    );
    if (!existing[0]) throw new ApiError(404, "Kit no encontrado");
    const current = existing[0];

    const resolvedMode = price_mode ?? current.price_mode;
    const resolvedFixedPrice = fixed_price !== undefined ? fixed_price : current.fixed_price;
    if (resolvedMode === "fixed" && (resolvedFixedPrice === undefined || resolvedFixedPrice === null)) {
      throw new ApiError(400, "fixed_price es requerido cuando price_mode es 'fixed'");
    }

    const { rows } = await client.query(
      `UPDATE product_kits
       SET sku          = COALESCE($3, sku),
           name         = COALESCE($4, name),
           description  = COALESCE($5, description),
           price_mode   = $6,
           fixed_price  = $7,
           discount_pct = $8,
           updated_at   = NOW()
       WHERE id = $1 AND business_id = $2
       RETURNING *`,
      [
        kitId,
        businessId,
        sku !== undefined ? (sku?.trim() || null) : current.sku,
        name !== undefined ? name.trim() : current.name,
        description !== undefined ? (description?.trim() || null) : current.description,
        resolvedMode,
        resolvedMode === "fixed" ? Number(resolvedFixedPrice) : null,
        discount_pct !== undefined ? Number(discount_pct) : current.discount_pct
      ]
    );
    const kit = rows[0];

    if (items !== undefined) {
      await client.query("DELETE FROM product_kit_items WHERE kit_id = $1 AND business_id = $2", [kitId, businessId]);
      try {
        await insertKitItems(client, kitId, businessId, items);
      } catch (err) {
        if (err.code === "23503") {
          throw new ApiError(400, "Uno o más productos del kit no existen o no pertenecen a este negocio");
        }
        throw err;
      }
    }

    await client.query("COMMIT");
    return getKitById(businessId, kit.id, client);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getKitById(businessId, kitId, existingClient = null) {
  const db = existingClient || pool;

  const { rows: kitRows } = await db.query(
    "SELECT * FROM product_kits WHERE id = $1 AND business_id = $2",
    [kitId, businessId]
  );
  if (!kitRows[0]) throw new ApiError(404, "Kit no encontrado");
  const kit = mapKitRow(kitRows[0]);

  const { rows: itemRows } = await db.query(
    `SELECT pki.id, pki.product_id, pki.quantity,
            p.name AS product_name, p.sku AS product_sku,
            p.price AS product_price, p.cost_price AS product_cost,
            p.status AS product_status, p.unidad_de_venta
     FROM product_kit_items pki
     INNER JOIN products p ON p.id = pki.product_id AND p.business_id = pki.business_id
     WHERE pki.kit_id = $1 AND pki.business_id = $2
     ORDER BY pki.id ASC`,
    [kitId, businessId]
  );

  kit.items = itemRows.map((r) => ({
    id: r.id,
    product_id: r.product_id,
    quantity: Number(r.quantity),
    product_name: r.product_name,
    product_sku: r.product_sku,
    product_price: Number(r.product_price || 0),
    product_cost: Number(r.product_cost || 0),
    product_status: r.product_status,
    unidad_de_venta: r.unidad_de_venta
  }));

  return kit;
}

async function listKits(businessId, { activeOnly = false, search = "" } = {}) {
  const params = [businessId];
  let whereClause = "WHERE pk.business_id = $1";

  if (activeOnly) {
    whereClause += " AND pk.active = TRUE";
  }
  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    whereClause += ` AND (pk.name ILIKE $${params.length} OR pk.sku ILIKE $${params.length})`;
  }

  const { rows } = await pool.query(
    `SELECT pk.*,
            COUNT(pki.id)::int AS item_count,
            CASE
              WHEN pk.price_mode = 'fixed' THEN pk.fixed_price
              WHEN pk.price_mode = 'calculated' THEN (
                SELECT ROUND(
                  SUM(p.price * pki2.quantity) * (1 - pk.discount_pct / 100.0), -- precio base de componentes, sin descuentos activos
                  2
                )
                FROM product_kit_items pki2
                INNER JOIN products p ON p.id = pki2.product_id AND p.business_id = pki2.business_id
                WHERE pki2.kit_id = pk.id AND pki2.business_id = pk.business_id
              )
              ELSE NULL
            END AS effective_price
     FROM product_kits pk
     LEFT JOIN product_kit_items pki ON pki.kit_id = pk.id AND pki.business_id = pk.business_id
     ${whereClause}
     GROUP BY pk.id, pk.business_id
     ORDER BY pk.name ASC`,
    params
  );

  return rows.map((r) => ({ ...mapKitRow(r), item_count: r.item_count, effective_price: r.effective_price !== null ? Number(r.effective_price) : null }));
}

async function deleteKit(businessId, kitId) {
  const { rows } = await pool.query(
    "UPDATE product_kits SET active = FALSE, updated_at = NOW() WHERE id = $1 AND business_id = $2 RETURNING id",
    [kitId, businessId]
  );
  if (!rows[0]) throw new ApiError(404, "Kit no encontrado");
  return { id: rows[0].id, active: false };
}

async function calculateKitPrice(businessId, kitId, dbClient = null) {
  const db = dbClient || pool;

  const { rows: kitRows } = await db.query(
    "SELECT * FROM product_kits WHERE id = $1 AND business_id = $2 AND active = TRUE",
    [kitId, businessId]
  );
  if (!kitRows[0]) throw new ApiError(404, "Kit no encontrado o inactivo");
  const kit = kitRows[0];

  if (kit.price_mode === "fixed") {
    return Number(kit.fixed_price);
  }

  // price_mode = 'calculated': sum effective price of each component
  const { rows: itemRows } = await db.query(
    `SELECT pki.quantity,
            p.price, p.status, p.discount_type, p.discount_value, p.discount_start, p.discount_end,
            p.liquidation_price, p.expires_at, p.created_at,
            COALESCE(sales_21.recent_units_sold, 0) AS recent_units_sold
     FROM product_kit_items pki
     INNER JOIN products p ON p.id = pki.product_id AND p.business_id = pki.business_id
     LEFT JOIN (
       SELECT si.product_id, COALESCE(SUM(si.quantity), 0) AS recent_units_sold
       FROM sale_items si
       INNER JOIN sales s ON s.id = si.sale_id AND s.business_id = si.business_id
       WHERE si.business_id = $2
         AND s.sale_date >= CURRENT_DATE - INTERVAL '21 days'
         AND COALESCE(s.status, 'completed') <> 'cancelled'
       GROUP BY si.product_id
     ) sales_21 ON sales_21.product_id = p.id
     WHERE pki.kit_id = $1 AND pki.business_id = $2`,
    [kitId, businessId]
  );

  let subtotal = 0;
  for (const row of itemRows) {
    const componentPrice = computeComponentEffectivePrice(row);
    subtotal += componentPrice * Number(row.quantity);
  }

  const discountPct = Number(kit.discount_pct || 0);
  const finalPrice = discountPct > 0 ? subtotal * (1 - discountPct / 100) : subtotal;
  return Math.round(finalPrice * 100) / 100;
}

module.exports = {
  createKit,
  updateKit,
  getKitById,
  listKits,
  deleteKit,
  calculateKitPrice,
  computeComponentEffectivePrice
};
