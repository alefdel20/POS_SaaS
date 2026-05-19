const pool = require("../db/pool");

const TOOLS = [
  {
    type: "function",
    function: {
      name: "getSalesByPeriod",
      description: "Obtiene el resumen de ventas de un período específico (mes/año o rango de fechas)",
      parameters: {
        type: "object",
        properties: {
          month: { type: "integer", description: "Mes (1-12)" },
          year: { type: "integer", description: "Año (ej. 2026)" },
          start_date: { type: "string", description: "Fecha inicio YYYY-MM-DD (alternativa a month/year)" },
          end_date: { type: "string", description: "Fecha fin YYYY-MM-DD" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getTopProducts",
      description: "Obtiene los productos más vendidos en un período",
      parameters: {
        type: "object",
        properties: {
          month: { type: "integer" },
          year: { type: "integer" },
          start_date: { type: "string" },
          end_date: { type: "string" },
          limit: { type: "integer", description: "Número de productos (default 5)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getClientBalance",
      description: "Obtiene el balance pendiente de un cliente específico o lista de deudores",
      parameters: {
        type: "object",
        properties: {
          client_name: { type: "string", description: "Nombre del cliente (parcial o completo)" },
          list_all: { type: "boolean", description: "Si es true, lista todos los deudores" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getSupplierInfo",
      description: "Obtiene información de proveedores: contacto, productos",
      parameters: {
        type: "object",
        properties: {
          supplier_name: { type: "string", description: "Nombre del proveedor (parcial)" },
          list_all: { type: "boolean", description: "Si es true, lista todos los proveedores" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "createReminder",
      description: "Crea un recordatorio en el sistema para el negocio",
      parameters: {
        type: "object",
        required: ["title", "due_date"],
        properties: {
          title: { type: "string", description: "Título del recordatorio" },
          notes: { type: "string", description: "Notas adicionales" },
          due_date: { type: "string", description: "Fecha de vencimiento YYYY-MM-DD" },
          category: { type: "string", description: "Categoría: usa 'administrative' para recordatorios de negocio, 'clinical' para recordatorios médicos" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getExpensesByPeriod",
      description: "Obtiene gastos del negocio por período",
      parameters: {
        type: "object",
        properties: {
          month: { type: "integer" },
          year: { type: "integer" }
        }
      }
    }
  }
];

// Returns { clause, params } for a date filter starting at paramIdx (1-based, businessId is always $1)
function buildPeriodClause(args, nextIdx, col) {
  if (args.start_date && args.end_date) {
    return {
      clause: `${col} BETWEEN $${nextIdx} AND $${nextIdx + 1}`,
      params: [args.start_date, args.end_date]
    };
  }
  if (args.month && args.year) {
    return {
      clause: `EXTRACT(MONTH FROM ${col}) = $${nextIdx} AND EXTRACT(YEAR FROM ${col}) = $${nextIdx + 1}`,
      params: [Number(args.month), Number(args.year)]
    };
  }
  return {
    clause: `DATE_TRUNC('month', ${col}) = DATE_TRUNC('month', CURRENT_DATE)`,
    params: []
  };
}

async function getSalesByPeriod(args, businessId) {
  const period = buildPeriodClause(args, 2, "sale_date");
  const params = [Number(businessId), ...period.params];

  const [summaryRes, breakdownRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(total), 0) AS revenue,
              COALESCE(AVG(total), 0) AS avg_ticket
       FROM sales
       WHERE business_id = $1 AND ${period.clause}`,
      params
    ),
    pool.query(
      `SELECT payment_method,
              COUNT(*) AS count,
              COALESCE(SUM(total), 0) AS revenue
       FROM sales
       WHERE business_id = $1 AND ${period.clause}
       GROUP BY payment_method
       ORDER BY revenue DESC`,
      params
    )
  ]);

  const r = summaryRes.rows[0];
  return {
    count: Number(r.count),
    revenue: Number(r.revenue),
    avg_ticket: Number(r.avg_ticket),
    payment_breakdown: breakdownRes.rows.map((b) => ({
      method: b.payment_method,
      count: Number(b.count),
      revenue: Number(b.revenue)
    }))
  };
}

async function getTopProducts(args, businessId) {
  const limit = Math.min(Number(args.limit) || 10, 20);
  const period = buildPeriodClause(args, 2, "s.sale_date");
  const params = [Number(businessId), ...period.params, limit];
  const limitIdx = params.length;

  const { rows } = await pool.query(
    `SELECT p.name,
            SUM(si.quantity) AS quantity,
            COALESCE(SUM(si.subtotal), 0) AS revenue
     FROM sale_items si
     JOIN products p ON p.id = si.product_id AND p.business_id = si.business_id
     JOIN sales s ON s.id = si.sale_id AND s.business_id = si.business_id
     WHERE si.business_id = $1 AND ${period.clause}
     GROUP BY p.id, p.name
     ORDER BY quantity DESC
     LIMIT $${limitIdx}`,
    params
  );

  return rows.map((r) => ({
    name: r.name,
    quantity: Number(r.quantity),
    revenue: Number(r.revenue)
  }));
}

async function getClientBalance(args, businessId) {
  const hasName = args.client_name && String(args.client_name).trim();

  const { rows } = hasName
    ? await pool.query(
        `SELECT customer_name,
                SUM(balance_due) AS balance,
                MAX(sale_date) AS last_sale_date
         FROM sales
         WHERE business_id = $1 AND balance_due > 0 AND customer_name ILIKE $2
         GROUP BY customer_name
         ORDER BY balance DESC
         LIMIT 10`,
        [Number(businessId), `%${String(args.client_name).trim()}%`]
      )
    : await pool.query(
        `SELECT customer_name,
                SUM(balance_due) AS balance,
                MAX(sale_date) AS last_sale_date
         FROM sales
         WHERE business_id = $1 AND balance_due > 0
         GROUP BY customer_name
         ORDER BY balance DESC
         LIMIT 10`,
        [Number(businessId)]
      );

  return rows.map((r) => ({
    name: r.customer_name || "Sin nombre",
    balance: Number(r.balance),
    last_sale_date: r.last_sale_date
  }));
}

async function getSupplierInfo(args, businessId) {
  const hasName = args.supplier_name && String(args.supplier_name).trim();

  const baseWhere = "s.business_id = $1 AND s.is_active = TRUE";
  const groupBy = "GROUP BY s.id, s.name, s.whatsapp, s.email ORDER BY s.name ASC LIMIT 10";

  const { rows } = hasName
    ? await pool.query(
        `SELECT s.name, s.whatsapp, s.email, COUNT(ps.product_id) AS product_count
         FROM suppliers s
         LEFT JOIN product_suppliers ps ON ps.supplier_id = s.id AND ps.business_id = s.business_id
         WHERE ${baseWhere} AND s.name ILIKE $2
         ${groupBy}`,
        [Number(businessId), `%${String(args.supplier_name).trim()}%`]
      )
    : await pool.query(
        `SELECT s.name, s.whatsapp, s.email, COUNT(ps.product_id) AS product_count
         FROM suppliers s
         LEFT JOIN product_suppliers ps ON ps.supplier_id = s.id AND ps.business_id = s.business_id
         WHERE ${baseWhere}
         ${groupBy}`,
        [Number(businessId)]
      );

  return rows.map((r) => ({
    name: r.name,
    whatsapp: r.whatsapp || null,
    email: r.email || null,
    product_count: Number(r.product_count)
  }));
}

async function createReminder(args, businessId, userId) {
  const { rows } = await pool.query(
    `INSERT INTO reminders
       (title, notes, status, due_date, business_id, reminder_type, category, is_completed, created_by, metadata)
     VALUES ($1, $2, 'pending', $3, $4, 'manual', $5, FALSE, $6, '{}'::jsonb)
     RETURNING id, title, due_date`,
    [
      String(args.title || "").trim(),
      String(args.notes || "").trim(),
      args.due_date || null,
      Number(businessId),
      String(args.category || "").toLowerCase().includes("clinical") ? "clinical" : "administrative",
      userId || null
    ]
  );
  return {
    id: rows[0].id,
    title: rows[0].title,
    due_date: rows[0].due_date
  };
}

async function getExpensesByPeriod(args, businessId) {
  const period = buildPeriodClause(args, 2, "date");
  const params = [Number(businessId), ...period.params];

  const { rows } = await pool.query(
    `SELECT category, SUM(amount) AS total
     FROM expenses
     WHERE business_id = $1 AND is_voided = FALSE AND ${period.clause}
     GROUP BY category
     ORDER BY total DESC
     LIMIT 10`,
    params
  );

  return rows.map((r) => ({ category: r.category, total: Number(r.total) }));
}

async function executeTool(toolName, args, businessId, userId = null) {
  try {
    switch (toolName) {
      case "getSalesByPeriod":   return await getSalesByPeriod(args, businessId);
      case "getTopProducts":     return await getTopProducts(args, businessId);
      case "getClientBalance":   return await getClientBalance(args, businessId);
      case "getSupplierInfo":    return await getSupplierInfo(args, businessId);
      case "createReminder":     return await createReminder(args, businessId, userId);
      case "getExpensesByPeriod":return await getExpensesByPeriod(args, businessId);
      default:                   return { error: "Herramienta no reconocida." };
    }
  } catch (err) {
    console.error(`[AI Tool] ${toolName} error:`, err.message);
    return { error: "No se pudo obtener la información." };
  }
}

module.exports = { TOOLS, executeTool };
