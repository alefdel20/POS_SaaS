const pool = require("../db/pool");
const ExcelJS = require("exceljs");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");
const { buildStoredImagePath, deleteStoredImage } = require("../utils/productImages");
const { saveAuditLog } = require("./auditLogService");
const { emitActorAutomationEvent } = require("./automationEventService");
const { canUseExpiryDate, canUseIeps, normalizePosType } = require("../utils/business");

const SKU_CONFUSING_CHARACTERS = { O: "0", I: "1" };
const SALE_UNITS = ["pieza", "kg", "litro", "caja"];
const INTEGER_UNITS = new Set(["pieza", "caja"]);
const FRACTIONAL_UNITS = new Set(["kg", "litro"]);
const PRODUCT_IMPORT_LIMIT = 500;
const IMPORT_DEFAULT_CATEGORY = "General";
const IMPORT_COLUMN_ALIASES = {
  name: ["nombre", "producto", "descripcion", "descripción", "name", "product", "item", "articulo", "artículo"],
  price: ["precio", "precio venta", "precio_venta", "pvp", "price", "publico", "publico venta", "venta"],
  cost_price: ["costo", "cost", "compra", "cost_price", "precio compra", "precio_compra"],
  category: ["categoria", "categoría", "category", "rubro", "linea", "línea"],
  sku: ["sku", "clave", "codigo sku", "codigo_sku"],
  barcode: ["codigo", "código", "barcode", "codigo barras", "código barras", "codigo_de_barras", "ean"],
  stock: ["stock", "existencia", "inventario", "cantidad", "qty"],
  unidad_de_venta: ["unidad", "unidad de venta", "unidad_de_venta", "presentacion", "presentación", "uom"],
  supplier: ["proveedor", "supplier", "marca", "brand"]
};

function stripAccents(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeImportHeader(value) {
  return stripAccents(String(value || ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeImportCell(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeImportText(value) {
  return normalizeImportCell(value);
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
    discount_value: payload.discount_value === undefined || payload.discount_value === null || payload.discount_value === "" ? null : roundToScale(payload.discount_value, 5),
    discount_start: payload.discount_start || null,
    discount_end: payload.discount_end || null
  };
}

function getActorPosType(actor) {
  return normalizePosType(actor?.pos_type) || "Otro";
}

function sanitizeProductPayloadByPosType(payload, actor, currentProduct = null) {
  const posType = getActorPosType(actor);
  const nextPayload = { ...payload };

  if (!canUseIeps(posType)) {
    nextPayload.ieps = null;
  }

  if (!canUseExpiryDate(posType) && (currentProduct === null || Object.prototype.hasOwnProperty.call(nextPayload, "expires_at"))) {
    nextPayload.expires_at = null;
  }

  if (Object.prototype.hasOwnProperty.call(nextPayload, "discount_type")) delete nextPayload.discount_type;
  if (Object.prototype.hasOwnProperty.call(nextPayload, "discount_value")) delete nextPayload.discount_value;
  if (Object.prototype.hasOwnProperty.call(nextPayload, "discount_start")) delete nextPayload.discount_start;
  if (Object.prototype.hasOwnProperty.call(nextPayload, "discount_end")) delete nextPayload.discount_end;

  return nextPayload;
}

function roundToScale(value, scale) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) {
    throw new ApiError(400, "Invalid numeric value");
  }
  const factor = 10 ** scale;
  return Math.round((numericValue + Number.EPSILON) * factor) / factor;
}

function normalizeIepsValue(value, currentProduct = null) {
  const rawValue = value !== undefined ? value : currentProduct?.ieps;
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return null;
  }

  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new ApiError(400, "Invalid IEPS value");
  }

  return roundToScale(numericValue, 2);
}

function normalizeSaleUnit(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "pieza";
  if (!SALE_UNITS.includes(normalized)) throw new ApiError(400, "Invalid sale unit");
  return normalized;
}

function roundToThree(value) {
  return roundToScale(value, 3);
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

function normalizeMoneyValue(value, fieldLabel, options = {}) {
  const allowZero = options.allowZero !== false;
  const allowNull = Boolean(options.allowNull);
  if (value === undefined || value === null || value === "") {
    if (allowNull) {
      return null;
    }
    return 0;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new ApiError(400, `${fieldLabel} must be a valid number`);
  }
  if (numericValue < 0 || (!allowZero && numericValue === 0)) {
    throw new ApiError(400, `${fieldLabel} must be greater than ${allowZero ? "or equal to " : ""}zero`);
  }
  if (Math.abs(numericValue * 100000 - Math.round(numericValue * 100000)) > 1e-9) {
    throw new ApiError(400, `${fieldLabel} cannot exceed 5 decimals`);
  }
  return roundToScale(numericValue, 5);
}

function buildProductAuditMetadata(actor, extra = {}) {
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

function buildProductSnapshot(product) {
  if (!product) return {};
  return mapProductRow(product);
}

function normalizeListOptions(search, options) {
  if (options && typeof options === "object" && !Array.isArray(options)) {
    return {
      search: search || "",
      category: options.category ? String(options.category).trim() : "",
      activeOnly: Boolean(options.activeOnly),
      page: options.page ? Number(options.page) : null,
      pageSize: options.pageSize ? Number(options.pageSize) : null
    };
  }
  return { search: search || "", category: "", activeOnly: Boolean(options), page: null, pageSize: null };
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
  const normalizedPrice = normalizeMoneyValue(price, "Product price", { allowZero: false });
  const normalizedCostPrice = normalizeMoneyValue(costPrice, "Product cost", { allowZero: true });
  const normalizedLiquidationPrice = (payload.liquidation_price !== undefined || currentProduct?.liquidation_price !== undefined)
    ? normalizeMoneyValue(payload.liquidation_price ?? currentProduct?.liquidation_price, "Liquidation price", { allowZero: true, allowNull: true })
    : null;
  if (normalizedStock < 0) throw new ApiError(400, "Product stock cannot be negative");
  if (normalizedStockMinimo < 0) throw new ApiError(400, "Product minimum stock cannot be negative");
  if (normalizedStockMaximo < 0) throw new ApiError(400, "Product maximum stock cannot be negative");
  if (normalizedStockMaximo < normalizedStockMinimo) throw new ApiError(400, "Product maximum stock cannot be lower than minimum stock");

  return {
    stock: normalizedStock,
    stockMinimo: normalizedStockMinimo,
    stockMaximo: normalizedStockMaximo,
    unidadDeVenta,
    porcentajeGanancia,
    price: normalizedPrice,
    costPrice: normalizedCostPrice,
    liquidationPrice: normalizedLiquidationPrice
  };
}

async function ensureUniqueSku(baseSku, businessId, excludeProductId = null, client = pool) {
  const normalizedBase = sanitizeManualSku(baseSku).replace(/^-+|-+$/g, "");
  const compactBase = normalizedBase.slice(0, 60) || "ITEM";
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
  for (let sequence = 1; sequence <= 9999; sequence += 1) {
    const suffix = `-${sequence}`;
    const candidate = `${compactBase.slice(0, Math.max(60 - suffix.length, 1))}${suffix}`;
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
          AND (((COALESCE(sales_21.recent_units_sold, 0) = 0) AND product_data.created_at <= NOW() - INTERVAL '21 days') OR (product_data.expires_at IS NOT NULL AND product_data.expires_at <= CURRENT_DATE + INTERVAL '14 days'))
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
      COALESCE(sales_21.recent_units_sold, 0) AS recent_units_sold,
      product_data.stock <= product_data.stock_minimo AS is_low_stock,
      COALESCE(sales_21.recent_units_sold, 0) = 0
        AND product_data.created_at <= NOW() - INTERVAL '21 days' AS is_low_rotation,
      product_data.expires_at IS NOT NULL AND product_data.expires_at <= CURRENT_DATE + INTERVAL '14 days' AS is_near_expiry,
      (
        product_data.status = 'activo'
        AND product_data.discount_type IS NOT NULL
        AND product_data.discount_value IS NOT NULL
        AND product_data.discount_start IS NOT NULL
        AND product_data.discount_end IS NOT NULL
        AND NOW() BETWEEN product_data.discount_start AND product_data.discount_end
      ) AS has_active_discount,
      (${effectivePriceCase}) AS effective_price,
      product_data.price > (${effectivePriceCase}) AS is_on_sale
    FROM products product_data
    LEFT JOIN sales_21 ON sales_21.product_id = product_data.id
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
  if (options.category) {
    filters.push(options.category);
    conditions.push(`product_data.category = $${filters.length}`);
  }
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
    WITH sales_21 AS (
      SELECT si.product_id, COALESCE(SUM(si.quantity), 0) AS recent_units_sold
      FROM sale_items si
      INNER JOIN sales s ON s.id = si.sale_id AND s.business_id = si.business_id
      WHERE s.business_id = $1
        AND COALESCE(s.status, 'completed') <> 'cancelled'
        AND COALESCE(s.created_at, NOW()) >= NOW() - INTERVAL '21 days'
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

async function ensureCategoryReference(category, businessId, actor, client = pool) {
  const normalizedCategory = String(category || "").trim();
  if (!normalizedCategory) return;
  await client.query(
    `INSERT INTO product_categories (business_id, name, source, created_by)
     VALUES ($1, $2, 'product', $3)
     ON CONFLICT (business_id, LOWER(name))
     DO UPDATE SET updated_at = NOW()`,
    [businessId, normalizedCategory, actor.id]
  );
}

async function listCategories(search, actor) {
  const term = search?.trim();
  const params = [requireActorBusinessId(actor)];
  const productConditions = ["category IS NOT NULL", "category <> ''", `business_id = $${params.length}`];
  const templateConditions = ["name IS NOT NULL", "name <> ''", `business_id = $${params.length}`];
  if (term) {
    params.push(`%${term}%`);
    productConditions.push(`category ILIKE $${params.length}`);
    templateConditions.push(`name ILIKE $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT DISTINCT category
     FROM (
       SELECT category
       FROM products
       WHERE ${productConditions.join(" AND ")}
       UNION
       SELECT name AS category
       FROM product_categories
       WHERE ${templateConditions.join(" AND ")}
     ) AS categories
     ORDER BY category ASC
     LIMIT 20`,
    params
  );
  return rows.map((row) => row.category);
}

function detectImportColumn(header) {
  const normalizedHeader = normalizeImportHeader(header);
  if (!normalizedHeader) return null;

  for (const [field, aliases] of Object.entries(IMPORT_COLUMN_ALIASES)) {
    if (aliases.some((alias) => normalizedHeader === normalizeImportHeader(alias))) {
      return field;
    }
  }

  for (const [field, aliases] of Object.entries(IMPORT_COLUMN_ALIASES)) {
    if (aliases.some((alias) => normalizedHeader.includes(normalizeImportHeader(alias)))) {
      return field;
    }
  }

  return null;
}

async function parseImportWorkbook(file) {
  if (!file?.buffer?.length) {
    throw new ApiError(400, "Import file is required");
  }

  const extension = String(file.originalname || "").toLowerCase().split(".").pop();
  if (!["csv", "xlsx"].includes(extension)) {
    throw new ApiError(400, "Only CSV and XLSX files are allowed");
  }

  const rows = extension === "csv"
    ? parseCsvImportRows(file.buffer)
    : await parseXlsxImportRows(file.buffer);

  if (!rows.length) {
    throw new ApiError(400, "The file is empty");
  }

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.values.map((header) => normalizeImportCell(header));
  if (!headers.some(Boolean)) {
    throw new ApiError(400, "The file header is empty");
  }

  const headerMap = {};
  headers.forEach((header, index) => {
    const detectedField = detectImportColumn(header);
    if (detectedField && headerMap[detectedField] === undefined) {
      headerMap[detectedField] = index;
    }
  });

  return {
    format: extension,
    headers,
    headerMap,
    rows: dataRows.filter((row) => row.values.some((value) => normalizeImportCell(value)))
  };
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === "\"") {
      if (inQuotes && nextCharacter === "\"") {
        current += "\"";
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);
  return values.map((value) => normalizeImportCell(value));
}

function parseCsvImportRows(buffer) {
  const text = buffer.toString("utf-8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  return lines.map((line, index) => ({
    rowNumber: index + 1,
    values: parseCsvLine(line)
  }));
}

async function parseXlsxImportRows(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new ApiError(400, "The file does not contain sheets or rows");
  }

  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    rows.push({
      rowNumber,
      values: row.values.slice(1).map((value) => normalizeImportCell(value))
    });
  });
  return rows;
}

function normalizeImportUnit(unitValue, nameValue = "") {
  const normalizedUnit = normalizeImportHeader(unitValue);
  if (normalizedUnit) {
    if (["pieza", "pza", "pz", "unit", "unidad"].includes(normalizedUnit)) return "pieza";
    if (["kg", "kilo", "kilos", "kilogramo", "kilogramos"].includes(normalizedUnit)) return "kg";
    if (["litro", "litros", "lt", "lts", "l"].includes(normalizedUnit)) return "litro";
    if (["caja", "cajas", "box"].includes(normalizedUnit)) return "caja";
  }

  const normalizedName = normalizeImportHeader(nameValue);
  if (/\b(kg|kilo|kilos|kilogramo|kilogramos)\b/.test(normalizedName)) return "kg";
  if (/\b(lt|lts|litro|litros)\b/.test(normalizedName)) return "litro";
  if (/\b(caja|cajas|box)\b/.test(normalizedName)) return "caja";
  return "pieza";
}

function normalizeImportMoney(value) {
  const raw = normalizeImportCell(value);
  if (!raw) return "";
  const normalized = raw
    .replace(/\s+/g, "")
    .replace(/\$(?=\d)/g, "")
    .replace(/,(?=\d{1,5}$)/, ".")
    .replace(/,/g, "");
  return normalized;
}

function normalizeImportStock(value) {
  const raw = normalizeImportCell(value);
  if (!raw) return "0";
  return raw.replace(/,/g, ".");
}

async function getImportContext(actor) {
  const businessId = requireActorBusinessId(actor);
  const [categories, suppliersResult, skusResult, barcodesResult] = await Promise.all([
    listCategories("", actor),
    pool.query("SELECT id, name FROM suppliers WHERE business_id = $1 ORDER BY name ASC", [businessId]),
    pool.query("SELECT UPPER(sku) AS value FROM products WHERE business_id = $1 AND sku IS NOT NULL AND sku <> ''", [businessId]),
    pool.query("SELECT barcode AS value FROM products WHERE business_id = $1 AND barcode IS NOT NULL AND barcode <> ''", [businessId])
  ]);

  return {
    businessId,
    categories,
    categoryFallback: categories[0] || IMPORT_DEFAULT_CATEGORY,
    suppliersByName: new Map(suppliersResult.rows.map((row) => [String(row.name || "").trim().toLowerCase(), row])),
    existingSkus: new Set(skusResult.rows.map((row) => String(row.value || "").toUpperCase())),
    existingBarcodes: new Set(barcodesResult.rows.map((row) => String(row.value || "")))
  };
}

function mapImportRowValues(rowValues, headerMap) {
  const valueFor = (field) => {
    const index = headerMap[field];
    return index === undefined ? "" : normalizeImportCell(rowValues[index]);
  };

  return {
    name: valueFor("name"),
    price: valueFor("price"),
    cost_price: valueFor("cost_price"),
    category: valueFor("category"),
    sku: valueFor("sku"),
    barcode: valueFor("barcode"),
    stock: valueFor("stock"),
    unidad_de_venta: valueFor("unidad_de_venta"),
    supplier_name: valueFor("supplier")
  };
}

function buildImportRowPreview(index, rawRow, headerMap, context) {
  const extracted = mapImportRowValues(rawRow.values, headerMap);
  const warnings = [];
  const errors = [];
  const payload = {
    name: normalizeImportText(extracted.name),
    price: normalizeImportMoney(extracted.price),
    cost_price: normalizeImportMoney(extracted.cost_price),
    category: normalizeImportText(extracted.category) || context.categoryFallback,
    sku: sanitizeManualSku(extracted.sku || ""),
    barcode: sanitizeBarcode(extracted.barcode || ""),
    stock: normalizeImportStock(extracted.stock),
    unidad_de_venta: normalizeImportUnit(extracted.unidad_de_venta, extracted.name),
    supplier_name: normalizeImportText(extracted.supplier_name),
    stock_minimo: "0"
  };

  if (!payload.name) {
    errors.push("Nombre requerido");
  }

  const normalizedPrice = payload.price === "" ? Number.NaN : Number(payload.price);
  if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0 || hasMoreThanFiveDecimals(normalizedPrice)) {
    errors.push("Precio invalido");
  }

  const normalizedCost = payload.cost_price === "" ? 0 : Number(payload.cost_price);
  if (!Number.isFinite(normalizedCost) || normalizedCost < 0 || hasMoreThanFiveDecimals(normalizedCost)) {
    errors.push("Costo invalido");
  }

  const normalizedStock = payload.stock === "" ? 0 : Number(payload.stock);
  if (!Number.isFinite(normalizedStock) || normalizedStock < 0) {
    errors.push("Stock invalido");
  } else if ((payload.unidad_de_venta === "pieza" || payload.unidad_de_venta === "caja") && !Number.isInteger(normalizedStock)) {
    errors.push(`Stock debe ser entero para ${payload.unidad_de_venta}`);
  } else if ((payload.unidad_de_venta === "kg" || payload.unidad_de_venta === "litro") && hasMoreThanThreeDecimals(normalizedStock)) {
    errors.push(`Stock solo acepta 3 decimales para ${payload.unidad_de_venta}`);
  }

  if (!normalizeImportText(extracted.category)) {
    warnings.push(`Categoria vacia, se asignara ${context.categoryFallback}`);
  }

  if (!normalizeImportText(extracted.unidad_de_venta)) {
    warnings.push(`Unidad no informada, se usara ${payload.unidad_de_venta}`);
  }

  if (!payload.sku) {
    warnings.push("SKU vacio, se generara automaticamente");
  }

  if (payload.sku && context.existingSkus.has(payload.sku.toUpperCase())) {
    warnings.push("SKU duplicado en este negocio, se generara uno nuevo");
    payload.sku = "";
  }

  if (payload.barcode && context.existingBarcodes.has(payload.barcode)) {
    warnings.push("Codigo de barras duplicado en este negocio, se generara uno nuevo");
    payload.barcode = "";
  }

  if (payload.supplier_name && !context.suppliersByName.has(payload.supplier_name.toLowerCase())) {
    warnings.push("Proveedor no existe aun, se creara al importar");
  }

  return {
    row_number: rawRow.rowNumber,
    index,
    payload,
    warnings,
    errors,
    action: errors.length ? "error" : "import"
  };
}

function dedupeImportPreviewRows(rows) {
  const seenNames = new Set();
  const seenSkus = new Set();
  const seenBarcodes = new Set();

  for (const row of rows) {
    const normalizedName = normalizeImportHeader(row.payload.name);
    const normalizedSku = String(row.payload.sku || "").toUpperCase();
    const normalizedBarcode = String(row.payload.barcode || "");

    if (normalizedName && seenNames.has(normalizedName)) {
      row.warnings.push("Nombre repetido en el archivo");
    } else if (normalizedName) {
      seenNames.add(normalizedName);
    }

    if (normalizedSku) {
      if (seenSkus.has(normalizedSku)) {
        row.warnings.push("SKU repetido en el archivo, se generara uno nuevo");
        row.payload.sku = "";
      } else {
        seenSkus.add(normalizedSku);
      }
    }

    if (normalizedBarcode) {
      if (seenBarcodes.has(normalizedBarcode)) {
        row.warnings.push("Codigo repetido en el archivo, se generara uno nuevo");
        row.payload.barcode = "";
      } else {
        seenBarcodes.add(normalizedBarcode);
      }
    }
  }

  return rows;
}

function summarizeImportPreview(rows) {
  return rows.reduce((summary, row) => {
    if (row.action === "import") {
      summary.ready += 1;
    }
    if (row.errors.length) {
      summary.with_errors += 1;
    }
    if (row.warnings.length) {
      summary.with_warnings += 1;
    }
    if (row.action !== "import") {
      summary.omitted += 1;
    }
    return summary;
  }, {
    total: rows.length,
    ready: 0,
    with_errors: 0,
    with_warnings: 0,
    omitted: 0
  });
}

async function previewProductImport(file, actor) {
  const parsedWorkbook = await parseImportWorkbook(file);
  if (parsedWorkbook.rows.length > PRODUCT_IMPORT_LIMIT) {
    throw new ApiError(400, `Import limit is ${PRODUCT_IMPORT_LIMIT} rows per file`);
  }

  const context = await getImportContext(actor);
  const previewRows = dedupeImportPreviewRows(
    parsedWorkbook.rows.map((row, index) => buildImportRowPreview(index, row, parsedWorkbook.headerMap, context))
  );

  return {
    format: parsedWorkbook.format,
    headers: parsedWorkbook.headers,
    detected_columns: parsedWorkbook.headerMap,
    rows: previewRows,
    summary: summarizeImportPreview(previewRows)
  };
}

function sanitizeImportedRow(row, context) {
  const payload = {
    name: normalizeImportText(row?.payload?.name || row?.name),
    price: normalizeImportMoney(row?.payload?.price || row?.price),
    cost_price: normalizeImportMoney(row?.payload?.cost_price || row?.cost_price),
    category: normalizeImportText(row?.payload?.category || row?.category) || context.categoryFallback,
    sku: sanitizeManualSku(row?.payload?.sku || row?.sku || ""),
    barcode: sanitizeBarcode(row?.payload?.barcode || row?.barcode || ""),
    stock: normalizeImportStock(row?.payload?.stock || row?.stock),
    unidad_de_venta: normalizeImportUnit(row?.payload?.unidad_de_venta || row?.unidad_de_venta, row?.payload?.name || row?.name),
    supplier_name: normalizeImportText(row?.payload?.supplier_name || row?.supplier_name),
    stock_minimo: "0"
  };

  if (!payload.name) {
    throw new ApiError(400, "Imported row requires product name");
  }

  return payload;
}

async function confirmProductImport(rows, actor) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ApiError(400, "Import rows are required");
  }
  if (rows.length > PRODUCT_IMPORT_LIMIT) {
    throw new ApiError(400, `Import limit is ${PRODUCT_IMPORT_LIMIT} rows per request`);
  }

  const context = await getImportContext(actor);
  const results = [];
  const seenSkus = new Set();
  const seenBarcodes = new Set();

  for (const row of rows) {
    try {
      const payload = sanitizeImportedRow(row, context);
      const normalizedSku = String(payload.sku || "").toUpperCase();
      const normalizedBarcode = String(payload.barcode || "");
      if (normalizedSku && (context.existingSkus.has(normalizedSku) || seenSkus.has(normalizedSku))) {
        payload.sku = "";
      }
      if (normalizedBarcode && (context.existingBarcodes.has(normalizedBarcode) || seenBarcodes.has(normalizedBarcode))) {
        payload.barcode = "";
      }

      const created = await createProduct(payload, actor);
      results.push({
        row_number: row?.row_number || row?.index || null,
        status: "imported",
        product_id: created.id,
        product_name: created.name
      });
      if (normalizedSku) seenSkus.add(normalizedSku);
      if (normalizedBarcode) seenBarcodes.add(normalizedBarcode);
    } catch (error) {
      results.push({
        row_number: row?.row_number || row?.index || null,
        status: "error",
        message: error instanceof Error ? error.message : "Import row failed"
      });
    }
  }

  return {
    results,
    summary: {
      total: rows.length,
      imported: results.filter((row) => row.status === "imported").length,
      errors: results.filter((row) => row.status === "error").length,
      omitted: 0
    }
  };
}

async function listRestockProducts(filters = {}, actor) {
  const businessId = requireActorBusinessId(actor);
  const values = [businessId];
  const conditions = [
    "product_data.business_id = $1",
    "product_data.is_active = TRUE",
    "product_data.status = 'activo'",
    "product_data.stock <= product_data.stock_minimo"
  ];

  if (filters.category) {
    values.push(String(filters.category).trim());
    conditions.push(`product_data.category = $${values.length}`);
  }

  if (filters.supplier) {
    values.push(`%${String(filters.supplier).trim()}%`);
    conditions.push(`COALESCE(product_suppliers.name, '') ILIKE $${values.length}`);
  }

  if (filters.search) {
    values.push(`%${String(filters.search).trim()}%`);
    conditions.push(`(
      product_data.name ILIKE $${values.length}
      OR product_data.sku ILIKE $${values.length}
      OR COALESCE(product_data.category, '') ILIKE $${values.length}
      OR COALESCE(product_suppliers.name, '') ILIKE $${values.length}
    )`);
  }

  const { rows } = await pool.query(
    `SELECT
       product_data.id,
       product_data.name,
       product_data.sku,
       product_data.category,
       product_data.stock,
       product_data.stock_minimo,
       product_data.stock_maximo,
       product_data.cost_price,
       product_data.unidad_de_venta,
       product_suppliers.name AS supplier_name,
       product_suppliers.whatsapp AS supplier_whatsapp,
       product_suppliers.purchase_cost AS recent_purchase_cost,
       product_suppliers.cost_updated_at,
       GREATEST(COALESCE(product_data.stock_minimo, 0) - COALESCE(product_data.stock, 0), 0) AS shortage,
       GREATEST(COALESCE(product_data.stock_maximo, product_data.stock_minimo, 0) - COALESCE(product_data.stock, 0), 0) AS suggested_restock
     FROM products product_data
     LEFT JOIN LATERAL (
       SELECT ps.*, s.name, s.whatsapp
       FROM product_suppliers ps
       INNER JOIN suppliers s ON s.id = ps.supplier_id AND s.business_id = ps.business_id
       WHERE ps.product_id = product_data.id
         AND ps.business_id = product_data.business_id
       ORDER BY ps.is_primary DESC, ps.cost_updated_at DESC NULLS LAST, s.name ASC
       LIMIT 1
     ) AS product_suppliers ON TRUE
     WHERE ${conditions.join(" AND ")}
     ORDER BY shortage DESC, suggested_restock DESC, product_data.name ASC`,
    values
  );

  return rows.map((row) => ({
    ...row,
    stock: Number(row.stock || 0),
    stock_minimo: Number(row.stock_minimo || 0),
    stock_maximo: Number(row.stock_maximo || 0),
    cost_price: Number(row.cost_price || 0),
    recent_purchase_cost: row.recent_purchase_cost === null || row.recent_purchase_cost === undefined ? null : Number(row.recent_purchase_cost),
    shortage: Number(row.shortage || 0),
    suggested_restock: Number(row.suggested_restock || 0)
  }));
}

async function createProduct(payload, actor) {
  const businessId = requireActorBusinessId(actor);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const sanitizedPayload = sanitizeProductPayloadByPosType(payload, actor);
    const discountFields = normalizeDiscountFields(sanitizedPayload);
    const ieps = normalizeIepsValue(sanitizedPayload.ieps);
    const { stock, stockMinimo, stockMaximo, unidadDeVenta, porcentajeGanancia, price, costPrice, liquidationPrice } = validateCoreProductData(sanitizedPayload);
    const requestedBarcode = sanitizeBarcode(sanitizedPayload.barcode || "");
    const primarySupplierId = await ensureSupplierReference(sanitizedPayload, businessId, client);
    let rows = [];
    let lastError = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const resolvedSku = await resolveSku(
        attempt === 0 ? sanitizedPayload : { ...sanitizedPayload, sku: "" },
        businessId,
        null,
        client
      );
      const resolvedBarcode = requestedBarcode
        ? await ensureUniqueBarcode(requestedBarcode, businessId, null, client)
        : await generateUniqueBarcode(businessId, null, client);

      try {
        ({ rows } = await client.query(
          `INSERT INTO products (
            name, sku, barcode, category, description, price, cost_price, liquidation_price, stock, expires_at,
            is_active, supplier_id, status, discount_type, discount_value, discount_start, discount_end,
            stock_minimo, stock_maximo, business_id, unidad_de_venta, porcentaje_ganancia, ieps
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
          RETURNING *`,
          [
            sanitizedPayload.name.trim(), resolvedSku, resolvedBarcode, sanitizedPayload.category || null, sanitizedPayload.description || "",
            price, costPrice, liquidationPrice, stock,
            sanitizedPayload.expires_at || null, sanitizedPayload.is_active ?? true, primarySupplierId, sanitizedPayload.status || "activo",
            discountFields.discount_type, discountFields.discount_value, discountFields.discount_start, discountFields.discount_end,
            stockMinimo, stockMaximo, businessId, unidadDeVenta, porcentajeGanancia, ieps
          ]
        ));
        lastError = null;
        break;
      } catch (error) {
        if (error?.code !== "23505") {
          throw error;
        }
        lastError = error;
      }
    }

    if (lastError) {
      throw new ApiError(409, "Unable to generate unique SKU");
    }

    await syncProductSuppliers(rows[0].id, businessId, sanitizedPayload, client);
    await ensureCategoryReference(sanitizedPayload.category, businessId, actor, client);
    await emitActorAutomationEvent(actor, "product_created", {
      product_id: rows[0].id,
      name: rows[0].name,
      sku: rows[0].sku,
      category: rows[0].category,
      stock: Number(rows[0].stock || 0),
      stock_minimo: Number(rows[0].stock_minimo || 0),
      supplier_id: primarySupplierId,
      source: payload?.source || "products_module"
    }, { client });
    if (Number(rows[0].stock || 0) <= Number(rows[0].stock_minimo || 0)) {
      await emitActorAutomationEvent(actor, "low_stock_detected", {
        product_id: rows[0].id,
        name: rows[0].name,
        sku: rows[0].sku,
        stock: Number(rows[0].stock || 0),
        stock_minimo: Number(rows[0].stock_minimo || 0),
        source: "product_created"
      }, { client });
    }
    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "products",
      accion: "create_product",
      entidad_tipo: "product",
      entidad_id: rows[0].id,
      detalle_anterior: {},
      detalle_nuevo: { entity: "product", entity_id: rows[0].id, snapshot: buildProductSnapshot(rows[0]), version: 1 },
      motivo: actor?.support_context?.reason || "",
      metadata: buildProductAuditMetadata(actor)
    }, { client });
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
    const sanitizedPayload = sanitizeProductPayloadByPosType(payload, actor, current);
    const ieps = normalizeIepsValue(sanitizedPayload.ieps, current);
    const { stock, stockMinimo, stockMaximo, unidadDeVenta, porcentajeGanancia, price, costPrice, liquidationPrice } = validateCoreProductData(sanitizedPayload, current);
    const resolvedSku = sanitizedPayload.sku !== undefined ? await resolveSku(sanitizedPayload, businessId, current, client) : current.sku;
    const nextBarcodeSource = sanitizedPayload.barcode !== undefined ? sanitizedPayload.barcode : current.barcode;
    const normalizedNextBarcode = sanitizeBarcode(nextBarcodeSource || "");
    const resolvedBarcode = normalizedNextBarcode
      ? await ensureUniqueBarcode(normalizedNextBarcode, businessId, id, client)
      : current.barcode
        ? await ensureUniqueBarcode(current.barcode, businessId, id, client)
        : await generateUniqueBarcode(businessId, id, client);
    const supplierId = sanitizedPayload.supplier_id !== undefined || sanitizedPayload.supplier_name !== undefined || sanitizedPayload.suppliers !== undefined
      ? await ensureSupplierReference(sanitizedPayload, businessId, client)
      : current.supplier_id;
    const discountFields = normalizeDiscountFields(sanitizedPayload);
    const clearDiscountData = sanitizedPayload.discount_type !== undefined && discountFields.discount_type === null;
    const nextLiquidationPrice = clearDiscountData ? null : sanitizedPayload.liquidation_price !== undefined ? liquidationPrice : current.liquidation_price;

    const { rows } = await client.query(
      `UPDATE products
       SET name = $1, sku = $2, barcode = $3, category = $4, description = $5, price = $6, cost_price = $7,
           liquidation_price = $8, stock = $9, expires_at = $10, is_active = $11, supplier_id = $12, status = $13,
           discount_type = $14, discount_value = $15, discount_start = $16, discount_end = $17,
           stock_minimo = $18, stock_maximo = $19, unidad_de_venta = $20, porcentaje_ganancia = $21, ieps = $22, updated_at = NOW()
       WHERE id = $23 AND business_id = $24
       RETURNING *`,
      [
        sanitizedPayload.name ?? current.name, resolvedSku, resolvedBarcode, sanitizedPayload.category ?? current.category,
        sanitizedPayload.description ?? current.description, sanitizedPayload.price !== undefined ? price : current.price, sanitizedPayload.cost_price !== undefined ? costPrice : current.cost_price,
        nextLiquidationPrice,
        sanitizedPayload.stock !== undefined ? stock : current.stock,
        sanitizedPayload.expires_at !== undefined ? sanitizedPayload.expires_at : current.expires_at,
        sanitizedPayload.is_active ?? current.is_active, supplierId, sanitizedPayload.status ?? current.status ?? "activo",
        clearDiscountData || sanitizedPayload.discount_type !== undefined ? discountFields.discount_type : current.discount_type,
        clearDiscountData || sanitizedPayload.discount_value !== undefined ? discountFields.discount_value : current.discount_value,
        clearDiscountData || sanitizedPayload.discount_start !== undefined ? discountFields.discount_start : current.discount_start,
        clearDiscountData || sanitizedPayload.discount_end !== undefined ? discountFields.discount_end : current.discount_end,
        sanitizedPayload.stock_minimo !== undefined ? stockMinimo : current.stock_minimo ?? 0,
        sanitizedPayload.stock_maximo !== undefined || sanitizedPayload.stock !== undefined || sanitizedPayload.stock_minimo !== undefined ? stockMaximo : current.stock_maximo,
        sanitizedPayload.unidad_de_venta !== undefined ? unidadDeVenta : normalizeSaleUnit(current.unidad_de_venta),
        sanitizedPayload.porcentaje_ganancia !== undefined ? porcentajeGanancia : current.porcentaje_ganancia,
        sanitizedPayload.ieps !== undefined ? ieps : current.ieps,
        id, businessId
      ]
    );

    if (sanitizedPayload.supplier_id !== undefined || sanitizedPayload.supplier_name !== undefined || sanitizedPayload.suppliers !== undefined) {
      const primarySupplierId = await syncProductSuppliers(id, businessId, sanitizedPayload, client);
      if (primarySupplierId !== supplierId) {
        await client.query("UPDATE products SET supplier_id = $1 WHERE id = $2 AND business_id = $3", [primarySupplierId, id, businessId]);
      }
    }

    if (sanitizedPayload.category !== undefined) {
      await ensureCategoryReference(sanitizedPayload.category, businessId, actor, client);
    }

    await saveAuditLog({
      business_id: businessId,
      usuario_id: actor.id,
      modulo: "products",
      accion: "update_product",
      entidad_tipo: "product",
      entidad_id: id,
      detalle_anterior: { entity: "product", entity_id: id, snapshot: buildProductSnapshot(current), version: 1 },
      detalle_nuevo: { entity: "product", entity_id: id, snapshot: buildProductSnapshot(rows[0]), version: 1 },
      motivo: actor?.support_context?.reason || "",
      metadata: buildProductAuditMetadata(actor)
    }, { client });
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
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE products SET is_active = $1, status = $2, updated_at = NOW()
       WHERE id = $3 AND business_id = $4
       RETURNING *`,
      [resolvedIsActive, nextStatus, id, current.business_id]
    );
    await saveAuditLog({
      business_id: current.business_id,
      usuario_id: actor.id,
      modulo: "products",
      accion: "update_product_status",
      entidad_tipo: "product",
      entidad_id: id,
      detalle_anterior: { entity: "product", entity_id: id, snapshot: buildProductSnapshot(current), version: 1 },
      detalle_nuevo: { entity: "product", entity_id: id, snapshot: buildProductSnapshot(rows[0]), version: 1 },
      motivo: actor?.support_context?.reason || "",
      metadata: buildProductAuditMetadata(actor)
    }, { client });
    await client.query("COMMIT");
    return mapProductRow(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deleteProduct(id, action, actor) {
  const current = await getOwnedProduct(id, actor);
  if (!current) throw new ApiError(404, "Product not found");

  if (action === "delete") {
    const client = await pool.connect();
    let previousImagePath = null;

    try {
      await client.query("BEGIN");
      const ownedProduct = await getOwnedProduct(id, actor, client);
      if (!ownedProduct) throw new ApiError(404, "Product not found");

      const { rows: usageRows } = await client.query(
        `SELECT 1
         FROM sale_items
         WHERE product_id = $1 AND business_id = $2
         LIMIT 1`,
        [id, ownedProduct.business_id]
      );
      if (usageRows[0]) {
        throw new ApiError(409, "Cannot permanently delete product with sales history");
      }

      previousImagePath = ownedProduct.image_path || null;
      const { rows } = await client.query(
        `DELETE FROM products
         WHERE id = $1 AND business_id = $2
         RETURNING *`,
        [id, ownedProduct.business_id]
      );

      await saveAuditLog({
        business_id: ownedProduct.business_id,
        usuario_id: actor.id,
        modulo: "products",
        accion: "delete_product",
        entidad_tipo: "product",
        entidad_id: id,
        detalle_anterior: { entity: "product", entity_id: id, snapshot: buildProductSnapshot(ownedProduct), version: 1 },
        detalle_nuevo: { entity: "product", entity_id: id, snapshot: {}, version: 1 },
        motivo: actor?.support_context?.reason || "",
        metadata: buildProductAuditMetadata(actor, { delete_mode: "hard" })
      }, { client });

      await client.query("COMMIT");
      if (previousImagePath) {
        await deleteStoredImage(previousImagePath).catch(() => {});
      }
      return { mode: "hard", product: mapProductRow(rows[0]), requested_action: action };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE products
       SET is_active = FALSE, status = 'inactivo', updated_at = NOW()
       WHERE id = $1 AND business_id = $2
       RETURNING *`,
      [id, current.business_id]
    );
    await saveAuditLog({
      business_id: current.business_id,
      usuario_id: actor.id,
      modulo: "products",
      accion: "deactivate_product",
      entidad_tipo: "product",
      entidad_id: id,
      detalle_anterior: { entity: "product", entity_id: id, snapshot: buildProductSnapshot(current), version: 1 },
      detalle_nuevo: { entity: "product", entity_id: id, snapshot: buildProductSnapshot(rows[0]), version: 1 },
      motivo: actor?.support_context?.reason || "",
      metadata: buildProductAuditMetadata(actor, { delete_mode: "soft" })
    }, { client });
    await client.query("COMMIT");
    return { mode: "soft", product: mapProductRow(rows[0]), requested_action: action || "deactivate" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
  previewProductImport,
  confirmProductImport,
  listRestockProducts,
  createProduct,
  updateProduct,
  uploadProductImage,
  removeProductImage,
  updateProductStatus,
  deleteProduct,
  applyBulkDiscount
};
