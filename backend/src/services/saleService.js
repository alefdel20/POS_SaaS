const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { recomputeDailyCut } = require("./dailyCutService");
const { ensureAutomaticReminders, ensureLowStockRemindersForProductIds } = require("./reminderService");
const { requireActorBusinessId } = require("../utils/tenant");
const { getMexicoCityDate } = require("../utils/timezone");
const { createAdministrativeInvoiceFromSale } = require("./adminInvoiceService");
const { saveAuditLog } = require("./auditLogService");
const { emitActorAutomationEvent } = require("./automationEventService");
const { canUseCreditCollections } = require("../utils/business");

const INTEGER_UNITS = new Set(["pieza", "caja"]);
const FRACTIONAL_UNITS = new Set(["kg", "litro"]);

function roundToScale(value, scale) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) {
    throw new ApiError(400, "Invalid numeric value");
  }
  const factor = 10 ** scale;
  return Math.round((numericValue + Number.EPSILON) * factor) / factor;
}

function roundQuantity(value) {
  return roundToScale(value, 3);
}

function normalizeMoneyValue(value, fieldLabel, options = {}) {
  const allowNull = Boolean(options.allowNull);
  if (value === undefined || value === null || value === "") {
    if (allowNull) {
      return null;
    }
    return 0;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new ApiError(400, `${fieldLabel} must be a valid positive number`);
  }
  if (Math.abs(numericValue * 100000 - Math.round(numericValue * 100000)) > 1e-9) {
    throw new ApiError(400, `${fieldLabel} cannot exceed 5 decimals`);
  }
  return roundToScale(numericValue, 5);
}

function multiplyMoney(left, right) {
  return roundToScale(Number(left || 0) * Number(right || 0), 5);
}

function buildSaleAuditMetadata(actor, extra = {}) {
  if (!actor?.support_context) {
    return extra;
  }
  return {
    ...extra,
    is_support_mode: true,
    support_session_id: actor.support_context.session_id,
    support_actor_user_id: actor.support_context.actor_user_id,
    support_target_business_id: actor.support_context.business_id,
    support_reason: actor.support_context.reason
  };
}

function computeDiscountedPrice(product) {
  if (product.status !== "activo" || !product.discount_type || product.discount_value === null || !product.discount_start || !product.discount_end) return null;
  const now = new Date();
  const start = new Date(product.discount_start);
  const end = new Date(product.discount_end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || now < start || now > end) return null;
  if (product.discount_type === "percentage") return roundToScale(Math.max(Number(product.price) - Number(product.price) * (Number(product.discount_value) / 100), 0), 5);
  if (product.discount_type === "fixed") return roundToScale(Math.max(Number(product.price) - Number(product.discount_value), 0), 5);
  return null;
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseTransferNotes(notes) {
  try { return notes ? JSON.parse(notes) : {}; } catch { return {}; }
}

function mapSaleRow(row) {
  if (!row) return null;
  return {
    ...row,
    status: row.status || "completed",
    cancellation_reason: row.cancellation_reason || null,
    cancelled_by: row.cancelled_by || null,
    cancelled_at: row.cancelled_at || null,
    transfer_snapshot: row.transfer_snapshot || parseTransferNotes(row.notes),
    invoice_data: row.invoice_data || {},
    stamp_snapshot: row.stamp_snapshot || {},
    requires_administrative_invoice: Boolean(row.requires_administrative_invoice),
    items_summary: row.items_summary || ""
  };
}

function buildValidSaleStatusClause(alias = "sales") {
  return `COALESCE(${alias}.status, 'completed') <> 'cancelled'`;
}

function normalizeSaleUnit(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || "pieza";
}

function hasMoreThanThreeDecimals(value) {
  return Math.abs(Number(value) * 1000 - Math.round(Number(value) * 1000)) > 1e-9;
}

function formatQuantity(quantity, unit) {
  const numericValue = Number(quantity || 0);
  if (INTEGER_UNITS.has(unit)) {
    return String(Math.trunc(numericValue));
  }
  return String(roundQuantity(numericValue));
}

function buildItemsSummary(items = []) {
  return items
    .map((item) => `${formatQuantity(item.quantity, item.unidad_de_venta || "pieza")} ${item.unidad_de_venta || "pieza"} ${item.product_name}`)
    .join(", ");
}

function validateSaleQuantity(quantity, unit) {
  const numericValue = Number(quantity);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new ApiError(400, "Quantity must be greater than zero");
  }
  if (INTEGER_UNITS.has(unit) && !Number.isInteger(numericValue)) {
    throw new ApiError(400, `Quantity must be an integer for ${unit}`);
  }
  if (FRACTIONAL_UNITS.has(unit) && hasMoreThanThreeDecimals(numericValue)) {
    throw new ApiError(400, `Quantity cannot exceed 3 decimals for ${unit}`);
  }
  return roundQuantity(numericValue);
}

function appendBusinessScope(filters, actor, alias = "sales") {
  filters.values.push(requireActorBusinessId(actor));
  filters.conditions.push(`${alias}.business_id = $${filters.values.length}`);
}

function buildSaleFilters(filters = {}, actor) {
  const state = { conditions: [], values: [] };
  appendBusinessScope(state, actor);
  const add = (sql, value) => { state.values.push(value); state.conditions.push(sql.replace("?", `$${state.values.length}`)); };
  if (filters.date) add("sales.sale_date = ?::date", filters.date);
  if (filters.date_from) add("sales.sale_date >= ?::date", filters.date_from);
  if (filters.date_to) add("sales.sale_date <= ?::date", filters.date_to);
  if (filters.user_id) add("sales.user_id = ?", Number(filters.user_id));
  if (filters.cashier) add("users.full_name ILIKE ?", `%${String(filters.cashier).trim()}%`);
  if (filters.payment_method) add("sales.payment_method = ?", filters.payment_method);
  if (filters.folio) add("CAST(sales.id AS TEXT) ILIKE ?", `%${String(filters.folio).trim()}%`);
  const totalMin = normalizeNumber(filters.total_min);
  if (totalMin !== null) add("sales.total >= ?", totalMin);
  const totalMax = normalizeNumber(filters.total_max);
  if (totalMax !== null) add("sales.total <= ?", totalMax);
  if (filters.total !== undefined && filters.total !== null && filters.total !== "") add("sales.total = ?", Number(filters.total));
  return { whereClause: state.conditions.length ? `WHERE ${state.conditions.join(" AND ")}` : "", values: state.values };
}

async function getActiveCompanyProfile(actor, client = pool) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await client.query(
    `SELECT *
     FROM company_profiles
     WHERE profile_key = 'default' AND is_active = TRUE AND business_id = $1
     LIMIT 1`,
    [businessId]
  );
  return rows[0] || null;
}

function hasCompleteFiscalProfile(profile) {
  return Boolean(profile && profile.fiscal_rfc && profile.fiscal_business_name && profile.fiscal_regime && profile.fiscal_address);
}

async function listSales(filters = {}, actor) {
  const { whereClause, values } = buildSaleFilters(filters, actor);
  const { rows } = await pool.query(
    `SELECT sales.*, users.full_name AS cashier_name,
            COALESCE(items_summary.summary, '') AS items_summary
     FROM sales
     INNER JOIN users ON users.id = sales.user_id AND users.business_id = sales.business_id
     LEFT JOIN LATERAL (
       SELECT STRING_AGG(
         CONCAT(
           CASE
             WHEN COALESCE(si.unidad_de_venta, p.unidad_de_venta, 'pieza') IN ('pieza', 'caja')
               THEN TRUNC(si.quantity)::text
             ELSE TO_CHAR(si.quantity, 'FM999999990.000')
           END,
           ' ',
           COALESCE(si.unidad_de_venta, p.unidad_de_venta, 'pieza'),
           ' ',
           p.name
         ),
         ', '
         ORDER BY si.id
       ) AS summary
       FROM sale_items si
       INNER JOIN products p ON p.id = si.product_id AND p.business_id = si.business_id
       WHERE si.sale_id = sales.id AND si.business_id = sales.business_id
     ) items_summary ON TRUE
     ${whereClause}
     ORDER BY sales.created_at DESC`,
    values
  );
  return rows.map(mapSaleRow);
}

async function listRecentSales(actor) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `SELECT sales.*, users.full_name AS cashier_name,
            COALESCE(items_summary.summary, '') AS items_summary
     FROM sales
     INNER JOIN users ON users.id = sales.user_id AND users.business_id = sales.business_id
     LEFT JOIN LATERAL (
       SELECT STRING_AGG(
         CONCAT(
           CASE
             WHEN COALESCE(si.unidad_de_venta, p.unidad_de_venta, 'pieza') IN ('pieza', 'caja')
               THEN TRUNC(si.quantity)::text
             ELSE TO_CHAR(si.quantity, 'FM999999990.000')
           END,
           ' ',
           COALESCE(si.unidad_de_venta, p.unidad_de_venta, 'pieza'),
           ' ',
           p.name
         ),
         ', '
         ORDER BY si.id
       ) AS summary
       FROM sale_items si
       INNER JOIN products p ON p.id = si.product_id AND p.business_id = si.business_id
       WHERE si.sale_id = sales.id AND si.business_id = sales.business_id
     ) items_summary ON TRUE
     WHERE sales.business_id = $1
       AND ${buildValidSaleStatusClause("sales")}
     ORDER BY sales.created_at DESC
     LIMIT 10`,
    [businessId]
  );
  return rows.map(mapSaleRow);
}

async function getSaleDetail(saleId, actor) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `SELECT sales.*, users.full_name AS cashier_name, users.username AS cashier_username
     FROM sales
     INNER JOIN users ON users.id = sales.user_id AND users.business_id = sales.business_id
     WHERE sales.id = $1 AND sales.business_id = $2`,
    [saleId, businessId]
  );
  const sale = mapSaleRow(rows[0]);
  if (!sale) throw new ApiError(404, "Sale not found");

  const { rows: itemRows } = await pool.query(
    `SELECT sale_items.id, sale_items.product_id, products.name AS product_name, products.sku, sale_items.quantity, sale_items.unit_price, sale_items.subtotal,
            COALESCE(sale_items.unidad_de_venta, products.unidad_de_venta, 'pieza') AS unidad_de_venta
     FROM sale_items
     INNER JOIN products ON products.id = sale_items.product_id AND products.business_id = sale_items.business_id
     WHERE sale_items.sale_id = $1 AND sale_items.business_id = $2
     ORDER BY sale_items.id ASC`,
    [saleId, sale.business_id]
  );
  const { rows: paymentRows } = await pool.query(
    `SELECT id, payment_date, amount, payment_method, notes, created_at
     FROM credit_payments
     WHERE sale_id = $1 AND business_id = $2
     ORDER BY payment_date ASC, id ASC`,
    [saleId, sale.business_id]
  );

  return {
    ...sale,
    folio: sale.id,
    user: { id: sale.user_id, full_name: sale.cashier_name, username: sale.cashier_username },
    credit_info: sale.payment_method === "credit" ? {
      customer_name: sale.customer_name,
      customer_phone: sale.customer_phone,
      initial_payment: Number(sale.initial_payment || 0),
      balance_due: Number(sale.balance_due || 0),
      payments: paymentRows.map((payment) => ({ ...payment, amount: Number(payment.amount) }))
    } : null,
    transfer_info: sale.payment_method === "transfer" ? sale.transfer_snapshot : null,
    invoice_info: sale.sale_type === "invoice" ? {
      status: sale.invoice_status,
      stamp_status: sale.stamp_status,
      stamp_snapshot: sale.stamp_snapshot,
      invoice_data: sale.invoice_data
    } : null,
    items_summary: buildItemsSummary(itemRows),
    items: itemRows.map((item) => ({
      ...item,
      unidad_de_venta: item.unidad_de_venta || "pieza",
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      subtotal: Number(item.subtotal)
    }))
  };
}

async function getSalesTrends(period, actor) {
  const periods = { week: { label: "week", trunc: "week", interval: "12 weeks" }, month: { label: "month", trunc: "month", interval: "12 months" }, year: { label: "year", trunc: "year", interval: "5 years" } };
  const selected = periods[period];
  if (!selected) throw new ApiError(400, "Invalid trend period");
  const params = [requireActorBusinessId(actor)];
  const { rows } = await pool.query(
    `WITH aggregated AS (
       SELECT DATE_TRUNC('${selected.trunc}', sales.sale_date::timestamp)::date AS period_start,
              sale_items.product_id,
              products.name AS product_name,
              products.sku,
              SUM(sale_items.quantity) AS units_sold,
              SUM(sale_items.subtotal) AS revenue
       FROM sale_items
       INNER JOIN sales ON sales.id = sale_items.sale_id AND sales.business_id = sale_items.business_id
       INNER JOIN products ON products.id = sale_items.product_id AND products.business_id = sale_items.business_id
       WHERE sales.sale_date >= CURRENT_DATE - INTERVAL '${selected.interval}'
         AND sales.business_id = $1
         AND ${buildValidSaleStatusClause("sales")}
       GROUP BY DATE_TRUNC('${selected.trunc}', sales.sale_date::timestamp)::date, sale_items.product_id, products.name, products.sku
     ),
     ranked AS (
       SELECT aggregated.*, ROW_NUMBER() OVER (PARTITION BY aggregated.period_start ORDER BY aggregated.units_sold DESC, aggregated.revenue DESC, aggregated.product_id ASC) AS position
       FROM aggregated
     )
     SELECT * FROM ranked WHERE position <= 10 ORDER BY period_start DESC, position ASC`,
    params
  );
  return { period: selected.label, items: rows.map((row) => ({ ...row, position: Number(row.position), units_sold: Number(row.units_sold), revenue: Number(row.revenue) })) };
}

async function createSale(payload, user) {
  if (!payload.items?.length) throw new ApiError(400, "Sale requires at least one item");
  if (payload.payment_method === "credit" && !canUseCreditCollections(user?.pos_type)) throw new ApiError(409, "Credit sales are not available for this business type");
  if (payload.payment_method === "credit" && !payload.customer?.name?.trim()) throw new ApiError(400, "Customer name is required for credit sales");
  if (payload.payment_method === "credit" && !payload.customer?.phone?.trim()) throw new ApiError(400, "Customer phone is required for credit sales");
  if (payload.payment_method === "credit" && (payload.initial_payment === undefined || Number(payload.initial_payment) < 0)) throw new ApiError(400, "Initial payment is required for credit sales");
  if (payload.payment_method === "cash") {
    const cashReceived = Number(payload.cash_received);
    if ((payload.cash_received !== 0 && !payload.cash_received) || Number.isNaN(cashReceived) || cashReceived <= 0) throw new ApiError(400, "Cash received must be greater than zero");
  }

  const businessId = requireActorBusinessId(user);
  const prescriptionId = payload.prescription_id ? Number(payload.prescription_id) : null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let prescriptionSnapshot = null;
    if (prescriptionId) {
      const { rows: prescriptionRows } = await client.query(
        `SELECT mp.id, mp.patient_id, mp.status
         FROM medical_prescriptions mp
         WHERE mp.id = $1 AND mp.business_id = $2`,
        [prescriptionId, businessId]
      );
      if (!prescriptionRows[0]) throw new ApiError(404, "Prescription not found");
      prescriptionSnapshot = prescriptionRows[0];
    }
    const productIds = payload.items.map((item) => item.product_id);
    const { rows: productRows } = await client.query(
      `WITH sales_30 AS (
         SELECT si.product_id, COALESCE(SUM(si.quantity), 0) AS recent_units_sold
         FROM sale_items si
         INNER JOIN sales s ON s.id = si.sale_id AND s.business_id = si.business_id
         WHERE s.business_id = $2
           AND COALESCE(s.status, 'completed') <> 'cancelled'
         GROUP BY si.product_id
       )
       SELECT products.*, COALESCE(sales_30.recent_units_sold, 0) AS recent_units_sold
       FROM products
       LEFT JOIN sales_30 ON sales_30.product_id = products.id
       WHERE products.id = ANY($1::int[]) AND products.business_id = $2`,
      [productIds, businessId]
    );
    const productsMap = new Map(productRows.map((product) => [product.id, product]));
    const warnings = [];
    const normalizedItems = [];
    let total = 0;
    let totalCost = 0;

    for (const item of payload.items) {
      const product = productsMap.get(item.product_id);
      if (!product) throw new ApiError(404, `Product ${item.product_id} not found`);
      if (!product.is_active || product.status !== "activo") throw new ApiError(409, "Producto inactivo, contactar proveedor");
      const unit = normalizeSaleUnit(product.unidad_de_venta);
      const quantity = validateSaleQuantity(item.quantity, unit);
      if (Number(product.stock) < quantity) warnings.push(`Insufficient stock for ${product.name}. Current stock: ${product.stock}`);

      const nearExpiry = Boolean(product.expires_at) && new Date(product.expires_at) <= new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      const activeDiscountPrice = computeDiscountedPrice(product);
      const effectivePrice = activeDiscountPrice !== null
        ? activeDiscountPrice
        : product.liquidation_price !== null && (Number(product.recent_units_sold || 0) <= 2 || nearExpiry)
          ? product.liquidation_price
          : product.price;
      const unitPrice = normalizeMoneyValue(item.unit_price ?? effectivePrice, "Unit price");
      const unitCost = normalizeMoneyValue(product.cost_price || 0, "Unit cost");
      const subtotal = multiplyMoney(unitPrice, quantity);
      total = roundToScale(total + subtotal, 5);
      totalCost = roundToScale(totalCost + multiplyMoney(unitCost, quantity), 5);
      normalizedItems.push({ productId: product.id, quantity, unitPrice, unitCost, subtotal, unidadDeVenta: unit, productName: product.name });
    }

    const saleType = payload.sale_type || "ticket";
    const requiresAdministrativeInvoice = Boolean(payload.requires_administrative_invoice);
    const initialPayment = normalizeMoneyValue(payload.initial_payment || 0, "Initial payment");
    const cashReceived = payload.payment_method === "cash" ? normalizeMoneyValue(payload.cash_received, "Cash received") : null;
    if (payload.payment_method === "cash" && cashReceived < total) throw new ApiError(400, "Cash received must cover the sale total");
    const balanceDue = payload.payment_method === "credit" ? roundToScale(Math.max(total - initialPayment, 0), 5) : 0;
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
      companyProfile = await getActiveCompanyProfile(user, client);
      transferSnapshot = companyProfile ? { bank: companyProfile.bank_name || null, clabe: companyProfile.bank_clabe || null, beneficiary: companyProfile.bank_beneficiary || null } : {};
    }
    if (saleType === "invoice" && !requiresAdministrativeInvoice) {
      companyProfile = companyProfile || await getActiveCompanyProfile(user, client);
      if (!hasCompleteFiscalProfile(companyProfile)) throw new ApiError(409, "Fiscal profile is incomplete");
      if (Number(companyProfile.stamps_available || 0) <= 0) throw new ApiError(409, "No invoice stamps available");
      invoiceData = { ...invoiceData, company_profile: { id: companyProfile.id, rfc: companyProfile.fiscal_rfc, razon_social: companyProfile.fiscal_business_name, regimen_fiscal: companyProfile.fiscal_regime, direccion_fiscal: companyProfile.fiscal_address, pac_provider: companyProfile.pac_provider, pac_mode: companyProfile.pac_mode } };
      stampSnapshot = { profile_id: companyProfile.id, balance_before: Number(companyProfile.stamps_available || 0), balance_after: Math.max(Number(companyProfile.stamps_available || 0) - 1, 0), used_before: Number(companyProfile.stamps_used || 0), used_after: Number(companyProfile.stamps_used || 0) + 1 };
      const { rows: movementRows } = await client.query(
        `INSERT INTO company_stamp_movements (company_profile_id, movement_type, quantity, balance_before, balance_after, note, created_by, business_id)
         VALUES ($1, 'consume', 1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [companyProfile.id, stampSnapshot.balance_before, stampSnapshot.balance_after, "Prepared invoice stamp consumption for sale", user.id, businessId]
      );
      stampMovement = movementRows[0];
      await client.query(
        `UPDATE company_profiles
         SET stamps_available = $1, stamps_used = $2, updated_by = $3, updated_at = NOW()
         WHERE id = $4 AND business_id = $5`,
        [stampSnapshot.balance_after, stampSnapshot.used_after, user.id, companyProfile.id, businessId]
      );
      invoiceStatus = "pending";
      stampStatus = "consumed";
    }

    const safeSaleTime = new Date().toISOString().split("T")[1].split(".")[0];
    const { rows: saleRows } = await client.query(
      `INSERT INTO sales (
        user_id, business_id, payment_method, sale_type, subtotal, total, total_cost, customer_name, customer_phone,
        initial_payment, balance_due, invoice_data, notes, company_profile_id, transfer_snapshot, invoice_status,
        stamp_status, stamp_movement_id, stamp_snapshot, sale_date, sale_time, created_at, requires_administrative_invoice, status
      )
      VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, CURRENT_TIMESTAMP, $21, 'completed')
      RETURNING *`,
      [user.id, businessId, payload.payment_method || "cash", saleType, total, totalCost, customerName, customerPhone, initialPayment, balanceDue, JSON.stringify(invoiceData), payload.notes || "", companyProfile?.id || null, JSON.stringify(transferSnapshot), invoiceStatus, stampStatus, stampMovement?.id || null, JSON.stringify(stampSnapshot), getMexicoCityDate(), safeSaleTime, requiresAdministrativeInvoice]
    );
    const sale = mapSaleRow(saleRows[0]);

    if (stampMovement?.id) {
      await client.query("UPDATE company_stamp_movements SET related_sale_id = $1 WHERE id = $2 AND business_id = $3", [sale.id, stampMovement.id, businessId]);
    }

    for (const item of normalizedItems) {
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, business_id, quantity, unit_price, unit_cost, subtotal, unidad_de_venta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [sale.id, item.productId, businessId, item.quantity, item.unitPrice, item.unitCost, item.subtotal, item.unidadDeVenta]
      );
      await client.query("UPDATE products SET stock = stock - $1 WHERE id = $2 AND business_id = $3", [item.quantity, item.productId, businessId]);
    }

    if (requiresAdministrativeInvoice) {
      const administrativeInvoice = await createAdministrativeInvoiceFromSale({
        client,
        actor: user,
        sale,
        items: normalizedItems.map((item) => ({
          product_id: item.productId,
          product_name: item.productName,
          quantity: item.quantity,
          unidad_de_venta: item.unidadDeVenta,
          unit_price: item.unitPrice,
          subtotal: item.subtotal
        })),
        customer: {
          customer_name: customerName,
          rfc: payload.invoice_data?.client?.rfc || "",
          email: payload.invoice_data?.client?.correo || "",
          phone: payload.invoice_data?.client?.telefono || customerPhone || "",
          fiscal_regime: payload.invoice_data?.client?.regimen_fiscal || "",
          fiscal_data: payload.invoice_data?.client || {},
          observations: payload.notes || ""
        }
      });

      await client.query(
        "UPDATE sales SET administrative_invoice_id = $1 WHERE id = $2 AND business_id = $3",
        [administrativeInvoice.id, sale.id, businessId]
      );
      sale.administrative_invoice_id = administrativeInvoice.id;
    }

    if (prescriptionId) {
      await client.query(
        `INSERT INTO sale_prescription_links (business_id, prescription_id, sale_id, created_by)
         VALUES ($1, $2, $3, $4)`,
        [businessId, prescriptionId, sale.id, user.id]
      );
    }

    await emitActorAutomationEvent(user, "sale_created", {
      sale_id: sale.id,
      payment_method: sale.payment_method,
      sale_type: sale.sale_type,
      total: Number(sale.total || total),
      total_cost: Number(sale.total_cost || totalCost),
      balance_due: Number(sale.balance_due || balanceDue),
      items_count: normalizedItems.length,
      requires_administrative_invoice: Boolean(requiresAdministrativeInvoice)
    }, { client });

    await client.query("COMMIT");
    await recomputeDailyCut(sale.sale_date, user);
    await ensureLowStockRemindersForProductIds(normalizedItems.map((item) => item.productId), user);
    await ensureAutomaticReminders(user);

    sale.requires_administrative_invoice = requiresAdministrativeInvoice;
    await saveAuditLog({
      business_id: businessId,
      usuario_id: user.id,
      modulo: "sales",
      accion: "create_sale",
      entidad_tipo: "sale",
      entidad_id: sale.id,
      detalle_anterior: {},
      detalle_nuevo: {
        entity: "sale",
        entity_id: sale.id,
        snapshot: {
          ...sale,
          items: normalizedItems.map((item) => ({
            product_id: item.productId,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            unit_cost: item.unitCost,
            subtotal: item.subtotal,
            unidad_de_venta: item.unidadDeVenta
          }))
        },
        version: 1
      },
      motivo: user?.support_context?.reason || payload.notes || "",
      metadata: buildSaleAuditMetadata(user, { warnings_count: warnings.length, prescription_id: prescriptionId || null })
    }, { strict: false });
    if (prescriptionId) {
      await saveAuditLog({
        business_id: businessId,
        usuario_id: user.id,
        modulo: "clinical",
        accion: "generate_sale_from_prescription",
        entidad_tipo: "medical_prescription",
        entidad_id: prescriptionId,
        detalle_nuevo: { sale_id: sale.id },
        metadata: { patient_id: prescriptionSnapshot?.patient_id || null }
      }, { strict: false });
    }
    return { sale, warnings, receipt: { bank_details: payload.payment_method === "transfer" ? transferSnapshot : null, balance_due: balanceDue, invoice_status: invoiceStatus, stamp_status: stampStatus } };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cancelSale(saleId, reason, actor) {
  const businessId = requireActorBusinessId(actor);
  const trimmedReason = String(reason || "").trim();
  if (!trimmedReason) throw new ApiError(400, "Cancellation reason is required");

  const today = getMexicoCityDate();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows: saleRows } = await client.query(
      `SELECT *
       FROM sales
       WHERE id = $1 AND business_id = $2
       FOR UPDATE`,
      [saleId, businessId]
    );
    const sale = saleRows[0];
    if (!sale) throw new ApiError(404, "Sale not found");
    if ((sale.status || "completed") === "cancelled") throw new ApiError(409, "Sale is already cancelled");
    if (sale.sale_date !== today) {
      throw new ApiError(409, "Only current day sales can be cancelled");
    }

    const { rows: paymentRows } = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM credit_payments
       WHERE sale_id = $1 AND business_id = $2`,
      [saleId, businessId]
    );
    if (Number(paymentRows[0]?.total || 0) > 0) {
      throw new ApiError(409, "Sale already has credit payments and cannot be cancelled");
    }

    const { rows: itemRows } = await client.query(
      `SELECT id, product_id, quantity, unidad_de_venta
       FROM sale_items
       WHERE sale_id = $1 AND business_id = $2
       ORDER BY id ASC`,
      [saleId, businessId]
    );

    for (const item of itemRows) {
      await client.query(
        `UPDATE products
         SET stock = stock + $1, updated_at = NOW()
         WHERE id = $2 AND business_id = $3`,
        [item.quantity, item.product_id, businessId]
      );
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE sales
       SET status = 'cancelled',
           cancellation_reason = $1,
           cancelled_by = $2,
           cancelled_at = NOW()
       WHERE id = $3
         AND business_id = $4
         AND COALESCE(status, 'completed') <> 'cancelled'
       RETURNING *`,
      [trimmedReason, actor.id, saleId, businessId]
    );
    const updatedSale = updatedRows[0];
    if (!updatedSale) {
      throw new ApiError(409, "Sale could not be cancelled");
    }

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "sales",
      accion: "cancel_sale",
      entidad_tipo: "sale",
      entidad_id: saleId,
      detalle_anterior: { entity: "sale", entity_id: saleId, snapshot: mapSaleRow(sale), version: 1 },
      detalle_nuevo: { entity: "sale", entity_id: saleId, snapshot: mapSaleRow(updatedSale), restored_items: itemRows, version: 1 },
      motivo: trimmedReason,
      metadata: buildSaleAuditMetadata(actor, { restored_stock_items: itemRows.length })
    }, { client });

    await client.query("COMMIT");
    await recomputeDailyCut(updatedSale.sale_date, actor);
    return mapSaleRow(updatedSale);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { listSales, listRecentSales, getSaleDetail, getSalesTrends, createSale, cancelSale, buildValidSaleStatusClause };
