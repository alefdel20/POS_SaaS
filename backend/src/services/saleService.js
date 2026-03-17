const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { recomputeDailyCut } = require("./dailyCutService");

const BANK_DETAILS = {
  bank: "BBVA",
  clabe: "012345678901234567",
  beneficiary: "Comercial XYZ"
};

function computeDiscountedPrice(product) {
  if (
    product.status !== "activo" ||
    !product.discount_type ||
    product.discount_value === null ||
    product.discount_value === undefined ||
    !product.discount_start ||
    !product.discount_end
  ) {
    return null;
  }

  const now = new Date();
  const start = new Date(product.discount_start);
  const end = new Date(product.discount_end);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || now < start || now > end) {
    return null;
  }

  if (product.discount_type === "percentage") {
    return Math.max(Number(product.price) - Number(product.price) * (Number(product.discount_value) / 100), 0);
  }

  if (product.discount_type === "fixed") {
    return Math.max(Number(product.price) - Number(product.discount_value), 0);
  }

  return null;
}

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
  if (payload.payment_method === "credit") {
    if (!payload.customer?.name?.trim()) {
      throw new ApiError(400, "Customer name is required for credit sales");
    }
    if (!payload.customer?.phone?.trim()) {
      throw new ApiError(400, "Customer phone is required for credit sales");
    }
    if (payload.initial_payment === undefined || Number(payload.initial_payment) < 0) {
      throw new ApiError(400, "Initial payment is required for credit sales");
    }
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const productIds = payload.items.map((item) => item.product_id);
    const { rows: productRows } = await client.query(
      `WITH sales_30 AS (
         SELECT
           si.product_id,
           COALESCE(SUM(si.quantity), 0) AS recent_units_sold
         FROM sale_items si
         INNER JOIN sales s ON s.id = si.sale_id
         WHERE s.sale_date >= CURRENT_DATE - INTERVAL '30 days'
         GROUP BY si.product_id
       )
       SELECT products.*, COALESCE(sales_30.recent_units_sold, 0) AS recent_units_sold
       FROM products
       LEFT JOIN sales_30 ON sales_30.product_id = products.id
       WHERE products.id = ANY($1::int[])`,
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
      if (!product.is_active || product.status !== "activo") {
        throw new ApiError(409, "Producto inactivo, contactar proveedor");
      }

      const quantity = Number(item.quantity);
      if (quantity <= 0) {
        throw new ApiError(400, "Quantity must be greater than zero");
      }

      if (Number(product.stock) < quantity) {
        warnings.push(`Insufficient stock for ${product.name}. Current stock: ${product.stock}`);
      }

      const nearExpiry =
        Boolean(product.expires_at) &&
        new Date(product.expires_at) <= new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      const activeDiscountPrice = computeDiscountedPrice(product);
      const effectivePrice =
        activeDiscountPrice !== null
          ? activeDiscountPrice
          : product.liquidation_price !== null &&
              product.liquidation_price !== undefined &&
              (Number(product.recent_units_sold || 0) <= 2 || nearExpiry)
          ? product.liquidation_price
          : product.price;
      const unitPrice = Number(item.unit_price ?? effectivePrice);
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

    const saleType = payload.sale_type || "ticket";
    const subtotal = total;
    const initialPayment = Number(payload.initial_payment || 0);
    const balanceDue = payload.payment_method === "credit" ? Math.max(total - initialPayment, 0) : 0;
    const customerName = payload.customer?.name?.trim() || null;
    const customerPhone = payload.customer?.phone?.trim() || null;
    const invoiceData = saleType === "invoice" ? payload.invoice_data || {} : {};

    const { rows: saleRows } = await client.query(
      `INSERT INTO sales (
        user_id,
        payment_method,
        sale_type,
        subtotal,
        total,
        total_cost,
        customer_name,
        customer_phone,
        initial_payment,
        balance_due,
        invoice_data,
        notes,
        sale_date,
        sale_time,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_DATE, CURRENT_TIME, CURRENT_TIMESTAMP)
      RETURNING *`,
      [
        user.id,
        payload.payment_method || "cash",
        saleType,
        subtotal,
        total,
        totalCost,
        customerName,
        customerPhone,
        initialPayment,
        balanceDue,
        JSON.stringify(invoiceData),
        payload.payment_method === "transfer" ? JSON.stringify({ bank_details: BANK_DETAILS }) : ""
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
        "UPDATE products SET stock = stock - $1 WHERE id = $2",
        [item.quantity, item.productId]
      );
    }

    await client.query("COMMIT");
    await recomputeDailyCut(sale.sale_date);

    return {
      sale,
      warnings,
      receipt: {
        bank_details: payload.payment_method === "transfer" ? BANK_DETAILS : null,
        balance_due: balanceDue
      }
    };
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
  createSale,
  BANK_DETAILS
};
