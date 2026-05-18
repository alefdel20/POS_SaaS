const pool = require("../db/pool");
const { getMexicoCityDate } = require("./timezone");

async function getBusinessContext(businessId, branchId) {
  const today = getMexicoCityDate();
  const context = {
    today,
    salesSummary: null,
    lowStockProducts: [],
    topSellersToday: [],
    pendingCredits: []
  };

  const baseParams = [Number(businessId), today];

  await Promise.allSettled([
    pool.query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS revenue
       FROM sales
       WHERE business_id = $1 AND sale_date = $2`,
      baseParams
    ).then(({ rows }) => {
      context.salesSummary = {
        count: Number(rows[0].count),
        revenue: Number(rows[0].revenue)
      };
    }),

    pool.query(
      `SELECT name, stock, stock_minimo, category
       FROM products
       WHERE business_id = $1 AND is_active = TRUE
         AND stock < stock_minimo AND stock_minimo > 0
       ORDER BY (stock - stock_minimo) ASC
       LIMIT 10`,
      [Number(businessId)]
    ).then(({ rows }) => {
      context.lowStockProducts = rows.map((r) => ({
        name: r.name,
        stock: Number(r.stock),
        minimo: Number(r.stock_minimo),
        category: r.category
      }));
    }),

    pool.query(
      `SELECT p.name, SUM(si.quantity) AS total_qty, SUM(si.subtotal) AS total_revenue
       FROM sale_items si
       JOIN products p ON p.id = si.product_id AND p.business_id = si.business_id
       JOIN sales s ON s.id = si.sale_id AND s.business_id = si.business_id
       WHERE si.business_id = $1 AND s.sale_date = $2
       GROUP BY p.id, p.name
       ORDER BY total_qty DESC
       LIMIT 5`,
      baseParams
    ).then(({ rows }) => {
      context.topSellersToday = rows.map((r) => ({
        name: r.name,
        qty: Number(r.total_qty),
        revenue: Number(r.total_revenue)
      }));
    }),

    pool.query(
      `SELECT customer_name, SUM(balance_due) AS total_pending
       FROM sales
       WHERE business_id = $1 AND balance_due > 0
       GROUP BY customer_name
       ORDER BY total_pending DESC
       LIMIT 10`,
      [Number(businessId)]
    ).then(({ rows }) => {
      context.pendingCredits = rows.map((r) => ({
        name: r.customer_name || "Sin nombre",
        pending: Number(r.total_pending)
      }));
    })
  ]);

  return context;
}

function buildSystemPrompt(user, businessContext) {
  const today = getMexicoCityDate();
  const roleLabel = user.role || "usuario";
  const posType = user.pos_type || "General";
  const businessName = user.business_name || "el negocio";
  const branchInfo = businessContext?.branchName ? ` (sucursal: ${businessContext.branchName})` : "";

  const ctx = businessContext || {};
  const sales = ctx.salesSummary;
  const lowStock = ctx.lowStockProducts || [];
  const topSellers = ctx.topSellersToday || [];
  const credits = ctx.pendingCredits || [];

  const salesLine = sales
    ? `Hoy se han registrado ${sales.count} venta(s) por $${Number(sales.revenue).toFixed(2)} MXN.`
    : "No hay datos de ventas disponibles por ahora.";

  const lowStockLine = lowStock.length
    ? `Productos bajo mínimo: ${lowStock.map((p) => `${p.name} (stock ${p.stock}/${p.minimo})`).join(", ")}.`
    : "No hay productos bajo mínimo de stock.";

  const topSellersLine = topSellers.length
    ? `Más vendidos hoy: ${topSellers.map((p) => `${p.name} (${p.qty} uds)`).join(", ")}.`
    : "Sin ventas registradas hoy aún.";

  const creditsLine = credits.length
    ? `Clientes con crédito pendiente: ${credits.slice(0, 5).map((c) => `${c.name} ($${Number(c.pending).toFixed(2)})`).join(", ")}.`
    : "No hay créditos pendientes.";

  return [
    `Eres el asistente IA de Ankode, un sistema POS SaaS para negocios mexicanos.`,
    `Estás asistiendo a ${businessName}${branchInfo}, tipo de negocio: ${posType}.`,
    `El usuario tiene el rol: ${roleLabel}.`,
    `Fecha actual (zona horaria Ciudad de México): ${today}.`,
    ``,
    `CONTEXTO DEL NEGOCIO HOY:`,
    salesLine,
    lowStockLine,
    topSellersLine,
    creditsLine,
    ``,
    `INSTRUCCIONES:`,
    `- Responde SIEMPRE en español.`,
    `- Sé conciso y directo. Prioriza información accionable.`,
    `- Si el usuario pregunta sobre ventas, inventario, clientes o finanzas, usa el contexto anterior.`,
    `- No inventes datos que no están en el contexto provisto.`,
    `- Si no tienes información suficiente, dilo claramente y sugiere qué acción tomar en el sistema.`,
    `- No respondas preguntas fuera del ámbito del negocio (política, entretenimiento, etc.).`
  ].join("\n");
}

module.exports = { getBusinessContext, buildSystemPrompt };
