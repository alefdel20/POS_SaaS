const pool = require("../db/pool");
const ApiError = require("../utils/ApiError");
const initialCatalogs = require("../data/initialCatalogs.json");
const { normalizePosType } = require("../utils/business");
const { SALE_UNITS, isIntegerUnit } = require("../constants/saleUnits");
const { POS_TYPES_WITH_GUIDED_BUNDLE } = require("./initialCatalogSeedService");
const { resolveSku, generateUniqueBarcode, ensureCategoryReference } = require("./productService");
const { syncStaffUsersPosType } = require("./onboardingService");

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

// Stock inicial opcional: ausente / null / "" => 0. Misma regla que ProductsPage.tsx
// (validateQuantityByUnitInput): >= 0; entero para unidades enteras, max 3 decimales para el resto.
function normalizeSelectionStock(value, unit) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return 0;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new ApiError(400, "Selection stock must be a number greater than or equal to zero");
  }
  if (isIntegerUnit(unit)) {
    if (!Number.isInteger(numeric)) {
      throw new ApiError(400, `Selection stock must be an integer for unit ${unit}`);
    }
    return numeric;
  }
  if (Math.abs(numeric * 1000 - Math.round(numeric * 1000)) > 1e-9) {
    throw new ApiError(400, `Selection stock cannot exceed 3 decimals for unit ${unit}`);
  }
  return Math.round((numeric + Number.EPSILON) * 1000) / 1000;
}

// products.name es VARCHAR(150) (infra/postgres/01-schema.sql).
const PRODUCT_NAME_MAX_LENGTH = 150;

// Renombre opcional: ausente / null / "" (tras trim) => nombre del catalogo.
function normalizeSelectionName(value, catalogName) {
  const fallback = String(catalogName || "").trim();
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") {
    throw new ApiError(400, "Selection name must be a string");
  }
  const trimmed = value.trim();
  if (trimmed === "") return fallback;
  // Postgres cuenta caracteres, no unidades UTF-16.
  if ([...trimmed].length > PRODUCT_NAME_MAX_LENGTH) {
    throw new ApiError(400, `Selection name cannot exceed ${PRODUCT_NAME_MAX_LENGTH} characters`);
  }
  return trimmed;
}

// Negocio ya sembrado por la siembra automatica (metodo anterior al wizard): no acepta paquete ni borrador.
async function hasSeededCatalog(businessId, db = pool) {
  const { rows } = await db.query(
    `SELECT 1
     FROM initial_catalog_seed_runs
     WHERE business_id = $1 AND inserted_count > 0
     LIMIT 1`,
    [businessId]
  );
  return rows.length > 0;
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
    const item = bundle[index];
    included.push({
      item,
      name: normalizeSelectionName(selection.name, item.name),
      price: normalizeSelectionPrice(selection.price),
      stock: normalizeSelectionStock(selection.stock, normalizeUnit(item.unit))
    });
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

    if (await hasSeededCatalog(businessId, client)) {
      throw new ApiError(409, "Bundle already confirmed");
    }

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
    // Mismo orden de candados que changeGuidedPosType (perfil -> negocio). Si el giro cambio
    // mientras esperabamos, el bundle calculado arriba es del catalogo viejo: abortar.
    const { rows: businessRows } = await client.query(
      "SELECT pos_type FROM businesses WHERE id = $1 FOR UPDATE",
      [businessId]
    );
    if (normalizePosType(businessRows[0]?.pos_type) !== normalizePosType(business?.pos_type)) {
      throw new ApiError(409, "El giro del negocio cambió antes de confirmar; vuelve a cargar el paquete.");
    }

    const categories = new Set();
    for (const { item, name, price, stock } of included) {
      const category = String(item.category || "General").trim() || "General";
      const sku = await resolveSku({ name, category }, businessId, null, client);
      const barcode = await generateUniqueBarcode(businessId, null, client);

      await client.query(
        `INSERT INTO products (
          name, sku, barcode, category, description, price, cost_price, unidad_de_venta,
          stock, stock_minimo, stock_maximo, status, is_active, business_id
        ) VALUES ($1, $2, $3, $4, '', $5, $6, $7, $9, 0, 0, 'activo', TRUE, $8)`,
        [name, sku, barcode, category, price, normalizeCost(item.cost), normalizeUnit(item.unit), businessId, stock]
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

// Borrador del wizard: validacion laxa (solo tipos y tamanos). Las reglas de negocio
// (price > 0, stock por unidad, etc.) viven solo en confirmBundle.
const DRAFT_MAX_SELECTIONS = 500; // mismo tope que body("selections") en POST /bundle/confirm
const DRAFT_MAX_CUSTOM_PRODUCTS = 200;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractBundleDraft(generalSettings) {
  return generalSettings?.bundle_draft ?? null;
}

function validateBundleDraft(draft, bundle) {
  if (!isPlainObject(draft)) {
    throw new ApiError(400, "Draft must be an object");
  }
  const { selections, customProducts, activeCategory } = draft;

  if (selections !== undefined) {
    if (!Array.isArray(selections) || selections.length > DRAFT_MAX_SELECTIONS) {
      throw new ApiError(400, `Draft selections must be an array of at most ${DRAFT_MAX_SELECTIONS} items`);
    }
    for (const selection of selections) {
      const index = isPlainObject(selection) ? selection.bundle_index : undefined;
      if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= bundle.length) {
        throw new ApiError(400, "Draft selection has an invalid bundle_index");
      }
    }
  }

  if (customProducts !== undefined) {
    if (!Array.isArray(customProducts) || customProducts.length > DRAFT_MAX_CUSTOM_PRODUCTS) {
      throw new ApiError(400, `Draft customProducts must be an array of at most ${DRAFT_MAX_CUSTOM_PRODUCTS} items`);
    }
    for (const product of customProducts) {
      if (!isPlainObject(product)) {
        throw new ApiError(400, "Draft customProducts items must be objects");
      }
      if (product.name !== undefined && product.name !== null) {
        if (typeof product.name !== "string" || [...product.name].length > PRODUCT_NAME_MAX_LENGTH) {
          throw new ApiError(400, `Draft custom product name must be a string of at most ${PRODUCT_NAME_MAX_LENGTH} characters`);
        }
      }
    }
  }

  if (activeCategory !== undefined && typeof activeCategory !== "string") {
    throw new ApiError(400, "Draft activeCategory must be a string");
  }

  // Solo las tres llaves conocidas, con sus valores tal como llegaron.
  return { selections, customProducts, activeCategory };
}

async function getBundleDraft(business) {
  const businessId = Number(business?.id);
  const { rows } = await pool.query(
    `SELECT general_settings
     FROM company_profiles
     WHERE business_id = $1 AND profile_key = 'default'
     LIMIT 1`,
    [businessId]
  );
  return extractBundleDraft(rows[0]?.general_settings);
}

async function saveBundleDraft(business, user, draft) {
  const businessId = Number(business?.id);
  if (!Number.isInteger(businessId) || businessId <= 0) {
    throw new ApiError(401, "Authenticated user is missing business context");
  }
  const bundle = getBundleForBusiness(business);
  if (bundle.length === 0) {
    throw new ApiError(400, "This business type has no guided bundle");
  }
  const cleanDraft = validateBundleDraft(draft, bundle);

  if (await hasSeededCatalog(businessId)) {
    throw new ApiError(409, "Bundle already confirmed");
  }

  await pool.query(
    `INSERT INTO company_profiles (business_id, profile_key, general_settings, is_active)
     VALUES ($1, 'default', '{}'::jsonb, TRUE)
     ON CONFLICT (business_id, profile_key) DO NOTHING`,
    [businessId]
  );
  // Mismo merge que confirmBundle. La condicion sobre bundle_confirmed va en el WHERE para que
  // sea atomica: si confirmBundle tiene la fila bloqueada, este UPDATE espera y re-evalua.
  const { rowCount } = await pool.query(
    `UPDATE company_profiles
     SET general_settings = COALESCE(general_settings, '{}'::jsonb) || $1::jsonb,
         updated_by = $2,
         updated_at = NOW()
     WHERE business_id = $3
       AND profile_key = 'default'
       AND COALESCE(general_settings->>'bundle_confirmed', 'false') <> 'true'`,
    [JSON.stringify({ bundle_draft: cleanDraft }), user?.id || null, businessId]
  );
  if (rowCount === 0) {
    throw new ApiError(409, "Bundle already confirmed");
  }
}

// Unico punto de la app para cambiar el giro: solo dentro del wizard, entre giros con paquete
// guiado y antes de confirmar. El login y requireAuth leen businesses.pos_type en fresco.
async function changeGuidedPosType(business, user, newPosType) {
  const businessId = Number(business?.id);
  if (!Number.isInteger(businessId) || businessId <= 0) {
    throw new ApiError(401, "Authenticated user is missing business context");
  }
  const nextPosType = normalizePosType(newPosType);
  if (!nextPosType || !POS_TYPES_WITH_GUIDED_BUNDLE.includes(nextPosType)) {
    throw new ApiError(400, "Target business type has no guided bundle");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Mismo candado que confirmBundle: serializa cambio de giro vs. confirmacion.
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
    const { rows: businessRows } = await client.query(
      "SELECT pos_type FROM businesses WHERE id = $1 FOR UPDATE",
      [businessId]
    );
    if (!businessRows[0]) {
      throw new ApiError(404, "Business not found");
    }
    const currentPosType = normalizePosType(businessRows[0].pos_type);
    if (!currentPosType || !POS_TYPES_WITH_GUIDED_BUNDLE.includes(currentPosType)) {
      throw new ApiError(400, "Current business type has no guided bundle");
    }
    if (profileRows[0]?.general_settings?.bundle_confirmed || await hasSeededCatalog(businessId, client)) {
      throw new ApiError(409, "Bundle already confirmed");
    }

    if (currentPosType !== nextPosType) {
      // Mismo par business_type/pos_type que setupOnboarding.
      await client.query(
        `UPDATE businesses
         SET business_type = $1, pos_type = $1, updated_by = $2, updated_at = NOW()
         WHERE id = $3`,
        [nextPosType, user?.id || null, businessId]
      );
      await syncStaffUsersPosType(client, businessId, nextPosType);
      // El borrador referencia bundle_index del catalogo viejo.
      await client.query(
        `UPDATE company_profiles
         SET general_settings = COALESCE(general_settings, '{}'::jsonb) || $1::jsonb,
             updated_by = $2,
             updated_at = NOW()
         WHERE id = $3 AND business_id = $4`,
        [JSON.stringify({ bundle_draft: null }), user?.id || null, profileRows[0].id, businessId]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return getBundleStatus({ id: businessId, pos_type: nextPosType });
}

async function getBundleStatus(business) {
  const businessId = Number(business?.id);
  const [{ rows }, seeded] = await Promise.all([
    pool.query(
      `SELECT general_settings
       FROM company_profiles
       WHERE business_id = $1 AND profile_key = 'default'
       LIMIT 1`,
      [businessId]
    ),
    hasSeededCatalog(businessId)
  ]);
  const posType = normalizePosType(business?.pos_type);
  // Ya sembrado por la siembra automatica: no ofrecer el paquete (solo lectura, no se escribe general_settings).
  const confirmed = Boolean(rows[0]?.general_settings?.bundle_confirmed) || seeded;
  return {
    posType,
    needsBundle: POS_TYPES_WITH_GUIDED_BUNDLE.includes(posType) && !confirmed,
    items: getBundleForBusiness(business),
    // Mismo dato que getBundleDraft, tomado de la fila que ya se leyo arriba (sin segunda consulta).
    draft: extractBundleDraft(rows[0]?.general_settings)
  };
}

module.exports = {
  getBundleForBusiness,
  getBundleStatus,
  getBundleDraft,
  saveBundleDraft,
  confirmBundle,
  changeGuidedPosType
};
