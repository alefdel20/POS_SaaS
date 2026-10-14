// Baseline of restockProduct, restockProductsBatch and createProduct as they
// behave for their current callers (PATCH /:id/restock, POST /restock/batch,
// POST /products, import). Written before the purchase-ticket refactor and
// kept unchanged after it: the default options must leave every flow
// identical. pool is an in-memory fake (inventoryFakeDb.testlib.js).
//
// Run with: node --test src/utils/restockCreateBaseline.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");
const { createFakeDb } = require("./inventoryFakeDb.testlib");
const productService = require("../services/productService");
const { getMexicoCityDate } = require("./timezone");

const SEED = {
  businesses: [{ id: 6, pos_type: "Tienda" }, { id: 7, pos_type: "Tienda" }],
  company_profiles: [
    { id: 1, business_id: 6, profile_key: "default", general_settings: { cashier_direct_stock: true } },
    { id: 2, business_id: 7, profile_key: "default", general_settings: {} }
  ],
  suppliers: [
    { id: 10, business_id: 6, name: "Abarrotes El Sol", is_active: true },
    { id: 70, business_id: 7, name: "Otro negocio SA", is_active: true }
  ],
  products: [
    { id: 1, business_id: 6, name: "Coca Cola 600 ml", sku: "COC-600", barcode: "750100", category: "Bebidas", price: 18, cost_price: 12, stock: 5, stock_minimo: 10, stock_maximo: 40, is_active: true, status: "activo", unidad_de_venta: "pieza" },
    { id: 2, business_id: 6, name: "Arroz 1kg", sku: "ARZ-1KG", barcode: "750200", category: "Abarrotes", price: 30, cost_price: 21.5, stock: 20, stock_minimo: 5, stock_maximo: 50, is_active: true, status: "activo", unidad_de_venta: "pieza" },
    { id: 90, business_id: 7, name: "Producto ajeno", sku: "AJE-1", barcode: "750900", category: "Otros", price: 10, cost_price: 4, stock: 3, stock_minimo: 0, stock_maximo: 0, is_active: true, status: "activo", unidad_de_venta: "pieza" }
  ],
  product_suppliers: [
    { product_id: 1, supplier_id: 10, business_id: 6, is_primary: true, purchase_cost: 11.25, cost_updated_at: "2026-09-01" }
  ]
};

const db = createFakeDb(SEED);
db.install(pool);

const ADMIN = { id: 501, business_id: 6, role: "admin", full_name: "Ana Admin", pos_type: "Tienda" };
const CAJERO = { id: 502, business_id: 6, role: "cajero", full_name: "Carlos Cajero", pos_type: "Tienda" };
const CAJERO_7 = { id: 503, business_id: 7, role: "cajero", full_name: "Cajero Siete", pos_type: "Tienda" };

function product(id) {
  return db.state.products.find((p) => p.id === id);
}

async function rejects(promise, status) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.statusCode, status, error.message);
    return true;
  });
}

// ─── restockProduct ──────────────────────────────────────────────────────────

test("restock admin: stock, historial, egreso en efectivo, recordatorio, auditoria", async () => {
  db.reset();
  const result = await productService.restockProduct(1, { stock: 12, reason: "compra semanal" }, ADMIN);

  assert.equal(result.id, 1);
  assert.equal(Number(result.stock), 17);
  assert.equal(product(1).stock, 17);
  assert.deepEqual(db.transactions, { begin: 1, commit: 1, rollback: 0 });
  assert.equal(db.released, 1);

  const [history] = db.rows("product_restock_history");
  assert.equal(db.rows("product_restock_history").length, 1);
  assert.equal(history.business_id, 6);
  assert.equal(history.supplier_id, 10);
  assert.equal(history.quantity_added, 12);
  assert.equal(history.stock_before, 5);
  assert.equal(history.stock_after, 17);
  // Cost from the primary supplier link, not products.cost_price.
  assert.equal(history.unit_cost, 11.25);
  assert.equal(history.total_cost, 135);
  assert.equal(history.reason, "compra semanal");
  assert.equal(history.supplier_name_snapshot, "Abarrotes El Sol");
  assert.deepEqual(history.metadata, {
    product_sku: "COC-600", supplier_name: "Abarrotes El Sol", purchase_cost: 11.25, cost_updated_at: "2026-09-01",
    unit: "pieza", lot_number: null, expires_at: null, actor_role: "admin", entry_type: "entry"
  });

  const expenses = db.rows("expenses");
  assert.equal(expenses.length, 1);
  assert.equal(expenses[0].business_id, 6);
  assert.equal(expenses[0].amount, 135);
  assert.equal(expenses[0].payment_method, "cash");
  assert.equal(expenses[0].movement_type, "inventory_restock");
  assert.equal(expenses[0].category, "Compra de inventario");
  assert.equal(expenses[0].concept, "Reabastecimiento: Coca Cola 600 ml");
  assert.equal(expenses[0].date, getMexicoCityDate());
  assert.equal(expenses[0].metadata.restock_history_id, history.id);
  assert.equal(expenses[0].metadata.source_module, "product_restock_history");

  const restockReminders = db.rows("reminders", (r) => String(r.source_key).startsWith("auto:restock:1:"));
  assert.equal(restockReminders.length, 1);
  assert.equal(restockReminders[0].title, "Reabastecimiento: Coca Cola 600 ml (+12 unidades)");
  assert.equal(restockReminders[0].business_id, 6);

  // 17 > minimum 10: nothing low in business 6, the STOCK BAJO reminder is not created.
  assert.equal(db.rows("reminders", (r) => r.source_key === "auto:stock-low:6").length, 0);

  const audits = db.rows("audit_logs");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].accion, "restock_product");
  assert.equal(audits[0].metadata.inventory_restock_expense_id, expenses[0].id);
  assert.equal(audits[0].metadata.added_stock, 12);
});

test("restock sin proveedor ligado: costo de products.cost_price", async () => {
  db.reset();
  await productService.restockProduct(2, { stock: 4 }, ADMIN);
  const [history] = db.rows("product_restock_history");
  assert.equal(history.unit_cost, 21.5);
  assert.equal(history.total_cost, 86);
  assert.equal(history.supplier_id, null);
  assert.equal(history.reason, "restock_update");
  assert.equal(db.rows("expenses")[0].amount, 86);
});

test("restock deja producto bajo: sincroniza el recordatorio STOCK BAJO", async () => {
  db.reset();
  await productService.restockProduct(1, { stock: 2 }, ADMIN);
  const lowStock = db.rows("reminders", (r) => r.source_key === "auto:stock-low:6");
  assert.equal(lowStock.length, 1);
  assert.match(lowStock[0].notes, /Coca Cola 600 ml/);
});

test("restock cajero con cashier_direct_stock: sin egreso, total_cost 0", async () => {
  db.reset();
  await productService.restockProduct(1, { stock: 3 }, CAJERO);
  assert.equal(product(1).stock, 8);
  assert.equal(db.rows("expenses").length, 0);
  const [history] = db.rows("product_restock_history");
  assert.equal(history.total_cost, 0);
  assert.equal(history.metadata.cost_not_recorded, true);
  const [audit] = db.rows("audit_logs");
  assert.equal(audit.metadata.inventory_restock_expense_id, 0);
  assert.equal(audit.metadata.cost_not_recorded, true);
  assert.match(db.rows("reminders", (r) => String(r.source_key).startsWith("auto:restock:"))[0].notes, /sin costo registrado/);
});

test("restock cajero sin cashier_direct_stock: 403 sin abrir transaccion", async () => {
  db.reset();
  await rejects(productService.restockProduct(90, { stock: 3 }, CAJERO_7), 403);
  assert.equal(db.transactions.begin, 0);
  assert.equal(product(90).stock, 3);
});

test("restock tenant: producto de otro negocio da 404 y ROLLBACK sin cambios", async () => {
  db.reset();
  await rejects(productService.restockProduct(90, { stock: 3 }, ADMIN), 404);
  assert.deepEqual(db.transactions, { begin: 1, commit: 0, rollback: 1 });
  assert.equal(product(90).stock, 3);
  assert.equal(db.rows("expenses").length, 0);
  assert.equal(db.rows("product_restock_history").length, 0);
  // Every product read carries the actor's business_id.
  for (const { sql, params } of db.queries.filter((q) => /FROM products WHERE id = \$1/.test(q.sql))) {
    assert.equal(params[1], 6, sql);
  }
});

test("restock cantidad invalida: 400 antes de la transaccion", async () => {
  db.reset();
  await rejects(productService.restockProduct(1, { stock: 0 }, ADMIN), 400);
  await rejects(productService.restockProduct(1, { stock: -2 }, ADMIN), 400);
  await rejects(productService.restockProduct(1, { stock: 1.5 }, ADMIN), 400);
  assert.equal(product(1).stock, 5);
});

test("restock batch: no atomico, cada item su propia transaccion y un recordatorio de lote", async () => {
  db.reset();
  const result = await productService.restockProductsBatch({ items: [
    { product_id: 1, stock: 2 },
    { product_id: 90, stock: 1 },
    { product_id: 2, stock: 0 }
  ] }, ADMIN);
  assert.deepEqual(result.results.map((r) => r.status), ["success", "error", "error"]);
  assert.equal(product(1).stock, 7);
  assert.equal(db.rows("expenses").length, 1);
  assert.equal(db.rows("reminders", (r) => String(r.source_key).startsWith("auto:restock-batch:6:")).length, 1);
});

// ─── createProduct ───────────────────────────────────────────────────────────

test("createProduct admin: valores por defecto, SKU y codigo generados, categoria, evento y auditoria", async () => {
  db.reset();
  const created = await productService.createProduct({ name: "Sabritas Naturales 45 g", category: "Botanas", price: 22, cost_price: 14.5, stock: 6 }, ADMIN);

  assert.deepEqual(db.transactions, { begin: 1, commit: 1, rollback: 0 });
  const row = product(created.id);
  assert.equal(row.business_id, 6);
  assert.equal(row.name, "Sabritas Naturales 45 g");
  assert.equal(row.category, "Botanas");
  assert.equal(row.price, 22);
  assert.equal(row.cost_price, 14.5);
  assert.equal(row.stock, 6);
  assert.equal(row.stock_minimo, 0);
  assert.equal(row.stock_maximo, 6);
  assert.equal(row.unidad_de_venta, "pieza");
  assert.equal(row.status, "activo");
  assert.equal(row.is_active, true);
  assert.equal(row.supplier_id, null);
  assert.ok(row.sku);
  assert.match(row.barcode, /^\d{13}$/);

  assert.equal(db.rows("product_categories", (c) => c.business_id === 6 && c.name === "Botanas").length, 1);
  assert.deepEqual(db.rows("automation_events").map((e) => e.event_type), ["product_created"]);
  const [audit] = db.rows("audit_logs");
  assert.equal(audit.accion, "create_product");
  assert.equal(audit.metadata.creation_source, "products_module");
  // No supplier fields: no supplier lookup, creation or link.
  assert.equal(db.queries.filter((q) => /FROM suppliers|INSERT INTO suppliers|UPDATE suppliers/.test(q.sql)).length, 0);
  assert.equal(db.rows("product_suppliers", (ps) => ps.product_id === created.id).length, 0);
  // Creation never writes restock history nor expenses.
  assert.equal(db.rows("product_restock_history").length, 0);
  assert.equal(db.rows("expenses").length, 0);
});

test("createProduct con supplier_name: hoy crea el proveedor y lo liga (comportamiento actual)", async () => {
  db.reset();
  const created = await productService.createProduct({ name: "Leche 1 L", category: "Lacteos", price: 28, cost_price: 20, supplier_name: "Lala Nueva" }, ADMIN);
  const supplier = db.rows("suppliers", (s) => s.name === "Lala Nueva")[0];
  assert.ok(supplier);
  assert.equal(supplier.business_id, 6);
  assert.equal(product(created.id).supplier_id, supplier.id);
  const [link] = db.rows("product_suppliers", (ps) => ps.product_id === created.id);
  assert.equal(link.supplier_id, supplier.id);
  assert.equal(link.purchase_cost, 20);
  assert.equal(link.is_primary, true);
});

test("createProduct: nombre y categoria obligatorios, precio 0 rechazado (400 y ROLLBACK)", async () => {
  db.reset();
  const before = db.state.products.length;
  await rejects(productService.createProduct({ name: "Sin categoria", price: 10 }, ADMIN), 400);
  await rejects(productService.createProduct({ name: "Categoria vacia", category: "  ", price: 10 }, ADMIN), 400);
  await rejects(productService.createProduct({ name: "Precio cero", category: "X", price: 0 }, ADMIN), 400);
  await rejects(productService.createProduct({ name: "", category: "X", price: 5 }, ADMIN), 400);
  assert.equal(db.transactions.rollback, 4);
  assert.equal(db.state.products.length, before);
});

test("createProduct sin price: hoy se crea con precio 0 (comportamiento actual)", async () => {
  db.reset();
  const created = await productService.createProduct({ name: "Sin precio", category: "X" }, ADMIN);
  assert.equal(product(created.id).price, 0);
});

test("createProduct cajero: 403", async () => {
  db.reset();
  await rejects(productService.createProduct({ name: "X", category: "X", price: 5 }, CAJERO), 403);
  assert.equal(db.transactions.begin, 0);
});

test("createProduct tenant: business_id del actor y supplier_id ajeno da 404", async () => {
  db.reset();
  const created = await productService.createProduct({ name: "Propio", category: "X", price: 5, business_id: 7 }, ADMIN);
  assert.equal(product(created.id).business_id, 6);
  const before = db.state.products.length;
  await rejects(productService.createProduct({ name: "Ajeno", category: "X", price: 5, supplier_id: 70 }, ADMIN), 404);
  assert.equal(db.state.products.length, before);
});
