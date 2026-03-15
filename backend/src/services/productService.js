const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");

async function listProducts(search, activeOnly = false) {
  const filters = activeOnly ? "WHERE product_data.is_active = TRUE" : "";

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
         COALESCE(sales_30.recent_units_sold, 0) AS recent_units_sold,
         COALESCE(sales_30.recent_units_sold, 0) <= 2 AS is_low_rotation,
         product_data.expires_at IS NOT NULL AND product_data.expires_at <= CURRENT_DATE + INTERVAL '14 days' AS is_near_expiry,
         product_data.liquidation_price IS NOT NULL
           AND (
             COALESCE(sales_30.recent_units_sold, 0) <= 2
             OR (product_data.expires_at IS NOT NULL AND product_data.expires_at <= CURRENT_DATE + INTERVAL '14 days')
           ) AS is_on_sale,
         COALESCE(
           CASE
             WHEN product_data.liquidation_price IS NOT NULL
               AND (
                 COALESCE(sales_30.recent_units_sold, 0) <= 2
                 OR (product_data.expires_at IS NOT NULL AND product_data.expires_at <= CURRENT_DATE + INTERVAL '14 days')
               )
             THEN product_data.liquidation_price
             ELSE product_data.price
           END,
           product_data.price
         ) AS effective_price
       FROM products product_data
       LEFT JOIN sales_30 ON sales_30.product_id = product_data.id
       ${filters}
       ORDER BY product_data.created_at DESC`
    );
    return rows;
  }

  const term = `%${search}%`;
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
       COALESCE(sales_30.recent_units_sold, 0) AS recent_units_sold,
       COALESCE(sales_30.recent_units_sold, 0) <= 2 AS is_low_rotation,
       product_data.expires_at IS NOT NULL AND product_data.expires_at <= CURRENT_DATE + INTERVAL '14 days' AS is_near_expiry,
       product_data.liquidation_price IS NOT NULL
         AND (
           COALESCE(sales_30.recent_units_sold, 0) <= 2
           OR (product_data.expires_at IS NOT NULL AND product_data.expires_at <= CURRENT_DATE + INTERVAL '14 days')
         ) AS is_on_sale,
       COALESCE(
         CASE
           WHEN product_data.liquidation_price IS NOT NULL
             AND (
               COALESCE(sales_30.recent_units_sold, 0) <= 2
               OR (product_data.expires_at IS NOT NULL AND product_data.expires_at <= CURRENT_DATE + INTERVAL '14 days')
             )
           THEN product_data.liquidation_price
           ELSE product_data.price
         END,
         product_data.price
       ) AS effective_price
     FROM products product_data
     LEFT JOIN sales_30 ON sales_30.product_id = product_data.id
     WHERE ${activeOnly ? "product_data.is_active = TRUE AND " : ""}(product_data.name ILIKE $1 OR product_data.sku ILIKE $1 OR product_data.barcode ILIKE $1 OR product_data.category ILIKE $1)
     ORDER BY product_data.name ASC`,
    [term]
  );
  return rows;
}

async function createProduct(payload) {
  const barcode = payload.barcode?.trim() || payload.sku;
  const { rows } = await pool.query(
    `INSERT INTO products (name, sku, barcode, category, description, price, cost_price, liquidation_price, stock, expires_at, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
      payload.is_active ?? true
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

  const { rows } = await pool.query(
    `UPDATE products
     SET name = $1, sku = $2, barcode = $3, category = $4, description = $5, price = $6, cost_price = $7, liquidation_price = $8, stock = $9, expires_at = $10, is_active = $11, updated_at = NOW()
     WHERE id = $12
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
      id
    ]
  );
  return rows[0];
}

async function updateProductStatus(id, isActive) {
  const { rows } = await pool.query(
    "UPDATE products SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
    [isActive, id]
  );

  if (!rows[0]) {
    throw new ApiError(404, "Product not found");
  }

  return rows[0];
}

async function deleteProduct(id) {
  const { rows: productRows } = await pool.query("SELECT id, name FROM products WHERE id = $1", [id]);
  const product = productRows[0];

  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  const { rows: usageRows } = await pool.query(
    "SELECT EXISTS(SELECT 1 FROM sale_items WHERE product_id = $1) AS has_sales",
    [id]
  );

  if (usageRows[0]?.has_sales) {
    const { rows } = await pool.query(
      "UPDATE products SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *",
      [id]
    );
    return { mode: "soft", product: rows[0] };
  }

  await pool.query("DELETE FROM products WHERE id = $1", [id]);
  return { mode: "hard", product };
}

module.exports = {
  listProducts,
  createProduct,
  updateProduct,
  updateProductStatus,
  deleteProduct
};
