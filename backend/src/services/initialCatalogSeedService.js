const pool = require("../db/pool");
const { normalizePosType } = require("../utils/business");
const initialCatalogs = require("../data/initialCatalogs.json");

const SEED_VERSION = "2026-04-17-initial-catalog-v1";
const VARGAS_BUSINESS_ID = 11;
const VARGAS_SLUG_KEY = "vargas";
const ALLOWED_UNITS = new Set(["pieza", "kg", "litro", "caja"]);

function stripAccents(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeLookupKey(value) {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeNameKey(value) {
  return normalizeLookupKey(value).replace(/\s+/g, " ");
}

function isVargasBusiness(business) {
  const businessId = Number(business?.id);
  if (businessId === VARGAS_BUSINESS_ID) return true;

  const slug = String(business?.slug || "").trim().toLowerCase();
  return slug === VARGAS_SLUG_KEY;
}

function resolveCatalogKeyForBusiness(business) {
  const rawPosType = normalizePosType(business?.pos_type) || String(business?.pos_type || "").trim();
  const posKey = normalizeLookupKey(rawPosType);
  const businessTypeKey = normalizeLookupKey(business?.business_type);

  const mappedByPosType = new Map([
    ["tienda", "tienda"],
    ["tlapaleria", "ferreteria"],
    ["papeleria", "papeleria"],
    ["veterinaria", "veterinaria"],
    ["dentista", "dental"],
    ["farmacia", "farmacia"],
    ["farmacia consultorio", "farmacia"],
    ["farmaciaconsultorio", "farmacia"],
    ["clinica chica", "clinica"],
    ["clinicachica", "clinica"]
  ]);

  if (mappedByPosType.has(posKey)) {
    return mappedByPosType.get(posKey);
  }

  if (Object.prototype.hasOwnProperty.call(initialCatalogs, posKey)) {
    return posKey;
  }

  if (Object.prototype.hasOwnProperty.call(initialCatalogs, businessTypeKey)) {
    return businessTypeKey;
  }

  return null;
}

function normalizeUnit(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "pieza";
  return ALLOWED_UNITS.has(normalized) ? normalized : "pieza";
}

function normalizeMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.round((numeric + Number.EPSILON) * 100000) / 100000;
}

async function markSeedRun(client, { businessId, catalogKey = null, insertedCount = 0, skippedExistingCount = 0, notes = "" }) {
  await client.query(
    `INSERT INTO initial_catalog_seed_runs (
      business_id,
      seed_version,
      catalog_key,
      inserted_count,
      skipped_existing_count,
      notes
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (business_id) DO NOTHING`,
    [businessId, SEED_VERSION, catalogKey, insertedCount, skippedExistingCount, String(notes || "")]
  );
}

async function seedInitialCatalogForBusiness(client, business) {
  const businessId = Number(business.id);
  const businessName = String(business.name || "").trim();

  if (isVargasBusiness(business)) {
    await markSeedRun(client, {
      businessId,
      notes: "excluded_business_vargas"
    });
    return { businessId, businessName, insertedCount: 0, skippedExistingCount: 0, catalogKey: null, skippedReason: "excluded_business_vargas" };
  }

  const catalogKey = resolveCatalogKeyForBusiness(business);
  if (!catalogKey) {
    await markSeedRun(client, {
      businessId,
      notes: "no_catalog_mapping_for_business"
    });
    return { businessId, businessName, insertedCount: 0, skippedExistingCount: 0, catalogKey: null, skippedReason: "no_catalog_mapping_for_business" };
  }

  const catalogItems = Array.isArray(initialCatalogs[catalogKey]) ? initialCatalogs[catalogKey] : [];
  if (catalogItems.length === 0) {
    await markSeedRun(client, {
      businessId,
      catalogKey,
      notes: "empty_catalog"
    });
    return { businessId, businessName, insertedCount: 0, skippedExistingCount: 0, catalogKey, skippedReason: "empty_catalog" };
  }

  const existingRows = await client.query(
    `SELECT LOWER(BTRIM(name)) AS normalized_name
     FROM products
     WHERE business_id = $1
       AND name IS NOT NULL
       AND BTRIM(name) <> ''`,
    [businessId]
  );
  const existingByName = new Set(
    existingRows.rows
      .map((row) => normalizeNameKey(row.normalized_name))
      .filter(Boolean)
  );

  let insertedCount = 0;
  let skippedExistingCount = 0;

  for (const item of catalogItems) {
    const productName = String(item?.name || "").trim();
    const normalizedName = normalizeNameKey(productName);
    if (!normalizedName) continue;

    if (existingByName.has(normalizedName)) {
      skippedExistingCount += 1;
      continue;
    }

    await client.query(
      `INSERT INTO products (
        name,
        category,
        description,
        price,
        cost_price,
        unidad_de_venta,
        stock,
        stock_minimo,
        stock_maximo,
        status,
        is_active,
        business_id
      ) VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 0, 'activo', TRUE, $7)`,
      [
        productName,
        String(item?.category || "General").trim() || "General",
        "",
        normalizeMoney(item?.price),
        normalizeMoney(item?.cost),
        normalizeUnit(item?.unit),
        businessId
      ]
    );

    existingByName.add(normalizedName);
    insertedCount += 1;
  }

  await markSeedRun(client, {
    businessId,
    catalogKey,
    insertedCount,
    skippedExistingCount
  });

  return { businessId, businessName, insertedCount, skippedExistingCount, catalogKey, skippedReason: null };
}

async function seedInitialCatalogsForExistingBusinesses() {
  const { rows: businesses } = await pool.query(
    `SELECT b.id, b.name, b.slug, b.pos_type, b.business_type
     FROM businesses b
     LEFT JOIN initial_catalog_seed_runs seed ON seed.business_id = b.id
     WHERE seed.business_id IS NULL
     ORDER BY b.id ASC`
  );

  const results = [];
  for (const business of businesses) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const lockCheck = await client.query(
        "SELECT business_id FROM initial_catalog_seed_runs WHERE business_id = $1",
        [business.id]
      );
      if (lockCheck.rows[0]) {
        await client.query("COMMIT");
        continue;
      }

      const result = await seedInitialCatalogForBusiness(client, business);
      results.push(result);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`[INITIAL-CATALOG-SEED] Failed business ${business.id}`, error);
    } finally {
      client.release();
    }
  }

  if (results.length > 0) {
    console.info("[INITIAL-CATALOG-SEED] Seed summary", results);
  }

  return results;
}

module.exports = {
  seedInitialCatalogsForExistingBusinesses
};
