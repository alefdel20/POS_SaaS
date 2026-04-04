const ExcelJS = require("exceljs");
const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const { requireActorBusinessId } = require("../utils/tenant");
const productService = require("./productService");

const SUPPLIER_CATALOG_IMPORT_LIMIT = 500;
const SUPPLIER_CATALOG_COLUMN_ALIASES = {
  supplier_product_code: ["codigo", "código", "clave", "sku proveedor", "sku", "codigo proveedor", "clave proveedor"],
  supplier_product_name: ["nombre", "producto", "name", "product", "articulo", "artículo", "descripcion corta"],
  supplier_description: ["descripcion", "descripción", "detalle", "description"],
  supplier_category: ["categoria", "categoría", "category", "linea", "línea", "rubro"],
  supplier_unit: ["unidad", "unidad compra", "unidad de compra", "uom", "presentacion", "presentación"],
  purchase_cost: ["costo", "precio compra", "precio proveedor", "costo proveedor", "purchase cost", "cost", "compra"],
  currency: ["moneda", "currency", "divisa"],
  pack_size: ["presentacion", "presentación", "empaque", "pack", "pack size", "contenido"],
  min_order_qty: ["minimo", "mínimo", "pedido minimo", "pedido mínimo", "min order", "min order qty"]
};

function stripAccents(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeHeader(value) {
  return stripAccents(String(value || ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCell(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeText(value) {
  return normalizeCell(value);
}

function normalizeLookup(value) {
  return normalizeHeader(value);
}

function detectColumn(header) {
  const normalizedHeader = normalizeHeader(header);
  if (!normalizedHeader) return null;

  for (const [field, aliases] of Object.entries(SUPPLIER_CATALOG_COLUMN_ALIASES)) {
    if (aliases.some((alias) => normalizedHeader === normalizeHeader(alias))) {
      return field;
    }
  }

  for (const [field, aliases] of Object.entries(SUPPLIER_CATALOG_COLUMN_ALIASES)) {
    if (aliases.some((alias) => normalizedHeader.includes(normalizeHeader(alias)))) {
      return field;
    }
  }

  return null;
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
  return values.map((value) => normalizeCell(value));
}

function parseCsvRows(buffer) {
  const text = buffer.toString("utf-8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  return lines.map((line, index) => ({
    rowNumber: index + 1,
    values: parseCsvLine(line)
  }));
}

async function parseXlsxRows(buffer) {
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
      values: row.values.slice(1).map((value) => normalizeCell(value))
    });
  });
  return rows;
}

async function parseWorkbook(file) {
  if (!file?.buffer?.length) {
    throw new ApiError(400, "Import file is required");
  }

  const extension = String(file.originalname || "").toLowerCase().split(".").pop();
  if (!["csv", "xlsx"].includes(extension)) {
    throw new ApiError(400, "Only CSV and XLSX files are allowed");
  }

  const rows = extension === "csv" ? parseCsvRows(file.buffer) : await parseXlsxRows(file.buffer);
  if (!rows.length) {
    throw new ApiError(400, "The file is empty");
  }

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.values.map((header) => normalizeCell(header));
  if (!headers.some(Boolean)) {
    throw new ApiError(400, "The file header is empty");
  }

  const headerMap = {};
  headers.forEach((header, index) => {
    const field = detectColumn(header);
    if (field && headerMap[field] === undefined) {
      headerMap[field] = index;
    }
  });

  return {
    format: extension,
    headers,
    headerMap,
    rows: dataRows.filter((row) => row.values.some((value) => normalizeCell(value)))
  };
}

function normalizeUnit(value, fallbackName = "") {
  const normalized = normalizeHeader(value);
  if (["pieza", "pza", "pz", "unidad", "unit"].includes(normalized)) return "pieza";
  if (["kg", "kilo", "kilos", "kilogramo", "kilogramos"].includes(normalized)) return "kg";
  if (["litro", "litros", "lt", "lts", "l"].includes(normalized)) return "litro";
  if (["caja", "cajas", "box"].includes(normalized)) return "caja";

  const normalizedName = normalizeHeader(fallbackName);
  if (/\b(kg|kilo|kilos|kilogramo|kilogramos)\b/.test(normalizedName)) return "kg";
  if (/\b(lt|lts|litro|litros)\b/.test(normalizedName)) return "litro";
  if (/\b(caja|cajas|box)\b/.test(normalizedName)) return "caja";
  return "pieza";
}

function normalizeMoney(value) {
  const raw = normalizeCell(value);
  if (!raw) return "";
  return raw.replace(/\s+/g, "").replace(/\$(?=\d)/g, "").replace(/,(?=\d{1,5}$)/, ".").replace(/,/g, "");
}

function normalizeQty(value) {
  const raw = normalizeCell(value);
  if (!raw) return "";
  return raw.replace(/,/g, ".");
}

function hasMoreThanThreeDecimals(value) {
  return Math.abs(Number(value) * 1000 - Math.round(Number(value) * 1000)) > 1e-9;
}

function hasMoreThanFiveDecimals(value) {
  return Math.abs(Number(value) * 100000 - Math.round(Number(value) * 100000)) > 1e-9;
}

function mapRowValues(values, headerMap) {
  const valueFor = (field) => {
    const index = headerMap[field];
    return index === undefined ? "" : normalizeCell(values[index]);
  };

  return {
    supplier_product_code: valueFor("supplier_product_code"),
    supplier_product_name: valueFor("supplier_product_name"),
    supplier_description: valueFor("supplier_description"),
    supplier_category: valueFor("supplier_category"),
    supplier_unit: valueFor("supplier_unit"),
    purchase_cost: valueFor("purchase_cost"),
    currency: valueFor("currency"),
    pack_size: valueFor("pack_size"),
    min_order_qty: valueFor("min_order_qty")
  };
}

function buildCatalogStatus({ productId, costChanged, isActive }) {
  if (!isActive) return "inactive";
  if (costChanged) return "cost_changed";
  if (productId) return "linked";
  return "pending";
}

async function requireOwnedSupplier(supplierId, actor, client = pool) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await client.query(
    `SELECT id, business_id, name, email, phone, whatsapp, observations
     FROM suppliers
     WHERE id = $1 AND business_id = $2`,
    [supplierId, businessId]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Supplier not found");
  }
  return rows[0];
}

async function getPreviewContext(supplierId, actor) {
  const businessId = requireActorBusinessId(actor);
  const supplier = await requireOwnedSupplier(supplierId, actor);

  const [catalogRows, productRows] = await Promise.all([
    pool.query(
      `SELECT
         catalog.id,
         catalog.product_id,
         catalog.supplier_product_code,
         catalog.supplier_product_name,
         catalog.purchase_cost,
         catalog.catalog_status,
         catalog.cost_changed,
         products.name AS product_name,
         products.sku AS product_sku
       FROM supplier_catalog_items catalog
       LEFT JOIN products
         ON products.id = catalog.product_id
        AND products.business_id = catalog.business_id
       WHERE catalog.business_id = $1 AND catalog.supplier_id = $2`,
      [businessId, supplierId]
    ),
    pool.query(
      `SELECT id, name, sku, barcode
       FROM products
       WHERE business_id = $1
       ORDER BY name ASC`,
      [businessId]
    )
  ]);

  const existingByCode = new Map();
  const existingByName = new Map();
  for (const row of catalogRows.rows) {
    const codeKey = normalizeLookup(row.supplier_product_code);
    const nameKey = normalizeLookup(row.supplier_product_name);
    if (codeKey) existingByCode.set(codeKey, row);
    if (nameKey && !existingByName.has(nameKey)) existingByName.set(nameKey, row);
  }

  const productsByCode = new Map();
  const productsByName = new Map();
  for (const row of productRows.rows) {
    const skuKey = normalizeLookup(row.sku);
    const barcodeKey = normalizeLookup(row.barcode);
    const nameKey = normalizeLookup(row.name);
    if (skuKey && !productsByCode.has(skuKey)) productsByCode.set(skuKey, row);
    if (barcodeKey && !productsByCode.has(barcodeKey)) productsByCode.set(barcodeKey, row);
    if (nameKey && !productsByName.has(nameKey)) productsByName.set(nameKey, row);
  }

  return {
    businessId,
    supplier,
    existingByCode,
    existingByName,
    productsByCode,
    productsByName
  };
}

function buildPreviewRow(index, rawRow, headerMap, context) {
  const extracted = mapRowValues(rawRow.values, headerMap);
  const warnings = [];
  const errors = [];
  const payload = {
    supplier_product_code: normalizeText(extracted.supplier_product_code),
    supplier_product_name: normalizeText(extracted.supplier_product_name),
    supplier_description: normalizeText(extracted.supplier_description),
    supplier_category: normalizeText(extracted.supplier_category),
    supplier_unit: normalizeUnit(extracted.supplier_unit, extracted.supplier_product_name),
    purchase_cost: normalizeMoney(extracted.purchase_cost),
    currency: normalizeText(extracted.currency).toUpperCase() || "MXN",
    pack_size: normalizeText(extracted.pack_size),
    min_order_qty: normalizeQty(extracted.min_order_qty),
    is_active: true
  };

  if (!payload.supplier_product_name) {
    errors.push("Nombre requerido");
  }

  const normalizedCost = payload.purchase_cost === "" ? Number.NaN : Number(payload.purchase_cost);
  if (!Number.isFinite(normalizedCost) || normalizedCost < 0 || hasMoreThanFiveDecimals(normalizedCost)) {
    errors.push("Costo invalido");
  }

  const normalizedMinOrderQty = payload.min_order_qty === "" ? null : Number(payload.min_order_qty);
  if (normalizedMinOrderQty !== null && (!Number.isFinite(normalizedMinOrderQty) || normalizedMinOrderQty < 0 || hasMoreThanThreeDecimals(normalizedMinOrderQty))) {
    errors.push("Pedido minimo invalido");
  }

  if (!normalizeText(extracted.supplier_unit)) {
    warnings.push(`Unidad no informada, se usara ${payload.supplier_unit}`);
  }

  const codeKey = normalizeLookup(payload.supplier_product_code);
  const nameKey = normalizeLookup(payload.supplier_product_name);
  const existingItem = (codeKey && context.existingByCode.get(codeKey)) || context.existingByName.get(nameKey) || null;
  const suggestedProduct = (codeKey && context.productsByCode.get(codeKey)) || context.productsByName.get(nameKey) || null;
  const costChanged = Boolean(existingItem && Number(existingItem.purchase_cost || 0) !== Number(payload.purchase_cost || 0));

  return {
    row_number: rawRow.rowNumber,
    index,
    payload,
    warnings,
    errors,
    action: errors.length ? "error" : existingItem ? "update" : "create",
    existing_item: existingItem ? {
      id: Number(existingItem.id),
      product_id: existingItem.product_id ? Number(existingItem.product_id) : null,
      supplier_product_name: existingItem.supplier_product_name,
      purchase_cost: Number(existingItem.purchase_cost || 0),
      catalog_status: existingItem.catalog_status,
      cost_changed: Boolean(existingItem.cost_changed),
      product_name: existingItem.product_name || null,
      product_sku: existingItem.product_sku || null
    } : null,
    suggested_product: suggestedProduct ? {
      id: Number(suggestedProduct.id),
      name: suggestedProduct.name,
      sku: suggestedProduct.sku,
      match_reason: codeKey && context.productsByCode.get(codeKey) ? "codigo" : "nombre"
    } : null,
    cost_changed: costChanged
  };
}

function dedupePreviewRows(rows) {
  const seenCodes = new Set();
  const seenNames = new Set();

  for (const row of rows) {
    const codeKey = normalizeLookup(row.payload.supplier_product_code);
    const nameKey = normalizeLookup(row.payload.supplier_product_name);
    if (codeKey) {
      if (seenCodes.has(codeKey)) {
        row.warnings.push("Codigo repetido en el archivo");
      } else {
        seenCodes.add(codeKey);
      }
    }

    if (nameKey) {
      if (seenNames.has(nameKey)) {
        row.warnings.push("Nombre repetido en el archivo");
      } else {
        seenNames.add(nameKey);
      }
    }
  }

  return rows;
}

function summarizePreview(rows) {
  return rows.reduce((summary, row) => {
    if (row.errors.length) {
      summary.with_errors += 1;
      return summary;
    }
    summary.ready += 1;
    if (row.action === "create") summary.new_items += 1;
    if (row.action === "update") summary.updated += 1;
    if (row.cost_changed) summary.cost_changes += 1;
    return summary;
  }, {
    total: rows.length,
    ready: 0,
    new_items: 0,
    updated: 0,
    with_errors: 0,
    cost_changes: 0
  });
}

async function previewSupplierCatalogImport(supplierId, file, actor) {
  const parsedWorkbook = await parseWorkbook(file);
  if (parsedWorkbook.rows.length > SUPPLIER_CATALOG_IMPORT_LIMIT) {
    throw new ApiError(400, `Import limit is ${SUPPLIER_CATALOG_IMPORT_LIMIT} rows per file`);
  }

  const context = await getPreviewContext(supplierId, actor);
  const previewRows = dedupePreviewRows(
    parsedWorkbook.rows.map((row, index) => buildPreviewRow(index, row, parsedWorkbook.headerMap, context))
  );

  return {
    supplier: { id: context.supplier.id, name: context.supplier.name },
    format: parsedWorkbook.format,
    headers: parsedWorkbook.headers,
    detected_columns: parsedWorkbook.headerMap,
    rows: previewRows,
    summary: summarizePreview(previewRows)
  };
}

function sanitizePreviewPayload(row) {
  const payload = row?.payload || row || {};
  const sanitized = {
    supplier_product_code: normalizeText(payload.supplier_product_code),
    supplier_product_name: normalizeText(payload.supplier_product_name),
    supplier_description: normalizeText(payload.supplier_description),
    supplier_category: normalizeText(payload.supplier_category),
    supplier_unit: normalizeUnit(payload.supplier_unit, payload.supplier_product_name),
    purchase_cost: normalizeMoney(payload.purchase_cost),
    currency: normalizeText(payload.currency).toUpperCase() || "MXN",
    pack_size: normalizeText(payload.pack_size),
    min_order_qty: normalizeQty(payload.min_order_qty),
    is_active: payload.is_active !== false
  };

  if (!sanitized.supplier_product_name) {
    throw new ApiError(400, "Imported row requires supplier product name");
  }

  const numericCost = Number(sanitized.purchase_cost || 0);
  if (!Number.isFinite(numericCost) || numericCost < 0 || hasMoreThanFiveDecimals(numericCost)) {
    throw new ApiError(400, "Imported row requires valid purchase cost");
  }

  const numericMinOrderQty = sanitized.min_order_qty === "" ? null : Number(sanitized.min_order_qty);
  if (numericMinOrderQty !== null && (!Number.isFinite(numericMinOrderQty) || numericMinOrderQty < 0 || hasMoreThanThreeDecimals(numericMinOrderQty))) {
    throw new ApiError(400, "Imported row has invalid minimum order quantity");
  }

  return {
    ...sanitized,
    purchase_cost: numericCost,
    min_order_qty: numericMinOrderQty
  };
}

async function findExistingItem(client, businessId, supplierId, payload) {
  const codeKey = normalizeLookup(payload.supplier_product_code);
  if (codeKey) {
    const { rows } = await client.query(
      `SELECT *
       FROM supplier_catalog_items
       WHERE business_id = $1
         AND supplier_id = $2
         AND LOWER(supplier_product_code) = LOWER($3)
       LIMIT 1`,
      [businessId, supplierId, payload.supplier_product_code]
    );
    if (rows[0]) return rows[0];
  }

  const { rows } = await client.query(
    `SELECT *
     FROM supplier_catalog_items
     WHERE business_id = $1
       AND supplier_id = $2
       AND LOWER(supplier_product_name) = LOWER($3)
     ORDER BY product_id IS NOT NULL DESC, updated_at DESC
     LIMIT 1`,
    [businessId, supplierId, payload.supplier_product_name]
  );
  return rows[0] || null;
}

function mapCatalogRow(row) {
  return {
    id: Number(row.id),
    supplier_id: Number(row.supplier_id),
    product_id: row.product_id ? Number(row.product_id) : null,
    supplier_product_code: row.supplier_product_code || "",
    supplier_product_name: row.supplier_product_name,
    supplier_description: row.supplier_description || "",
    supplier_category: row.supplier_category || "",
    supplier_unit: row.supplier_unit || "pieza",
    purchase_cost: Number(row.purchase_cost || 0),
    previous_purchase_cost: row.previous_purchase_cost === null || row.previous_purchase_cost === undefined ? null : Number(row.previous_purchase_cost),
    currency: row.currency || "MXN",
    pack_size: row.pack_size || "",
    min_order_qty: row.min_order_qty === null || row.min_order_qty === undefined ? null : Number(row.min_order_qty),
    is_active: Boolean(row.is_active),
    cost_changed: Boolean(row.cost_changed),
    catalog_status: row.catalog_status,
    source_file: row.source_file || null,
    imported_at: row.imported_at,
    updated_at: row.updated_at,
    last_cost_applied_at: row.last_cost_applied_at || null,
    linked_product: row.product_id ? {
      id: Number(row.product_id),
      name: row.product_name || null,
      sku: row.product_sku || null,
      cost_price: row.product_cost_price === null || row.product_cost_price === undefined ? null : Number(row.product_cost_price)
    } : null
  };
}

async function confirmSupplierCatalogImport(supplierId, rows, actor, sourceFile = null) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ApiError(400, "Import rows are required");
  }
  if (rows.length > SUPPLIER_CATALOG_IMPORT_LIMIT) {
    throw new ApiError(400, `Import limit is ${SUPPLIER_CATALOG_IMPORT_LIMIT} rows per request`);
  }

  const businessId = requireActorBusinessId(actor);
  const client = await pool.connect();
  const results = [];

  try {
    await client.query("BEGIN");
    await requireOwnedSupplier(supplierId, actor, client);

    for (const row of rows) {
      try {
        const payload = sanitizePreviewPayload(row);
        const existingItem = await findExistingItem(client, businessId, supplierId, payload);
        const costChanged = Boolean(existingItem && Number(existingItem.purchase_cost || 0) !== Number(payload.purchase_cost || 0));

        if (existingItem) {
          const nextStatus = buildCatalogStatus({
            productId: existingItem.product_id,
            costChanged,
            isActive: payload.is_active
          });

          const { rows: updatedRows } = await client.query(
            `UPDATE supplier_catalog_items
             SET supplier_product_code = $1,
                 supplier_product_name = $2,
                 supplier_description = $3,
                 supplier_category = $4,
                 supplier_unit = $5,
                 purchase_cost = $6,
                 previous_purchase_cost = CASE WHEN $7 THEN purchase_cost ELSE previous_purchase_cost END,
                 currency = $8,
                 pack_size = $9,
                 min_order_qty = $10,
                 is_active = $11,
                 cost_changed = $7,
                 catalog_status = $12,
                 source_file = $13,
                 imported_at = NOW(),
                 updated_at = NOW()
             WHERE id = $14 AND business_id = $15
             RETURNING *`,
            [
              payload.supplier_product_code || null,
              payload.supplier_product_name,
              payload.supplier_description,
              payload.supplier_category || null,
              payload.supplier_unit,
              payload.purchase_cost,
              costChanged,
              payload.currency,
              payload.pack_size || null,
              payload.min_order_qty,
              payload.is_active,
              nextStatus,
              sourceFile,
              existingItem.id,
              businessId
            ]
          );

          results.push({
            row_number: row?.row_number || row?.index || null,
            status: "updated",
            item_id: Number(updatedRows[0].id),
            message: costChanged ? "Catalogo actualizado con cambio de costo" : "Catalogo actualizado",
            cost_changed: costChanged
          });
          continue;
        }

        const { rows: createdRows } = await client.query(
          `INSERT INTO supplier_catalog_items (
            business_id,
            supplier_id,
            supplier_product_code,
            supplier_product_name,
            supplier_description,
            supplier_category,
            supplier_unit,
            purchase_cost,
            currency,
            pack_size,
            min_order_qty,
            is_active,
            cost_changed,
            catalog_status,
            source_file,
            imported_at,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, FALSE, 'new', $13, NOW(), NOW(), NOW())
          RETURNING *`,
          [
            businessId,
            supplierId,
            payload.supplier_product_code || null,
            payload.supplier_product_name,
            payload.supplier_description,
            payload.supplier_category || null,
            payload.supplier_unit,
            payload.purchase_cost,
            payload.currency,
            payload.pack_size || null,
            payload.min_order_qty,
            payload.is_active,
            sourceFile
          ]
        );

        results.push({
          row_number: row?.row_number || row?.index || null,
          status: "imported",
          item_id: Number(createdRows[0].id),
          message: "Catalogo importado",
          cost_changed: false
        });
      } catch (error) {
        results.push({
          row_number: row?.row_number || row?.index || null,
          status: "error",
          message: error instanceof Error ? error.message : "Import row failed"
        });
      }
    }

    await client.query("COMMIT");
    return {
      results,
      summary: {
        total: rows.length,
        imported: results.filter((row) => row.status === "imported").length,
        updated: results.filter((row) => row.status === "updated").length,
        errors: results.filter((row) => row.status === "error").length,
        cost_changes: results.filter((row) => row.cost_changed).length
      }
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function buildListFilters(filters = {}) {
  return {
    search: normalizeText(filters.search),
    status: normalizeText(filters.status).toLowerCase(),
    linked: normalizeText(filters.linked).toLowerCase(),
    cost_changed: normalizeText(filters.cost_changed).toLowerCase(),
    active: normalizeText(filters.active).toLowerCase(),
    category: normalizeText(filters.category),
    supplier_product_code: normalizeText(filters.supplier_product_code)
  };
}

async function listSupplierCatalog(supplierId, filters, actor) {
  const businessId = requireActorBusinessId(actor);
  const supplier = await requireOwnedSupplier(supplierId, actor);
  const normalizedFilters = buildListFilters(filters);
  const conditions = ["catalog.business_id = $1", "catalog.supplier_id = $2"];
  const params = [businessId, supplierId];

  if (normalizedFilters.search) {
    params.push(`%${normalizedFilters.search}%`);
    conditions.push(`(catalog.supplier_product_name ILIKE $${params.length} OR COALESCE(catalog.supplier_description, '') ILIKE $${params.length})`);
  }
  if (normalizedFilters.category) {
    params.push(normalizedFilters.category);
    conditions.push(`COALESCE(catalog.supplier_category, '') = $${params.length}`);
  }
  if (normalizedFilters.supplier_product_code) {
    params.push(`%${normalizedFilters.supplier_product_code}%`);
    conditions.push(`COALESCE(catalog.supplier_product_code, '') ILIKE $${params.length}`);
  }
  if (normalizedFilters.status) {
    params.push(normalizedFilters.status);
    conditions.push(`catalog.catalog_status = $${params.length}`);
  }
  if (normalizedFilters.linked === "linked") {
    conditions.push("catalog.product_id IS NOT NULL");
  } else if (normalizedFilters.linked === "unlinked") {
    conditions.push("catalog.product_id IS NULL");
  }
  if (normalizedFilters.cost_changed === "true") {
    conditions.push("catalog.cost_changed = TRUE");
  }
  if (normalizedFilters.active === "active") {
    conditions.push("catalog.is_active = TRUE");
  } else if (normalizedFilters.active === "inactive") {
    conditions.push("catalog.is_active = FALSE");
  }

  const [itemsResult, summaryResult, importsResult, categoriesResult] = await Promise.all([
    pool.query(
      `SELECT
         catalog.*,
         products.name AS product_name,
         products.sku AS product_sku,
         products.cost_price AS product_cost_price
       FROM supplier_catalog_items catalog
       LEFT JOIN products
         ON products.id = catalog.product_id
        AND products.business_id = catalog.business_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY catalog.cost_changed DESC, catalog.updated_at DESC, catalog.supplier_product_name ASC`,
      params
    ),
    pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE product_id IS NOT NULL)::int AS linked,
         COUNT(*) FILTER (WHERE product_id IS NULL)::int AS pending,
         COUNT(*) FILTER (WHERE cost_changed = TRUE)::int AS cost_changes,
         COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active
       FROM supplier_catalog_items
       WHERE business_id = $1 AND supplier_id = $2`,
      [businessId, supplierId]
    ),
    pool.query(
      `SELECT
         COALESCE(source_file, 'Carga manual') AS source_file,
         MAX(imported_at) AS imported_at,
         COUNT(*)::int AS item_count,
         COUNT(*) FILTER (WHERE product_id IS NOT NULL)::int AS linked_count,
         COUNT(*) FILTER (WHERE cost_changed = TRUE)::int AS cost_changes
       FROM supplier_catalog_items
       WHERE business_id = $1 AND supplier_id = $2
       GROUP BY COALESCE(source_file, 'Carga manual')
       ORDER BY MAX(imported_at) DESC
       LIMIT 10`,
      [businessId, supplierId]
    ),
    pool.query(
      `SELECT DISTINCT supplier_category
       FROM supplier_catalog_items
       WHERE business_id = $1
         AND supplier_id = $2
         AND supplier_category IS NOT NULL
         AND supplier_category <> ''
       ORDER BY supplier_category ASC`,
      [businessId, supplierId]
    )
  ]);

  return {
    supplier,
    summary: {
      total: Number(summaryResult.rows[0]?.total || 0),
      linked: Number(summaryResult.rows[0]?.linked || 0),
      pending: Number(summaryResult.rows[0]?.pending || 0),
      cost_changes: Number(summaryResult.rows[0]?.cost_changes || 0),
      active: Number(summaryResult.rows[0]?.active || 0)
    },
    categories: categoriesResult.rows.map((row) => row.supplier_category),
    imports: importsResult.rows.map((row) => ({
      source_file: row.source_file,
      imported_at: row.imported_at,
      item_count: Number(row.item_count || 0),
      linked_count: Number(row.linked_count || 0),
      cost_changes: Number(row.cost_changes || 0)
    })),
    items: itemsResult.rows.map(mapCatalogRow)
  };
}

async function getCatalogItemOwned(client, supplierId, itemId, actor) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await client.query(
    `SELECT *
     FROM supplier_catalog_items
     WHERE id = $1
       AND supplier_id = $2
       AND business_id = $3`,
    [itemId, supplierId, businessId]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Supplier catalog item not found");
  }
  return rows[0];
}

async function linkCatalogItemToProduct(supplierId, itemId, productId, actor) {
  const businessId = requireActorBusinessId(actor);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await requireOwnedSupplier(supplierId, actor, client);
    const item = await getCatalogItemOwned(client, supplierId, itemId, actor);
    const { rows: productRows } = await client.query(
      `SELECT id
       FROM products
       WHERE id = $1 AND business_id = $2`,
      [productId, businessId]
    );
    if (!productRows[0]) {
      throw new ApiError(404, "Internal product not found");
    }

    await client.query(
      `UPDATE supplier_catalog_items
       SET product_id = $1,
           catalog_status = $2,
           updated_at = NOW()
       WHERE id = $3 AND business_id = $4`,
      [productId, item.cost_changed ? "cost_changed" : "linked", itemId, businessId]
    );

    await client.query(
      `INSERT INTO product_suppliers (product_id, supplier_id, is_primary, purchase_cost, cost_updated_at, business_id)
       VALUES ($1, $2, FALSE, $3, CASE WHEN $3 IS NULL THEN NULL ELSE NOW() END, $4)
       ON CONFLICT (product_id, supplier_id)
       DO UPDATE SET
         purchase_cost = COALESCE(EXCLUDED.purchase_cost, product_suppliers.purchase_cost),
         cost_updated_at = CASE WHEN EXCLUDED.purchase_cost IS NULL THEN product_suppliers.cost_updated_at ELSE NOW() END,
         business_id = EXCLUDED.business_id`,
      [productId, supplierId, item.purchase_cost, businessId]
    );

    await client.query("COMMIT");
    return listSupplierCatalog(supplierId, {}, actor);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createInternalProductFromCatalogItem(supplierId, itemId, payload, actor) {
  const supplier = await requireOwnedSupplier(supplierId, actor);
  const item = await getCatalogItemOwned(pool, supplierId, itemId, actor);
  if (item.product_id) {
    throw new ApiError(409, "This supplier catalog item is already linked");
  }

  const createdProduct = await productService.createProduct({
    name: payload.name || item.supplier_product_name,
    category: payload.category || item.supplier_category || "General",
    description: payload.description ?? item.supplier_description ?? "",
    price: payload.price,
    cost_price: payload.cost_price ?? item.purchase_cost ?? 0,
    stock: payload.stock ?? 0,
    stock_minimo: payload.stock_minimo ?? 0,
    stock_maximo: payload.stock_maximo ?? 0,
    unidad_de_venta: payload.unidad_de_venta || item.supplier_unit || "pieza",
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    supplier_email: supplier.email,
    supplier_phone: supplier.phone,
    supplier_whatsapp: supplier.whatsapp,
    supplier_observations: supplier.observations || "",
    source: "supplier_catalog"
  }, actor);

  await linkCatalogItemToProduct(supplierId, itemId, createdProduct.id, actor);
  return createdProduct;
}

async function applyCatalogCostToProduct(supplierId, itemId, actor) {
  const businessId = requireActorBusinessId(actor);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await requireOwnedSupplier(supplierId, actor, client);
    const item = await getCatalogItemOwned(client, supplierId, itemId, actor);
    if (!item.product_id) {
      throw new ApiError(409, "The supplier item must be linked before applying cost");
    }

    await client.query(
      `UPDATE products
       SET cost_price = $1,
           supplier_id = $2,
           updated_at = NOW()
       WHERE id = $3 AND business_id = $4`,
      [item.purchase_cost, supplierId, item.product_id, businessId]
    );

    await client.query(
      `INSERT INTO product_suppliers (product_id, supplier_id, is_primary, purchase_cost, cost_updated_at, business_id)
       VALUES ($1, $2, FALSE, $3, NOW(), $4)
       ON CONFLICT (product_id, supplier_id)
       DO UPDATE SET
         purchase_cost = EXCLUDED.purchase_cost,
         cost_updated_at = NOW(),
         business_id = EXCLUDED.business_id`,
      [item.product_id, supplierId, item.purchase_cost, businessId]
    );

    await client.query(
      `UPDATE supplier_catalog_items
       SET cost_changed = FALSE,
           catalog_status = $1,
           last_cost_applied_at = NOW(),
           updated_at = NOW()
       WHERE id = $2 AND business_id = $3`,
      [item.is_active ? "cost_applied" : "inactive", itemId, businessId]
    );

    await client.query("COMMIT");
    return listSupplierCatalog(supplierId, {}, actor);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  listSupplierCatalog,
  previewSupplierCatalogImport,
  confirmSupplierCatalogImport,
  linkCatalogItemToProduct,
  createInternalProductFromCatalogItem,
  applyCatalogCostToProduct
};
