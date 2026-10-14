// Supplier catalog import confirm (supplierCatalogService.confirmSupplierCatalogImport):
// one SAVEPOINT per row, so a SQL error in one row leaves the others intact.
// pool.connect returns a fake client that behaves like PostgreSQL inside a
// transaction: after a failed statement every command fails until ROLLBACK TO
// SAVEPOINT, and a COMMIT of an aborted transaction rolls everything back.
//
// Run with: node --test src/utils/supplierCatalogImport.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");
const { confirmSupplierCatalogImport } = require("../services/supplierCatalogService");

const ADMIN = { id: 1, business_id: 7, role: "admin" };
const SUPPLIER_ID = 10;
const ABORTED = "current transaction is aborted, commands ignored until end of transaction block";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFakeDb({ items = [], failNames = [], failRollbackTo = false } = {}) {
  const db = { items: clone(items), nextId: 100, statements: [] };
  let tx = null;

  function sqlError(message) {
    if (tx) tx.aborted = true;
    return new Error(message);
  }

  async function query(sqlText, params = []) {
    const sql = String(sqlText).replace(/\s+/g, " ").trim();
    db.statements.push(sql);

    if (sql === "BEGIN") {
      tx = { snapshot: clone(db.items), savepoints: [], aborted: false };
      return { rows: [] };
    }
    if (sql === "COMMIT") {
      // PostgreSQL turns the COMMIT of an aborted transaction into a ROLLBACK.
      if (tx.aborted) db.items = tx.snapshot;
      tx = null;
      return { rows: [] };
    }
    if (sql === "ROLLBACK") {
      db.items = tx.snapshot;
      tx = null;
      return { rows: [] };
    }
    const rollbackTo = /^ROLLBACK TO SAVEPOINT (\w+)$/.exec(sql);
    if (rollbackTo) {
      if (failRollbackTo) throw new Error("connection lost");
      const savepoint = tx.savepoints.find((s) => s.name === rollbackTo[1]);
      db.items = clone(savepoint.snapshot);
      tx.aborted = false;
      return { rows: [] };
    }
    if (tx?.aborted) throw new Error(ABORTED);

    const savepoint = /^SAVEPOINT (\w+)$/.exec(sql);
    if (savepoint) {
      tx.savepoints.push({ name: savepoint[1], snapshot: clone(db.items) });
      return { rows: [] };
    }
    const release = /^RELEASE SAVEPOINT (\w+)$/.exec(sql);
    if (release) {
      const index = tx.savepoints.map((s) => s.name).lastIndexOf(release[1]);
      tx.savepoints.splice(index);
      return { rows: [] };
    }

    if (/FROM suppliers WHERE id = \$1 AND business_id = \$2/.test(sql)) {
      return { rows: params[0] === SUPPLIER_ID && params[1] === 7 ? [{ id: SUPPLIER_ID, business_id: 7, name: "Truper" }] : [] };
    }
    if (/^SELECT \* FROM supplier_catalog_items/.test(sql)) {
      const [businessId, supplierId, key] = params;
      const field = /LOWER\(supplier_product_code\)/.test(sql) ? "supplier_product_code" : "supplier_product_name";
      const found = db.items.find((item) => item.business_id === businessId && item.supplier_id === supplierId
        && String(item[field] || "").toLowerCase() === String(key).toLowerCase());
      return { rows: found ? [clone(found)] : [] };
    }
    if (/^UPDATE supplier_catalog_items/.test(sql)) {
      const item = db.items.find((x) => x.id === params[13] && x.business_id === params[14]);
      if (failNames.includes(params[1])) throw sqlError("value too long for type character varying(180)");
      Object.assign(item, { supplier_product_code: params[0], supplier_product_name: params[1], purchase_cost: params[5] });
      return { rows: [clone(item)] };
    }
    if (/^INSERT INTO supplier_catalog_items/.test(sql)) {
      if (failNames.includes(params[3])) throw sqlError("value too long for type character varying(180)");
      const item = { id: db.nextId++, business_id: params[0], supplier_id: params[1], supplier_product_code: params[2], supplier_product_name: params[3], purchase_cost: params[7] };
      db.items.push(item);
      return { rows: [clone(item)] };
    }
    throw new Error(`SQL no esperado en la prueba: ${sql.slice(0, 80)}`);
  }

  pool.connect = async () => ({ query, release() {} });
  return db;
}

function row(rowNumber, name, cost, code = "") {
  return { row_number: rowNumber, payload: { supplier_product_code: code, supplier_product_name: name, purchase_cost: String(cost), supplier_unit: "pieza" } };
}

// What the response says was saved, compared with what is left after COMMIT.
function assertResponseMatchesDb(result, db) {
  for (const entry of result.results) {
    if (entry.status === "imported" || entry.status === "updated") {
      assert.ok(db.items.some((item) => item.id === entry.item_id), `item ${entry.item_id} reportado como guardado no existe`);
    }
  }
}

test("una fila que falla en SQL a la mitad no tumba a las demas; la base queda con lo reportado", async () => {
  const db = createFakeDb({
    items: [{ id: 50, business_id: 7, supplier_id: SUPPLIER_ID, supplier_product_code: "TRU-1", supplier_product_name: "Martillo", purchase_cost: "100" }],
    failNames: ["Nombre que revienta en SQL"]
  });

  const result = await confirmSupplierCatalogImport(SUPPLIER_ID, [
    row(2, "Desarmador", 45),
    row(3, "Nombre que revienta en SQL", 10),
    row(4, "Martillo", 120, "TRU-1"),
    row(5, "Pinzas", 80)
  ], ADMIN, "catalogo.xlsx");

  assert.deepEqual(result.results.map((r) => [r.row_number, r.status]), [[2, "imported"], [3, "error"], [4, "updated"], [5, "imported"]]);
  assert.match(result.results[1].message, /value too long/);
  assert.deepEqual(result.summary, { total: 4, imported: 2, updated: 1, errors: 1, cost_changes: 1 });

  assert.deepEqual(db.items.map((i) => [i.supplier_product_name, i.purchase_cost]).sort(), [
    ["Desarmador", 45], ["Martillo", 120], ["Pinzas", 80]
  ]);
  assertResponseMatchesDb(result, db);
  assert.equal(db.statements.filter((s) => s === "COMMIT").length, 1);
  assert.equal(db.statements.includes(ABORTED), false);
  assert.equal(db.statements.filter((s) => s === "ROLLBACK TO SAVEPOINT catalog_import_row").length, 1);
});

test("fallo SQL en la primera y en la ultima fila, y un error de validacion de JS: el resto se guarda", async () => {
  const db = createFakeDb({ failNames: ["Falla uno", "Falla dos"] });

  const result = await confirmSupplierCatalogImport(SUPPLIER_ID, [
    row(2, "Falla uno", 1),
    row(3, "", 5),
    row(4, "Llave inglesa", 150),
    row(5, "Falla dos", 1)
  ], ADMIN);

  assert.deepEqual(result.results.map((r) => r.status), ["error", "error", "imported", "error"]);
  assert.match(result.results[1].message, /requires supplier product name/);
  assert.deepEqual(db.items.map((i) => i.supplier_product_name), ["Llave inglesa"]);
  assertResponseMatchesDb(result, db);
});

test("un update que falla en SQL deja el renglon existente como estaba", async () => {
  const db = createFakeDb({
    items: [{ id: 50, business_id: 7, supplier_id: SUPPLIER_ID, supplier_product_code: "TRU-9", supplier_product_name: "Nivel", purchase_cost: "90" }],
    failNames: ["Nivel nuevo nombre demasiado largo"]
  });

  const result = await confirmSupplierCatalogImport(SUPPLIER_ID, [
    row(2, "Nivel nuevo nombre demasiado largo", 95, "TRU-9"),
    row(3, "Flexometro", 60)
  ], ADMIN);

  assert.deepEqual(result.results.map((r) => r.status), ["error", "imported"]);
  assert.deepEqual(db.items.find((i) => i.id === 50), { id: 50, business_id: 7, supplier_id: SUPPLIER_ID, supplier_product_code: "TRU-9", supplier_product_name: "Nivel", purchase_cost: "90" });
  assertResponseMatchesDb(result, db);
});

test("si ROLLBACK TO SAVEPOINT tambien falla, se revierte todo y no se devuelve un resultado parcial", async () => {
  const db = createFakeDb({ failNames: ["Falla"], failRollbackTo: true });

  await assert.rejects(
    () => confirmSupplierCatalogImport(SUPPLIER_ID, [row(2, "Serrucho", 70), row(3, "Falla", 1), row(4, "Lija", 5)], ADMIN),
    /connection lost/
  );
  assert.deepEqual(db.items, []);
  assert.equal(db.statements.at(-1), "ROLLBACK");
});

test("proveedor de otro negocio: 404 y nada se guarda", async () => {
  const db = createFakeDb();
  await assert.rejects(
    () => confirmSupplierCatalogImport(SUPPLIER_ID, [row(2, "Serrucho", 70)], { ...ADMIN, business_id: 8 }),
    /Supplier not found/
  );
  assert.deepEqual(db.items, []);
});
