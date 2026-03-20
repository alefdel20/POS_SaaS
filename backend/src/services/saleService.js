const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { recomputeDailyCut } = require("./dailyCutService");
const { ensureAutomaticReminders, ensureLowStockRemindersForProductIds } = require("./reminderService");

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

function normalizeNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseTransferNotes(notes) {
  if (!notes) {
    return {};
  }

  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function mapSaleRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    transfer_snapshot: row.transfer_snapshot || parseTransferNotes(row.notes),
    invoice_data: row.invoice_data || {},
    stamp_snapshot: row.stamp_snapshot || {}
  };
}

function buildSaleFilters(filters = {}) {
  const conditions = [];
  const values = [];

  const addCondition = (sql, value) => {
    values.push(value);
    conditions.push(sql.replace("?", `$${values.length}`));
  };

  if (filters.date) {
    addCondition("sales.sale_date = ?::date", filters.date);
  }

  if (filters.date_from) {
    addCondition("sales.sale_date >= ?::date", filters.date_from);
  }

  if (filters.date_to) {
    addCondition("sales.sale_date <= ?::date", filters.date_to);
  }

  if (filters.user_id) {
    addCondition("sales.user_id = ?", Number(filters.user_id));
  }

  if (filters.cashier) {
    addCondition("users.full_name ILIKE ?", `%${String(filters.cashier).trim()}%`);
  }

  if (filters.payment_method) {
    addCondition("sales.payment_method = ?", filters.payment_method);
  }

  if (filters.folio) {
    addCondition("CAST(sales.id AS TEXT) ILIKE ?", `%${String(filters.folio).trim()}%`);
  }

  const totalMin = normalizeNumber(filters.total_min);
  if (totalMin !== null) {
    addCondition("sales.total >= ?", totalMin);
  }

  const totalMax = normalizeNumber(filters.total_max);
  if (totalMax !== null) {
    addCondition("sales.total <= ?", totalMax);
  }

  if (filters.total !== undefined && filters.total !== null && filters.total !== "") {
    addCondition("sales.total = ?", Number(filters.total));
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    values
  };
}

async function getActiveCompanyProfile(client = pool) {
  const { rows } = await client.query(
    `SELECT *
     FROM company_profiles
     WHERE profile_key = 'default' AND is_active = TRUE
     LIMIT 1`
  );

  return rows[0] || null;
}

function hasCompleteFiscalProfile(profile) {
  return Boolean(
    profile &&
    profile.fiscal_rfc &&
    profile.fiscal_business_name &&
    profile.fiscal_regime &&
    profile.fiscal_address
  );
}

async function listSales(filters = {}) {
  const { whereClause, values } = buildSaleFilters(filters);
  const { rows } = await pool.query(
    `SELECT sales.*, users.full_name AS cashier_name
     FROM sales
     INNER JOIN users ON users.id = sales.user_id
     ${whereClause}
     ORDER BY sales.created_at DESC`,
    values
  );
  return rows.map(mapSaleRow);
}

async function listRecentSales() {
  const { rows } = await pool.query(
    `SELECT sales.*, users.full_name AS cashier_name
     FROM sales
     INNER JOIN users ON users.id = sales.user_id
     ORDER BY sales.created_at DESC
     LIMIT 20`
  );
  return rows.map(mapSaleRow);
}

async function getSaleDetail(saleId) {
  const { rows } = await pool.query(
    `SELECT
       sales.*,
       users.full_name AS cashier_name,
       users.username AS cashier_username
     FROM sales
     INNER JOIN users ON users.id = sales.user_id
     WHERE sales.id = $1`,
    [saleId]
  );

  const sale = mapSaleRow(rows[0]);
  if (!sale) {
    throw new ApiError(404, "Sale not found");
  }

  const { rows: itemRows } = await pool.query(
    `SELECT
       sale_items.id,
       sale_items.product_id,
       products.name AS product_name,
       products.sku,
       sale_items.quantity,
       sale_items.unit_price,
       sale_items.subtotal
     FROM sale_items
     INNER JOIN products ON products.id = sale_items.product_id
     WHERE sale_items.sale_id = $1
     ORDER BY sale_items.id ASC`,
    [saleId]
  );

  const { rows: paymentRows } = await pool.query(
    `SELECT id, payment_date, amount, payment_method, notes, created_at
     FROM credit_payments
     WHERE sale_id = $1
     ORDER BY payment_date ASC, id ASC`,
    [saleId]
  );

  return {
    ...sale,
    folio: sale.id,
    user: {
      id: sale.user_id,
      full_name: sale.cashier_name,
      username: sale.cashier_username
    },
    credit_info: sale.payment_method === "credit" ? {
      customer_name: sale.customer_name,
      customer_phone: sale.customer_phone,
      initial_payment: Number(sale.initial_payment || 0),
      balance_due: Number(sale.balance_due || 0),
      payments: paymentRows.map((payment) => ({
        id: payment.id,
        payment_date: payment.payment_date,
        amount: Number(payment.amount),
        payment_method: payment.payment_method,
        notes: payment.notes,
        created_at: payment.created_at
      }))
    } : null,
    transfer_info: sale.payment_method === "transfer" ? sale.transfer_snapshot : null,
    invoice_info: sale.sale_type === "invoice" ? {
      status: sale.invoice_status,
      stamp_status: sale.stamp_status,
      stamp_snapshot: sale.stamp_snapshot,
      invoice_data: sale.invoice_data
    } : null,
    items: itemRows.map((item) => ({
      id: item.id,
      product_id: item.product_id,
      product_name: item.product_name,
      sku: item.sku,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      subtotal: Number(item.subtotal)
    }))
  };
}

async function getSalesTrends(period) {
  const periods = {
    week: {
      label: "week",
      trunc: "week",
      interval: "12 weeks"
    },
    month: {
      label: "month",
      trunc: "month",
      interval: "12 months"
    },
    year: {
      label: "year",
      trunc: "year",
      interval: "5 years"
    }
  };

  const selected = periods[period];
  if (!selected) {
    throw new ApiError(400, "Invalid trend period");
  }

  const { rows } = await pool.query(
    `WITH aggregated AS (
       SELECT
         DATE_TRUNC('${selected.trunc}', sales.sale_date::timestamp)::date AS period_start,
         sale_items.product_id,
         products.name AS product_name,
         products.sku,
         SUM(sale_items.quantity) AS units_sold,
         SUM(sale_items.subtotal) AS revenue
       FROM sale_items
       INNER JOIN sales ON sales.id = sale_items.sale_id
       INNER JOIN products ON products.id = sale_items.product_id
       WHERE sales.sale_date >= CURRENT_DATE - INTERVAL '${selected.interval}'
       GROUP BY DATE_TRUNC('${selected.trunc}', sales.sale_date::timestamp)::date, sale_items.product_id, products.name, products.sku
     ),
     ranked AS (
       SELECT
         aggregated.*,
         ROW_NUMBER() OVER (
           PARTITION BY aggregated.period_start
           ORDER BY aggregated.units_sold DESC, aggregated.revenue DESC, aggregated.product_id ASC
         ) AS position
       FROM aggregated
     )
     SELECT
       period_start,
       product_id,
       product_name,
       sku,
       units_sold,
       revenue,
       position
     FROM ranked
     WHERE position <= 10
     ORDER BY period_start DESC, position ASC`
  );

  return {
    period: selected.label,
    items: rows.map((row) => ({
      period_start: row.period_start,
      position: Number(row.position),
      product_id: row.product_id,
      product_name: row.product_name,
      sku: row.sku,
      units_sold: Number(row.units_sold),
      revenue: Number(row.revenue)
    }))
  };
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
  if (payload.payment_method === "cash") {
    const cashReceived = Number(payload.cash_received);
    if (!payload.cash_received && payload.cash_received !== 0) {
      throw new ApiError(400, "Cash received is required for cash sales");
    }
    if (Number.isNaN(cashReceived) || cashReceived <= 0) {
      throw new ApiError(400, "Cash received must be greater than zero");
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
    const cashReceived = payload.payment_method === "cash" ? Number(payload.cash_received) : null;
    if (payload.payment_method === "cash" && cashReceived < total) {
      throw new ApiError(400, "Cash received must cover the sale total");
    }
    const balanceDue = payload.payment_method === "credit" ? Math.max(total - initialPayment, 0) : 0;
    const customerName = payload.customer?.name?.trim() || null;
    const customerPhone = payload.customer?.phone?.trim() || null;
    let invoiceData = saleType === "invoice" ? payload.invoice_data || {} : {};
    let companyProfile = null;
    let stampMovement = null;
    let stampSnapshot = {};
    let transferSnapshot = {};
    let invoiceStatus = "not_requested";
    let stampStatus = "not_applicable";

    if (payload.payment_method === "transfer") {
      companyProfile = await getActiveCompanyProfile(client);
      transferSnapshot = companyProfile
        ? {
            bank: companyProfile.bank_name || null,
            clabe: companyProfile.bank_clabe || null,
            beneficiary: companyProfile.bank_beneficiary || null
          }
        : {};
    }

    if (saleType === "invoice") {
      companyProfile = companyProfile || await getActiveCompanyProfile(client);
      if (!hasCompleteFiscalProfile(companyProfile)) {
        throw new ApiError(409, "Fiscal profile is incomplete");
      }
      if (Number(companyProfile.stamps_available || 0) <= 0) {
        throw new ApiError(409, "No invoice stamps available");
      }

      invoiceData = {
        ...invoiceData,
        company_profile: {
          id: companyProfile.id,
          rfc: companyProfile.fiscal_rfc,
          razon_social: companyProfile.fiscal_business_name,
          regimen_fiscal: companyProfile.fiscal_regime,
          direccion_fiscal: companyProfile.fiscal_address,
          pac_provider: companyProfile.pac_provider,
          pac_mode: companyProfile.pac_mode
        }
      };

      stampSnapshot = {
        profile_id: companyProfile.id,
        balance_before: Number(companyProfile.stamps_available || 0),
        balance_after: Math.max(Number(companyProfile.stamps_available || 0) - 1, 0),
        used_before: Number(companyProfile.stamps_used || 0),
        used_after: Number(companyProfile.stamps_used || 0) + 1
      };

      const { rows: movementRows } = await client.query(
        `INSERT INTO company_stamp_movements (
          company_profile_id,
          movement_type,
          quantity,
          balance_before,
          balance_after,
          note,
          created_by
        )
        VALUES ($1, 'consume', 1, $2, $3, $4, $5)
        RETURNING *`,
        [
          companyProfile.id,
          stampSnapshot.balance_before,
          stampSnapshot.balance_after,
          "Prepared invoice stamp consumption for sale",
          user.id
        ]
      );
      stampMovement = movementRows[0];

      await client.query(
        `UPDATE company_profiles
         SET stamps_available = $1,
             stamps_used = $2,
             updated_by = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [
          stampSnapshot.balance_after,
          stampSnapshot.used_after,
          user.id,
          companyProfile.id
        ]
      );

      invoiceStatus = "pending";
      stampStatus = "consumed";
    }

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
        company_profile_id,
        transfer_snapshot,
        invoice_status,
        stamp_status,
        stamp_movement_id,
        stamp_snapshot,
        sale_date,
        sale_time,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_DATE, CURRENT_TIME, CURRENT_TIMESTAMP)
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
        payload.payment_method === "transfer" ? JSON.stringify(transferSnapshot) : "",
        companyProfile?.id || null,
        JSON.stringify(transferSnapshot),
        invoiceStatus,
        stampStatus,
        stampMovement?.id || null,
        JSON.stringify(stampSnapshot)
      ]
    );

    const sale = mapSaleRow(saleRows[0]);

    if (stampMovement?.id) {
      await client.query(
        `UPDATE company_stamp_movements
         SET related_sale_id = $1
         WHERE id = $2`,
        [sale.id, stampMovement.id]
      );
    }

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
    await ensureLowStockRemindersForProductIds(normalizedItems.map((item) => item.productId));
    await ensureAutomaticReminders();

    return {
      sale,
      warnings,
      receipt: {
        bank_details: payload.payment_method === "transfer" ? transferSnapshot : null,
        balance_due: balanceDue,
        invoice_status: invoiceStatus,
        stamp_status: stampStatus
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
  getSaleDetail,
  getSalesTrends,
  createSale
};
