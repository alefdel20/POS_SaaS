const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const initialCatalogs = require("../data/initialCatalogs.json");
const { normalizePosType } = require("../utils/business");
const { SALE_UNITS } = require("../constants/saleUnits");
const { POS_TYPES_WITH_GUIDED_BUNDLE } = require("./initialCatalogSeedService");
const { resolveSku, generateUniqueBarcode, ensureCategoryReference } = require("./productService");

// pos_type canonical (normalizePosType) -> clave en initialCatalogs.json.
// Solo los giros con wizard guiado; el resto no tiene paquete.
const BUNDLE_CATALOG_KEY_BY_POS_TYPE = {
  Papeleria: "papeleria",
  Tienda: "tienda",
  Tlapaleria: "ferreteria"
};

function getBundleForBusiness(business) {
  const posType = normalizePosType(business?.pos_type);
  const catalogKey = posType && POS_TYPES_WITH_GUIDED_BUNDLE.includes(posType)
    ? BUNDLE_CATALOG_KEY_BY_POS_TYPE[posType]
    : null;
  const items = catalogKey && Array.isArray(initialCatalogs[catalogKey]) ? initialCatalogs[catalogKey] : [];

  return items.map((item, index) => ({
    bundle_index: index,
    name: item.name,
    price: item.price,
    cost: item.cost,
    category: item.category,
    unit: item.unit
  }));
}

function normalizeSelectionPrice(value) {
  const numeric = Number(value);
  if (value === null || value === "" || !Number.isFinite(numeric) || numeric <= 0) {
    throw new ApiError(400, "Selection price must be greater than zero");
  }
  if (Math.abs(numeric * 100000 - Math.round(numeric * 100000)) > 1e-9) {
    throw new ApiError(400, "Selection price cannot exceed 5 decimals");
  }
  return Math.round((numeric + Number.EPSILON) * 100000) / 100000;
}

function normalizeCost(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round((numeric + Number.EPSILON) * 100000) / 100000 : 0;
}

function normalizeUnit(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return SALE_UNITS.includes(normalized) ? normalized : "pieza";
}

function validateSelections(selections, bundle) {
  if (!Array.isArray(selections)) {
    throw new ApiError(400, "selections must be an array");
  }
  const seen = new Set();
  const included = [];
  for (const selection of selections) {
    const index = Number(selection?.bundle_index);
    if (!Number.isInteger(index) || index < 0 || index >= bundle.length) {
      throw new ApiError(400, "Invalid bundle_index");
    }
    if (seen.has(index)) {
      throw new ApiError(400, "Duplicate bundle_index");
    }
    seen.add(index);
    if (selection.included !== true) continue;
    included.push({ item: bundle[index], price: normalizeSelectionPrice(selection.price) });
  }
  return included;
}

async function confirmBundle(business, user, selections, { client: externalClient } = {}) {
  const businessId = Number(business?.id);
  if (!Number.isInteger(businessId) || businessId <= 0) {
    throw new ApiError(401, "Authenticated user is missing business context");
  }

  const bundle = getBundleForBusiness(business);
  if (bundle.length === 0) {
    throw new ApiError(400, "This business type has no guided bundle");
  }
  const included = validateSelections(selections, bundle);

  const client = externalClient || await pool.connect();
  try {
    await client.query("BEGIN");

    // Fila del perfil bloqueada: serializa confirmaciones concurrentes del mismo negocio.
    await client.query(
      `INSERT INTO company_profiles (business_id, profile_key, general_settings, is_active)
       VALUES ($1, 'default', '{}'::jsonb, TRUE)
       ON CONFLICT (business_id, profile_key) DO NOTHING`,
      [businessId]
    );
    const { rows: profileRows } = await client.query(
      `SELECT id, general_settings
       FROM company_profiles
       WHERE business_id = $1 AND profile_key = 'default'
       FOR UPDATE`,
      [businessId]
    );
    if (profileRows[0]?.general_settings?.bundle_confirmed) {
      throw new ApiError(409, "Bundle already confirmed");
    }

    const categories = new Set();
    for (const { item, price } of included) {
      const category = String(item.category || "General").trim() || "General";
      const name = String(item.name || "").trim();
      const sku = await resolveSku({ name, category }, businessId, null, client);
      const barcode = await generateUniqueBarcode(businessId, null, client);

      await client.query(
        `INSERT INTO products (
          name, sku, barcode, category, description, price, cost_price, unidad_de_venta,
          stock, stock_minimo, stock_maximo, status, is_active, business_id
        ) VALUES ($1, $2, $3, $4, '', $5, $6, $7, 0, 0, 0, 'activo', TRUE, $8)`,
        [name, sku, barcode, category, price, normalizeCost(item.cost), normalizeUnit(item.unit), businessId]
      );
      categories.add(category);
    }

    for (const category of categories) {
      await ensureCategoryReference(category, businessId, user, client);
    }

    await client.query(
      `UPDATE company_profiles
       SET general_settings = COALESCE(general_settings, '{}'::jsonb) || $1::jsonb,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $3 AND business_id = $4`,
      [
        JSON.stringify({ bundle_confirmed: true, bundle_confirmed_at: new Date().toISOString() }),
        user?.id || null,
        profileRows[0].id,
        businessId
      ]
    );

    await client.query("COMMIT");
    return { inserted: included.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (!externalClient) client.release();
  }
}

async function getBundleStatus(business) {
  const businessId = Number(business?.id);
  const [{ rows }, { rows: seedRows }] = await Promise.all([
    pool.query(
      `SELECT general_settings
       FROM company_profiles
       WHERE business_id = $1 AND profile_key = 'default'
       LIMIT 1`,
      [businessId]
    ),
    pool.query(
      `SELECT 1
       FROM initial_catalog_seed_runs
       WHERE business_id = $1 AND inserted_count > 0
       LIMIT 1`,
      [businessId]
    )
  ]);
  const posType = normalizePosType(business?.pos_type);
  // Ya sembrado por la siembra automatica: no ofrecer el paquete (solo lectura, no se escribe general_settings).
  const confirmed = Boolean(rows[0]?.general_settings?.bundle_confirmed) || seedRows.length > 0;
  return {
    posType,
    needsBundle: POS_TYPES_WITH_GUIDED_BUNDLE.includes(posType) && !confirmed,
    items: getBundleForBusiness(business)
  };
}

module.exports = {
  getBundleForBusiness,
  getBundleStatus,
  confirmBundle
};
