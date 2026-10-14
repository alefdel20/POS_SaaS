// POST /products/restock/ticket/confirm and /products/restock/ticket/:id/void.
// The real productRoutes router runs on an ephemeral local port behind a fake
// auth that sets req.user; pool is the in-memory fake of
// inventoryFakeDb.testlib.js, which snapshots on BEGIN and restores on
// ROLLBACK, so "nothing changed" is checked against the whole state.
//
// Run with: node --test src/utils/purchaseTicketConfirm.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const pool = require("../db/pool");
const { createFakeDb } = require("./inventoryFakeDb.testlib");
const productRoutes = require("../routes/productRoutes");
const errorHandler = require("../middleware/errorHandler");
const { getMexicoCityDate } = require("./timezone");

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const CONFIRM_ON = { ticket_ai_enabled: true, ticket_ai_confirm_enabled: true, cashier_direct_stock: true };

function seed(settings6 = CONFIRM_ON, plan6 = "Premium") {
  return {
    businesses: [{ id: 6, pos_type: "Tienda" }, { id: 7, pos_type: "Tienda" }],
    business_subscriptions: [
      { business_id: 6, plan_name: plan6, trial_expired: false },
      { business_id: 7, plan_name: "Premium", trial_expired: false }
    ],
    company_profiles: [
      { id: 1, business_id: 6, profile_key: "default", general_settings: settings6 },
      { id: 2, business_id: 7, profile_key: "default", general_settings: CONFIRM_ON }
    ],
    suppliers: [
      { id: 10, business_id: 6, name: "Abarrotes El Sol", is_active: true },
      { id: 11, business_id: 6, name: "Distribuidora Norte", is_active: true },
      { id: 70, business_id: 7, name: "Proveedor ajeno", is_active: true }
    ],
    products: [
      { id: 1, business_id: 6, name: "Coca Cola 600 ml", sku: "COC-600", barcode: "750100", category: "Bebidas", price: 18, cost_price: 12, stock: 5, stock_minimo: 2, stock_maximo: 40, is_active: true, status: "activo", unidad_de_venta: "pieza" },
      { id: 2, business_id: 6, name: "Arroz 1kg", sku: "ARZ-1KG", barcode: "750200", category: "Abarrotes", price: 30, cost_price: 21.5, stock: 20, stock_minimo: 5, stock_maximo: 50, is_active: true, status: "activo", unidad_de_venta: "pieza" },
      { id: 3, business_id: 6, name: "Queso granel", sku: "QSO-GR", barcode: "750300", category: "Lacteos", price: 150, cost_price: 90, stock: 1.5, stock_minimo: 0, stock_maximo: 0, is_active: true, status: "activo", unidad_de_venta: "kg" },
      { id: 90, business_id: 7, name: "Producto ajeno", sku: "AJE-1", barcode: "750900", category: "Otros", price: 10, cost_price: 4, stock: 3, stock_minimo: 0, stock_maximo: 0, is_active: true, status: "activo", unidad_de_venta: "pieza" }
    ],
    product_suppliers: [
      { product_id: 1, supplier_id: 10, business_id: 6, is_primary: true, purchase_cost: 11.25, cost_updated_at: "2026-09-01" }
    ]
  };
}

// users is read only by the recent-tickets join; kept outside the fake state.
const USERS = [
  { id: 501, business_id: 6, full_name: "Ana Admin", username: "ana" },
  { id: 502, business_id: 6, full_name: null, username: "gabi" },
  { id: 777, business_id: 7, full_name: "Admin Siete", username: "siete" }
];

const db = createFakeDb(seed());
db.install(pool);

// SQL of purchaseTicketConfirmService, answered from the fake state.
const byBusiness = (table, businessId) => db.state[table].filter((row) => row.business_id === businessId);
db.handlers.push(
  [/^SELECT id, name FROM suppliers WHERE id = \$1 AND business_id = \$2$/, (p) => ({ rows: byBusiness("suppliers", p[1]).filter((s) => s.id === p[0]).map(({ id, name }) => ({ id, name })) })],
  [/^SELECT id FROM purchase_tickets WHERE business_id = \$1 AND image_sha256 = \$2 AND status = 'confirmed' LIMIT 1$/, (p) => ({ rows: byBusiness("purchase_tickets", p[0]).filter((t) => t.image_sha256 === p[1] && t.status === "confirmed").map(({ id }) => ({ id })) })],
  [/^SELECT id FROM purchase_tickets WHERE business_id = \$1 AND status = 'confirmed' AND supplier_id IS NOT DISTINCT FROM \$2 AND ticket_date = \$3 AND total = \$4 AND folio IS NOT DISTINCT FROM \$5 LIMIT 1$/, (p) => ({
    rows: byBusiness("purchase_tickets", p[0]).filter((t) => t.status === "confirmed" && t.supplier_id === p[1] && t.ticket_date === p[2] && Number(t.total) === p[3] && t.folio === p[4]).map(({ id }) => ({ id }))
  })],
  [/^SELECT id, cost_price FROM products WHERE business_id = \$1 AND id = ANY\(\$2::int\[\]\) ORDER BY id FOR UPDATE$/, (p) => ({ rows: byBusiness("products", p[0]).filter((r) => p[1].includes(r.id)).sort((a, b) => a.id - b.id).map(({ id, cost_price }) => ({ id, cost_price })) })],
  [/^SELECT id, name, category, sku, stock, cost_price, unidad_de_venta FROM products WHERE business_id = \$1 AND id = ANY\(\$2::int\[\]\) ORDER BY id FOR UPDATE$/, (p) => ({ rows: byBusiness("products", p[0]).filter((r) => p[1].includes(r.id)).sort((a, b) => a.id - b.id).map((r) => ({ ...r })) })],
  [/^UPDATE products SET cost_price = \$1, updated_at = NOW\(\) WHERE id = \$2 AND business_id = \$3$/, (p) => {
    const row = byBusiness("products", p[2]).find((r) => r.id === p[1]);
    if (row) row.cost_price = p[0];
    return { rows: [], rowCount: row ? 1 : 0 };
  }],
  [/^UPDATE products SET stock = \$1, cost_price = \$2, updated_at = NOW\(\) WHERE id = \$3 AND business_id = \$4$/, (p) => {
    const row = byBusiness("products", p[3]).find((r) => r.id === p[2]);
    if (row) Object.assign(row, { stock: p[0], cost_price: p[1] });
    return { rows: [], rowCount: row ? 1 : 0 };
  }],
  [/^SELECT supplier_id, purchase_cost FROM product_suppliers WHERE product_id = \$1 AND business_id = \$2$/, (p) => ({ rows: byBusiness("product_suppliers", p[1]).filter((ps) => ps.product_id === p[0]).map(({ supplier_id, purchase_cost }) => ({ supplier_id, purchase_cost })) })],
  [/^SELECT purchase_cost FROM product_suppliers WHERE product_id = \$1 AND supplier_id = \$2 AND business_id = \$3$/, (p) => ({ rows: byBusiness("product_suppliers", p[2]).filter((ps) => ps.product_id === p[0] && ps.supplier_id === p[1]).map(({ purchase_cost }) => ({ purchase_cost })) })],
  [/^DELETE FROM product_suppliers WHERE product_id = \$1 AND supplier_id = \$2 AND business_id = \$3$/, (p) => {
    db.state.product_suppliers = db.state.product_suppliers.filter((ps) => !(ps.product_id === p[0] && ps.supplier_id === p[1] && ps.business_id === p[2]));
    return { rows: [] };
  }],
  [/^UPDATE product_suppliers SET purchase_cost = \$1, cost_updated_at = NOW\(\) WHERE product_id = \$2 AND supplier_id = \$3 AND business_id = \$4$/, (p) => {
    const row = byBusiness("product_suppliers", p[3]).find((ps) => ps.product_id === p[1] && ps.supplier_id === p[2]);
    if (row) Object.assign(row, { purchase_cost: p[0], cost_updated_at: "now" });
    return { rows: [] };
  }],
  // GET /restock/ticket/recent. Only the business_id = $1 shape is understood.
  [/^SELECT pt\.id, pt\.ticket_date, .* FROM purchase_tickets pt LEFT JOIN suppliers ON suppliers\.id = pt\.supplier_id AND suppliers\.business_id = pt\.business_id LEFT JOIN users ON users\.id = pt\.created_by AND users\.business_id = pt\.business_id WHERE pt\.business_id = \$1 ORDER BY pt\.created_at DESC, pt\.id DESC LIMIT \$2$/, (p) => ({
    rows: byBusiness("purchase_tickets", p[0])
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id)
      .slice(0, p[1])
      .map((t) => {
        const supplier = db.state.suppliers.find((s) => s.id === t.supplier_id && s.business_id === t.business_id);
        const user = USERS.find((u) => u.id === t.created_by && u.business_id === t.business_id);
        return {
          id: t.id, ticket_date: t.ticket_date, total: t.total, lines_total: t.lines_total, folio: t.folio,
          supplier_id: t.supplier_id, supplier_name: supplier ? supplier.name : null, status: t.status,
          created_by: t.created_by, created_by_name: user ? (user.full_name || user.username) : null,
          created_at: t.created_at, voided_at: t.voided_at, void_reason: t.void_reason,
          line_count: db.state.purchase_ticket_lines.filter((l) => l.ticket_id === t.id && l.business_id === t.business_id).length
        };
      })
  })],
  // GET /restock-history/metrics without filters. Mirrors the SQL: decrease rows
  // out; total_spent skips rows whose metadata.purchase_ticket_id is a voided
  // ticket of the same business.
  [/^SELECT -- Entries of a voided purchase ticket .* FROM product_restock_history history WHERE history\.business_id = \$1 AND COALESCE\(history\.metadata->>'entry_type', 'entry'\) <> 'decrease'$/, (p, sql) => {
    assert.match(sql, /FILTER \(WHERE NOT EXISTS \( SELECT 1 FROM purchase_tickets voided_ticket WHERE voided_ticket\.business_id = history\.business_id AND voided_ticket\.id::text = history\.metadata->>'purchase_ticket_id' AND voided_ticket\.status = 'voided' \)\)/);
    const rows = byBusiness("product_restock_history", p[0]).filter((h) => (h.metadata.entry_type || "entry") !== "decrease");
    const voidedTicket = (h) => db.state.purchase_tickets.some((t) => t.business_id === h.business_id && String(t.id) === String(h.metadata.purchase_ticket_id ?? "") && h.metadata.purchase_ticket_id !== undefined && t.status === "voided");
    return { rows: [{
      total_spent: rows.filter((h) => !voidedTicket(h)).reduce((sum, h) => sum + Number(h.total_cost), 0),
      inventory_value_before: rows.reduce((sum, h) => sum + h.stock_before * h.unit_cost, 0),
      inventory_value_after: rows.reduce((sum, h) => sum + h.stock_after * h.unit_cost, 0),
      total_movements: rows.length
    }] };
  }],
  [/^UPDATE purchase_tickets SET expense_id = \$1 WHERE id = \$2 AND business_id = \$3$/, (p) => {
    const row = byBusiness("purchase_tickets", p[2]).find((t) => t.id === p[1]);
    if (row) row.expense_id = p[0];
    return { rows: [] };
  }],
  [/^SELECT \* FROM purchase_tickets WHERE id = \$1 AND business_id = \$2 FOR UPDATE$/, (p) => ({ rows: byBusiness("purchase_tickets", p[1]).filter((t) => t.id === p[0]).map((t) => ({ ...t })) })],
  [/^SELECT \* FROM purchase_ticket_lines WHERE ticket_id = \$1 AND business_id = \$2 ORDER BY id$/, (p) => ({ rows: byBusiness("purchase_ticket_lines", p[1]).filter((l) => l.ticket_id === p[0]).sort((a, b) => a.id - b.id).map((l) => ({ ...l })) })],
  [/^SELECT id, supplier_id, supplier_name_snapshot FROM product_restock_history WHERE business_id = \$1 AND id = ANY\(\$2::bigint\[\]\)$/, (p) => ({ rows: byBusiness("product_restock_history", p[0]).filter((h) => p[1].includes(h.id)).map(({ id, supplier_id, supplier_name_snapshot }) => ({ id, supplier_id, supplier_name_snapshot })) })],
  [/^UPDATE expenses SET is_voided = TRUE, voided_at = NOW\(\), voided_by = \$1, void_reason = \$2, updated_at = NOW\(\), updated_by = \$1 WHERE id = \$3 AND business_id = \$4$/, (p) => {
    const row = byBusiness("expenses", p[3]).find((e) => e.id === p[2]);
    if (row) Object.assign(row, { is_voided: true, voided_at: "now", voided_by: p[0], void_reason: p[1] });
    return { rows: [] };
  }],
  [/^UPDATE purchase_tickets SET status = 'voided', voided_at = NOW\(\), voided_by = \$1, void_reason = \$2 WHERE id = \$3 AND business_id = \$4$/, (p) => {
    const row = byBusiness("purchase_tickets", p[3]).find((t) => t.id === p[2]);
    if (row) Object.assign(row, { status: "voided", voided_at: "now", voided_by: p[0], void_reason: p[1] });
    return { rows: [] };
  }]
);

// No model call may happen from these endpoints.
let fetchCalls = 0;
global.fetch = async () => {
  fetchCalls += 1;
  throw new Error("confirm/void no deben llamar a ningun servicio externo");
};

let server;
let baseUrl;
const nativeFetch = require("node:http");

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = JSON.parse(req.headers["x-test-user"]);
    next();
  });
  app.use("/products", productRoutes);
  app.use(errorHandler);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

const ADMIN = { id: 501, business_id: 6, role: "admin", full_name: "Ana Admin", pos_type: "Tienda" };
const GERENTE = { id: 502, business_id: 6, role: "gerente", full_name: "Gabi Gerente", pos_type: "Tienda" };
const SUPER = { id: 503, business_id: 6, role: "superadmin", full_name: "Soporte", pos_type: "Tienda" };
const CAJERO = { id: 504, business_id: 6, role: "cajero", full_name: "Carlos Cajero", pos_type: "Tienda" };

// global.fetch is stubbed, so requests go through node:http.
function post(path, user, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body ?? {}));
    const request = nativeFetch.request(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": payload.length, "x-test-user": JSON.stringify(user) }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, json: JSON.parse(Buffer.concat(chunks).toString("utf8") || "null") }));
    });
    request.on("error", reject);
    request.end(payload);
  });
}

const confirm = (user, body) => post("/products/restock/ticket/confirm", user, body);
const voidTicket = (user, id, body) => post(`/products/restock/ticket/${id}/void`, user, body);

function ticketBody(overrides = {}) {
  return {
    image_sha256: HASH_A,
    supplier_id: 10,
    ticket_date: "2026-10-10",
    total: 500,
    folio: "A-1029",
    lines: [
      { product_id: 1, qty: 24, unit_cost: 12.5 },
      { product_id: 2, qty: 10, unit_cost: 22 },
      { new_product: { name: "Sabritas Naturales 45 g", sale_price: 22, category: "Botanas" }, qty: 6, unit_cost: 14 }
    ],
    ...overrides
  };
}

function product(id) {
  return db.state.products.find((p) => p.id === id);
}

function snapshot() {
  return JSON.parse(JSON.stringify(db.state));
}

function startCase(settings, plan) {
  db.reset(seed(settings, plan));
  fetchCalls = 0;
}

// ─── Success ─────────────────────────────────────────────────────────────────

test("confirmar: exito completo en una transaccion", async () => {
  startCase();
  const suppliersBefore = JSON.stringify(db.state.suppliers);
  const { status, json } = await confirm(ADMIN, ticketBody());
  assert.equal(status, 201, JSON.stringify(json));
  assert.deepEqual(db.transactions, { begin: 1, commit: 1, rollback: 0 });
  assert.equal(fetchCalls, 0);

  // 24*12.5 + 10*22 + 6*14 = 604 vs 500 printed: both kept.
  const ticket = db.state.purchase_tickets[0];
  assert.equal(json.ticket_id, ticket.id);
  assert.equal(json.status, "confirmed");
  assert.deepEqual({ ...json.summary, products_created: json.summary.products_created.map((p) => p.name) }, {
    lines: 3, restocked_lines: 2, products_created: ["Sabritas Naturales 45 g"], total: 500, lines_total: 604, totals_match: false,
    expense: { id: ticket.expense_id, amount: 500, payment_method: "cash", date: getMexicoCityDate() }
  });
  assert.equal(ticket.business_id, 6);
  assert.equal(ticket.status, "confirmed");
  assert.equal(ticket.total, 500);
  assert.equal(ticket.lines_total, 604);
  assert.equal(ticket.ticket_date, "2026-10-10");
  assert.equal(ticket.supplier_id, 10);
  assert.equal(ticket.created_by, 501);

  // Stock and costs.
  assert.equal(product(1).stock, 29);
  assert.equal(product(1).cost_price, 12.5);
  assert.equal(product(2).stock, 30);
  assert.equal(product(2).cost_price, 22);
  const createdId = json.summary.products_created[0].product_id;
  const created = product(createdId);
  assert.deepEqual(
    { business_id: created.business_id, stock: created.stock, cost_price: created.cost_price, price: created.price, category: created.category, supplier_id: created.supplier_id },
    { business_id: 6, stock: 6, cost_price: 14, price: 22, category: "Botanas", supplier_id: 10 }
  );

  // product_suppliers: existing link updated, new links created, never a new supplier.
  const link = (productId) => db.state.product_suppliers.find((ps) => ps.product_id === productId && ps.supplier_id === 10);
  assert.equal(link(1).purchase_cost, 12.5);
  assert.equal(link(1).is_primary, true);
  assert.equal(link(2).purchase_cost, 22);
  assert.equal(link(2).is_primary, true);
  assert.equal(link(createdId).purchase_cost, 14);
  assert.equal(JSON.stringify(db.state.suppliers), suppliersBefore);
  assert.equal(db.queries.filter((q) => /INSERT INTO suppliers|UPDATE suppliers/.test(q.sql)).length, 0);

  // History: one entry per existing-product line, ticket cost, ticket id in metadata.
  const history = db.state.product_restock_history;
  assert.equal(history.length, 2);
  for (const row of history) {
    assert.equal(row.metadata.purchase_ticket_id, ticket.id);
    assert.equal(row.metadata.purchase_ticket_supplier_id, 10);
    assert.equal(row.metadata.entry_type, "entry");
    assert.equal(row.reason, `purchase_ticket:${ticket.id}`);
  }
  const coca = history.find((h) => h.product_id === 1);
  assert.equal(coca.unit_cost, 12.5);
  assert.equal(coca.total_cost, 300);
  assert.equal(coca.supplier_id, 10);
  // supplier_id column untouched by the ticket: product 2 had no primary supplier when restocked.
  assert.equal(history.find((h) => h.product_id === 2).supplier_id, null);

  // Ticket lines.
  const lines = db.state.purchase_ticket_lines;
  assert.deepEqual(lines.map((l) => [l.product_id, l.qty, l.unit_cost, l.line_total, l.product_created, l.prev_cost_price, l.restock_history_id !== null]), [
    [1, 24, 12.5, 300, false, 12, true],
    [2, 10, 22, 220, false, 21.5, true],
    [createdId, 6, 14, 84, true, null, false]
  ]);
  for (const line of lines) assert.equal(line.ticket_id, ticket.id);
  assert.equal(lines[0].restock_history_id, coca.id);

  // No per-line "Reabastecimiento" reminder; audit for the ticket.
  assert.equal(db.state.reminders.filter((r) => String(r.source_key).startsWith("auto:restock:")).length, 0);
  const ticketAudit = db.state.audit_logs.filter((a) => a.accion === "confirm_purchase_ticket");
  assert.equal(ticketAudit.length, 1);
  assert.equal(ticketAudit[0].entidad_id, String(ticket.id));
  assert.deepEqual(db.state.automation_events.map((e) => e.payload.source), ["purchase_ticket"]);
});

test("egreso: uno solo por ticket, en efectivo, por el total confirmado", async () => {
  startCase();
  const { json } = await confirm(GERENTE, ticketBody());
  const expenses = db.state.expenses;
  assert.equal(expenses.length, 1);
  const [expense] = expenses;
  assert.equal(expense.id, db.state.purchase_tickets[0].expense_id);
  assert.equal(expense.business_id, 6);
  assert.equal(expense.amount, 500);
  assert.equal(expense.payment_method, "cash");
  assert.equal(expense.movement_type, "inventory_restock");
  assert.equal(expense.category, "Compra de inventario");
  assert.equal(expense.is_voided, false);
  assert.equal(expense.date, getMexicoCityDate());
  assert.equal(expense.concept, "Compra por ticket A-1029: Abarrotes El Sol");
  assert.deepEqual(expense.metadata, {
    source_module: "purchase_tickets", purchase_ticket_id: json.ticket_id, ticket_date: "2026-10-10", folio: "A-1029",
    total: 500, lines_total: 604, line_count: 3, supplier_id: 10, supplier_name: "Abarrotes El Sol"
  });
});

test("roles: superusuario (alias superadmin), admin y gerente confirman", async () => {
  for (const [user, hash] of [[SUPER, HASH_A], [ADMIN, HASH_B], [GERENTE, HASH_C]]) {
    startCase();
    const { status } = await confirm(user, ticketBody({ image_sha256: hash }));
    assert.equal(status, 201, user.role);
  }
});

test("sin proveedor: no toca product_suppliers", async () => {
  startCase();
  const { status } = await confirm(ADMIN, ticketBody({ supplier_id: null, lines: [{ product_id: 2, qty: 1, unit_cost: 20 }], total: 20 }));
  assert.equal(status, 201);
  assert.equal(db.state.product_suppliers.length, 1);
  assert.equal(db.state.purchase_tickets[0].supplier_id, null);
  assert.equal(db.state.expenses[0].concept, "Compra por ticket A-1029: Sin proveedor");
});

// ─── Rollback ────────────────────────────────────────────────────────────────

test("ROLLBACK completo si falla una linea a mitad del ticket", async () => {
  startCase();
  const before = snapshot();
  let lineInserts = 0;
  db.failWhen = (sql) => sql.startsWith("INSERT INTO purchase_ticket_lines") && ++lineInserts === 2;
  const { status } = await confirm(ADMIN, ticketBody());
  assert.equal(status, 500);
  assert.deepEqual(db.transactions, { begin: 1, commit: 0, rollback: 1 });
  assert.deepEqual(db.state, before);
});

test("ROLLBACK si una linea no pasa la validacion de restock (qty fraccionaria en pieza)", async () => {
  startCase();
  const before = snapshot();
  const { status } = await confirm(ADMIN, ticketBody({ lines: [
    { product_id: 3, qty: 0.75, unit_cost: 95 },
    { product_id: 1, qty: 1.5, unit_cost: 12 }
  ] }));
  assert.equal(status, 400);
  assert.deepEqual(db.state, before);
});

test("ROLLBACK si falla la creacion de un producto nuevo (precio cero)", async () => {
  startCase();
  const before = snapshot();
  const { status } = await confirm(ADMIN, ticketBody({ lines: [
    { product_id: 1, qty: 2, unit_cost: 12 },
    { new_product: { name: "Nuevo", sale_price: 0, category: "X" }, qty: 1, unit_cost: 5 }
  ] }));
  assert.equal(status, 400);
  assert.deepEqual(db.state, before);
});

// ─── Tenant ──────────────────────────────────────────────────────────────────

test("aislamiento: proveedor o producto de otro negocio da 404 sin cambios", async () => {
  startCase();
  const before = snapshot();
  let response = await confirm(ADMIN, ticketBody({ supplier_id: 70 }));
  assert.equal(response.status, 404);
  response = await confirm(ADMIN, ticketBody({ lines: [{ product_id: 1, qty: 1, unit_cost: 1 }, { product_id: 90, qty: 1, unit_cost: 1 }] }));
  assert.equal(response.status, 404);
  assert.deepEqual(response.json.details, { product_ids: [90] });
  response = await confirm(ADMIN, ticketBody({ business_id: 7 }));
  assert.equal(response.status, 400);
  response = await confirm(ADMIN, ticketBody({ supplier_name: "Proveedor inventado" }));
  assert.equal(response.status, 400);
  assert.deepEqual(db.state, before);
  // Every business-scoped statement used the actor's business (6), never 7.
  for (const { sql, params } of db.queries) {
    if (/business_id = \$2/.test(sql) && /WHERE id = \$1/.test(sql)) assert.equal(params[1], 6, sql);
    if (/WHERE business_id = \$1/.test(sql)) assert.equal(params[0], 6, sql);
  }
});

test("aislamiento: no se puede anular el ticket de otro negocio", async () => {
  startCase();
  const { json } = await confirm(ADMIN, ticketBody());
  const before = snapshot();
  const other = { ...ADMIN, id: 777, business_id: 7 };
  const { status } = await voidTicket(other, json.ticket_id, { reason: "intento ajeno" });
  assert.equal(status, 404);
  assert.deepEqual(db.state, before);
});

// ─── Duplicates ──────────────────────────────────────────────────────────────

test("duplicado por hash: 409; anulado el ticket, la misma imagen se puede volver a confirmar", async () => {
  startCase();
  const first = await confirm(ADMIN, ticketBody());
  assert.equal(first.status, 201);
  const before = snapshot();
  const again = await confirm(ADMIN, ticketBody({ supplier_id: 11, total: 1, folio: "otro", acknowledge_possible_duplicate: true }));
  assert.equal(again.status, 409);
  assert.deepEqual(again.json.details, { reason: "duplicate_image", ticket_id: first.json.ticket_id });
  assert.deepEqual(db.state, before);

  assert.equal((await voidTicket(ADMIN, first.json.ticket_id, { reason: "subido por error" })).status, 200);
  const reupload = await confirm(ADMIN, ticketBody());
  assert.equal(reupload.status, 201);
  assert.notEqual(reupload.json.ticket_id, first.json.ticket_id);
});

test("duplicado por indice unico (carrera): 23505 se responde 409", async () => {
  startCase();
  db.state.purchase_tickets.push({ id: 99, business_id: 6, image_sha256: HASH_A, status: "confirmed", supplier_id: null, ticket_date: "2000-01-01", total: 1, folio: null });
  // Hide it from the pre-check so only the unique index catches it.
  db.handlers.unshift([/^SELECT id FROM purchase_tickets WHERE business_id = \$1 AND image_sha256 = \$2/, () => ({ rows: [] })]);
  try {
    const { status, json } = await confirm(ADMIN, ticketBody());
    assert.equal(status, 409);
    assert.equal(json.details.reason, "duplicate_image");
    assert.equal(db.transactions.rollback, 1);
  } finally {
    db.handlers.shift();
  }
});

test("posible duplicado por proveedor+fecha+total+folio: 409 sin acknowledge, 201 con acknowledge", async () => {
  startCase();
  const first = await confirm(ADMIN, ticketBody());
  const before = snapshot();
  const second = await confirm(ADMIN, ticketBody({ image_sha256: HASH_B }));
  assert.equal(second.status, 409);
  assert.deepEqual(second.json.details, { reason: "possible_duplicate", ticket_id: first.json.ticket_id });
  assert.deepEqual(db.state, before);

  // Any field different: not a duplicate.
  assert.equal((await confirm(ADMIN, ticketBody({ image_sha256: HASH_C, folio: "A-1030" }))).status, 201);
  const acknowledged = await confirm(ADMIN, ticketBody({ image_sha256: HASH_B, acknowledge_possible_duplicate: true }));
  assert.equal(acknowledged.status, 201);
  assert.equal(db.state.purchase_tickets.length, 3);
});

// ─── Gates ───────────────────────────────────────────────────────────────────

test("cajero: 403 en confirmar y anular, aun con cashier_direct_stock", async () => {
  startCase();
  const before = snapshot();
  assert.equal((await confirm(CAJERO, ticketBody())).status, 403);
  assert.equal((await voidTicket(CAJERO, 1, { reason: "no deberia" })).status, 403);
  assert.deepEqual(db.state, before);
  assert.equal(db.queries.length, 0);
});

test("bandera ticket_ai_confirm_enabled apagada, ausente o no booleana: 403", async () => {
  for (const settings of [
    { ticket_ai_enabled: true, ticket_ai_confirm_enabled: false },
    { ticket_ai_enabled: true },
    { ticket_ai_enabled: true, ticket_ai_confirm_enabled: "true" },
    { ticket_ai_enabled: true, ticket_ai_confirm_enabled: null }
  ]) {
    startCase(settings);
    const before = snapshot();
    const { status, json } = await confirm(ADMIN, ticketBody());
    assert.equal(status, 403, JSON.stringify(settings));
    assert.match(json.message, /confirmación de tickets/);
    assert.equal((await voidTicket(ADMIN, 1, { reason: "probando" })).status, 403);
    assert.deepEqual(db.state, before);
  }
});

test("plan Basico y ticket_ai_enabled apagado: 403; giro sin control de stock: 403", async () => {
  startCase(CONFIRM_ON, "Basico");
  assert.equal((await confirm(ADMIN, ticketBody())).status, 403);
  startCase({ ticket_ai_enabled: false, ticket_ai_confirm_enabled: true });
  assert.equal((await confirm(ADMIN, ticketBody())).status, 403);
  startCase();
  assert.equal((await confirm({ ...ADMIN, pos_type: "Restaurante" }, ticketBody())).status, 403);
  assert.equal(db.state.purchase_tickets.length, 0);
});

test("confirmar no usa cuota IA: sin ai_token_usage ni llamadas externas", async () => {
  startCase();
  await confirm(ADMIN, ticketBody());
  assert.equal(db.queries.filter((q) => /ai_token_usage/.test(q.sql)).length, 0);
  assert.equal(fetchCalls, 0);
});

// ─── Validation ──────────────────────────────────────────────────────────────

test("new_product sin sale_price o sin category: 400", async () => {
  startCase();
  const before = snapshot();
  for (const newProduct of [
    { name: "Sin precio", category: "X" },
    { name: "Precio nulo", category: "X", sale_price: null },
    { name: "Sin categoria", sale_price: 10 },
    { name: "Categoria vacia", sale_price: 10, category: "   " },
    { sale_price: 10, category: "X" }
  ]) {
    const { status } = await confirm(ADMIN, ticketBody({ lines: [{ new_product: newProduct, qty: 1, unit_cost: 1 }] }));
    assert.equal(status, 400, JSON.stringify(newProduct));
  }
  assert.deepEqual(db.state, before);
  assert.equal(db.transactions.begin, 0);
});

test("limites y forma del cuerpo: 400 sin abrir transaccion", async () => {
  startCase();
  const line = { product_id: 1, qty: 1, unit_cost: 1 };
  const cases = [
    { lines: Array.from({ length: 101 }, () => line) },
    { lines: [] },
    { lines: [{ ...line, qty: 0 }] },
    { lines: [{ ...line, qty: 100001 }] },
    { lines: [{ ...line, unit_cost: -1 }] },
    { lines: [{ ...line, unit_cost: 1000001 }] },
    { lines: [{ ...line, qty: "muchos" }] },
    { total: -1 },
    { total: 10000001 },
    { total: null },
    { ticket_date: "2026-02-30" },
    { ticket_date: "10/10/2026" },
    { ticket_date: null },
    { image_sha256: "xyz" },
    { supplier_id: "abc" },
    { folio: 123 },
    { acknowledge_possible_duplicate: "si" },
    { lines: [{ product_id: 1, new_product: { name: "A", sale_price: 1, category: "X" }, qty: 1, unit_cost: 1 }] },
    { lines: [{ qty: 1, unit_cost: 1 }] }
  ];
  for (const overrides of cases) {
    const { status } = await confirm(ADMIN, ticketBody(overrides));
    assert.equal(status, 400, JSON.stringify(overrides).slice(0, 120));
  }
  assert.equal(db.transactions.begin, 0);
  // Upper bounds are inclusive.
  const atLimit = await confirm(ADMIN, ticketBody({ total: 10000000, lines: [{ product_id: 2, qty: 100000, unit_cost: 0 }] }));
  assert.equal(atLimit.status, 201);
});

// ─── Void ────────────────────────────────────────────────────────────────────

test("anular con stock suficiente: revierte stock, costo si no cambio, egreso anulado, historial compensatorio", async () => {
  startCase();
  const { json } = await confirm(ADMIN, ticketBody());
  const ticketId = json.ticket_id;
  const createdId = json.summary.products_created[0].product_id;
  // After the ticket someone edited product 2's cost by hand: it must be kept.
  product(2).cost_price = 23;
  const historyBefore = db.state.product_restock_history.length;

  const { status, json: result } = await voidTicket(GERENTE, ticketId, { reason: "proveedor cancelo la factura" });
  assert.equal(status, 200, JSON.stringify(result));
  assert.equal(product(1).stock, 5);
  assert.equal(product(1).cost_price, 12);
  assert.equal(product(2).stock, 20);
  assert.equal(product(2).cost_price, 23);
  // Created product is not deleted: stock back to 0 and reported.
  assert.ok(product(createdId));
  assert.equal(product(createdId).stock, 0);
  assert.deepEqual(result, {
    ticket_id: ticketId,
    status: "voided",
    expense_voided_id: db.state.expenses[0].id,
    products_reverted: [{ product_id: 1, qty: 24 }, { product_id: 2, qty: 10 }, { product_id: createdId, qty: 6 }],
    cost_restored: [1],
    cost_kept: [2],
    // Product 1's link existed (11.25 before); the ticket created the links of 2 and the new product.
    supplier_cost_restored: [1],
    supplier_link_removed: [createdId, 2],
    supplier_cost_kept: [],
    products_created_kept: [{ product_id: createdId, name: "Sabritas Naturales 45 g" }]
  });

  const [expense] = db.state.expenses;
  assert.equal(expense.is_voided, true);
  assert.equal(expense.voided_by, 502);
  assert.equal(expense.void_reason, "proveedor cancelo la factura");
  const ticket = db.state.purchase_tickets[0];
  assert.equal(ticket.status, "voided");
  assert.equal(ticket.voided_by, 502);
  assert.equal(ticket.void_reason, "proveedor cancelo la factura");

  const compensating = db.state.product_restock_history.slice(historyBefore);
  assert.equal(compensating.length, 3);
  for (const row of compensating) {
    assert.equal(row.metadata.entry_type, "decrease");
    assert.equal(row.metadata.purchase_ticket_void, true);
    assert.equal(row.metadata.purchase_ticket_id, ticketId);
    assert.equal(row.total_cost, 0);
    assert.ok(row.quantity_added < 0);
  }
  const cocaReversal = compensating.find((row) => row.product_id === 1);
  assert.deepEqual([cocaReversal.quantity_added, cocaReversal.stock_before, cocaReversal.stock_after, cocaReversal.supplier_id], [-24, 29, 5, 10]);
  assert.equal(db.state.audit_logs.filter((a) => a.accion === "void_purchase_ticket").length, 1);
  assert.deepEqual(db.transactions, { begin: 2, commit: 2, rollback: 0 });
});

test("anular con stock insuficiente: 409 con los productos, sin cambios", async () => {
  startCase();
  const { json } = await confirm(ADMIN, ticketBody());
  // Sales after the ticket: 29 -> 10 for product 1.
  product(1).stock = 10;
  const before = snapshot();
  const { status, json: error } = await voidTicket(ADMIN, json.ticket_id, { reason: "proveedor cancelo" });
  assert.equal(status, 409);
  assert.deepEqual(error.details, { reason: "insufficient_stock", products: [{ product_id: 1, name: "Coca Cola 600 ml", stock: 10, required: 24 }] });
  assert.deepEqual(db.state, before);
});

test("anular: el mismo producto en dos lineas se deshace en orden inverso", async () => {
  startCase();
  const { json } = await confirm(ADMIN, ticketBody({ total: 50, lines: [
    { product_id: 2, qty: 1, unit_cost: 20 },
    { product_id: 2, qty: 2, unit_cost: 25 }
  ] }));
  assert.equal(product(2).cost_price, 25);
  assert.deepEqual(db.state.purchase_ticket_lines.map((l) => l.prev_cost_price), [21.5, 20]);
  await voidTicket(ADMIN, json.ticket_id, { reason: "duplicado real" });
  assert.equal(product(2).stock, 20);
  assert.equal(product(2).cost_price, 21.5);
});

test("anular: motivo obligatorio, ticket inexistente 404, ya anulado 409", async () => {
  startCase();
  const { json } = await confirm(ADMIN, ticketBody());
  assert.equal((await voidTicket(ADMIN, json.ticket_id, {})).status, 400);
  assert.equal((await voidTicket(ADMIN, json.ticket_id, { reason: "   " })).status, 400);
  assert.equal((await voidTicket(ADMIN, json.ticket_id, { reason: "abc" })).status, 400);
  assert.equal((await voidTicket(ADMIN, "abc", { reason: "motivo valido" })).status, 400);
  assert.equal((await voidTicket(ADMIN, 9999, { reason: "motivo valido" })).status, 404);
  assert.equal((await voidTicket(ADMIN, json.ticket_id, { reason: "motivo valido" })).status, 200);
  const before = snapshot();
  assert.equal((await voidTicket(ADMIN, json.ticket_id, { reason: "otra vez" })).status, 409);
  assert.deepEqual(db.state, before);
});

// ─── Supplier cost on void ───────────────────────────────────────────────────

const supplierLink = (productId, supplierId = 10) => db.state.product_suppliers.find((ps) => ps.product_id === productId && ps.supplier_id === supplierId);

test("confirmar guarda prev_supplier_cost y supplier_link_created por linea", async () => {
  startCase();
  const { json } = await confirm(ADMIN, ticketBody());
  const createdId = json.summary.products_created[0].product_id;
  assert.deepEqual(db.state.purchase_ticket_lines.map((l) => [l.product_id, l.prev_supplier_cost, l.supplier_link_created]), [
    [1, 11.25, false],
    [2, null, true],
    [createdId, null, true]
  ]);
  // Without supplier nothing is linked nor recorded.
  startCase();
  await confirm(ADMIN, ticketBody({ supplier_id: null, total: 20, lines: [{ product_id: 1, qty: 1, unit_cost: 20 }] }));
  assert.deepEqual(db.state.purchase_ticket_lines.map((l) => [l.prev_supplier_cost, l.supplier_link_created]), [[null, false]]);
  assert.equal(supplierLink(1).purchase_cost, 11.25);
});

test("anular: restaura el costo previo del proveedor y elimina el vinculo que creo el ticket", async () => {
  startCase();
  const { json } = await confirm(ADMIN, ticketBody());
  const createdId = json.summary.products_created[0].product_id;
  assert.equal(supplierLink(1).purchase_cost, 12.5);
  assert.ok(supplierLink(2));
  assert.ok(supplierLink(createdId));

  const { status, json: result } = await voidTicket(ADMIN, json.ticket_id, { reason: "proveedor cancelo" });
  assert.equal(status, 200);
  assert.equal(supplierLink(1).purchase_cost, 11.25);
  assert.equal(supplierLink(1).is_primary, true);
  assert.equal(supplierLink(2), undefined);
  assert.equal(supplierLink(createdId), undefined);
  assert.deepEqual(db.state.product_suppliers.map((ps) => [ps.product_id, ps.supplier_id]), [[1, 10]]);
  assert.deepEqual([result.supplier_cost_restored, result.supplier_link_removed.sort((a, b) => a - b), result.supplier_cost_kept], [[1], [2, createdId], []]);
});

test("anular: si el costo del proveedor ya cambio, no se toca y se reporta", async () => {
  startCase();
  const { json } = await confirm(ADMIN, ticketBody());
  const createdId = json.summary.products_created[0].product_id;
  // After the ticket the supplier costs were edited (catalog import, product form...).
  supplierLink(1).purchase_cost = 13;
  supplierLink(createdId).purchase_cost = 15;

  const { json: result } = await voidTicket(ADMIN, json.ticket_id, { reason: "proveedor cancelo" });
  assert.equal(supplierLink(1).purchase_cost, 13);
  assert.equal(supplierLink(createdId).purchase_cost, 15);
  assert.equal(supplierLink(2), undefined);
  assert.deepEqual(result.supplier_cost_kept.sort((a, b) => a - b), [1, createdId]);
  assert.deepEqual(result.supplier_cost_restored, []);
  assert.deepEqual(result.supplier_link_removed, [2]);
});

test("anular: vinculo borrado despues del ticket se reporta como no tocado", async () => {
  startCase();
  const { json } = await confirm(ADMIN, ticketBody({ total: 25, lines: [{ product_id: 2, qty: 1, unit_cost: 25 }] }));
  db.state.product_suppliers = db.state.product_suppliers.filter((ps) => ps.product_id !== 2);
  const { status, json: result } = await voidTicket(ADMIN, json.ticket_id, { reason: "proveedor cancelo" });
  assert.equal(status, 200);
  assert.deepEqual(result.supplier_cost_kept, [2]);
  assert.equal(supplierLink(2), undefined);
});

test("anular: mismo producto dos veces con proveedor, se deshace en orden inverso", async () => {
  startCase();
  const { json } = await confirm(ADMIN, ticketBody({ total: 50, lines: [
    { product_id: 2, qty: 1, unit_cost: 20 },
    { product_id: 2, qty: 2, unit_cost: 25 }
  ] }));
  assert.deepEqual(db.state.purchase_ticket_lines.map((l) => [l.prev_supplier_cost, l.supplier_link_created]), [[null, true], [20, false]]);
  assert.equal(supplierLink(2).purchase_cost, 25);
  await voidTicket(ADMIN, json.ticket_id, { reason: "duplicado real" });
  assert.equal(supplierLink(2), undefined);
});

// ─── Restock metrics ─────────────────────────────────────────────────────────

function getJson(path, user) {
  return new Promise((resolve, reject) => {
    nativeFetch.get(`${baseUrl}${path}`, { headers: { "x-test-user": JSON.stringify(user) } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, json: JSON.parse(Buffer.concat(chunks).toString("utf8") || "null") }));
    }).on("error", reject);
  });
}

const metrics = (user = ADMIN) => getJson("/products/restock-history/metrics", user);

test("metricas: total_spent sin el ticket anulado; el resto no cambia", async () => {
  startCase();
  // A manual restock (no ticket): 4 x 21.5 = 86.
  await require("../services/productService").restockProduct(2, { stock: 4 }, ADMIN);
  const manualOnly = (await metrics()).json;
  assert.deepEqual(manualOnly, { total_spent: 86, inventory_value_before: 20 * 21.5, inventory_value_after: 24 * 21.5, total_movements: 1 });

  // Ticket entries: 24 x 12.5 + 10 x 22 = 520 (the created product has no history entry).
  const { json: ticket } = await confirm(ADMIN, ticketBody());
  const withTicket = (await metrics()).json;
  assert.equal(withTicket.total_spent, 86 + 520);
  assert.equal(withTicket.total_movements, 3);

  await voidTicket(ADMIN, ticket.ticket_id, { reason: "proveedor cancelo" });
  const afterVoid = (await metrics()).json;
  assert.equal(afterVoid.total_spent, 86);
  // Only total_spent changes: the voided ticket entries still count as movements and inventory value.
  assert.equal(afterVoid.total_movements, withTicket.total_movements);
  assert.equal(afterVoid.inventory_value_before, withTicket.inventory_value_before);
  assert.equal(afterVoid.inventory_value_after, withTicket.inventory_value_after);

  // A confirmed ticket keeps counting, even if business 7 has a voided ticket with that same id.
  const { json: second } = await confirm(ADMIN, ticketBody({ image_sha256: HASH_B, folio: "B-1", total: 22, lines: [{ product_id: 2, qty: 1, unit_cost: 22 }] }));
  db.state.purchase_tickets.push({ id: second.ticket_id, business_id: 7, status: "voided", image_sha256: HASH_C });
  assert.equal((await metrics()).json.total_spent, 86 + 22);
});

test("metricas: la consulta solo lee purchase_tickets del mismo negocio", async () => {
  startCase();
  await metrics();
  const query = db.queries.find((q) => /FROM product_restock_history history/.test(q.sql));
  assert.deepEqual(query.params, [6]);
  assert.match(query.sql, /voided_ticket\.business_id = history\.business_id/);
});

// ─── Recent tickets ──────────────────────────────────────────────────────────

const recent = (user) => getJson("/products/restock/ticket/recent", user);

test("recientes: tickets del negocio, confirmados y anulados, con proveedor, usuario y lineas", async () => {
  startCase();
  const { json: first } = await confirm(ADMIN, ticketBody());
  const { json: second } = await confirm(GERENTE, ticketBody({ image_sha256: HASH_B, supplier_id: null, folio: null, total: 22, lines: [{ product_id: 2, qty: 1, unit_cost: 22 }] }));
  await voidTicket(ADMIN, first.ticket_id, { reason: "proveedor cancelo" });
  // Business 7 ticket must never show up, even being the newest.
  db.state.purchase_tickets.push({ id: 900, business_id: 7, supplier_id: 70, ticket_date: "2026-10-01", total: 1, lines_total: 1, folio: "AJENO", image_sha256: HASH_C, status: "confirmed", created_by: 777, created_at: "2099-01-01" });
  const before = snapshot();

  const { status, json } = await recent(ADMIN);
  assert.equal(status, 200);
  assert.deepEqual(json.items.map((t) => t.id), [second.ticket_id, first.ticket_id]);
  assert.deepEqual(json.items[1], {
    id: first.ticket_id, ticket_date: "2026-10-10", total: 500, lines_total: 604, folio: "A-1029",
    supplier_id: 10, supplier_name: "Abarrotes El Sol", status: "voided", created_by: "Ana Admin", created_by_id: 501,
    created_at: db.state.purchase_tickets[0].created_at, line_count: 3, voided_at: "now", void_reason: "proveedor cancelo"
  });
  assert.deepEqual(json.items[0], {
    id: second.ticket_id, ticket_date: "2026-10-10", total: 22, lines_total: 22, folio: null,
    supplier_id: null, supplier_name: null, status: "confirmed", created_by: "gabi", created_by_id: 502,
    created_at: db.state.purchase_tickets[1].created_at, line_count: 1, voided_at: null, void_reason: null
  });
  // Read only, scoped to business 6.
  assert.deepEqual(db.state, before);
  const query = db.queries.find((q) => /FROM purchase_tickets pt/.test(q.sql));
  assert.deepEqual(query.params, [6, 30]);
  assert.equal(fetchCalls, 0);
});

test("recientes: maximo 30", async () => {
  startCase();
  for (let i = 0; i < 35; i += 1) {
    db.state.purchase_tickets.push({ id: 100 + i, business_id: 6, supplier_id: null, ticket_date: "2026-10-01", total: i, lines_total: i, folio: null, image_sha256: String(i).padStart(64, "0"), status: "confirmed", created_by: 501, created_at: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}` });
  }
  const { json } = await recent(GERENTE);
  assert.equal(json.items.length, 30);
});

test("recientes: cajero 403; bandera de confirmar apagada o plan Basico 403; otro negocio no ve tickets ajenos", async () => {
  startCase();
  await confirm(ADMIN, ticketBody());
  assert.equal((await recent(CAJERO)).status, 403);
  startCase({ ticket_ai_enabled: true });
  assert.equal((await recent(ADMIN)).status, 403);
  startCase(CONFIRM_ON, "Basico");
  assert.equal((await recent(ADMIN)).status, 403);

  startCase();
  await confirm(ADMIN, ticketBody());
  const other = { ...ADMIN, id: 777, business_id: 7 };
  const { status, json } = await recent(other);
  assert.equal(status, 200);
  assert.deepEqual(json.items, []);
});
