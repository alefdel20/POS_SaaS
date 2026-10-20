// AI chat getSalesByPeriod tool (aiFunctions.js) and the sales rules of the
// system prompt (aiContextBuilder.js). No database: pool.query is mocked and
// returns daily-cut rows shaped like dailyCutService.listRealizedDailyCuts.
//
// Run with: node --test src/utils/aiSalesTool.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");
const { executeTool } = require("./aiFunctions");
const { getBusinessContext, buildSystemPrompt } = require("./aiContextBuilder");

const ADMIN = { id: 42, business_id: 7, role: "admin" };

// Two cut days that add up to the April 2026 report: 15 sales, $637 collected,
// $269 of it credit payments (inside cash), $299 sold on credit still pending.
// Each day: total_day = cash + card + transfer + down payment (enganche).
const APRIL_ROWS = [
  { cut_date: "2026-04-20", total_day: "237", cash_total: "237", card_total: "0", transfer_total: "0", credit_collected: "169", credit_generated: "149", ticket_count: "12", invoice_count: "0" },
  { cut_date: "2026-04-03", total_day: "400", cash_total: "300", card_total: "50", transfer_total: "0", credit_collected: "100", credit_generated: "150", ticket_count: "2", invoice_count: "1" }
];

function mockPool(rows) {
  const queries = [];
  pool.query = async (sql, params) => {
    queries.push({ sql, params });
    return { rows };
  };
  return queries;
}

test("getSalesByPeriod: resumen_texto y campos autoexplicativos que suman al total", async () => {
  const queries = mockPool(APRIL_ROWS);
  const result = await executeTool("getSalesByPeriod", { month: 4, year: 2026 }, 7, ADMIN.id, ADMIN);

  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, [7, "2026-04-01", "2026-04-30"]);

  assert.equal(result.numero_de_ventas, 15);
  assert.equal(result.total_cobrado_en_el_periodo, 637);
  assert.deepEqual(result.total_se_compone_de, {
    cobrado_por_ventas_del_periodo: 368,
    abonos_cobrados_a_ventas_a_credito: 269
  });
  assert.deepEqual(result.total_cobrado_por_metodo, {
    efectivo: 537,
    tarjeta: 50,
    transferencia: 0,
    enganches_de_ventas_a_credito: 50
  });
  const byMethod = Object.values(result.total_cobrado_por_metodo).reduce((a, b) => a + b, 0);
  assert.equal(byMethod, result.total_cobrado_en_el_periodo);
  assert.equal(result.ventas_a_credito_pendientes_no_incluidas_en_total, 299);

  assert.equal(
    result.resumen_texto,
    "Del 2026-04-01 al 2026-04-30: 15 venta(s), total cobrado $637.00 MXN (regla del Corte Diario), " +
    "de los cuales $269.00 MXN son abonos cobrados a ventas a crédito (del periodo o anteriores) y $368.00 MXN corresponde a las ventas del periodo. " +
    "Además se vendieron $299.00 MXN a crédito que quedaron pendientes de cobro al momento de la venta; esa cantidad NO está incluida en el total."
  );
  assert.deepEqual(result.detalle_por_dia, [
    { fecha: "2026-04-20", numero_de_ventas: 12, total_cobrado: 237 },
    { fecha: "2026-04-03", numero_de_ventas: 3, total_cobrado: 400 }
  ]);

  // Old ambiguous names are gone.
  for (const key of ["total_day", "sales_count", "payment_breakdown", "credit_generated", "credit_collected"]) {
    assert.equal(key in result, false, key);
  }
});

test("getSalesByPeriod: un día sin movimientos dice 0 ventas y $0.00 sin frases de crédito", async () => {
  mockPool([]);
  const result = await executeTool("getSalesByPeriod", { date: "2026-10-18" }, 7, ADMIN.id, ADMIN);

  assert.equal(result.numero_de_ventas, 0);
  assert.equal(result.total_cobrado_en_el_periodo, 0);
  assert.equal(result.resumen_texto, "El 2026-10-18: 0 venta(s), total cobrado $0.00 MXN (regla del Corte Diario).");
  assert.ok(Object.values(result.total_cobrado_por_metodo).every((v) => Object.is(v, 0)));
});

test("getBusinessContext ya no consulta cifras de ventas por fecha", async () => {
  const queries = mockPool([{ count: 0, revenue: 0 }]);
  const context = await getBusinessContext(7, null);

  for (const key of ["salesSummary", "weeklySales", "monthlySummary"]) {
    assert.equal(key in context, false, key);
  }
  assert.ok(queries.every((q) => !/COUNT\(\*\) AS count/.test(q.sql)));
  assert.ok(queries.every((q) => q.params[0] === 7));
});

// Monday 2026-10-19, 10:00 in Mexico City (UTC-6).
const MONDAY_MORNING = new Date("2026-10-19T16:00:00Z");

test("buildSystemPrompt: getSalesByPeriod obligatorio para hoy y ayer, sin cifras de ventas en el contexto", () => {
  const prompt = buildSystemPrompt(
    { role: "admin" },
    { topSellersToday: [{ name: "Croquetas", qty: 3 }] },
    MONDAY_MORNING
  );
  const lines = prompt.split("\n");

  assert.doesNotMatch(prompt, /HISTORIAL DE VENTAS/);
  assert.doesNotMatch(prompt, /Hoy se han registrado/);
  assert.doesNotMatch(prompt, /Últimos 7 días/);
  assert.doesNotMatch(prompt, /Mes actual:/);
  assert.match(prompt, /Más vendidos hoy, solo por unidades \(no usar para responder ventas por fecha\): Croquetas \(3 uds\)\./);

  const rule = lines.findIndex((line) => line.startsWith("- VENTAS:"));
  assert.ok(rule > 0);
  assert.match(lines[rule], /incluidos hoy \(2026-10-19\) y ayer \(2026-10-18\), DEBE llamar a la herramienta getSalesByPeriod antes de responder/);
  assert.match(lines[rule], /nunca respondas una cifra de ventas, ni "0 ventas", sin haber llamado la herramienta/);
  assert.match(lines[rule + 1], /reporta numero_de_ventas y total_cobrado_en_el_periodo tal cual vienen\. NO calcules, sumes, restes ni infieras desgloses/);

  const contextRule = lines.find((line) => line.includes("usa el contexto anterior"));
  assert.equal(contextRule, "- Si el usuario pregunta sobre inventario, clientes, proveedores o gastos, usa el contexto anterior; para cifras de ventas usa siempre getSalesByPeriod.");
});

test("buildSystemPrompt: 'ayer' cruza correctamente el inicio de mes y de año", () => {
  assert.match(buildSystemPrompt({ role: "admin" }, {}, new Date("2026-11-01T18:00:00Z")), /ayer \(2026-10-31\)/);
  assert.match(buildSystemPrompt({ role: "admin" }, {}, new Date("2027-01-01T18:00:00Z")), /ayer \(2026-12-31\)/);
});
