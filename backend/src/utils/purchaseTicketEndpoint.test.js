// Synthetic harness for POST /products/restock/ticket/extract (preview only).
// The real productRoutes router runs on an ephemeral local port behind a fake
// auth that sets req.user; pool.query is an in-memory fake that records every
// SQL statement, and global fetch stands in for the Anthropic API. Checks the
// gate order (role, plan, switch, cajero, quota), cajero without costs,
// business_id isolation and that the only write is ai_token_usage.
// Keys below are dummy placeholders, never real credentials.
//
// Run with: node --test src/utils/purchaseTicketEndpoint.test.js   (from backend/)
for (const name of Object.keys(process.env)) {
  if (/^(AI_|DEEPSEEK_|OLLAMA_|ANTHROPIC_)/.test(name)) delete process.env[name];
}
process.env.AI_PROVIDER = "deepseek";
process.env.AI_PROVIDER_VISION = "anthropic";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const pool = require("../db/pool");
const productRoutes = require("../routes/productRoutes");
const { normalizeLookup, stripAccents } = require("./textLookup");
const { rankSupplierCandidates, buildMatchContext, matchLine, stripLegalSuffix, SIMILARITY_MATCH, SIMILARITY_SUGGEST } = require("../services/purchaseTicketMatchService");
const { parseTicketText, similarityScore } = require("./ticketLineSimilarity");

// ─── Fake Anthropic ──────────────────────────────────────────────────────────

// Requests to the local test server go to the real fetch; everything else
// is the Anthropic API.
const realFetch = globalThis.fetch;
let fetchHandler = null;
let fetchCalls = 0;
let baseUrl;
globalThis.fetch = async (url, init = {}) => {
  if (baseUrl && String(url).startsWith(baseUrl)) return realFetch(url, init);
  fetchCalls += 1;
  return fetchHandler(url, init);
};

function anthropicReply(ticket, { stopReason = "end_turn", text = null } = {}) {
  fetchHandler = async () => new Response(JSON.stringify({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text: text ?? JSON.stringify(ticket) }],
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: stopReason === "refusal" ? { type: "refusal", category: null, explanation: null } : null,
    usage: { input_tokens: 1500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 180 }
  }), { status: 200, headers: { "content-type": "application/json" } });
}

const TICKET = {
  supplier_name: "Abarrotes El Sol, S.A. de C.V.",
  date: "2026-10-10",
  total: 912.5,
  folio: "A-1029",
  lines: [
    { name: "Leche entera 1L", qty: 12, unit_cost: 24.5, sku: null, barcode: "7501055300075" },
    { name: "Refresco cola 600ml", qty: 24, unit_cost: 14, sku: "SOL-REF600", barcode: null },
    { name: "Arroz", qty: 10, unit_cost: 22, sku: "ARZ-1KG", barcode: null },
    { name: "FRIJOL NEGRO BOLSA 900G", qty: 6, unit_cost: 31, sku: null, barcode: null },
    { name: "Atún en agua", qty: 8, unit_cost: 18.75, sku: null, barcode: null },
    { name: "Galletas maria chocolate", qty: 3, unit_cost: 15, sku: null, barcode: null },
    { name: "Producto que no existe", qty: 1, unit_cost: 5, sku: null, barcode: "0000000000000" }
  ]
};

// ─── Fake database ───────────────────────────────────────────────────────────

const PRODUCTS = [
  { id: 1, business_id: 6, name: "Leche Entera 1 L", sku: "LEC-1L", barcode: "7501055300075", is_active: true, status: "activo" },
  { id: 2, business_id: 6, name: "Coca Cola 600 ml", sku: "COC-600", barcode: "7501055300099", is_active: true, status: "activo" },
  { id: 3, business_id: 6, name: "Arroz Morelos 1kg", sku: "ARZ-1KG", barcode: null, is_active: true, status: "activo" },
  { id: 4, business_id: 6, name: "Frijol negro 900 g", sku: "FRI-900", barcode: null, is_active: true, status: "activo" },
  { id: 5, business_id: 6, name: "Atun en agua", sku: "ATU-AG", barcode: null, is_active: true, status: "activo" },
  { id: 6, business_id: 6, name: "Galletas Maria", sku: "GAL-MAR", barcode: null, is_active: true, status: "activo" },
  { id: 7, business_id: 6, name: "Galletas chocolate", sku: "GAL-CHO", barcode: null, is_active: true, status: "activo" },
  { id: 8, business_id: 6, name: "Leche descontinuada", sku: "LEC-OLD", barcode: "0000000000000", is_active: false, status: "inactivo" },
  // Other business: same barcode / SKU / name as products of business 6.
  { id: 90, business_id: 7, name: "Producto que no existe", sku: "ARZ-1KG", barcode: "0000000000000", is_active: true, status: "activo" },
  { id: 91, business_id: 7, name: "Atun en agua", sku: "X", barcode: "7501055300075", is_active: true, status: "activo" }
];

const SUPPLIERS = [
  { id: 10, business_id: 6, name: "Abarrotes El Sol", is_active: true },
  { id: 11, business_id: 6, name: "El Sol", is_active: true },
  { id: 12, business_id: 6, name: "Distribuidora Norte SA de CV", is_active: true },
  { id: 13, business_id: 6, name: "Abarrotes El Sol Viejo", is_active: false },
  { id: 70, business_id: 7, name: "Abarrotes El Sol, S.A. de C.V.", is_active: true }
];

const CATALOG = [
  { business_id: 6, supplier_id: 10, product_id: 2, supplier_product_code: "SOL-REF600", supplier_product_name: "Refresco cola 600ml", is_active: true },
  { business_id: 6, supplier_id: 10, product_id: 4, supplier_product_code: "SOL-FRI", supplier_product_name: "Frijol negro bolsa 900g", is_active: true },
  { business_id: 6, supplier_id: 12, product_id: 5, supplier_product_code: "NOR-1", supplier_product_name: "Atún en agua", is_active: true },
  { business_id: 7, supplier_id: 70, product_id: 91, supplier_product_code: "SOL-REF600", supplier_product_name: "Galletas maria chocolate", is_active: true }
];

let state;

function resetDb({
  plan = "Premium",
  trialExpired = false,
  settings = { ticket_ai_enabled: true, cashier_direct_stock: true },
  tokensUsed = 0
} = {}) {
  state = {
    queries: [],
    subscriptions: { 6: { plan_name: plan, plan_type: "monthly", trial_expired: trialExpired }, 7: { plan_name: "Premium", plan_type: "monthly", trial_expired: false } },
    profiles: { 6: { business_id: 6, profile_key: "default", general_settings: settings }, 7: { business_id: 7, profile_key: "default", general_settings: { ticket_ai_enabled: true } } },
    usage: { 6: tokensUsed, 7: 0 }
  };
}

async function fakeQuery(sql, params = []) {
  state.queries.push({ sql, params });
  const businessId = params[0];
  if (/FROM business_subscriptions/.test(sql)) {
    const row = state.subscriptions[businessId];
    return { rows: row ? [row] : [] };
  }
  if (/FROM company_profiles/.test(sql)) {
    const row = state.profiles[businessId];
    return { rows: row ? [row] : [] };
  }
  if (/SELECT total_tokens_used FROM ai_token_usage/.test(sql)) {
    return { rows: [{ total_tokens_used: state.usage[businessId] }] };
  }
  if (/INSERT INTO ai_token_usage/.test(sql)) {
    state.usage[businessId] += params[3];
    return { rows: [], rowCount: 1 };
  }
  if (/FROM suppliers/.test(sql)) {
    return { rows: SUPPLIERS.filter((s) => s.business_id === businessId && s.is_active).map(({ id, name }) => ({ id, name })) };
  }
  if (/FROM products/.test(sql)) {
    return {
      rows: PRODUCTS.filter((p) => p.business_id === businessId && p.is_active && p.status === "activo")
        .map(({ id, name, sku, barcode }) => ({ id, name, sku, barcode }))
    };
  }
  if (/FROM supplier_catalog_items/.test(sql)) {
    return {
      rows: CATALOG.filter((c) => c.business_id === businessId && c.supplier_id === params[1] && c.is_active && c.product_id)
        .map(({ product_id, supplier_product_code, supplier_product_name }) => ({ product_id, supplier_product_code, supplier_product_name }))
    };
  }
  throw new Error(`SQL no esperado en la prueba: ${sql.slice(0, 80)}`);
}

pool.query = fakeQuery;
pool.connect = async () => { throw new Error("el endpoint no debe abrir transacciones"); };

// ─── Server ──────────────────────────────────────────────────────────────────

let server;
let nextUserId = 1000;

test.before(async () => {
  const app = express();
  // Stand-in for app.js requireAuth: the test sends the user as JSON.
  app.use((req, res, next) => {
    req.user = JSON.parse(req.headers["x-test-user"]);
    next();
  });
  app.use("/products", productRoutes);
  app.use((err, req, res, _next) => {
    res.status(err.statusCode || 500).json({ message: err.message });
  });
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-body")]);

// A fresh user id per request keeps aiRateLimiter out of the way.
async function extract(user, { bytes = PNG_BYTES } = {}) {
  const body = new FormData();
  body.append("image", new Blob([bytes], { type: "image/png" }), "ticket.png");
  const response = await fetch(`${baseUrl}/products/restock/ticket/extract`, {
    method: "POST",
    body,
    headers: { "x-test-user": JSON.stringify({ id: nextUserId++, business_id: 6, pos_type: "Tienda", ...user }) }
  });
  return { status: response.status, json: await response.json() };
}

function writes() {
  return state.queries.filter((q) => /\b(INSERT|UPDATE|DELETE)\b/i.test(q.sql));
}

function startCase(options) {
  resetDb(options);
  anthropicReply(TICKET);
  fetchCalls = 0;
}

// ─── Gates ───────────────────────────────────────────────────────────────────

test("rol sin acceso a Reabastecer: 403 sin consultar ni llamar al modelo", async () => {
  startCase();
  for (const role of ["clinico", "cocina", "soporte"]) {
    const { status } = await extract({ role });
    assert.equal(status, 403);
  }
  assert.equal(fetchCalls, 0);
  assert.equal(state.queries.length, 0);
});

test("giro sin control de inventario: 403", async () => {
  startCase();
  const { status } = await extract({ role: "admin", pos_type: "Restaurante" });
  assert.equal(status, 403);
  assert.equal(fetchCalls, 0);
});

test("plan Basico o trial vencido: 403 de plan, sin llamar al modelo", async () => {
  for (const options of [{ plan: "Básico" }, { plan: null }, { plan: "Premium", trialExpired: true }]) {
    startCase(options);
    const { status, json } = await extract({ role: "admin" });
    assert.equal(status, 403);
    assert.match(json.message, /plan Premium o superior/);
    assert.equal(fetchCalls, 0);
  }
});

test("plan Enterprise: pasa el filtro de plan", async () => {
  startCase({ plan: "Enterprise" });
  assert.equal((await extract({ role: "admin" })).status, 200);
});

test("ticket_ai_enabled apagado o ausente: 403 con mensaje claro", async () => {
  for (const settings of [{}, { ticket_ai_enabled: false }, { ticket_ai_enabled: "true" }]) {
    startCase({ settings });
    const { status, json } = await extract({ role: "admin" });
    assert.equal(status, 403);
    assert.match(json.message, /carga de tickets con IA no está activada/);
    assert.equal(fetchCalls, 0);
  }
});

test("cajero sin cashier_direct_stock: 403; admin y gerente no lo necesitan", async () => {
  startCase({ settings: { ticket_ai_enabled: true } });
  const cajero = await extract({ role: "cajero" });
  assert.equal(cajero.status, 403);
  assert.match(cajero.json.message, /cajero no tiene permitido/);
  assert.equal(fetchCalls, 0);

  for (const role of ["admin", "gerente", "superusuario", "superadmin"]) {
    startCase({ settings: { ticket_ai_enabled: true } });
    assert.equal((await extract({ role })).status, 200, role);
  }
});

test("cuota mensual agotada: 429 sin llamar al modelo", async () => {
  startCase({ tokensUsed: 4000000 });
  const { status } = await extract({ role: "admin" });
  assert.equal(status, 429);
  assert.equal(fetchCalls, 0);
});

test("imagen con magic bytes falsos: 400 antes del modelo", async () => {
  startCase();
  const { status } = await extract({ role: "admin" }, { bytes: Buffer.from("%PDF-1.7 ...") });
  assert.equal(status, 400);
  assert.equal(fetchCalls, 0);
});

// ─── Response ────────────────────────────────────────────────────────────────

test("admin: vista previa completa con emparejamiento por cada metodo", async () => {
  startCase();
  const { status, json } = await extract({ role: "admin" });
  assert.equal(status, 200);
  assert.equal(fetchCalls, 1);

  assert.deepEqual(Object.keys(json).sort(), ["lines", "supplier_candidates", "ticket"]);
  assert.deepEqual(json.ticket, {
    supplier_name_raw: "Abarrotes El Sol, S.A. de C.V.",
    date: "2026-10-10",
    total: 912.5,
    folio: "A-1029",
    image_sha256: require("crypto").createHash("sha256").update(PNG_BYTES).digest("hex")
  });
  // Exact (normalized) first, then containment; the inactive supplier and
  // business 7's identical name never appear.
  assert.deepEqual(json.supplier_candidates, [
    { id: 10, name: "Abarrotes El Sol", confidence: 0.9 },
    { id: 11, name: "El Sol", confidence: 0.6 }
  ]);

  const byIndex = (i) => json.lines[i];
  assert.deepEqual(byIndex(0).match, { product_id: 1, name: "Leche Entera 1 L", sku: "LEC-1L", confidence: 1, method: "barcode" });
  assert.deepEqual(byIndex(1).match, { product_id: 2, name: "Coca Cola 600 ml", sku: "COC-600", confidence: 0.95, method: "supplier_code" });
  assert.deepEqual(byIndex(2).match, { product_id: 3, name: "Arroz Morelos 1kg", sku: "ARZ-1KG", confidence: 0.9, method: "sku" });
  assert.deepEqual(byIndex(3).match, { product_id: 4, name: "Frijol negro 900 g", sku: "FRI-900", confidence: 0.85, method: "supplier_name" });
  assert.deepEqual(byIndex(4).match, { product_id: 5, name: "Atun en agua", sku: "ATU-AG", confidence: 0.8, method: "name" });

  // Shared words only suggest, never match.
  assert.equal(byIndex(5).match, null);
  assert.deepEqual(byIndex(5).suggestions.map((s) => s.product_id).sort(), [6, 7]);

  // Barcode of an inactive product here and of business 7's product: no match.
  assert.equal(byIndex(6).match, null);
  assert.deepEqual(byIndex(6).suggestions, []);

  for (const line of json.lines) {
    assert.deepEqual(Object.keys(line).sort(), ["index", "match", "qty", "raw_name", "suggestions", "unit_cost"]);
    if (line.match) assert.deepEqual(line.suggestions, []);
  }
  assert.equal(byIndex(1).unit_cost, 14);
});

test("cajero con cashier_direct_stock: sin unit_cost ni total en la respuesta", async () => {
  startCase();
  const { status, json } = await extract({ role: "cajero" });
  assert.equal(status, 200);
  assert.equal("total" in json.ticket, false);
  for (const line of json.lines) assert.equal("unit_cost" in line, false);
  assert.equal(JSON.stringify(json).includes("unit_cost"), false);
  assert.equal(JSON.stringify(json).includes("912.5"), false);
  // Matching is the same as for admin.
  assert.equal(json.lines[0].match.product_id, 1);
  assert.equal(json.lines[0].qty, 12);
});

test("aislamiento: toda consulta lleva el business_id del actor como $1", async () => {
  startCase();
  await extract({ role: "gerente" });
  assert.ok(state.queries.length > 0);
  for (const { sql, params } of state.queries) {
    // The token upsert binds business_id as $1 in VALUES.
    if (!/INSERT INTO ai_token_usage/.test(sql)) assert.match(sql, /business_id = \$1/, sql);
    assert.equal(params[0], 6, sql);
  }
  // Catalog only for the top supplier candidate of this business.
  const catalog = state.queries.filter((q) => /FROM supplier_catalog_items/.test(q.sql));
  assert.equal(catalog.length, 1);
  assert.deepEqual(catalog[0].params, [6, 10]);
});

test("sin escrituras salvo ai_token_usage; los tokens se suman al negocio", async () => {
  startCase();
  await extract({ role: "admin" });
  const written = writes();
  assert.equal(written.length, 1);
  assert.match(written[0].sql, /INSERT INTO ai_token_usage/);
  assert.equal(written[0].params[0], 6);
  assert.equal(state.usage[6], 1680);
  assert.equal(state.usage[7], 0);
});

test("extraccion fallida: 422 generico y los tokens cobrados se registran", async () => {
  const cases = [
    { stopReason: "refusal", text: "" },
    { stopReason: "max_tokens", text: "{\"supplier_name\": \"Abarr" },
    { text: "no es json" },
    { text: "{\"supplier_name\": null}" }
  ];
  for (const reply of cases) {
    resetDb();
    fetchCalls = 0;
    anthropicReply(null, reply);
    const { status, json } = await extract({ role: "admin" });
    assert.equal(status, 422);
    assert.match(json.message, /No se pudo leer el ticket/);
    assert.equal(state.usage[6], 1680);
    assert.equal(writes().length, 1);
    // No preview reads after a failed extraction.
    assert.equal(state.queries.some((q) => /FROM (products|suppliers)/.test(q.sql)), false);
  }
});

test("error de la API: 502 sin detalles internos y sin tokens", async () => {
  resetDb();
  fetchHandler = async () => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), {
    status: 400, headers: { "content-type": "application/json" }
  });
  const { status, json } = await extract({ role: "admin" });
  assert.equal(status, 502);
  assert.doesNotMatch(json.message, /Anthropic|Overloaded/);
  assert.equal(writes().length, 0);
});

// ─── Matching units ──────────────────────────────────────────────────────────

test("normalizeLookup movido a utils conserva el comportamiento", () => {
  assert.equal(normalizeLookup("  Atún   en Agua!! "), "atun en agua");
  assert.equal(normalizeLookup("SKU-001/a"), "sku 001 a");
  assert.equal(normalizeLookup(null), "");
  assert.equal(stripAccents("Ñandú"), "Nandu");
});

test("proveedor: sufijos legales, contenido y maximo 3 candidatos", () => {
  assert.equal(stripLegalSuffix(normalizeLookup("Grupo Lala, S.A.B. de C.V.")), "grupo lala");
  assert.equal(stripLegalSuffix(normalizeLookup("Bimbo SAPI de CV")), "bimbo");
  assert.equal(stripLegalSuffix(normalizeLookup("Casa")), "casa");

  const suppliers = [
    { id: 1, name: "Bimbo" },
    { id: 2, name: "bimbo" },
    { id: 3, name: "Bimbo S.A. de C.V." },
    { id: 4, name: "Grupo Bimbo Centro" },
    { id: 5, name: "Lala" }
  ];
  const ranked = rankSupplierCandidates("BIMBO", suppliers);
  assert.equal(ranked.length, 3);
  assert.deepEqual(ranked.map((s) => s.confidence), [1, 1, 0.9]);
  assert.deepEqual(rankSupplierCandidates(null, suppliers), []);
  assert.deepEqual(rankSupplierCandidates("Sol", [{ id: 1, name: "Soledad" }]), []);
});

test("clave ambigua (dos productos): sin match, ambos como sugerencia", () => {
  const context = buildMatchContext([
    { id: 1, name: "Agua 1L", sku: "AG", barcode: "750" },
    { id: 2, name: "Agua 1 L", sku: "AG", barcode: "750" }
  ], []);
  const result = matchLine({ name: "Botella", sku: "AG", barcode: "750" }, context);
  assert.equal(result.match, null);
  assert.deepEqual(result.suggestions.map((s) => s.product_id), [1, 2]);
});

// ─── Name similarity (ticket text vs. catalog name) ─────────────────────────

test("normalizacion de ticket: unidad pegada, sinonimos y palabras vacias", () => {
  const coca = parseTicketText("COCA COLA 600ml");
  assert.deepEqual([...coca.words], ["coca", "cola"]);
  assert.deepEqual(coca.sizes, [{ num: 600, unit: "ml" }]);
  assert.deepEqual(parseTicketText("Agua 1L").sizes, [{ num: 1, unit: "l" }]);
  assert.deepEqual(parseTicketText("Agua 1 litro").sizes, [{ num: 1, unit: "l" }]);
  assert.deepEqual(parseTicketText("Leche 1,5 LTS").sizes, [{ num: 1.5, unit: "l" }]);
  assert.deepEqual(parseTicketText("Frijol 900gr").sizes, [{ num: 900, unit: "g" }]);
  assert.deepEqual(parseTicketText("Jabon 3 piezas").sizes, [{ num: 3, unit: "pza" }]);
  assert.deepEqual([...parseTicketText("Cafe de la olla con canela c azucar").words], ["cafe", "olla", "canela", "azucar"]);
});

const SIMILAR_CATALOG = [
  { id: 1, name: "Coca cola 600 ml ret", sku: null, barcode: null },
  { id: 2, name: "Coca cola 550", sku: null, barcode: null },
  { id: 3, name: "Sabritas Naturales", sku: null, barcode: null },
  { id: 4, name: "Coca cola 1 l ret", sku: null, barcode: null }
];

function scoreOf(rawName, productName) {
  return similarityScore(parseTicketText(rawName), parseTicketText(productName));
}

test("COCA COLA 600ml: match con 600 ml ret, nunca con 550 ni con 1 l", () => {
  assert.ok(scoreOf("COCA COLA 600ml", "Coca cola 600 ml ret") > SIMILARITY_MATCH);
  assert.equal(scoreOf("COCA COLA 600ml", "Coca cola 550"), 0);
  assert.equal(scoreOf("COCA COLA 600ml", "Coca cola 1 l ret"), 0);

  const result = matchLine({ name: "COCA COLA 600ml" }, buildMatchContext(SIMILAR_CATALOG, []));
  assert.deepEqual(result.match, { product_id: 1, name: "Coca cola 600 ml ret", sku: null, confidence: 0.75, method: "name" });
  assert.deepEqual(result.suggestions, []);

  // Only the 550 in the catalog: no match and no suggestion.
  const only550 = matchLine({ name: "COCA COLA 600ml" }, buildMatchContext([SIMILAR_CATALOG[1]], []));
  assert.equal(only550.match, null);
  assert.deepEqual(only550.suggestions, []);
});

test("NATURALES 200g y PAPAS SABRITAS: sugerencia de Sabritas Naturales, sin match", () => {
  const context = buildMatchContext(SIMILAR_CATALOG, []);
  for (const name of ["NATURALES 200g", "PAPAS SABRITAS"]) {
    const score = scoreOf(name, "Sabritas Naturales");
    assert.ok(score >= SIMILARITY_SUGGEST && score <= SIMILARITY_MATCH, `${name}: ${score}`);
    const result = matchLine({ name }, context);
    assert.equal(result.match, null);
    assert.deepEqual(result.suggestions.map((s) => s.product_id), [3]);
  }
});

test("mismo producto en dos tamanos: cada tamano va a su producto", () => {
  const context = buildMatchContext([
    { id: 1, name: "Coca Cola 600 ml", sku: null, barcode: null },
    { id: 2, name: "Coca Cola 2 L", sku: null, barcode: null }
  ], []);
  assert.equal(matchLine({ name: "COCA COLA 2LT" }, context).match.product_id, 2);
  assert.equal(matchLine({ name: "COCA-COLA 600 ML" }, context).match.product_id, 1);
  // No size on the ticket: both fit equally, so suggestions, never a guess.
  const noSize = matchLine({ name: "COCA COLA" }, context);
  assert.equal(noSize.match, null);
  assert.deepEqual(noSize.suggestions.map((s) => s.product_id), [1, 2]);
});

test("por debajo de 0.4 nada; sugerencias maximo 3 ordenadas por puntaje", () => {
  const context = buildMatchContext([
    { id: 1, name: "Galletas Maria chocolate", sku: null, barcode: null },
    { id: 2, name: "Galletas Maria", sku: null, barcode: null },
    { id: 3, name: "Galletas Maria canela", sku: null, barcode: null },
    { id: 4, name: "Maria galletas mini", sku: null, barcode: null },
    { id: 5, name: "Galletas Maria integrales light", sku: null, barcode: null }
  ], []);
  // 0.5 (id 2), then 0.417 x3 by id (1, 3; 4 cut by the cap); id 5 is 0.375.
  const result = matchLine({ name: "MARIA SURTIDO 170g" }, context);
  assert.equal(result.match, null);
  assert.deepEqual(result.suggestions.map((s) => s.product_id), [2, 1, 3]);
  assert.ok(scoreOf("MARIA SURTIDO 170g", "Galletas Maria integrales light") < SIMILARITY_SUGGEST);
  // A clear winner above 0.8 is a match, even with close relatives around.
  assert.equal(matchLine({ name: "GALLETAS MARIA 170g" }, context).match.product_id, 2);
});

test("similitud por endpoint: solo productos del negocio del actor", async () => {
  resetDb();
  fetchCalls = 0;
  // Business 7 also has "Atun en agua" (id 91); only business 6's (id 5) may appear.
  anthropicReply({ ...TICKET, lines: [
    { name: "ATUN AGUA 140g", qty: 4, unit_cost: 18, sku: null, barcode: null },
    { name: "GALLETAS MARIA", qty: 2, unit_cost: 12, sku: null, barcode: null }
  ] });
  const { status, json } = await extract({ role: "admin" });
  assert.equal(status, 200);
  assert.deepEqual(json.lines[0].match, { product_id: 5, name: "Atun en agua", sku: "ATU-AG", confidence: 0.75, method: "name" });
  const ids = json.lines.flatMap((line) => [line.match?.product_id, ...line.suggestions.map((s) => s.product_id)]).filter(Boolean);
  for (const id of ids) assert.ok(PRODUCTS.some((p) => p.id === id && p.business_id === 6), `producto ${id}`);
});
