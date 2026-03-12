const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { recomputeDailyCut } = require("./dailyCutService");

async function listSales() {
  const { rows } = await pool.query(
    `SELECT sales.*, users.full_name AS cashier_name
     FROM sales
     INNER JOIN users ON users.id = sales.user_id
     ORDER BY sales.created_at DESC`
  );
  return rows;
}

async function listRecentSales() {
  const { rows } = await pool.query(
    `SELECT sales.*, users.full_name AS cashier_name
     FROM sales
     INNER JOIN users ON users.id = sales.user_id
     ORDER BY sales.created_at DESC
     LIMIT 20`
  );
  return rows;
}

async function createSale(payload, user) {
  if (!payload.items || !payload.items.length) {
    throw new ApiError(400, "Sale requires at least one item");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const productIds = payload.items.map((item) => item.product_id);
    const { rows: productRows } = await client.query(
      "SELECT * FROM products WHERE id = ANY($1::int[])",
      [productIds]
    );
    const productsMap = new Map(productRows.map((product) => [product.id, product]));

    const warnings = [];
    const normalizedItems = [];
    let total = 0;
    let totalCost = 0;

    for (const item of payload.items) {
      const product = productsMap.get(item.product_id);
      if (!product) {
        throw new ApiError(404, `Product ${item.product_id} not found`);
      }

      const quantity = Number(item.quantity);
      if (quantity <= 0) {
        throw new ApiError(400, "Quantity must be greater than zero");
      }

      if (Number(product.stock) < quantity) {
        warnings.push(`Insufficient stock for ${product.name}. Current stock: ${product.stock}`);
      }

      const unitPrice = Number(item.unit_price ?? product.price);
      const unitCost = Number(product.cost_price || 0);
      const subtotal = unitPrice * quantity;
      total += subtotal;
      totalCost += unitCost * quantity;

      normalizedItems.push({
        productId: product.id,
        quantity,
        unitPrice,
        unitCost,
        subtotal
      });
    }

    const { rows: saleRows } = await client.query(
      `INSERT INTO sales (user_id, payment_method, sale_type, subtotal, total, total_cost, notes, sale_date, sale_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, CURRENT_TIME)
       RETURNING *`,
      [
        user.id,
        payload.payment_method,
        payload.sale_type,
        total,
        total,
        totalCost,
        payload.notes || ""
      ]
    );

    const sale = saleRows[0];

    for (const item of normalizedItems) {
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, unit_cost, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sale.id, item.productId, item.quantity, item.unitPrice, item.unitCost, item.subtotal]
      );

      await client.query(
        "UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2",
        [item.quantity, item.productId]
      );
    }

    await client.query("COMMIT");
    await recomputeDailyCut(sale.sale_date);

    return { sale, warnings };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  listSales,
  listRecentSales,
  createSale
};
