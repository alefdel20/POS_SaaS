// AI context catalog totals: same source as the dashboard cards
// (dashboardService.buildCatalogTotalsSql), always scoped by business_id.
// No database: pool.query is mocked and every query is captured.
//
// Run with: node --test src/utils/aiContextCatalog.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");
const dashboardService = require("../services/dashboardService");
const { getBusinessContext, buildSystemPrompt } = require("./aiContextBuilder");

// Dashboard of the test account: 57 products, 108 units, $3,296 / $4,338.
const CATALOG_ROW = {
  total_products: "57",
  inventory_total_value: "4338.00000",
  total_current_stock: "108.000",
  current_stock_total_value: "3296.00000"
};

function mockPool() {
  const queries = [];
  pool.query = async (sql, params) => {
    queries.push({ sql, params });
    if (/AS current_stock_total_value/.test(sql)) return { rows: [CATALOG_ROW] };
    return { rows: [{ count: 0, revenue: 0 }] };
  };
  return queries;
}

test("getCatalogTotals usa el mismo SQL que las tarjetas del dashboard, filtrado por business_id", async () => {
  const queries = mockPool();
  const totals = await dashboardService.getCatalogTotals(7);

  assert.equal(queries.length, 1);
  assert.equal(queries[0].sql, `SELECT ${dashboardService.buildCatalogTotalsSql("$1")}`);
  assert.deepEqual(queries[0].params, [7]);
  assert.deepEqual(totals, {
    total_products: 57,
    total_current_stock: 108,
    current_stock_total_value: 3296,
    inventory_total_value: 4338
  });

  // Each of the four subqueries is scoped by the business parameter.
  const fragment = dashboardService.buildCatalogTotalsSql("$1");
  assert.equal((fragment.match(/FROM products WHERE products\.business_id = \$1\)/g) || []).length, 4);
});

test("getSummary del dashboard incluye exactamente el mismo fragmento de catalogo", async () => {
  const queries = mockPool();
  // Only the SQL text matters here; the rest of getSummary may fail on the mock.
  await dashboardService.getSummary({ id: 1, role: "admin", business_id: 7, pos_type: "Restaurante" }).catch(() => {});
  const summaryQuery = queries.find((q) => /AS total_sales_today/.test(q.sql));
  assert.ok(summaryQuery, "no se capturo la consulta del resumen");
  assert.ok(summaryQuery.sql.includes(dashboardService.buildCatalogTotalsSql("$1")));
  assert.equal(summaryQuery.params[0], 7);
});

test("getBusinessContext agrega el catalogo y todas sus consultas van por business_id", async () => {
  const queries = mockPool();
  const context = await getBusinessContext(7, null);

  assert.deepEqual(context.catalog, {
    total_products: 57,
    total_current_stock: 108,
    current_stock_total_value: 3296,
    inventory_total_value: 4338
  });
  assert.ok(queries.length > 0);
  assert.ok(queries.every((q) => q.params[0] === 7));
});

test("buildSystemPrompt: linea de catalogo a costo, proveedores con productos ligados e instruccion", () => {
  const prompt = buildSystemPrompt(
    { role: "admin", pos_type: "Tienda", business_name: "Cuenta test" },
    {
      catalog: { total_products: 57, total_current_stock: 108, current_stock_total_value: 3296, inventory_total_value: 4338 },
      suppliers: [{ name: "Proveedor Uno", product_count: 1 }]
    }
  );

  assert.match(prompt, /CATÁLOGO:\nCatálogo: 57 producto\(s\) registrados, 108 unidad\(es\) en stock/);
  assert.match(prompt, /Valor del stock actual \(existencias × costo; en el dashboard "Valor del stock actual"\): \$3296\.00 MXN/);
  assert.match(prompt, /Valor a stock máximo \(stock máximo × costo; en el dashboard "Valor de productos de la tienda"\): \$4338\.00 MXN/);
  assert.match(prompt, /Ambos valores están a costo, no a precio de venta\./);
  assert.match(prompt, /Proveedor Uno \(1 producto\(s\) ligado\(s\)\)/);
  assert.match(prompt, /usa SOLO la sección CATÁLOGO; nunca uses ni sumes los productos ligados a proveedores/);
});

test("buildSystemPrompt sin catalogo (consulta fallida): lo dice en lugar de inventar", () => {
  const prompt = buildSystemPrompt({ role: "admin" }, {});
  assert.match(prompt, /CATÁLOGO:\nNo hay datos del catálogo disponibles por ahora\./);
});
