const pool = require("../db/pool");
const { getMexicoCityDate } = require("./timezone");

async function getBusinessContext(businessId, branchId) {
  const today = getMexicoCityDate();
  const context = {
    today,
    salesSummary: null,
    lowStockProducts: [],
    topSellersToday: [],
    pendingCredits: [],
    weeklySales: [],
    monthlySummary: null,
    suppliers: [],
    monthlyExpenses: [],
    branches: [],
    branchName: null
  };

  const bid = Number(businessId);

  await Promise.allSettled([
    // Ventas de hoy
    pool.query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS revenue
       FROM sales
       WHERE business_id = $1 AND sale_date = $2`,
      [bid, today]
    ).then(({ rows }) => {
      context.salesSummary = {
        count: Number(rows[0].count),
        revenue: Number(rows[0].revenue)
      };
    }),

    // Productos bajo mínimo
    pool.query(
      `SELECT name, stock, stock_minimo, category
       FROM products
       WHERE business_id = $1 AND is_active = TRUE
         AND stock < stock_minimo AND stock_minimo > 0
       ORDER BY (stock - stock_minimo) ASC
       LIMIT 10`,
      [bid]
    ).then(({ rows }) => {
      context.lowStockProducts = rows.map((r) => ({
        name: r.name,
        stock: Number(r.stock),
        minimo: Number(r.stock_minimo),
        category: r.category
      }));
    }),

    // Más vendidos hoy
    pool.query(
      `SELECT p.name, SUM(si.quantity) AS total_qty, SUM(si.subtotal) AS total_revenue
       FROM sale_items si
       JOIN products p ON p.id = si.product_id AND p.business_id = si.business_id
       JOIN sales s ON s.id = si.sale_id AND s.business_id = si.business_id
       WHERE si.business_id = $1 AND s.sale_date = $2
       GROUP BY p.id, p.name
       ORDER BY total_qty DESC
       LIMIT 5`,
      [bid, today]
    ).then(({ rows }) => {
      context.topSellersToday = rows.map((r) => ({
        name: r.name,
        qty: Number(r.total_qty),
        revenue: Number(r.total_revenue)
      }));
    }),

    // Créditos pendientes
    pool.query(
      `SELECT customer_name, SUM(balance_due) AS total_pending
       FROM sales
       WHERE business_id = $1 AND balance_due > 0
       GROUP BY customer_name
       ORDER BY total_pending DESC
       LIMIT 10`,
      [bid]
    ).then(({ rows }) => {
      context.pendingCredits = rows.map((r) => ({
        name: r.customer_name || "Sin nombre",
        pending: Number(r.total_pending)
      }));
    }),

    // Ventas últimos 7 días
    pool.query(
      `SELECT sale_date, COUNT(*) AS count, SUM(total) AS revenue
       FROM sales
       WHERE business_id = $1
         AND sale_date BETWEEN (CURRENT_DATE - INTERVAL '7 days') AND CURRENT_DATE
       GROUP BY sale_date
       ORDER BY sale_date DESC`,
      [bid]
    ).then(({ rows }) => {
      context.weeklySales = rows.map((r) => ({
        date: r.sale_date,
        count: Number(r.count),
        revenue: Number(r.revenue)
      }));
    }),

    // Ventas del mes actual
    pool.query(
      `SELECT COUNT(*) AS count, SUM(total) AS revenue
       FROM sales
       WHERE business_id = $1
         AND DATE_TRUNC('month', sale_date) = DATE_TRUNC('month', CURRENT_DATE)`,
      [bid]
    ).then(({ rows }) => {
      context.monthlySummary = {
        count: Number(rows[0].count),
        revenue: Number(rows[0].revenue)
      };
    }),

    // Proveedores activos
    pool.query(
      `SELECT s.name, s.whatsapp, s.email, COUNT(ps.product_id) AS product_count
       FROM suppliers s
       LEFT JOIN product_suppliers ps ON ps.supplier_id = s.id AND ps.business_id = s.business_id
       WHERE s.business_id = $1 AND s.is_active = TRUE
       GROUP BY s.id, s.name, s.whatsapp, s.email
       ORDER BY s.name ASC
       LIMIT 10`,
      [bid]
    ).then(({ rows }) => {
      context.suppliers = rows.map((r) => ({
        name: r.name,
        whatsapp: r.whatsapp || null,
        email: r.email || null,
        product_count: Number(r.product_count)
      }));
    }),

    // Gastos del mes (tabla puede no existir — capturar error silenciosamente)
    (async () => {
      try {
        const { rows } = await pool.query(
          `SELECT category, SUM(amount) AS total
           FROM expenses
           WHERE business_id = $1
             AND date >= DATE_TRUNC('month', CURRENT_DATE)
           GROUP BY category
           ORDER BY total DESC
           LIMIT 10`,
          [bid]
        );
        context.monthlyExpenses = rows.map((r) => ({
          category: r.category,
          total: Number(r.total)
        }));
      } catch {
        context.monthlyExpenses = [];
      }
    })(),

    // Sucursales activas
    pool.query(
      `SELECT id, name, is_default
       FROM branches
       WHERE business_id = $1 AND is_active = TRUE
       ORDER BY is_default DESC, name ASC`,
      [bid]
    ).then(({ rows }) => {
      context.branches = rows.map((r) => ({
        id: r.id,
        name: r.name,
        is_default: Boolean(r.is_default)
      }));
      if (branchId) {
        const match = rows.find((r) => Number(r.id) === Number(branchId));
        context.branchName = match ? match.name : null;
      }
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
  const weeklySales = ctx.weeklySales || [];
  const monthlySummary = ctx.monthlySummary;
  const suppliers = ctx.suppliers || [];
  const monthlyExpenses = ctx.monthlyExpenses || [];
  const branches = ctx.branches || [];

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

  const weeklyLine = weeklySales.length
    ? `Últimos 7 días:\n${weeklySales.map((d) => `  ${d.date}: ${d.count} venta(s), $${Number(d.revenue).toFixed(2)} MXN`).join("\n")}`
    : "Sin datos de ventas de los últimos 7 días.";

  const monthlyLine = monthlySummary && monthlySummary.count > 0
    ? `Mes actual: ${monthlySummary.count} venta(s) por $${Number(monthlySummary.revenue).toFixed(2)} MXN en total.`
    : "Sin ventas registradas en el mes actual.";

  const suppliersLine = suppliers.length
    ? `Proveedores activos (${suppliers.length}): ${suppliers.map((s) => `${s.name} (${s.product_count} producto(s))`).join(", ")}.`
    : "No hay proveedores activos registrados.";

  const expensesLine = monthlyExpenses.length
    ? `Gastos del mes por categoría: ${monthlyExpenses.map((e) => `${e.category} $${Number(e.total).toFixed(2)}`).join(", ")}.`
    : "";

  const branchesLine = branches.length > 1
    ? `Sucursales activas: ${branches.map((b) => b.name + (b.is_default ? " (principal)" : "")).join(", ")}.`
    : "";

  const lines = [
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
    `HISTORIAL DE VENTAS:`,
    weeklyLine,
    monthlyLine,
    ``,
    `PROVEEDORES:`,
    suppliersLine,
  ];

  if (branchesLine) {
    lines.push(``, `SUCURSALES:`, branchesLine);
  }

  if (expensesLine) {
    lines.push(``, `GASTOS DEL MES:`, expensesLine);
  }

  lines.push(
    ``,
    `INSTRUCCIONES:`,
    `- Responde SIEMPRE en español.`,
    `- Sé conciso y directo. Prioriza información accionable.`,
    `- Puedes consultar ventas de hoy, últimos 7 días y del mes actual.`,
    `- Puedes informar sobre proveedores activos y sus productos.`,
    `- Puedes informar sobre gastos del mes por categoría.`,
    `- Puedes informar sobre sucursales del negocio.`,
    `- Si el usuario pregunta sobre ventas, inventario, clientes o finanzas, usa el contexto anterior.`,
    `- NO puedes modificar ningún dato del sistema — eres solo lectura.`,
    `- NO respondas sobre política, entretenimiento, deportes u otros temas ajenos al negocio.`,
    `- NO inventes datos — si no tienes la información, dilo claramente y sugiere qué acción tomar en el sistema.`
  );

  return lines.join("\n");
}

module.exports = { getBusinessContext, buildSystemPrompt };
