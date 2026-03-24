const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");
const { buildStoredImagePath, deleteStoredImage } = require("../utils/productImages");

const SKU_CONFUSING_CHARACTERS = { O: "0", I: "1" };
const SALE_UNITS = ["pieza", "kg", "litro", "caja"];
const INTEGER_UNITS = new Set(["pieza", "caja"]);
const FRACTIONAL_UNITS = new Set(["kg", "litro"]);

function stripAccents(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeAlphaNumeric(value) {
  return stripAccents(value).toUpperCase().replace(/[^A-Z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeGeneratedSkuSegment(value, maxLength = 4) {
  return normalizeAlphaNumeric(value)
    .replace(/\b(DE|DEL|LA|LAS|LOS|PARA|CON|SIN|Y|EN)\b/g, " ")
    .replace(/\s+/g, "")
    .replace(/[OI]/g, (character) => SKU_CONFUSING_CHARACTERS[character] || character)
    .slice(0, maxLength);
}

function sanitizeBarcode(value) {
  return stripAccents(value).replace(/\D/g, "").trim();
}

function sanitizeManualSku(value) {
  return normalizeAlphaNumeric(value).replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 60);
}

function pickSkuSegments(payload) {
  const brandSource = payload.brand || payload.marca || payload.supplier_name || payload.category || "";
  const nameTokens = normalizeAlphaNumeric(payload.name).split(" ").filter(Boolean);
  const categorySegment = normalizeGeneratedSkuSegment(payload.category, 4);
  const brandSegment = normalizeGeneratedSkuSegment(brandSource, 4);
  const primaryNameSegment = normalizeGeneratedSkuSegment(nameTokens[0] || payload.name, 4);
  const attributeSegment = normalizeGeneratedSkuSegment(nameTokens[1] || nameTokens[2] || "", 4);
  return [brandSegment, categorySegment || primaryNameSegment, attributeSegment || primaryNameSegment].filter(Boolean);
}

function normalizeDiscountFields(payload) {
  return {
    discount_type: payload.discount_type || null,
    discount_value: payload.discount_value === undefined || payload.discount_value === null || payload.discount_value === "" ? null : Number(payload.discount_value),
    discount_start: payload.discount_start || null,
    discount_end: payload.discount_end || null
  };
}

function normalizeSaleUnit(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "pieza";
  if (!SALE_UNITS.includes(normalized)) throw new ApiError(400, "Invalid sale unit");
  return normalized;
}

function roundToThree(value) {
  return Number(Number(value || 0).toFixed(3));
}

function hasMoreThanThreeDecimals(value) {
  return Math.abs(Number(value) * 1000 - Math.round(Number(value) * 1000)) > 1e-9;
}

function validateQuantityByUnit(value, unit, fieldLabel) {
  const numericValue = Number(value);
  if (Number.isNaN(numericValue) || numericValue < 0) {
    throw new ApiError(400, `${fieldLabel} must be a valid positive number`);
  }

  if (INTEGER_UNITS.has(unit) && !Number.isInteger(numericValue)) {
    throw new ApiError(400, `${fieldLabel} must be an integer for ${unit}`);
  }

  if (FRACTIONAL_UNITS.has(unit) && hasMoreThanThreeDecimals(numericValue)) {
    throw new ApiError(400, `${fieldLabel} cannot exceed 3 decimals for ${unit}`);
  }

  return roundToThree(numericValue);
}

function normalizeGainPercentage(payload, currentProduct = null) {
  const rawValue = payload.porcentaje_ganancia ?? currentProduct?.porcentaje_ganancia ?? null;
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return null;
  }

  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue)) {
    throw new ApiError(400, "Invalid profit percentage");
  }

  return roundToThree(numericValue);
}

function normalizeListOptions(search, options) {
  if (options && typeof options === "object" && !Array.isArray(options)) {
    return {
      search: search || "",
      activeOnly: Boolean(options.activeOnly),
      page: options.page ? Number(options.page) : null,
      pageSize: options.pageSize ? Number(options.pageSize) : null
    };
  }
  return { search: search || "", activeOnly: Boolean(options), page: null, pageSize: null };
}

function normalizeSupplierEntries(payload) {
  if (Array.isArray(payload.suppliers)) {
    return payload.suppliers
      .map((supplier, index) => ({
        supplier_id: supplier?.supplier_id ? Number(supplier.supplier_id) : null,
        supplier_name: supplier?.supplier_name?.trim() || "",
        supplier_email: supplier?.supplier_email?.trim() || null,
        supplier_phone: supplier?.supplier_phone?.trim() || null,
        supplier_whatsapp: supplier?.supplier_whatsapp?.trim() || null,
        supplier_observations: supplier?.supplier_observations?.trim() || "",
        purchase_cost: supplier?.purchase_cost === undefined || supplier?.purchase_cost === null || supplier?.purchase_cost === "" ? null : Number(supplier.purchase_cost),
        is_primary: Boolean(supplier?.is_primary) || index === 0
      }))
      .filter((supplier) => supplier.supplier_id || supplier.supplier_name);
  }

  if (payload.supplier_id || payload.supplier_name) {
    return [{
      supplier_id: payload.supplier_id ? Number(payload.supplier_id) : null,
      supplier_name: payload.supplier_name?.trim() || "",
      supplier_email: payload.supplier_email?.trim() || null,
      supplier_phone: payload.supplier_phone?.trim() || null,
      supplier_whatsapp: payload.supplier_whatsapp?.trim() || null,
      supplier_observations: payload.supplier_observations?.trim() || "",
      purchase_cost: payload.cost_price === undefined || payload.cost_price === null || payload.cost_price === "" ? null : Number(payload.cost_price),
      is_primary: true
    }];
  }

  return [];
}

function validateCoreProductData(payload, currentProduct = null) {
  const name = payload.name ?? currentProduct?.name;
  const category = payload.category ?? currentProduct?.category;
  const price = payload.price ?? currentProduct?.price;
  const costPrice = payload.cost_price ?? currentProduct?.cost_price ?? 0;
  const stock = payload.stock ?? currentProduct?.stock ?? 0;
  const stockMinimo = payload.stock_minimo ?? currentProduct?.stock_minimo ?? 0;
  const fallbackStockMaximo = Math.max(Number(stock || 0), Number(stockMinimo || 0), Number(currentProduct?.stock_maximo || 0));
  const stockMaximo = payload.stock_maximo ?? currentProduct?.stock_maximo ?? fallbackStockMaximo;
  const unidadDeVenta = normalizeSaleUnit(payload.unidad_de_venta ?? currentProduct?.unidad_de_venta);
  const normalizedStock = validateQuantityByUnit(stock, unidadDeVenta, "Product stock");
  const normalizedStockMinimo = validateQuantityByUnit(stockMinimo, unidadDeVenta, "Product minimum stock");
  const normalizedStockMaximo = validateQuantityByUnit(stockMaximo, unidadDeVenta, "Product maximum stock");
  const porcentajeGanancia = normalizeGainPercentage(payload, currentProduct);

  if (!String(name || "").trim()) throw new ApiError(400, "Product name is required");
  if (!String(category || "").trim()) throw new ApiError(400, "Product category is required");
  if (Number(price) <= 0) throw new ApiError(400, "Product price must be greater than zero");
  if (Number(costPrice) < 0) throw new ApiError(400, "Product cost cannot be negative");
  if (normalizedStock < 0) throw new ApiError(400, "Product stock cannot be negative");
  if (normalizedStockMinimo < 0) throw new ApiError(400, "Product minimum stock cannot be negative");
  if (normalizedStockMaximo < 0) throw new ApiError(400, "Product maximum stock cannot be negative");
  if (normalizedStockMaximo < normalizedStockMinimo) throw new ApiError(400, "Product maximum stock cannot be lower than minimum stock");

  return {
    stock: normalizedStock,
    stockMinimo: normalizedStockMinimo,
    stockMaximo: normalizedStockMaximo,
    unidadDeVenta,
    porcentajeGanancia
  };
}

async function ensureUniqueSku(baseSku, businessId, excludeProductId = null, client = pool) {
  const normalizedBase = sanitizeManualSku(baseSku).replace(/^-+|-+$/g, "");
  const compactBase = normalizedBase.slice(0, 12) || "ITEM000";
  const { rows } = await client.query(
    `SELECT sku
     FROM products
     WHERE business_id = $1
       AND UPPER(sku) LIKE UPPER($2)
       AND ($3::int IS NULL OR id <> $3)`,
    [businessId, `${compactBase}%`, excludeProductId]
  );
  const existing = new Set(rows.map((row) => String(row.sku || "").toUpperCase()));
  if (!existing.has(compactBase.toUpperCase())) return compactBase;
  for (let sequence = 1; sequence <= 99; sequence += 1) {
    const suffix = String(sequence).padStart(2, "0");
    const candidate = `${compactBase.slice(0, Math.max(12 - suffix.length, 6))}${suffix}`;
    if (!existing.has(candidate.toUpperCase())) return candidate;
  }
  throw new ApiError(409, "Unable to generate unique SKU");
}

async function resolveSku(payload, businessId, currentProduct = null, client = pool) {
  const manualSku = sanitizeManualSku(payload.sku || "");
  if (manualSku) {
    const { rows } = await client.query(
      `SELECT id
       FROM products
       WHERE business_id = $1
         AND UPPER(sku) = UPPER($2)
         AND ($3::int IS NULL OR id <> $3)
       LIMIT 1`,
      [businessId, manualSku, currentProduct?.id || null]
    );
    if (rows[0]) throw new ApiError(409, "SKU already exists");
    return manualSku;
  }

  const baseSku = pickSkuSegments({ ...currentProduct, ...payload }).join("-").slice(0, 12)
    || normalizeGeneratedSkuSegment(payload.name || currentProduct?.name || "ITEM", 8);
  return ensureUniqueSku(baseSku, businessId, currentProduct?.id || null, client);
}

async function ensureUniqueBarcode(barcode, businessId, excludeProductId = null, client = pool) {
  const normalizedBarcode = sanitizeBarcode(barcode);
  if (!normalizedBarcode) throw new ApiError(400, "Barcode is required");
  const { rows } = await client.query(
    `SELECT id
     FROM products
     WHERE business_id = $1
       AND UPPER(barcode) = UPPER($2)
       AND ($3::int IS NULL OR id <> $3)
     LIMIT 1`,
    [businessId, normalizedBarcode, excludeProductId]
  );
  if (rows[0]) throw new ApiError(409, "Barcode already exists");
  return normalizedBarcode;
}

async function generateUniqueBarcode(businessId, excludeProductId = null, client = pool) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const entropy = `${Date.now()}${Math.floor(Math.random() * 1e6).toString().padStart(6, "0")}`;
    const candidate = entropy.slice(-13);
    try {
      return await ensureUniqueBarcode(candidate, businessId, excludeProductId, client);
    } catch (error) {
      if (!(error instanceof ApiError) || error.statusCode !== 409) {
        throw error;
      }
    }
  }

  throw new ApiError(409, "Unable to generate unique barcode");
}

async function ensureSupplierReference(payload, businessId, client = pool) {
  const supplierId = payload.supplier_id ? Number(payload.supplier_id) : null;
  const supplierName = payload.supplier_name?.trim();
  const supplierEmail = payload.supplier_email?.trim() || null;
  const supplierPhone = payload.supplier_phone?.trim() || null;
  const supplierWhatsapp = payload.supplier_whatsapp?.trim() || null;
  const supplierObservations = payload.supplier_observations?.trim() || "";

  if (supplierId) {
    const { rows } = await client.query("SELECT * FROM suppliers WHERE id = $1 AND business_id = $2", [supplierId, businessId]);
    if (!rows[0]) throw new ApiError(404, "Supplier not found");
    if (supplierName || supplierEmail || supplierPhone || supplierWhatsapp || supplierObservations) {
      await client.query(
        `UPDATE suppliers
         SET name = $1, email = $2, phone = $3, whatsapp = $4, observations = $5, updated_at = NOW()
         WHERE id = $6 AND business_id = $7`,
        [
          supplierName || rows[0].name,
          supplierEmail !== null ? supplierEmail : rows[0].email,
          supplierPhone !== null ? supplierPhone : rows[0].phone,
          supplierWhatsapp !== null ? supplierWhatsapp : rows[0].whatsapp,
          supplierObservations || rows[0].observations || "",
          supplierId,
          businessId
        ]
      );
    }
    return supplierId;
  }

  if (!supplierName) return null;

  const { rows: existingRows } = await client.query(
    "SELECT * FROM suppliers WHERE business_id = $1 AND LOWER(name) = LOWER($2)",
    [businessId, supplierName]
  );
  if (existingRows[0]) {
    await client.query(
      `UPDATE suppliers
       SET email = $1, phone = $2, whatsapp = $3, observations = $4, updated_at = NOW()
       WHERE id = $5 AND business_id = $6`,
      [
        supplierEmail !== null ? supplierEmail : existingRows[0].email,
        supplierPhone !== null ? supplierPhone : existingRows[0].phone,
        supplierWhatsapp !== null ? supplierWhatsapp : existingRows[0].whatsapp,
        supplierObservations || existingRows[0].observations || "",
        existingRows[0].id,
        businessId
      ]
    );
    return existingRows[0].id;
  }

  const { rows } = await client.query(
    `INSERT INTO suppliers (name, email, phone, whatsapp, observations, is_active, business_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, TRUE, $6, NOW(), NOW())
     RETURNING id`,
    [supplierName, supplierEmail, supplierPhone, supplierWhatsapp, supplierObservations, businessId]
  );
  return rows[0].id;
}

async function syncProductSuppliers(productId, businessId, payload, client = pool) {
  const supplierEntries = normalizeSupplierEntries(payload);
  if (!supplierEntries.length) {
    await client.query("DELETE FROM product_suppliers WHERE product_id = $1 AND business_id = $2", [productId, businessId]);
    return null;
  }

  const resolvedSupplierIds = [];
  for (const [index, supplierEntry] of supplierEntries.entries()) {
    const supplierId = await ensureSupplierReference(supplierEntry, businessId, client);
    if (!supplierId) continue;
    if (resolvedSupplierIds.includes(supplierId)) throw new ApiError(409, "Duplicate supplier assignment");
    resolvedSupplierIds.push(supplierId);

    await client.query(
      `INSERT INTO product_suppliers (product_id, supplier_id, is_primary, purchase_cost, cost_updated_at, business_id)
       VALUES ($1, $2, $3, $4::numeric, CASE WHEN $4::numeric IS NULL THEN NULL ELSE NOW() END, $5)
       ON CONFLICT (product_id, supplier_id)
       DO UPDATE SET
         is_primary = EXCLUDED.is_primary,
         purchase_cost = EXCLUDED.purchase_cost,
         cost_updated_at = CASE WHEN EXCLUDED.purchase_cost IS NULL THEN product_suppliers.cost_updated_at ELSE NOW() END,
         business_id = EXCLUDED.business_id`,
      [productId, supplierId, index === 0, supplierEntry.purchase_cost ?? payload.cost_price ?? null, businessId]
    );
  }

  if (!resolvedSupplierIds.length) {
    await client.query("DELETE FROM product_suppliers WHERE product_id = $1 AND business_id = $2", [productId, businessId]);
    return null;
  }

  await client.query(
    `DELETE FROM product_suppliers
     WHERE product_id = $1 AND business_id = $2 AND supplier_id <> ALL($3::int[])`,
    [productId, businessId, resolvedSupplierIds]
  );
  await client.query(
    `UPDATE product_suppliers
     SET is_primary = supplier_id = $3
     WHERE product_id = $1 AND business_id = $2`,
    [productId, businessId, resolvedSupplierIds[0]]
  );

  return resolvedSupplierIds[0];
}

function buildSearchFilter(actor, alias = "product_data") {
  return { clause: `WHERE ${alias}.business_id = $1`, params: [requireActorBusinessId(actor)] };
}

function buildEffectivePriceCase() {
  return `
    COALESCE(
      CASE
        WHEN product_data.status = 'activo'
          AND product_data.discount_type IS NOT NULL
          AND product_data.discount_value IS NOT NULL
          AND product_data.discount_start IS NOT NULL
          AND product_data.discount_end IS NOT NULL
          AND NOW() BETWEEN product_data.discount_start AND product_data.discount_end
        THEN GREATEST(
          CASE
            WHEN product_data.discount_type = 'percentage' THEN product_data.price - (product_data.price * (product_data.discount_value / 100))
            WHEN product_data.discount_type = 'fixed' THEN product_data.price - product_data.discount_value
            ELSE product_data.price
          END,
          0
        )
        WHEN product_data.liquidation_price IS NOT NULL
          AND (COALESCE(sales_30.recent_units_sold, 0) <= 2 OR (product_data.expires_at IS NOT NULL AND product_data.expires_at <= CURRENT_DATE + INTERVAL '14 days'))
        THEN product_data.liquidation_price
        ELSE product_data.price
      END,
      product_data.price
    )
  `;
}

function buildProductSelect(effectivePriceCase) {
  return `
    SELECT
      product_data.*,
      primary_supplier.name AS supplier_name,
      primary_supplier.email AS supplier_email,
      primary_supplier.phone AS supplier_phone,
      primary_supplier.whatsapp AS supplier_whatsapp,
      primary_supplier.observations AS supplier_observations,
      COALESCE(supplier_meta.suppliers_json, '[]'::jsonb) AS suppliers,
      COALESCE(supplier_meta.supplier_names, ARRAY[]::text[]) AS supplier_names,
      COALESCE(sales_30.recent_units_sold, 0) AS recent_units_sold,
      product_data.stock <= product_data.stock_minimo AS is_low_stock,
      COALESCE(sales_30.recent_units_sold, 0) <= 2 AS is_low_rotation,
      product_data.expires_at IS NOT NULL AND product_data.expires_at <= CURRENT_DATE + INTERVAL '14 days' AS is_near_expiry,
      (${effectivePriceCase}) AS effective_price,
      product_data.price > (${effectivePriceCase}) AS is_on_sale
    FROM products product_data
    LEFT JOIN sales_30 ON sales_30.product_id = product_data.id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
               jsonb_build_object(
                 'supplier_id', suppliers.id,
                 'supplier_name', suppliers.name,
                 'supplier_email', suppliers.email,
                 'supplier_phone', suppliers.phone,
                 'supplier_whatsapp', suppliers.whatsapp,
                 'supplier_observations', suppliers.observations,
                 'is_primary', product_suppliers.is_primary,
                 'purchase_cost', product_suppliers.purchase_cost,
                 'cost_updated_at', product_suppliers.cost_updated_at
               )
               ORDER BY product_suppliers.is_primary DESC, suppliers.name ASC
             ) AS suppliers_json,
             array_agg(suppliers.name ORDER BY product_suppliers.is_primary DESC, suppliers.name ASC) AS supplier_names
      FROM product_suppliers
      INNER JOIN suppliers ON suppliers.id = product_suppliers.supplier_id
      WHERE product_suppliers.product_id = product_data.id
        AND product_suppliers.business_id = product_data.business_id
        AND suppliers.business_id = product_data.business_id
    ) supplier_meta ON TRUE
    LEFT JOIN LATERAL (
      SELECT suppliers.*
      FROM product_suppliers
      INNER JOIN suppliers ON suppliers.id = product_suppliers.supplier_id
      WHERE product_suppliers.product_id = product_data.id
        AND product_suppliers.business_id = product_data.business_id
        AND suppliers.business_id = product_data.business_id
      ORDER BY product_suppliers.is_primary DESC, suppliers.name ASC
      LIMIT 1
    ) primary_supplier ON TRUE
  `;
}

function mapProductRow(row) {
  if (!row) return null;
  return {
    ...row,
    image_path: row.image_path || null,
    unidad_de_venta: normalizeSaleUnit(row.unidad_de_venta)
  };
}

async function listProducts(search, activeOnlyOrOptions = false, actor) {
  const options = normalizeListOptions(search, activeOnlyOrOptions);
  const baseFilter = buildSearchFilter(actor);
  const effectivePriceCase = buildEffectivePriceCase();
  const page = options.page && options.page > 0 ? options.page : null;
  const pageSize = page && [10, 15].includes(options.pageSize) ? options.pageSize : 10;
  const offset = page ? (page - 1) * pageSize : 0;

  const filters = [...baseFilter.params];
  const conditions = [];
  if (baseFilter.clause) conditions.push(baseFilter.clause.replace(/^WHERE /, ""));
  if (options.activeOnly) conditions.push("product_data.is_active = TRUE AND product_data.status = 'activo'");
  if (options.search) {
    filters.push(`%${options.search}%`);
    const idx = filters.length;
    conditions.push(`(
      product_data.name ILIKE $${idx}
      OR product_data.sku ILIKE $${idx}
      OR product_data.barcode ILIKE $${idx}
      OR product_data.category ILIKE $${idx}
      OR EXISTS (
        SELECT 1
        FROM product_suppliers ps
        INNER JOIN suppliers s ON s.id = ps.supplier_id
        WHERE ps.product_id = product_data.id
          AND ps.business_id = product_data.business_id
          AND s.business_id = product_data.business_id
          AND s.name ILIKE $${idx}
      )
    )`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const baseQuery = `
    WITH sales_30 AS (
      SELECT si.product_id, COALESCE(SUM(si.quantity), 0) AS recent_units_sold
      FROM sale_items si
      INNER JOIN sales s ON s.id = si.sale_id AND s.business_id = si.business_id
      WHERE s.business_id = $1
        AND COALESCE(s.status, 'completed') <> 'cancelled'
      GROUP BY si.product_id
    )
    ${buildProductSelect(effectivePriceCase)}
    ${whereClause}
    ORDER BY ${options.search ? "product_data.name ASC" : "product_data.created_at DESC"}`;

  if (!page) {
    const { rows } = await pool.query(baseQuery, filters);
    return rows.map(mapProductRow);
  }

  const [{ rows: countRows }, { rows }] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM (${baseQuery}) AS product_count`, filters),
    pool.query(`${baseQuery} LIMIT $${filters.length + 1} OFFSET $${filters.length + 2}`, [...filters, pageSize, offset])
  ]);
  return {
    items: rows.map(mapProductRow),
    pagination: {
      page,
      pageSize,
      total: Number(countRows[0]?.total || 0),
      totalPages: Math.max(Math.ceil(Number(countRows[0]?.total || 0) / pageSize), 1)
    }
  };
}

async function listSuppliers(search, actor) {
  const term = search?.trim() || "";
  const params = [requireActorBusinessId(actor)];
  const conditions = [`business_id = $${params.length}`];
  if (term) {
    params.push(`%${term}%`);
    conditions.push(`name ILIKE $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT id, name, email, phone, whatsapp, observations, created_at, updated_at
     FROM suppliers
     ${where}
     ORDER BY name ASC
     LIMIT 20`,
    params
  );
  return rows;
}

async function listCategories(search, actor) {
  const term = search?.trim();
  const params = [requireActorBusinessId(actor)];
  const conditions = ["category IS NOT NULL", "category <> ''", `business_id = $${params.length}`];
  if (term) {
    params.push(`%${term}%`);
    conditions.push(`category ILIKE $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT DISTINCT category
     FROM products
     WHERE ${conditions.join(" AND ")}
     ORDER BY category ASC
     LIMIT 20`,
    params
  );
  return rows.map((row) => row.category);
}

async function createProduct(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const discountFields = normalizeDiscountFields(payload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { stock, stockMinimo, stockMaximo, unidadDeVenta, porcentajeGanancia } = validateCoreProductData(payload);
    const resolvedSku = await resolveSku(payload, businessId, null, client);
    const requestedBarcode = sanitizeBarcode(payload.barcode || "");
    const resolvedBarcode = requestedBarcode
      ? await ensureUniqueBarcode(requestedBarcode, businessId, null, client)
      : await generateUniqueBarcode(businessId, null, client);
    const primarySupplierId = await ensureSupplierReference(payload, businessId, client);
    const { rows } = await client.query(
      `INSERT INTO products (
        name, sku, barcode, category, description, price, cost_price, liquidation_price, stock, expires_at,
        is_active, supplier_id, status, discount_type, discount_value, discount_start, discount_end,
        stock_minimo, stock_maximo, business_id, unidad_de_venta, porcentaje_ganancia
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      RETURNING *`,
      [
        payload.name.trim(), resolvedSku, resolvedBarcode, payload.category || null, payload.description || "",
        payload.price, payload.cost_price ?? 0, payload.liquidation_price ?? null, stock,
        payload.expires_at || null, payload.is_active ?? true, primarySupplierId, payload.status || "activo",
        discountFields.discount_type, discountFields.discount_value, discountFields.discount_start, discountFields.discount_end,
        stockMinimo, stockMaximo, businessId, unidadDeVenta, porcentajeGanancia
      ]
    );
    await syncProductSuppliers(rows[0].id, businessId, payload, client);
    await client.query("COMMIT");
    return mapProductRow(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getOwnedProduct(id, actor, client = pool) {
  const params = [id, requireActorBusinessId(actor)];
  const where = "id = $1 AND business_id = $2";
  const { rows } = await client.query(`SELECT * FROM products WHERE ${where}`, params);
  return rows[0] || null;
}

async function updateProduct(id, payload, actor) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await getOwnedProduct(id, actor, client);
    if (!current) throw new ApiError(404, "Product not found");

    const businessId = Number(current.business_id);
    const { stock, stockMinimo, stockMaximo, unidadDeVenta, porcentajeGanancia } = validateCoreProductData(payload, current);
    const resolvedSku = payload.sku !== undefined ? await resolveSku(payload, businessId, current, client) : current.sku;
    const nextBarcodeSource = payload.barcode !== undefined ? payload.barcode : current.barcode;
    const normalizedNextBarcode = sanitizeBarcode(nextBarcodeSource || "");
    const resolvedBarcode = normalizedNextBarcode
      ? await ensureUniqueBarcode(normalizedNextBarcode, businessId, id, client)
      : current.barcode
        ? await ensureUniqueBarcode(current.barcode, businessId, id, client)
        : await generateUniqueBarcode(businessId, id, client);
    const supplierId = payload.supplier_id !== undefined || payload.supplier_name !== undefined || payload.suppliers !== undefined
      ? await ensureSupplierReference(payload, businessId, client)
      : current.supplier_id;
    const discountFields = normalizeDiscountFields(payload);
    const clearDiscountData = payload.discount_type !== undefined && discountFields.discount_type === null;
    const nextLiquidationPrice = clearDiscountData ? null : payload.liquidation_price !== undefined ? payload.liquidation_price : current.liquidation_price;

    const { rows } = await client.query(
      `UPDATE products
       SET name = $1, sku = $2, barcode = $3, category = $4, description = $5, price = $6, cost_price = $7,
           liquidation_price = $8, stock = $9, expires_at = $10, is_active = $11, supplier_id = $12, status = $13,
           discount_type = $14, discount_value = $15, discount_start = $16, discount_end = $17,
           stock_minimo = $18, stock_maximo = $19, unidad_de_venta = $20, porcentaje_ganancia = $21, updated_at = NOW()
       WHERE id = $22 AND business_id = $23
       RETURNING *`,
      [
        payload.name ?? current.name, resolvedSku, resolvedBarcode, payload.category ?? current.category,
        payload.description ?? current.description, payload.price ?? current.price, payload.cost_price ?? current.cost_price,
        payload.stock !== undefined ? stock : current.stock,
        payload.expires_at !== undefined ? payload.expires_at : current.expires_at,
        payload.is_active ?? current.is_active, supplierId, payload.status ?? current.status ?? "activo",
        clearDiscountData || payload.discount_type !== undefined ? discountFields.discount_type : current.discount_type,
        clearDiscountData || payload.discount_value !== undefined ? discountFields.discount_value : current.discount_value,
        clearDiscountData || payload.discount_start !== undefined ? discountFields.discount_start : current.discount_start,
        clearDiscountData || payload.discount_end !== undefined ? discountFields.discount_end : current.discount_end,
        payload.stock_minimo !== undefined ? stockMinimo : current.stock_minimo ?? 0,
        payload.stock_maximo !== undefined || payload.stock !== undefined || payload.stock_minimo !== undefined ? stockMaximo : current.stock_maximo,
        payload.unidad_de_venta !== undefined ? unidadDeVenta : normalizeSaleUnit(current.unidad_de_venta),
        payload.porcentaje_ganancia !== undefined ? porcentajeGanancia : current.porcentaje_ganancia,
        id, businessId
      ]
    );

    if (payload.supplier_id !== undefined || payload.supplier_name !== undefined || payload.suppliers !== undefined) {
      const primarySupplierId = await syncProductSuppliers(id, businessId, payload, client);
      if (primarySupplierId !== supplierId) {
        await client.query("UPDATE products SET supplier_id = $1 WHERE id = $2 AND business_id = $3", [primarySupplierId, id, businessId]);
      }
    }

    await client.query("COMMIT");
    return mapProductRow(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function uploadProductImage(id, file, actor) {
  if (!file) throw new ApiError(400, "Product image file is required");

  const client = await pool.connect();
  let previousImagePath = null;

  try {
    await client.query("BEGIN");
    const current = await getOwnedProduct(id, actor, client);
    if (!current) throw new ApiError(404, "Product not found");

    previousImagePath = current.image_path || null;
    const nextImagePath = buildStoredImagePath(file.filename);
    const { rows } = await client.query(
      `UPDATE products
       SET image_path = $1, updated_at = NOW()
       WHERE id = $2 AND business_id = $3
       RETURNING *`,
      [nextImagePath, id, current.business_id]
    );

    await client.query("COMMIT");
    if (previousImagePath && previousImagePath !== nextImagePath) {
      await deleteStoredImage(previousImagePath).catch(() => {});
    }
    return mapProductRow(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    await deleteStoredImage(buildStoredImagePath(file.filename)).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function removeProductImage(id, actor) {
  const client = await pool.connect();
  let previousImagePath = null;

  try {
    await client.query("BEGIN");
    const current = await getOwnedProduct(id, actor, client);
    if (!current) throw new ApiError(404, "Product not found");

    previousImagePath = current.image_path || null;
    const { rows } = await client.query(
      `UPDATE products
       SET image_path = NULL, updated_at = NOW()
       WHERE id = $1 AND business_id = $2
       RETURNING *`,
      [id, current.business_id]
    );

    await client.query("COMMIT");
    if (previousImagePath) {
      await deleteStoredImage(previousImagePath).catch(() => {});
    }
    return mapProductRow(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateProductStatus(id, isActive, status, actor) {
  const current = await getOwnedProduct(id, actor);
  if (!current) throw new ApiError(404, "Product not found");
  const resolvedIsActive = isActive === undefined ? current.is_active : isActive;
  const nextStatus = status || (resolvedIsActive ? "activo" : "inactivo");
  const { rows } = await pool.query(
    `UPDATE products SET is_active = $1, status = $2, updated_at = NOW()
     WHERE id = $3 AND business_id = $4
     RETURNING *`,
    [resolvedIsActive, nextStatus, id, current.business_id]
  );
  return mapProductRow(rows[0]);
}

async function deleteProduct(id, action, actor) {
  const current = await getOwnedProduct(id, actor);
  if (!current) throw new ApiError(404, "Product not found");
  const { rows } = await pool.query(
    `UPDATE products
     SET is_active = FALSE, status = 'inactivo', updated_at = NOW()
     WHERE id = $1 AND business_id = $2
     RETURNING *`,
    [id, current.business_id]
  );
  return { mode: "soft", product: mapProductRow(rows[0]), requested_action: action || "deactivate" };
}

async function applyBulkDiscount(productIds, payload, actor) {
  if (!Array.isArray(productIds) || productIds.length === 0) throw new ApiError(400, "At least one product is required");
  const normalizedIds = productIds.map(Number).filter(Boolean);
  const businessId = requireActorBusinessId(actor);
  const discountFields = normalizeDiscountFields(payload);

  if (payload.clear_discount) {
    const { rows } = await pool.query(
      `UPDATE products
       SET discount_type = NULL, discount_value = NULL, discount_start = NULL, discount_end = NULL, updated_at = NOW()
       WHERE business_id = $1 AND id = ANY($2::int[])
       RETURNING *`,
      [businessId, normalizedIds]
    );
    return rows.map(mapProductRow);
  }

  if (!discountFields.discount_type || discountFields.discount_value === null) throw new ApiError(400, "Discount configuration is incomplete");
  if (discountFields.discount_value < 0) throw new ApiError(400, "Discount value must be positive");

  const { rows } = await pool.query(
    `UPDATE products
     SET discount_type = $1, discount_value = $2, discount_start = $3, discount_end = $4, updated_at = NOW()
     WHERE business_id = $5 AND id = ANY($6::int[])
     RETURNING *`,
    [discountFields.discount_type, discountFields.discount_value, discountFields.discount_start, discountFields.discount_end, businessId, normalizedIds]
  );
  return rows.map(mapProductRow);
}

module.exports = {
  listProducts,
  listSuppliers,
  listCategories,
  createProduct,
  updateProduct,
  uploadProductImage,
  removeProductImage,
  updateProductStatus,
  deleteProduct,
  applyBulkDiscount
};
