// Synthetic harness for the stock_status rules (Reabastecer / inventario / dashboard):
// unconfigured > out > low > normal, and "Stock bajo" = out + low. No real DB: pool.query
// is mocked and the generated SQL is inspected, same approach as the other *.test.js here.
//
// Run with: node --test src/utils/stockStatus.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");
const {
  buildStockStatusSql,
  buildIsLowStockSql,
  buildStockShortageSql,
  listRestockProducts
} = require("../services/productService");

const actor = { id: 1, role: "admin", business_id: 7 };

function mockRestockQueries(rows = []) {
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    if (/COUNT\(\*\)::int AS total/.test(sql)) return { rows: [{ total: rows.length }] };
    return { rows };
  };
  return calls;
}

test("buildStockStatusSql: precedence is unconfigured > out > low > normal", () => {
  const sql = buildStockStatusSql();
  const order = ["'unconfigured'", "'out'", "'low'", "'normal'"].map((value) => sql.indexOf(value));
  assert.ok(order.every((index) => index >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(sql, /COALESCE\(product_data\.stock_minimo, 0\) <= 0 AND COALESCE\(product_data\.stock_maximo, 0\) <= 0 THEN 'unconfigured'/);
  assert.match(sql, /COALESCE\(product_data\.stock, 0\) <= 0 THEN 'out'/);
  assert.match(sql, /COALESCE\(product_data\.stock_minimo, 0\) > 0 AND COALESCE\(product_data\.stock, 0\) <= COALESCE\(product_data\.stock_minimo, 0\) THEN 'low'/);
});

test("buildIsLowStockSql: low stock means out or low", () => {
  assert.match(buildIsLowStockSql("products"), /IN \('out', 'low'\)/);
  assert.match(buildIsLowStockSql("products"), /products\.stock_minimo/);
});

test("buildStockShortageSql: out against max (fallback min), low against min, else 0", () => {
  const sql = buildStockShortageSql();
  assert.match(sql, /WHEN 'out' THEN GREATEST\(COALESCE\(NULLIF\(product_data\.stock_maximo, 0\), product_data\.stock_minimo, 0\) - COALESCE\(product_data\.stock, 0\), 0\)/);
  assert.match(sql, /WHEN 'low' THEN GREATEST\(COALESCE\(product_data\.stock_minimo, 0\) - COALESCE\(product_data\.stock, 0\), 0\)/);
  assert.match(sql, /ELSE 0/);
});

test("listRestockProducts stockStatus=low: COUNT and page use out + low", async () => {
  const calls = mockRestockQueries();
  await listRestockProducts({ stockStatus: "low", includeMeta: true }, actor);
  assert.equal(calls.length, 2);
  for (const { sql } of calls) {
    assert.ok(sql.includes(buildIsLowStockSql()), "where clause filters out + low");
    assert.ok(!sql.includes("COALESCE(product_data.stock, 0) <= COALESCE(product_data.stock_minimo, 0)\n"), "old stock <= min filter is gone");
  }
});

test("listRestockProducts lowStockOnly (dashboard) uses the same out + low filter", async () => {
  const calls = mockRestockQueries();
  await listRestockProducts({ lowStockOnly: true }, actor);
  assert.ok(calls[0].sql.includes(buildIsLowStockSql()));
});

test("listRestockProducts stockStatus=unconfigured and normal filter by stock_status", async () => {
  let calls = mockRestockQueries();
  await listRestockProducts({ stockStatus: "unconfigured" }, actor);
  assert.ok(calls[0].sql.includes(`${buildStockStatusSql()} = 'unconfigured'`));

  calls = mockRestockQueries();
  await listRestockProducts({ stockStatus: "normal" }, actor);
  assert.ok(calls[0].sql.includes(`${buildStockStatusSql()} = 'normal'`));
});

test("listRestockProducts stockStatus=all adds no stock condition", async () => {
  const calls = mockRestockQueries();
  await listRestockProducts({ stockStatus: "all" }, actor);
  const where = calls[0].sql.slice(calls[0].sql.indexOf("WHERE"));
  assert.ok(!where.includes("'unconfigured'"));
  assert.ok(!where.includes("IN ('out', 'low')"));
});

test("listRestockProducts maps stock_status, is_low_stock and shortage from the row", async () => {
  mockRestockQueries([
    { id: 1, stock: "0", stock_minimo: "0", stock_maximo: "0", stock_status: "unconfigured", is_low_stock: false, shortage: "0", suggested_restock: "0" },
    { id: 2, stock: "0", stock_minimo: "0", stock_maximo: "10", stock_status: "out", is_low_stock: true, shortage: "10", suggested_restock: "10" }
  ]);
  const { items } = await listRestockProducts({ includeMeta: true }, actor);
  assert.deepEqual(items.map((item) => [item.stock_status, item.is_low_stock, item.shortage]), [
    ["unconfigured", false, 0],
    ["out", true, 10]
  ]);
});
