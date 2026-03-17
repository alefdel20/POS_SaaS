const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");

function normalizeDiscountFields(payload) {
  return {
    discount_type: payload.discount_type || null,
    discount_value:
      payload.discount_value === undefined || payload.discount_value === null || payload.discount_value === ""
        ? null
        : Number(payload.discount_value),
    discount_start: payload.discount_start || null,
    discount_end: payload.discount_end || null
  };
}

function buildSearchCondition(activeOnly) {
  return activeOnly
    ? "WHERE product_data.is_active = TRUE AND product_data.status = 'activo'"
    : "";
}

async function ensureSupplierReference(payload, client = pool) {
  const supplierId = payload.supplier_id ? Number(payload.supplier_id) : null;
  const supplierName = payload.supplier_name?.trim();

  if (supplierId) {
    const { rows } = await client.query("SELECT id FROM suppliers WHERE id = $1", [supplierId]);
    if (!rows[0]) {
      throw new ApiError(404, "Supplier not found");
    }
    return supplierId;
  }

  if (!supplierName) {
    return null;
  }

  const { rows: existingRows } = await client.query("SELECT id FROM suppliers WHERE LOWER(name) = LOWER($1)", [supplierName]);
  if (existingRows[0]) {
    return existingRows[0].id;
  }

  const { rows } = await client.query(
    `INSERT INTO suppliers (name, created_at, updated_at)
     VALUES ($1, NOW(), NOW())
     RETURNING id`,
    [supplierName]
  );
  return rows[0].id;
}

function buildEffectivePriceCase() {
  return `
    COALESCE(
      CASE
        WHEN product_data.status = 'activo'
          AND product_data.discount_type IS NOT NULL
          AND product_data.discount_value IS NOT NULL
          AND product_data.discount_start IS NOT NULL
          AND product_data.discount_end IS NOT NULL
          AND NOW() BETWEEN product_data.discount_start AND product_data.discount_end
        THEN GREATEST(
          CASE
            WHEN product_data.discount_type = 'percentage'
              THEN product_data.price - (product_data.price * (product_data.discount_value / 100))
            WHEN product_data.discount_type = 'fixed'
              THEN product_data.price - product_data.discount_value
            ELSE product_data.price
          END,
          0
        )
        WHEN product_data.liquidation_price IS NOT NULL
          AND (
            COALESCE(sales_30.recent_units_sold, 0) <= 2
            OR (product_data.expires_at IS NOT NULL AND product_data.expires_at <= CURRENT_DATE + INTERVAL '14 days')
          )
        THEN product_data.liquidation_price
        ELSE product_data.price
      END,
      product_data.price
    )
  `;
}

async function listProducts(search, activeOnly = false) {
  const filters = buildSearchCondition(activeOnly);
  const effectivePriceCase = buildEffectivePriceCase();

  if (!search) {
    const { rows } = await pool.query(
      `WITH sales_30 AS (
         SELECT
           si.product_id,
           COALESCE(SUM(si.quantity), 0) AS recent_units_sold
         FROM sale_items si
         INNER JOIN sales s ON s.id = si.sale_id
         WHERE s.sale_date >= CURRENT_DATE - INTERVAL '30 days'
         GROUP BY si.product_id
       )
       SELECT
         product_data.*,
         suppliers.name AS supplier_name,
         COALESCE(sales_30.recent_units_sold, 0) AS recent_units_sold,
         COALESCE(sales_30.recent_units_sold, 0) <= 2 AS is_low_rotation,
         product_data.expires_at IS NOT NULL AND product_data.expires_at <= CURRENT_DATE + INTERVAL '14 days' AS is_near_expiry,
         product_data.discount_type IS NOT NULL
           AND product_data.discount_value IS NOT NULL
           AND product_data.discount_start IS NOT NULL
           AND product_data.discount_end IS NOT NULL
           AND NOW() BETWEEN product_data.discount_start AND product_data.discount_end
           AND product_data.status = 'activo' AS has_active_discount,
         product_data.liquidation_price IS NOT NULL
           AND (
             COALESCE(sales_30.recent_units_sold, 0) <= 2
             OR (product_data.expires_at IS NOT NULL AND product_data.expires_at <= CURRENT_DATE + INTERVAL '14 days')
           ) AS has_legacy_liquidation,
         (${effectivePriceCase}) AS effective_price,
         product_data.price > (${effectivePriceCase}) AS is_on_sale
       FROM products product_data
       LEFT JOIN sales_30 ON sales_30.product_id = product_data.id
       LEFT JOIN suppliers ON suppliers.id = product_data.supplier_id
       ${filters}
       ORDER BY product_data.created_at DESC`
    );
    return rows;
  }

  const term = `%${search}%`;
  const activePredicate = activeOnly ? "product_data.is_active = TRUE AND product_data.status = 'activo' AND " : "";
  const { rows } = await pool.query(
    `WITH sales_30 AS (
       SELECT
         si.product_id,
         COALESCE(SUM(si.quantity), 0) AS recent_units_sold
       FROM sale_items si
       INNER JOIN sales s ON s.id = si.sale_id
       WHERE s.sale_date >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY si.product_id
     )
     SELECT
       product_data.*,
       suppliers.name AS supplier_name,
       COALESCE(sales_30.recent_units_sold, 0) AS recent_units_sold,
       COALESCE(sales_30.recent_units_sold, 0) <= 2 AS is_low_rotation,
       product_data.expires_at IS NOT NULL AND product_data.expires_at <= CURRENT_DATE + INTERVAL '14 days' AS is_near_expiry,
       product_data.discount_type IS NOT NULL
         AND product_data.discount_value IS NOT NULL
         AND product_data.discount_start IS NOT NULL
         AND product_data.discount_end IS NOT NULL
         AND NOW() BETWEEN product_data.discount_start AND product_data.discount_end
         AND product_data.status = 'activo' AS has_active_discount,
       product_data.liquidation_price IS NOT NULL
         AND (
           COALESCE(sales_30.recent_units_sold, 0) <= 2
           OR (product_data.expires_at IS NOT NULL AND product_data.expires_at <= CURRENT_DATE + INTERVAL '14 days')
         ) AS has_legacy_liquidation,
       (${effectivePriceCase}) AS effective_price,
       product_data.price > (${effectivePriceCase}) AS is_on_sale
     FROM products product_data
     LEFT JOIN sales_30 ON sales_30.product_id = product_data.id
     LEFT JOIN suppliers ON suppliers.id = product_data.supplier_id
     WHERE ${activePredicate}(product_data.name ILIKE $1 OR product_data.sku ILIKE $1 OR product_data.barcode ILIKE $1 OR product_data.category ILIKE $1 OR suppliers.name ILIKE $1)
     ORDER BY product_data.name ASC`,
    [term]
  );
  return rows;
}

async function listSuppliers(search) {
  const term = search?.trim();
  if (!term) {
    const { rows } = await pool.query(
      "SELECT id, name, email, phone, created_at, updated_at FROM suppliers ORDER BY name ASC LIMIT 20"
    );
    return rows;
  }

  const { rows } = await pool.query(
    `SELECT id, name, email, phone, created_at, updated_at
     FROM suppliers
     WHERE name ILIKE $1
     ORDER BY name ASC
     LIMIT 20`,
    [`%${term}%`]
  );
  return rows;
}

async function createProduct(payload) {
  const barcode = payload.barcode?.trim() || payload.sku;
  const supplierId = await ensureSupplierReference(payload);
  const discountFields = normalizeDiscountFields(payload);

  const { rows } = await pool.query(
    `INSERT INTO products (
      name,
      sku,
      barcode,
      category,
      description,
      price,
      cost_price,
      liquidation_price,
      stock,
      expires_at,
      is_active,
      supplier_id,
      status,
      discount_type,
      discount_value,
      discount_start,
      discount_end
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING *`,
    [
      payload.name,
      payload.sku,
      barcode,
      payload.category || null,
      payload.description || "",
      payload.price,
      payload.cost_price ?? 0,
      payload.liquidation_price ?? null,
      payload.stock ?? 0,
      payload.expires_at || null,
      payload.is_active ?? true,
      supplierId,
      payload.status || "activo",
      discountFields.discount_type,
      discountFields.discount_value,
      discountFields.discount_start,
      discountFields.discount_end
    ]
  );
  return rows[0];
}

async function updateProduct(id, payload) {
  const { rows: currentRows } = await pool.query("SELECT * FROM products WHERE id = $1", [id]);
  const current = currentRows[0];

  if (!current) {
    throw new ApiError(404, "Product not found");
  }

  const supplierId = payload.supplier_id !== undefined || payload.supplier_name !== undefined
    ? await ensureSupplierReference(payload)
    : current.supplier_id;
  const discountFields = normalizeDiscountFields(payload);

  const { rows } = await pool.query(
    `UPDATE products
     SET name = $1,
         sku = $2,
         barcode = $3,
         category = $4,
         description = $5,
         price = $6,
         cost_price = $7,
         liquidation_price = $8,
         stock = $9,
         expires_at = $10,
         is_active = $11,
         supplier_id = $12,
         status = $13,
         discount_type = $14,
         discount_value = $15,
         discount_start = $16,
         discount_end = $17,
         updated_at = NOW()
     WHERE id = $18
     RETURNING *`,
    [
      payload.name ?? current.name,
      payload.sku ?? current.sku,
      payload.barcode?.trim() || current.barcode,
      payload.category ?? current.category,
      payload.description ?? current.description,
      payload.price ?? current.price,
      payload.cost_price ?? current.cost_price,
      payload.liquidation_price !== undefined ? payload.liquidation_price : current.liquidation_price,
      payload.stock ?? current.stock,
      payload.expires_at !== undefined ? payload.expires_at : current.expires_at,
      payload.is_active ?? current.is_active,
      supplierId,
      payload.status ?? current.status ?? "activo",
      payload.discount_type !== undefined ? discountFields.discount_type : current.discount_type,
      payload.discount_value !== undefined ? discountFields.discount_value : current.discount_value,
      payload.discount_start !== undefined ? discountFields.discount_start : current.discount_start,
      payload.discount_end !== undefined ? discountFields.discount_end : current.discount_end,
      id
    ]
  );
  return rows[0];
}

async function updateProductStatus(id, isActive, status) {
  const { rows: currentRows } = await pool.query("SELECT * FROM products WHERE id = $1", [id]);
  const current = currentRows[0];

  if (!current) {
    throw new ApiError(404, "Product not found");
  }

  const resolvedIsActive = isActive === undefined ? current.is_active : isActive;
  const nextStatus = status || (resolvedIsActive ? "activo" : "inactivo");
  const { rows } = await pool.query(
    "UPDATE products SET is_active = $1, status = $2, updated_at = NOW() WHERE id = $3 RETURNING *",
    [resolvedIsActive, nextStatus, id]
  );

  return rows[0];
}

async function deleteProduct(id, action) {
  const { rows: productRows } = await pool.query("SELECT id, name FROM products WHERE id = $1", [id]);
  const product = productRows[0];

  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  const { rows: usageRows } = await pool.query(
    "SELECT EXISTS(SELECT 1 FROM sale_items WHERE product_id = $1) AS has_sales",
    [id]
  );

  const hasSales = Boolean(usageRows[0]?.has_sales);
  if (action === "delete" && hasSales) {
    throw new ApiError(409, "Cannot permanently delete product with sales history");
  }

  if (action === "deactivate" || hasSales) {
    const { rows } = await pool.query(
      "UPDATE products SET is_active = FALSE, status = 'inactivo', updated_at = NOW() WHERE id = $1 RETURNING *",
      [id]
    );
    return { mode: "soft", product: rows[0] };
  }

  await pool.query("DELETE FROM products WHERE id = $1", [id]);
  return { mode: "hard", product };
}

async function applyBulkDiscount(productIds, payload) {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw new ApiError(400, "At least one product is required");
  }

  const normalizedIds = productIds.map(Number).filter(Boolean);
  const discountFields = normalizeDiscountFields(payload);

  if (payload.clear_discount) {
    const { rows } = await pool.query(
      `UPDATE products
       SET discount_type = NULL,
           discount_value = NULL,
           discount_start = NULL,
           discount_end = NULL,
           updated_at = NOW()
       WHERE id = ANY($1::int[])
       RETURNING *`,
      [normalizedIds]
    );
    return rows;
  }

  if (!discountFields.discount_type || discountFields.discount_value === null) {
    throw new ApiError(400, "Discount configuration is incomplete");
  }

  if (discountFields.discount_value < 0) {
    throw new ApiError(400, "Discount value must be positive");
  }

  const { rows } = await pool.query(
    `UPDATE products
     SET discount_type = $1,
         discount_value = $2,
         discount_start = $3,
         discount_end = $4,
         updated_at = NOW()
     WHERE id = ANY($5::int[])
     RETURNING *`,
    [
      discountFields.discount_type,
      discountFields.discount_value,
      discountFields.discount_start,
      discountFields.discount_end,
      normalizedIds
    ]
  );
  return rows;
}

module.exports = {
  listProducts,
  listSuppliers,
  createProduct,
  updateProduct,
  updateProductStatus,
  deleteProduct,
  applyBulkDiscount
};
