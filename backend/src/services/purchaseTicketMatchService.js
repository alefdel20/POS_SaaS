// Read-only preview for an extracted purchase ticket: supplier candidates and
// a catalog match per line. Three SELECTs, all WHERE business_id; matching
// happens in memory. Never creates suppliers or products and never touches
// stock or costs (no ensureSupplierReference, no restockProduct).
const pool = require("../db/pool");
const { requireActorBusinessId } = require("../utils/tenant");
const { normalizeLookup } = require("../utils/textLookup");
const { parseTicketText, similarityScore } = require("../utils/ticketLineSimilarity");

const MAX_SUPPLIER_CANDIDATES = 3;
const MAX_SUGGESTIONS = 3;
// Name similarity: above SIMILARITY_MATCH (and SIMILARITY_MARGIN clear of the
// runner-up) it is a match; from SIMILARITY_SUGGEST up only a suggestion.
const SIMILARITY_MATCH = 0.8;
const SIMILARITY_MARGIN = 0.1;
const SIMILARITY_SUGGEST = 0.4;

const SUPPLIER_CONFIDENCE = { exact: 1, normalized: 0.9, contains: 0.6 };
// similar is reported as method "name" (the method set the UI knows) with a
// confidence below an exact name match.
const MATCH_CONFIDENCE = { barcode: 1, supplier_code: 0.95, sku: 0.9, supplier_name: 0.85, name: 0.8, similar: 0.75 };

// Legal-entity suffixes, already in normalizeLookup form ("S.A. de C.V." ->
// "s a de c v"). Longest first so "s a de c v" wins over "s a".
const LEGAL_SUFFIXES = [
  "s a p i de c v", "sapi de cv", "s a b de c v", "sab de cv", "s de r l de c v", "s de rl de cv",
  "s a de c v", "sa de cv", "s de r l", "s de rl", "s en c", "s a s", "sas", "s a", "sa", "s c", "sc",
  "a c", "ac", "de c v", "de cv"
];

function stripLegalSuffix(key) {
  let result = key;
  let changed = true;
  while (changed && result) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (result.endsWith(` ${suffix}`)) {
        result = result.slice(0, -suffix.length - 1).trim();
        changed = true;
        break;
      }
    }
  }
  return result;
}

function containsWords(haystack, needle) {
  return needle.length >= 4 && ` ${haystack} `.includes(` ${needle} `);
}

// Up to 3 suppliers of this business whose name looks like the one read.
function rankSupplierCandidates(rawName, suppliers) {
  const raw = String(rawName || "").replace(/\s+/g, " ").trim().toLowerCase();
  const core = stripLegalSuffix(normalizeLookup(rawName));
  if (!raw || !core) return [];

  const candidates = [];
  for (const supplier of suppliers) {
    const name = String(supplier.name || "").replace(/\s+/g, " ").trim().toLowerCase();
    const supplierCore = stripLegalSuffix(normalizeLookup(supplier.name));
    if (!name || !supplierCore) continue;

    let confidence = null;
    if (name === raw) confidence = SUPPLIER_CONFIDENCE.exact;
    else if (supplierCore === core) confidence = SUPPLIER_CONFIDENCE.normalized;
    else if (containsWords(core, supplierCore) || containsWords(supplierCore, core)) confidence = SUPPLIER_CONFIDENCE.contains;

    if (confidence !== null) candidates.push({ id: Number(supplier.id), name: supplier.name, confidence });
  }

  return candidates
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name) || a.id - b.id)
    .slice(0, MAX_SUPPLIER_CANDIDATES);
}

function pushIndex(map, key, productId) {
  if (!key) return;
  const ids = map.get(key) || new Set();
  ids.add(productId);
  map.set(key, ids);
}

function buildMatchContext(products, catalogRows) {
  const productsById = new Map();
  const byBarcode = new Map();
  const bySku = new Map();
  const byName = new Map();
  const tokens = [];
  for (const product of products) {
    const id = Number(product.id);
    productsById.set(id, product);
    pushIndex(byBarcode, normalizeLookup(product.barcode), id);
    pushIndex(bySku, normalizeLookup(product.sku), id);
    const nameKey = normalizeLookup(product.name);
    pushIndex(byName, nameKey, id);
    tokens.push({ id, text: parseTicketText(product.name) });
  }

  // Catalog rows count only when they point to a product loaded above
  // (same business, active).
  const byCatalogCode = new Map();
  const byCatalogName = new Map();
  for (const row of catalogRows) {
    const id = Number(row.product_id);
    if (!productsById.has(id)) continue;
    pushIndex(byCatalogCode, normalizeLookup(row.supplier_product_code), id);
    pushIndex(byCatalogName, normalizeLookup(row.supplier_product_name), id);
  }

  return { productsById, byBarcode, bySku, byName, byCatalogCode, byCatalogName, tokens };
}

function productRef(product) {
  return { product_id: Number(product.id), name: product.name, sku: product.sku || null };
}

// [{ id, score }] at or above SIMILARITY_SUGGEST, best first.
function similarProducts(rawName, context, excluded) {
  const ticket = parseTicketText(rawName);
  if (!ticket.words.size) return [];
  const scored = [];
  for (const { id, text } of context.tokens) {
    if (excluded.has(id)) continue;
    const score = similarityScore(ticket, text);
    if (score >= SIMILARITY_SUGGEST) scored.push({ id, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.id - b.id);
}

// Only a single clear winner above SIMILARITY_MATCH becomes a match.
function isClearWinner(scored) {
  const [best, second] = scored;
  return Boolean(best) && best.score > SIMILARITY_MATCH && (!second || best.score - second.score >= SIMILARITY_MARGIN);
}

// Exact methods in priority order. A key shared by several products is
// ambiguous: no match from it, its products become suggestions instead.
function matchLine(line, context) {
  const nameKey = normalizeLookup(line.name);
  const skuKey = normalizeLookup(line.sku);
  const steps = [
    ["barcode", context.byBarcode, normalizeLookup(line.barcode)],
    ["supplier_code", context.byCatalogCode, skuKey],
    ["sku", context.bySku, skuKey],
    ["supplier_name", context.byCatalogName, nameKey],
    ["name", context.byName, nameKey]
  ];

  const ambiguous = [];
  for (const [method, index, key] of steps) {
    const ids = key ? index.get(key) : null;
    if (!ids) continue;
    if (ids.size === 1) {
      const product = context.productsById.get([...ids][0]);
      return { match: { ...productRef(product), confidence: MATCH_CONFIDENCE[method], method }, suggestions: [] };
    }
    for (const id of ids) if (!ambiguous.includes(id)) ambiguous.push(id);
  }

  const similar = similarProducts(line.name, context, new Set(ambiguous));
  if (!ambiguous.length && isClearWinner(similar)) {
    const product = context.productsById.get(similar[0].id);
    return { match: { ...productRef(product), confidence: MATCH_CONFIDENCE.similar, method: "name" }, suggestions: [] };
  }

  const suggestionIds = [...ambiguous, ...similar.map((entry) => entry.id)];
  return {
    match: null,
    suggestions: suggestionIds.slice(0, MAX_SUGGESTIONS).map((id) => productRef(context.productsById.get(id)))
  };
}

async function buildTicketPreview(actor, ticket, { imageSha256, hideCosts }) {
  const businessId = requireActorBusinessId(actor);

  const [{ rows: suppliers }, { rows: products }] = await Promise.all([
    pool.query(
      `SELECT id, name
       FROM suppliers
       WHERE business_id = $1 AND is_active = TRUE`,
      [businessId]
    ),
    pool.query(
      `SELECT id, name, sku, barcode
       FROM products
       WHERE business_id = $1 AND is_active = TRUE AND status = 'activo'
       ORDER BY id ASC`,
      [businessId]
    )
  ]);

  const supplierCandidates = rankSupplierCandidates(ticket.supplier_name, suppliers);

  // supplier_product_code / supplier_product_name only from the top candidate.
  let catalogRows = [];
  if (supplierCandidates.length) {
    ({ rows: catalogRows } = await pool.query(
      `SELECT product_id, supplier_product_code, supplier_product_name
       FROM supplier_catalog_items
       WHERE business_id = $1 AND supplier_id = $2 AND is_active = TRUE AND product_id IS NOT NULL`,
      [businessId, supplierCandidates[0].id]
    ));
  }

  const context = buildMatchContext(products, catalogRows);

  const preview = {
    ticket: {
      supplier_name_raw: ticket.supplier_name,
      date: ticket.date,
      total: ticket.total,
      folio: ticket.folio,
      image_sha256: imageSha256
    },
    supplier_candidates: supplierCandidates,
    lines: ticket.lines.map((line, index) => ({
      index,
      raw_name: line.name,
      qty: line.qty,
      unit_cost: line.unit_cost,
      ...matchLine(line, context)
    }))
  };

  // Cajero never sees costs: the keys are removed, not nulled.
  if (hideCosts) {
    delete preview.ticket.total;
    for (const line of preview.lines) delete line.unit_cost;
  }

  return preview;
}

module.exports = {
  SIMILARITY_MATCH,
  SIMILARITY_SUGGEST,
  stripLegalSuffix,
  rankSupplierCandidates,
  buildMatchContext,
  matchLine,
  buildTicketPreview
};
