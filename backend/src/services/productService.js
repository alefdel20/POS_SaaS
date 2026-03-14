const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");

async function listProducts(search, activeOnly = false) {
  if (!search) {
    const { rows } = await pool.query(
      `SELECT * FROM products
       ${activeOnly ? "WHERE is_active = TRUE" : ""}
       ORDER BY created_at DESC`
    );
    return rows;
  }

  const term = `%${search}%`;
  const { rows } = await pool.query(
    `SELECT * FROM products
     WHERE ${activeOnly ? "is_active = TRUE AND " : ""}(name ILIKE $1 OR sku ILIKE $1 OR barcode ILIKE $1 OR category ILIKE $1)
     ORDER BY name ASC`,
    [term]
  );
  return rows;
}

async function createProduct(payload) {
  const barcode = payload.barcode?.trim() || payload.sku;
  const { rows } = await pool.query(
    `INSERT INTO products (name, sku, barcode, category, description, price, cost_price, stock, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      payload.name,
      payload.sku,
      barcode,
      payload.category || null,
      payload.description || "",
      payload.price,
      payload.cost_price ?? 0,
      payload.stock ?? 0,
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
     SET name = $1, sku = $2, barcode = $3, category = $4, description = $5, price = $6, cost_price = $7, stock = $8, is_active = $9, updated_at = NOW()
     WHERE id = $10
     RETURNING *`,
    [
      payload.name ?? current.name,
      payload.sku ?? current.sku,
      payload.barcode?.trim() || current.barcode,
      payload.category ?? current.category,
      payload.description ?? current.description,
      payload.price ?? current.price,
      payload.cost_price ?? current.cost_price,
      payload.stock ?? current.stock,
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

module.exports = {
  listProducts,
  createProduct,
  updateProduct,
  updateProductStatus
};
