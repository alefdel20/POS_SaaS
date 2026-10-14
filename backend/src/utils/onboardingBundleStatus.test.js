// GET /onboarding/bundle -> getBundleStatus. needsBundle solo para un giro guiado
// (Tienda, Tlapaleria, Papeleria) sin paquete confirmado, sin siembra con
// productos y sin actividad (productos o ventas): un negocio que ya opera no se
// redirige al wizard en un navegador nuevo. pool.query es un fake en memoria y
// solo responde las consultas de lectura de getBundleStatus.
//
// Run with: node --test src/utils/onboardingBundleStatus.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");
const { getBundleStatus } = require("../services/onboardingBundleService");

let state;
const queries = [];

pool.query = async (sql, params = []) => {
  queries.push(sql);
  const businessId = params[0];
  if (/FROM company_profiles/.test(sql)) {
    const settings = state.settings[businessId];
    return { rows: settings ? [{ general_settings: settings }] : [] };
  }
  if (/FROM initial_catalog_seed_runs/.test(sql)) {
    return { rows: (state.seededWithProducts[businessId] ? [{ "?column?": 1 }] : []) };
  }
  if (/EXISTS \(SELECT 1 FROM products WHERE business_id = \$1\)/.test(sql) && /EXISTS \(SELECT 1 FROM sales WHERE business_id = \$1\)/.test(sql)) {
    return { rows: [{ has_products: Boolean(state.products[businessId]), has_sales: Boolean(state.sales[businessId]) }] };
  }
  throw new Error(`SQL no esperado en la prueba: ${sql.slice(0, 80)}`);
};

function reset(overrides = {}) {
  state = { settings: {}, seededWithProducts: {}, products: {}, sales: {}, ...overrides };
  queries.length = 0;
}

const TIENDA = { id: 6, pos_type: "Tienda" };

test("giro guiado vacio (sin confirmar, sin productos ni ventas): needsBundle true", async () => {
  reset();
  const status = await getBundleStatus(TIENDA);
  assert.equal(status.posType, "Tienda");
  assert.equal(status.needsBundle, true);
  assert.ok(status.items.length > 0);
  assert.equal(status.draft, null);
});

test("giro guiado con productos: needsBundle false", async () => {
  reset({ products: { 6: true } });
  assert.equal((await getBundleStatus(TIENDA)).needsBundle, false);
});

test("giro guiado con ventas (sin productos): needsBundle false", async () => {
  reset({ sales: { 6: true } });
  assert.equal((await getBundleStatus(TIENDA)).needsBundle, false);
});

test("giro guiado con paquete confirmado: needsBundle false", async () => {
  reset({ settings: { 6: { bundle_confirmed: true } } });
  assert.equal((await getBundleStatus(TIENDA)).needsBundle, false);
});

test("giro guiado con siembra automatica de productos: needsBundle false (sin cambio)", async () => {
  reset({ seededWithProducts: { 6: true } });
  assert.equal((await getBundleStatus(TIENDA)).needsBundle, false);
});

test("los tres giros guiados, vacios: true; con actividad: false", async () => {
  for (const posType of ["Tienda", "Tlapaleria", "Papeleria"]) {
    reset();
    assert.equal((await getBundleStatus({ id: 6, pos_type: posType })).needsBundle, true, posType);
    reset({ products: { 6: true }, sales: { 6: true } });
    assert.equal((await getBundleStatus({ id: 6, pos_type: posType })).needsBundle, false, posType);
  }
});

test("giro no guiado: needsBundle false con o sin actividad (sin cambio)", async () => {
  for (const posType of ["Veterinaria", "Restaurante", "Otro"]) {
    reset();
    const empty = await getBundleStatus({ id: 6, pos_type: posType });
    assert.equal(empty.needsBundle, false, posType);
    assert.deepEqual(empty.items, [], posType);
    reset({ products: { 6: true } });
    assert.equal((await getBundleStatus({ id: 6, pos_type: posType })).needsBundle, false, posType);
  }
});

test("el borrador se sigue devolviendo aunque el negocio ya opere", async () => {
  const draft = { selections: [] };
  reset({ settings: { 6: { bundle_draft: draft } }, products: { 6: true } });
  const status = await getBundleStatus(TIENDA);
  assert.equal(status.needsBundle, false);
  assert.deepEqual(status.draft, draft);
});

test("solo lectura y aislado por negocio: cada consulta usa el business_id del actor", async () => {
  reset({ products: { 7: true }, sales: { 7: true } });
  // Actividad de otro negocio (7) no afecta al negocio 6.
  assert.equal((await getBundleStatus(TIENDA)).needsBundle, true);
  assert.equal(queries.length, 3);
  for (const sql of queries) {
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE)\b/i);
  }
});
