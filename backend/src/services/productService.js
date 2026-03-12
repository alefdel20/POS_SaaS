const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");

async function listProducts(search) {
  if (!search) {
    const { rows } = await pool.query("SELECT * FROM products ORDER BY created_at DESC");
    return rows;
  }

  const term = `%${search}%`;
  const { rows } = await pool.query(
    `SELECT * FROM products
     WHERE name ILIKE $1 OR sku ILIKE $1 OR barcode ILIKE $1
     ORDER BY name ASC`,
    [term]
  );
  return rows;
}

async function createProduct(payload) {
  const { rows } = await pool.query(
    `INSERT INTO products (name, sku, barcode, description, price, cost_price, stock, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      payload.name,
      payload.sku,
      payload.barcode,
      payload.description || "",
      payload.price,
      payload.cost_price,
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
     SET name = $1, sku = $2, barcode = $3, description = $4, price = $5, cost_price = $6, stock = $7, is_active = $8, updated_at = NOW()
     WHERE id = $9
     RETURNING *`,
    [
      payload.name ?? current.name,
      payload.sku ?? current.sku,
      payload.barcode ?? current.barcode,
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
