const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");

function scope(actor, alias = "suppliers") {
  return { clause: `${alias}.business_id = $1`, params: [requireActorBusinessId(actor)] };
}

async function listSuppliers(search = "", actor) {
  const term = search.trim();
  const scoped = scope(actor);
  const params = [...scoped.params];
  const conditions = scoped.clause ? [scoped.clause] : [];
  if (term) {
    params.push(`%${term}%`);
    conditions.push(`suppliers.name ILIKE $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT
       suppliers.id,
       suppliers.name,
       suppliers.email,
       suppliers.phone,
       suppliers.whatsapp,
       suppliers.observations,
       suppliers.business_id,
       COUNT(DISTINCT product_suppliers.product_id)::int AS product_count,
       COALESCE(product_preview.product_names, ARRAY[]::text[]) AS product_names
     FROM suppliers
     LEFT JOIN product_suppliers
       ON product_suppliers.supplier_id = suppliers.id
      AND product_suppliers.business_id = suppliers.business_id
     LEFT JOIN LATERAL (
       SELECT ARRAY_AGG(preview_products.name ORDER BY preview_products.name ASC) AS product_names
       FROM (
         SELECT products.name
         FROM product_suppliers preview_links
         INNER JOIN products
           ON products.id = preview_links.product_id
          AND products.business_id = preview_links.business_id
         WHERE preview_links.supplier_id = suppliers.id
           AND preview_links.business_id = suppliers.business_id
         ORDER BY products.name ASC
         LIMIT 3
       ) AS preview_products
     ) AS product_preview ON TRUE
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     GROUP BY suppliers.id, product_preview.product_names
     ORDER BY suppliers.name ASC`,
    params
  );

  return rows;
}

async function getSupplierDetail(id, actor) {
  const scoped = scope(actor);
  const params = [id, ...scoped.params];
  const where = scoped.clause ? `AND ${scoped.clause.replace("$1", "$2")}` : "";
  const { rows: supplierRows } = await pool.query(
    `SELECT id, name, email, phone, whatsapp, observations, business_id
     FROM suppliers
     WHERE id = $1 ${where}`,
    params
  );
  const supplier = supplierRows[0];
  if (!supplier) throw new ApiError(404, "Supplier not found");

  const { rows: productRows } = await pool.query(
    `SELECT
       products.id AS product_id,
       products.name AS product_name,
       products.sku,
       products.stock,
       products.stock_maximo,
       GREATEST(COALESCE(products.stock_maximo, 0) - COALESCE(products.stock, 0), 0) AS diferencia_reabastecimiento,
       COALESCE(product_suppliers.purchase_cost, products.cost_price, 0) AS purchase_cost,
       product_suppliers.cost_updated_at,
       products.updated_at AS product_updated_at
     FROM product_suppliers
     INNER JOIN products ON products.id = product_suppliers.product_id AND products.business_id = product_suppliers.business_id
     WHERE product_suppliers.supplier_id = $1
       AND product_suppliers.business_id = $2
       AND products.business_id = $2
     ORDER BY products.name ASC`,
    [id, supplier.business_id]
  );

  return {
    ...supplier,
    products: productRows.map((row) => ({
      ...row,
      stock: Number(row.stock || 0),
      stock_maximo: Number(row.stock_maximo || 0),
      diferencia_reabastecimiento: Number(row.diferencia_reabastecimiento || 0),
      purchase_cost: Number(row.purchase_cost || 0)
    }))
  };
}

module.exports = { listSuppliers, getSupplierDetail };
