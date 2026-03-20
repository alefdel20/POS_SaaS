const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");

async function listSuppliers(search = "") {
  const term = search.trim();
  const { rows } = await pool.query(
    `SELECT
       suppliers.id,
       suppliers.name,
       suppliers.email,
       suppliers.phone,
       suppliers.whatsapp,
       suppliers.observations,
       COUNT(DISTINCT product_suppliers.product_id)::int AS product_count
     FROM suppliers
     LEFT JOIN product_suppliers ON product_suppliers.supplier_id = suppliers.id
     WHERE ($1 = '' OR suppliers.name ILIKE $2)
     GROUP BY suppliers.id
     ORDER BY suppliers.name ASC`,
    [term, `%${term}%`]
  );

  return rows;
}

async function getSupplierDetail(id) {
  const { rows: supplierRows } = await pool.query(
    `SELECT id, name, email, phone, whatsapp, observations
     FROM suppliers
     WHERE id = $1`,
    [id]
  );
  const supplier = supplierRows[0];

  if (!supplier) {
    throw new ApiError(404, "Supplier not found");
  }

  const { rows: productRows } = await pool.query(
    `SELECT
       products.id AS product_id,
       products.name AS product_name,
       products.sku,
       COALESCE(product_suppliers.purchase_cost, products.cost_price, 0) AS purchase_cost,
       product_suppliers.cost_updated_at,
       products.updated_at AS product_updated_at
     FROM product_suppliers
     INNER JOIN products ON products.id = product_suppliers.product_id
     WHERE product_suppliers.supplier_id = $1
     ORDER BY products.name ASC`,
    [id]
  );

  return {
    ...supplier,
    products: productRows.map((row) => ({
      ...row,
      purchase_cost: Number(row.purchase_cost || 0)
    }))
  };
}

module.exports = {
  listSuppliers,
  getSupplierDetail
};
