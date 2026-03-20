const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { canBypassBusinessScope, requireActorBusinessId } = require("../utils/tenant");

function scope(actor, alias = "suppliers") {
  if (canBypassBusinessScope(actor)) return { clause: "", params: [] };
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
       COUNT(DISTINCT product_suppliers.product_id)::int AS product_count
     FROM suppliers
     LEFT JOIN product_suppliers
       ON product_suppliers.supplier_id = suppliers.id
      AND product_suppliers.business_id = suppliers.business_id
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     GROUP BY suppliers.id
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
       COALESCE(product_suppliers.purchase_cost, products.cost_price, 0) AS purchase_cost,
       product_suppliers.cost_updated_at,
       products.updated_at AS product_updated_at
     FROM product_suppliers
     INNER JOIN products ON products.id = product_suppliers.product_id
     WHERE product_suppliers.supplier_id = $1
       AND product_suppliers.business_id = $2
       AND products.business_id = $2
     ORDER BY products.name ASC`,
    [id, supplier.business_id]
  );

  return {
    ...supplier,
    products: productRows.map((row) => ({ ...row, purchase_cost: Number(row.purchase_cost || 0) }))
  };
}

module.exports = { listSuppliers, getSupplierDetail };
