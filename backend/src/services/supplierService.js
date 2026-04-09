const ExcelJS = require("exceljs");
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
       COALESCE(products.stock, 0) * COALESCE(product_suppliers.purchase_cost, products.cost_price, 0) AS current_stock_cost,
       COALESCE(products.stock_maximo, 0) * COALESCE(product_suppliers.purchase_cost, products.cost_price, 0) AS max_stock_cost,
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
      purchase_cost: Number(row.purchase_cost || 0),
      current_stock_cost: Number(row.current_stock_cost || 0),
      max_stock_cost: Number(row.max_stock_cost || 0)
    }))
  };
}

async function buildSupplierCatalogTemplate() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Catalogo proveedor");

  worksheet.columns = [
    { header: "Codigo proveedor", key: "supplier_product_code", width: 22 },
    { header: "Producto", key: "supplier_product_name", width: 32 },
    { header: "Descripcion", key: "supplier_description", width: 36 },
    { header: "Categoria", key: "supplier_category", width: 22 },
    { header: "Unidad", key: "supplier_unit", width: 14 },
    { header: "Costo de compra", key: "purchase_cost", width: 18 },
    { header: "Moneda", key: "currency", width: 12 },
    { header: "Multiplo", key: "pack_size", width: 14 },
    { header: "Minimo de pedido", key: "min_order_qty", width: 18 }
  ];

  worksheet.addRow({
    supplier_product_code: "SKU-PROV-001",
    supplier_product_name: "Producto ejemplo",
    supplier_description: "Presentacion base para validar la importacion",
    supplier_category: "General",
    supplier_unit: "pieza",
    purchase_cost: 12.5,
    currency: "MXN",
    pack_size: "1",
    min_order_qty: "1"
  });

  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer,
    filename: "plantilla_catalogo_proveedor.xlsx"
  };
}

module.exports = { listSuppliers, getSupplierDetail, buildSupplierCatalogTemplate };
