// In-memory stand-in for pg used by the inventory tests (restock, product
// creation, purchase tickets). Only the SQL shapes those flows run are
// understood; anything else throws so a new query never passes silently.
// BEGIN snapshots the whole state, ROLLBACK restores it, SAVEPOINTs nest.
// Not a test file itself (no .test.js suffix): required by the tests.
const TODAY = "2026-10-13";

const TABLE_DEFAULTS = {
  products: () => ({
    sku: null, barcode: null, category: null, description: "", price: 0, cost_price: 0, liquidation_price: null,
    stock: 0, expires_at: null, is_active: true, supplier_id: null, status: "activo", stock_minimo: 0, stock_maximo: 0,
    unidad_de_venta: "pieza", porcentaje_ganancia: null, ieps: null, lot_number: null, catalog_type: "accessories",
    discount_type: null, discount_value: null, discount_start: null, discount_end: null, updated_at: TODAY
  }),
  expenses: () => ({ is_voided: false, voided_at: null, voided_by: null, void_reason: "", metadata: {} }),
  product_restock_history: () => ({ metadata: {} }),
  purchase_tickets: () => ({ status: "confirmed", expense_id: null, voided_at: null, voided_by: null, void_reason: "" }),
  purchase_ticket_lines: () => ({ product_created: false, prev_cost_price: null, restock_history_id: null })
};
const JSON_COLUMNS = new Set(["metadata", "payload", "detalle_anterior", "detalle_nuevo", "general_settings"]);
const TABLES = [
  "businesses", "company_profiles", "business_subscriptions", "products", "suppliers", "product_suppliers",
  "product_restock_history", "expenses", "reminders", "audit_logs", "automation_events", "product_categories",
  "purchase_tickets", "purchase_ticket_lines"
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function squash(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const char of text) {
    if (char === "'") quoted = !quoted;
    if (!quoted && char === "(") depth += 1;
    if (!quoted && char === ")") depth -= 1;
    if (!quoted && depth === 0 && char === ",") {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// "VALUES (" ... matching ")" -> [inner, rest]
function takeParenthesized(text, start) {
  let depth = 0;
  let quoted = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (char === "'") quoted = !quoted;
    if (quoted) continue;
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return [text.slice(start + 1, i), text.slice(i + 1).trim()];
    }
  }
  throw new Error(`Parentesis sin cerrar: ${text}`);
}

function evaluateToken(token, params) {
  let match = token.match(/^\$(\d+)(::[\w[\]]+)?$/);
  if (match) return params[Number(match[1]) - 1];
  match = token.match(/^'(.*)'(::(\w+))?$/);
  if (match) return match[3] === "jsonb" ? JSON.parse(match[1]) : match[1];
  if (token === "NULL") return null;
  if (token === "TRUE") return true;
  if (token === "FALSE") return false;
  if (token === "CURRENT_DATE" || token === "NOW()") return TODAY;
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  match = token.match(/^CASE WHEN \$(\d+)::numeric IS NULL THEN NULL ELSE NOW\(\) END$/);
  if (match) return params[Number(match[1]) - 1] === null ? null : TODAY;
  throw new Error(`Valor no soportado en INSERT: ${token}`);
}

function pick(row, returning) {
  if (!returning) return null;
  if (returning.trim() === "*") return { ...row };
  const out = {};
  for (const column of returning.split(",").map((c) => c.trim())) out[column] = row[column];
  return out;
}

function uniqueViolation(message) {
  const error = new Error(message);
  error.code = "23505";
  return error;
}

function stockStatus(product) {
  const stock = Number(product.stock || 0);
  const minimum = Number(product.stock_minimo || 0);
  const maximum = Number(product.stock_maximo || 0);
  if (minimum <= 0 && maximum <= 0) return "unconfigured";
  if (stock <= 0) return "out";
  if (minimum > 0 && stock <= minimum) return "low";
  return "normal";
}

function createFakeDb(seed = {}) {
  const db = {
    state: null,
    queries: [],
    // (sql, params) => truthy to make that statement throw (rollback tests).
    failWhen: null,
    transactions: { begin: 0, commit: 0, rollback: 0 },
    released: 0
  };
  const sequences = {};
  let snapshots = [];

  function reset(nextSeed = seed) {
    db.state = {};
    for (const table of TABLES) db.state[table] = clone(nextSeed[table] || []);
    for (const table of TABLES) sequences[table] = db.state[table].reduce((max, row) => Math.max(max, Number(row.id || 0)), 0);
    db.queries = [];
    db.failWhen = null;
    db.transactions = { begin: 0, commit: 0, rollback: 0 };
    db.released = 0;
    snapshots = [];
  }

  function nextId(table) {
    sequences[table] = Math.max(sequences[table] || 0, 0) + 1;
    return sequences[table];
  }

  function insert(table, row) {
    const full = { ...(TABLE_DEFAULTS[table] ? TABLE_DEFAULTS[table]() : {}), ...row };
    if (full.id === undefined) full.id = nextId(table);
    if (full.created_at === undefined) full.created_at = TODAY;
    for (const key of Object.keys(full)) {
      if (JSON_COLUMNS.has(key) && typeof full[key] === "string") full[key] = JSON.parse(full[key]);
    }
    if (table === "purchase_tickets" && full.status === "confirmed" && db.state.purchase_tickets.some((t) =>
      t.business_id === full.business_id && t.image_sha256 === full.image_sha256 && t.status === "confirmed")) {
      throw uniqueViolation("duplicate key value violates unique constraint \"uq_purchase_tickets_business_hash_confirmed\"");
    }
    db.state[table].push(full);
    return full;
  }

  function handleInsert(sql, params) {
    const head = sql.match(/^INSERT INTO (\w+) \(([^)]*)\) VALUES /);
    if (!head) throw new Error(`INSERT no soportado: ${sql}`);
    const [, table, columnList] = head;
    const [valuesText, rest] = takeParenthesized(sql, head[0].length);
    const columns = columnList.split(",").map((c) => c.trim());
    const values = splitTopLevel(valuesText).map((token) => evaluateToken(token, params));
    const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
    const returning = (rest.match(/RETURNING (.*)$/) || [])[1];
    const conflict = (rest.match(/^ON CONFLICT \(([^)]*\)?)\)/) || [])[1];

    if (conflict && table === "product_categories") {
      const existing = db.state.product_categories.find((c) => c.business_id === row.business_id && String(c.name).toLowerCase() === String(row.name).toLowerCase());
      if (existing) {
        existing.updated_at = TODAY;
        return { rows: returning ? [pick(existing, returning)] : [], rowCount: 1 };
      }
    }
    if (conflict && table === "product_suppliers") {
      const existing = db.state.product_suppliers.find((ps) => ps.product_id === row.product_id && ps.supplier_id === row.supplier_id);
      if (existing) {
        if (/DO UPDATE SET is_primary = EXCLUDED.is_primary/.test(rest)) {
          existing.is_primary = row.is_primary;
          existing.business_id = row.business_id;
        }
        if (row.purchase_cost !== null && row.purchase_cost !== undefined) {
          existing.purchase_cost = row.purchase_cost;
          existing.cost_updated_at = TODAY;
        }
        return { rows: returning ? [pick(existing, returning)] : [], rowCount: 1 };
      }
    }
    const inserted = insert(table, row);
    return { rows: returning ? [pick(inserted, returning)] : [], rowCount: 1 };
  }

  const handlers = [
    // ── Plan / profile ──
    [/FROM business_subscriptions WHERE business_id = \$1/, (p) => ({ rows: db.state.business_subscriptions.filter((s) => s.business_id === p[0]).slice(0, 1) })],
    [/^SELECT \* FROM company_profiles WHERE business_id = \$1 AND profile_key = 'default' LIMIT 1$/, (p) => ({ rows: db.state.company_profiles.filter((c) => c.business_id === p[0]).slice(0, 1) })],
    [/^SELECT pos_type FROM businesses WHERE id = \$1$/, (p) => ({ rows: db.state.businesses.filter((b) => b.id === p[0]).map(({ pos_type }) => ({ pos_type })) })],

    // ── Products ──
    [/^SELECT \* FROM products WHERE id = \$1 AND business_id = \$2( FOR UPDATE)?$/, (p) => ({ rows: db.state.products.filter((r) => r.id === Number(p[0]) && r.business_id === p[1]).map(clone) })],
    [/primary_supplier\.supplier_id/, (p) => {
      const product = db.state.products.find((r) => r.id === Number(p[0]) && r.business_id === p[1]);
      if (!product) return { rows: [] };
      const links = db.state.product_suppliers
        .filter((ps) => ps.product_id === product.id && ps.business_id === product.business_id)
        .map((ps) => ({ ps, supplier: db.state.suppliers.find((s) => s.id === ps.supplier_id && s.business_id === ps.business_id) }))
        .filter((entry) => entry.supplier)
        .sort((a, b) => Number(b.ps.is_primary) - Number(a.ps.is_primary) || String(b.ps.cost_updated_at || "").localeCompare(String(a.ps.cost_updated_at || "")) || a.supplier.name.localeCompare(b.supplier.name));
      const top = links[0];
      return { rows: [{ ...clone(product), supplier_id: top ? top.ps.supplier_id : null, supplier_name: top ? top.supplier.name : null, purchase_cost: top ? top.ps.purchase_cost : null, cost_updated_at: top ? top.ps.cost_updated_at || null : null }] };
    }],
    [/^UPDATE products SET stock = \$1, expires_at = COALESCE\(\$4, expires_at\), updated_at = NOW\(\) WHERE id = \$2 AND business_id = \$3 RETURNING \*$/, (p) => {
      const product = db.state.products.find((r) => r.id === Number(p[1]) && r.business_id === p[2]);
      if (!product) return { rows: [] };
      product.stock = p[0];
      if (p[3] !== null && p[3] !== undefined) product.expires_at = p[3];
      product.updated_at = TODAY;
      return { rows: [clone(product)] };
    }],
    [/^SELECT id, name, stock, stock_minimo, stock_maximo FROM products WHERE business_id = \$1 AND is_active = TRUE AND status = 'activo' AND \(\(CASE/, (p) => ({
      rows: db.state.products.filter((r) => r.business_id === p[0] && r.is_active && r.status === "activo" && ["out", "low"].includes(stockStatus(r)))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ id, name, stock, stock_minimo, stock_maximo }) => ({ id, name, stock, stock_minimo, stock_maximo }))
    })],
    [/^SELECT sku FROM products WHERE business_id = \$1 AND UPPER\(sku\) LIKE UPPER\(\$2\)/, (p) => {
      const prefix = String(p[1]).replace(/%$/, "").toUpperCase();
      return { rows: db.state.products.filter((r) => r.business_id === p[0] && r.sku && r.sku.toUpperCase().startsWith(prefix) && r.id !== p[2]).map(({ sku }) => ({ sku })) };
    }],
    [/^SELECT id FROM products WHERE business_id = \$1 AND UPPER\(sku\) = UPPER\(\$2\)/, (p) => ({ rows: db.state.products.filter((r) => r.business_id === p[0] && String(r.sku || "").toUpperCase() === String(p[1]).toUpperCase() && r.id !== p[2]).map(({ id }) => ({ id })) })],
    [/^SELECT id FROM products WHERE business_id = \$1 AND UPPER\(barcode\) = UPPER\(\$2\)/, (p) => ({ rows: db.state.products.filter((r) => r.business_id === p[0] && String(r.barcode || "").toUpperCase() === String(p[1]).toUpperCase() && r.id !== p[2]).map(({ id }) => ({ id })) })],

    // ── Suppliers ──
    [/^SELECT \* FROM suppliers WHERE id = \$1 AND business_id = \$2$/, (p) => ({ rows: db.state.suppliers.filter((s) => s.id === Number(p[0]) && s.business_id === p[1]).map(clone) })],
    [/^SELECT \* FROM suppliers WHERE business_id = \$1 AND LOWER\(name\) = LOWER\(\$2\)$/, (p) => ({ rows: db.state.suppliers.filter((s) => s.business_id === p[0] && s.name.toLowerCase() === String(p[1]).toLowerCase()).map(clone) })],
    [/^UPDATE suppliers SET (name = \$1, )?email = /, (p, sql) => {
      const hasName = /SET name = \$1/.test(sql);
      const [id, businessId] = hasName ? [p[5], p[6]] : [p[4], p[5]];
      const supplier = db.state.suppliers.find((s) => s.id === id && s.business_id === businessId);
      if (supplier && hasName) supplier.name = p[0];
      return { rows: [], rowCount: supplier ? 1 : 0 };
    }],
    [/^DELETE FROM product_suppliers WHERE product_id = \$1 AND business_id = \$2$/, (p) => {
      const before = db.state.product_suppliers.length;
      db.state.product_suppliers = db.state.product_suppliers.filter((ps) => !(ps.product_id === p[0] && ps.business_id === p[1]));
      return { rows: [], rowCount: before - db.state.product_suppliers.length };
    }],
    [/^DELETE FROM product_suppliers WHERE product_id = \$1 AND business_id = \$2 AND supplier_id <> ALL\(\$3::int\[\]\)$/, (p) => {
      db.state.product_suppliers = db.state.product_suppliers.filter((ps) => !(ps.product_id === p[0] && ps.business_id === p[1] && !p[2].includes(ps.supplier_id)));
      return { rows: [] };
    }],
    [/^UPDATE product_suppliers SET is_primary = supplier_id = \$3 WHERE product_id = \$1 AND business_id = \$2$/, (p) => {
      for (const ps of db.state.product_suppliers) if (ps.product_id === p[0] && ps.business_id === p[1]) ps.is_primary = ps.supplier_id === p[2];
      return { rows: [] };
    }],

    // ── Reminders (low stock sync) ──
    [/^DELETE FROM reminders WHERE business_id = \$1 AND source_key IN \(\$2, \$3\)$/, (p) => {
      db.state.reminders = db.state.reminders.filter((r) => !(r.business_id === p[0] && [p[1], p[2]].includes(r.source_key)));
      return { rows: [] };
    }],
    [/^DELETE FROM reminders WHERE business_id = \$1 AND source_key LIKE \$2$/, (p) => {
      const prefix = String(p[1]).replace(/%$/, "");
      db.state.reminders = db.state.reminders.filter((r) => !(r.business_id === p[0] && String(r.source_key || "").startsWith(prefix)));
      return { rows: [] };
    }],
    [/^SELECT id FROM reminders WHERE business_id = \$1 AND source_key = \$2 LIMIT 1$/, (p) => ({ rows: db.state.reminders.filter((r) => r.business_id === p[0] && r.source_key === p[1]).map(({ id }) => ({ id })) })],
    [/^UPDATE reminders SET title = 'STOCK BAJO', notes = \$1/, (p) => {
      for (const r of db.state.reminders) if (r.business_id === p[1] && r.source_key === p[2]) r.notes = p[0];
      return { rows: [] };
    }]
  ];

  // Extra handlers registered by a test file for SQL of the code under test.
  db.handlers = handlers;

  async function query(sqlOrConfig, params = []) {
    const raw = typeof sqlOrConfig === "string" ? sqlOrConfig : sqlOrConfig.text;
    const sql = squash(raw);
    db.queries.push({ sql, params });
    if (db.failWhen && db.failWhen(sql, params)) throw new Error("fallo inyectado por la prueba");

    if (sql === "BEGIN") {
      db.transactions.begin += 1;
      snapshots = [{ name: null, state: clone(db.state), sequences: clone(sequences) }];
      return { rows: [] };
    }
    if (sql === "COMMIT") {
      db.transactions.commit += 1;
      snapshots = [];
      return { rows: [] };
    }
    if (sql === "ROLLBACK") {
      db.transactions.rollback += 1;
      if (snapshots[0]) {
        db.state = snapshots[0].state;
        Object.assign(sequences, snapshots[0].sequences);
      }
      snapshots = [];
      return { rows: [] };
    }
    let match = sql.match(/^SAVEPOINT (\w+)$/);
    if (match) {
      snapshots.push({ name: match[1], state: clone(db.state), sequences: clone(sequences) });
      return { rows: [] };
    }
    match = sql.match(/^RELEASE SAVEPOINT (\w+)$/);
    if (match) {
      snapshots = snapshots.filter((s) => s.name !== match[1]);
      return { rows: [] };
    }
    match = sql.match(/^ROLLBACK TO SAVEPOINT (\w+)$/);
    if (match) {
      const savepoint = snapshots.find((s) => s.name === match[1]);
      db.state = clone(savepoint.state);
      return { rows: [] };
    }

    if (sql.startsWith("INSERT INTO ")) return handleInsert(sql, params);
    for (const [pattern, handler] of handlers) {
      if (pattern.test(sql)) return handler(params, sql);
    }
    throw new Error(`SQL no soportado por la base simulada: ${sql.slice(0, 160)}`);
  }

  db.query = query;
  db.connect = async () => ({
    query,
    release() {
      db.released += 1;
    }
  });
  // Points the shared pg pool at this fake.
  db.install = (pool) => {
    pool.query = query;
    pool.connect = db.connect;
  };
  db.reset = reset;
  db.rows = (table, predicate = () => true) => db.state[table].filter(predicate);
  reset(seed);
  return db;
}

module.exports = { createFakeDb, TODAY };
