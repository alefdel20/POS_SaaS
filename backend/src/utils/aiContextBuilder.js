const pool = require("../db/pool");
const { getMexicoCityDate, getMexicoCityTime } = require("./timezone");
const { getCatalogTotals } = require("../services/dashboardService");

async function getBusinessContext(businessId, branchId) {
  const today = getMexicoCityDate();
  const context = {
    today,
    lowStockProducts: [],
    topSellersToday: [],
    pendingCredits: [],
    suppliers: [],
    monthlyExpenses: [],
    branches: [],
    branchName: null,
    catalog: null
  };

  const bid = Number(businessId);

  await Promise.allSettled([
    // Catálogo: mismos totales que las tarjetas del dashboard (dashboardService.getCatalogTotals)
    getCatalogTotals(bid).then((totals) => {
      context.catalog = totals;
    }),

    // Sin cifras de ventas (hoy, 7 días, mes): usaban otra regla que el Corte Diario
    // y el modelo contestaba con ellas sin llamar a getSalesByPeriod.

    // Productos bajo mínimo
    pool.query(
      `SELECT name, stock, stock_minimo, category
       FROM products
       WHERE business_id = $1 AND is_active = TRUE
         AND stock <= stock_minimo AND stock_minimo > 0
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

const WEEKDAYS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// "YYYY-MM-DD" (Mexico City date) plus `offset` days, with its weekday in Spanish.
function shiftCalendarDay(dateText, offset) {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset, 12));
  return { date: date.toISOString().slice(0, 10), weekday: WEEKDAYS_ES[date.getUTCDay()] };
}

// now: injectable for tests; defaults to the current instant.
function buildSystemPrompt(user, businessContext, now = new Date()) {
  const today = getMexicoCityDate(now);
  const currentTime = getMexicoCityTime(now).slice(0, 5);
  const todayWeekday = shiftCalendarDay(today, 0).weekday;
  const yesterday = shiftCalendarDay(today, -1).date;
  const nextDaysLines = [1, 2, 3, 4, 5, 6, 7].map((offset) => {
    const { date, weekday } = shiftCalendarDay(today, offset);
    return `  ${weekday} ${date}${offset === 1 ? " (mañana)" : ""}`;
  });
  const roleLabel = user.role || "usuario";
  const posType = user.pos_type || "General";
  const businessName = user.business_name || "el negocio";
  const branchInfo = businessContext?.branchName ? ` (sucursal: ${businessContext.branchName})` : "";

  const ctx = businessContext || {};
  const lowStock = ctx.lowStockProducts || [];
  const topSellers = ctx.topSellersToday || [];
  const credits = ctx.pendingCredits || [];
  const suppliers = ctx.suppliers || [];
  const monthlyExpenses = ctx.monthlyExpenses || [];
  const branches = ctx.branches || [];
  const catalog = ctx.catalog;

  // Ambos valores son a costo (cost_price), igual que el dashboard; ninguno es a precio de venta.
  const catalogLine = catalog
    ? `Catálogo: ${catalog.total_products} producto(s) registrados, ${catalog.total_current_stock} unidad(es) en stock (suma de existencias). ` +
      `Valor del stock actual (existencias × costo; en el dashboard "Valor del stock actual"): $${Number(catalog.current_stock_total_value).toFixed(2)} MXN. ` +
      `Valor a stock máximo (stock máximo × costo; en el dashboard "Valor de productos de la tienda"): $${Number(catalog.inventory_total_value).toFixed(2)} MXN. ` +
      `Ambos valores están a costo, no a precio de venta.`
    : "No hay datos del catálogo disponibles por ahora.";

  const lowStockLine = lowStock.length
    ? `Productos bajo mínimo: ${lowStock.map((p) => `${p.name} (stock ${p.stock}/${p.minimo})`).join(", ")}.`
    : "No hay productos bajo mínimo de stock.";

  const topSellersLine = topSellers.length
    ? `Más vendidos hoy, solo por unidades (no usar para responder ventas por fecha): ${topSellers.map((p) => `${p.name} (${p.qty} uds)`).join(", ")}.`
    : "Más vendidos hoy: sin productos registrados aún (no usar para responder ventas por fecha).";

  const creditsLine = credits.length
    ? `Clientes con crédito pendiente: ${credits.slice(0, 5).map((c) => `${c.name} ($${Number(c.pending).toFixed(2)})`).join(", ")}.`
    : "No hay créditos pendientes.";

  const suppliersLine = suppliers.length
    ? `Proveedores activos (${suppliers.length}): ${suppliers.map((s) => `${s.name} (${s.product_count} producto(s) ligado(s))`).join(", ")}.`
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
    `Fecha actual (zona horaria Ciudad de México): ${today} (${todayWeekday}).`,
    `Hora actual (zona horaria Ciudad de México, formato 24 h): ${currentTime}.`,
    `Próximos 7 días:`,
    ...nextDaysLines,
    ``,
    `CONTEXTO DEL NEGOCIO HOY:`,
    lowStockLine,
    topSellersLine,
    creditsLine,
    ``,
    `CATÁLOGO:`,
    catalogLine,
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
    `- VENTAS: toda pregunta con cifras de ventas (cuántas ventas, cuánto se vendió o se cobró, ingresos, corte) de cualquier fecha, incluidos hoy (${today}) y ayer (${yesterday}), DEBE llamar a la herramienta getSalesByPeriod antes de responder. El contexto de arriba NO trae cifras de ventas: nunca respondas una cifra de ventas, ni "0 ventas", sin haber llamado la herramienta para esa fecha. Resuelve las fechas relativas ("ayer", "el lunes", "la semana pasada") con la fecha actual de Ciudad de México y pásalas en formato YYYY-MM-DD; para un solo día usa date, para un rango start_date y end_date, para un mes month y year.`,
    `- Al responder ventas, usa el resumen_texto de la herramienta y reporta numero_de_ventas y total_cobrado_en_el_periodo tal cual vienen. NO calcules, sumes, restes ni infieras desgloses por tu cuenta: solo menciona un desglose si la herramienta lo trae con ese nombre. ventas_a_credito_pendientes_no_incluidas_en_total NO forma parte del total.`,
    `- Puedes informar sobre proveedores activos y sus productos.`,
    `- Puedes informar sobre gastos del mes por categoría.`,
    `- Puedes informar sobre sucursales del negocio.`,
    `- Si el usuario pregunta sobre inventario, clientes, proveedores o gastos, usa el contexto anterior; para cifras de ventas usa siempre getSalesByPeriod.`,
    `- Para cuántos productos hay, cuántas unidades hay en stock o cuánto vale el inventario, usa SOLO la sección CATÁLOGO; nunca uses ni sumes los productos ligados a proveedores.`,
    `- Los dos valores del catálogo están a costo: "valor del stock actual" son las existencias de hoy y "valor a stock máximo" es el inventario lleno. No tienes el valor a precio de venta; si te lo piden, dilo.`,
    `- Solo puedes crear recordatorios con la herramienta createReminder cuando el usuario lo pida; no puedes modificar ni borrar ningún otro dato del sistema.`,
    `- Para un recordatorio: si falta la fecha o la hora es ambigua (sin a. m. o p. m. clara, una hora de hoy que ya pasó, o "el viernes" cuando hoy es viernes), pregunta UNA sola vez antes de crearlo.`,
    `- Al crearlo, usa due_date en formato YYYY-MM-DD y time en HH:mm de 24 horas, y confirma título, fecha y hora en lenguaje claro, por ejemplo: "Listo: mañana a las 4:00 p. m., comprar a Pan Bimbo".`,
    `- Crea un solo recordatorio por pedido, salvo que el usuario pida varios, y no lo vuelvas a crear si ya lo creaste (si la herramienta responde duplicate: true, ya existía).`,
    `- Di con claridad que el sistema todavía NO envía un aviso a esa hora: el usuario lo verá en la sección Recordatorios.`,
    `- Si el usuario pide cargar, registrar o dar de alta una compra, insumos o productos a partir de un ticket o factura, no digas solo que no puedes: indícale que use el botón "Cargar ticket" en la pantalla Productos por reabastecer, donde sube la foto, revisa lo que se leyó y confirma la compra. "Cargar ticket" es solo para COMPRAS reales: suma el stock y registra un egreso. Aun así puedes ayudarle a leer y resumir el archivo si lo pide. Si el usuario dice que no ve el botón, explícale que la función depende de su plan y de su rol, y que le pida a su administrador que la revise.`,
    `- Si el usuario quiere cargar un catálogo o una lista de productos o de precios (no una compra), no lo mandes a "Cargar ticket": indícale que use "Importar productos" en la pantalla Productos, con un archivo CSV o XLSX con nombre y precio de venta obligatorios, de hasta unos 200 renglones por archivo por ahora. Solo un administrador puede importar productos; si no ve el botón, que se lo pida a su administrador.`,
    `- NO respondas sobre política, entretenimiento, deportes u otros temas ajenos al negocio.`,
    `- NO inventes datos — si no tienes la información, dilo claramente y sugiere qué acción tomar en el sistema.`
  );

  return lines.join("\n");
}

module.exports = { getBusinessContext, buildSystemPrompt };
