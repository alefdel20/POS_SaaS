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

test("buildSystemPrompt: cargar una compra desde ticket remite a Cargar ticket, despues de las reglas de recordatorios", () => {
  const prompt = buildSystemPrompt({ role: "admin" }, {});
  const lines = prompt.split("\n");
  const ticket = lines.findIndex((line) => line.includes('"Cargar ticket"'));
  assert.ok(ticket > 0);
  assert.match(lines[ticket], /^- Si el usuario pide cargar, registrar o dar de alta una compra, insumos o productos a partir de un ticket o factura, no digas solo que no puedes/);
  assert.match(lines[ticket], /"Cargar ticket" en la pantalla Productos por reabastecer, donde sube la foto, revisa lo que se leyó y confirma/);
  assert.match(lines[ticket], /puedes ayudarle a leer y resumir el archivo/);
  assert.match(lines[ticket], /Si el usuario dice que no ve el botón, explícale que la función depende de su plan y de su rol, y que le pida a su administrador que la revise\.$/);
  assert.match(lines[ticket - 1], /NO envía un aviso a esa hora/);
  assert.match(lines[ticket + 1], /^- Si el usuario quiere cargar un catálogo/);
  assert.equal(lines[ticket + 2], "- NO respondas sobre política, entretenimiento, deportes u otros temas ajenos al negocio.");
});

test("buildSystemPrompt: Cargar ticket es solo para compras reales y justo debajo los catalogos van a Importar productos", () => {
  const lines = buildSystemPrompt({ role: "admin" }, {}).split("\n");
  const ticket = lines.findIndex((line) => line.includes('"Cargar ticket"') && line.includes("Productos por reabastecer"));
  assert.ok(ticket > 0);
  assert.match(lines[ticket], /"Cargar ticket" es solo para COMPRAS reales: suma el stock y registra un egreso\./);

  const catalog = lines[ticket + 1];
  assert.match(catalog, /^- Si el usuario quiere cargar un catálogo o una lista de productos o de precios \(no una compra\)/);
  assert.match(catalog, /no lo mandes a "Cargar ticket"/);
  assert.match(catalog, /"Importar productos" en la pantalla Productos/);
  assert.match(catalog, /archivo CSV o XLSX con nombre y precio de venta obligatorios/);
  assert.match(catalog, /hasta unos 200 renglones por archivo por ahora/);
  assert.match(catalog, /Solo un administrador puede importar productos/);
});

// Friday 2026-10-16, 16:30 in Mexico City (UTC-6).
const FRIDAY_AFTERNOON = new Date("2026-10-16T22:30:00Z");

test("buildSystemPrompt: ya no dice solo lectura; solo crea recordatorios y no modifica ni borra otros datos", () => {
  const prompt = buildSystemPrompt({ role: "admin" }, {}, FRIDAY_AFTERNOON);
  assert.doesNotMatch(prompt, /solo lectura/);
  assert.doesNotMatch(prompt, /NO puedes modificar ningún dato del sistema/);
  assert.ok(prompt.split("\n").includes(
    "- Solo puedes crear recordatorios con la herramienta createReminder cuando el usuario lo pida; no puedes modificar ni borrar ningún otro dato del sistema."
  ));
  assert.match(prompt, /pregunta UNA sola vez antes de crearlo/);
  assert.match(prompt, /sin a\. m\. o p\. m\. clara, una hora de hoy que ya pasó, o "el viernes" cuando hoy es viernes/);
  assert.match(prompt, /"Listo: mañana a las 4:00 p\. m\., comprar a Pan Bimbo"/);
  assert.match(prompt, /Crea un solo recordatorio por pedido, salvo que el usuario pida varios/);
  assert.match(prompt, /duplicate: true/);
  assert.match(prompt, /el sistema todavía NO envía un aviso a esa hora: el usuario lo verá en la sección Recordatorios/);
});

test("buildSystemPrompt: fecha con dia de la semana, hora actual de Mexico y los proximos 7 dias", () => {
  const lines = buildSystemPrompt({ role: "admin" }, {}, FRIDAY_AFTERNOON).split("\n");
  const dateLine = lines.indexOf("Fecha actual (zona horaria Ciudad de México): 2026-10-16 (viernes).");
  assert.ok(dateLine > 0);
  assert.deepEqual(lines.slice(dateLine + 1, dateLine + 10), [
    "Hora actual (zona horaria Ciudad de México, formato 24 h): 16:30.",
    "Próximos 7 días:",
    "  sábado 2026-10-17 (mañana)",
    "  domingo 2026-10-18",
    "  lunes 2026-10-19",
    "  martes 2026-10-20",
    "  miércoles 2026-10-21",
    "  jueves 2026-10-22",
    "  viernes 2026-10-23"
  ]);

  // Month and year boundaries.
  const december = buildSystemPrompt({ role: "admin" }, {}, new Date("2026-12-30T18:00:00Z")).split("\n");
  assert.ok(december.includes("Fecha actual (zona horaria Ciudad de México): 2026-12-30 (miércoles)."));
  assert.ok(december.includes("  jueves 2026-12-31 (mañana)"));
  assert.ok(december.includes("  miércoles 2027-01-06"));
});
