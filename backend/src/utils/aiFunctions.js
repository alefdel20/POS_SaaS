const pool = require("../db/pool");
const { syncReminderToHealthcare } = require("./healthcareSubjectTranslation");
const { extractReminderMeta, assertClinicalReminderAccess } = require("../services/reminderService");
const { saveAuditLog } = require("../services/auditLogService");
const { normalizeRole } = require("./roles");
const { getMexicoCityDate, getMexicoCityTime, getMonthRange } = require("./timezone");
const { isValidBusinessDate } = require("./businessDate");
// listDailyCuts = listRealizedDailyCuts: solo lectura (recomputeDailyCut escribe en daily_cuts).
const { listDailyCuts } = require("../services/dailyCutService");

const TOOLS = [
  {
    type: "function",
    function: {
      name: "getSalesByPeriod",
      description: "Obtiene las ventas de cualquier día (incluidos hoy y ayer), rango de fechas o mes (zona horaria Ciudad de México) con la misma regla del Corte Diario: ventas de contado + enganche de ventas a crédito en su fecha de venta + abonos cobrados ese día; excluye canceladas. Devuelve resumen_texto ya redactado: úsalo tal cual y no recalcules. Para un solo día usa date. Para un rango usa start_date y end_date. Para un mes usa month y year. Sin parámetros devuelve el mes actual.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Un solo día YYYY-MM-DD" },
          start_date: { type: "string", description: "Fecha inicio YYYY-MM-DD; sin end_date se toma solo ese día" },
          end_date: { type: "string", description: "Fecha fin YYYY-MM-DD (incluida)" },
          month: { type: "integer", description: "Mes (1-12), alternativa a las fechas" },
          year: { type: "integer", description: "Año (ej. 2026); con month. Sin year se usa el año actual" }
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
      description: "Crea un recordatorio para el negocio, solo cuando el usuario lo pide. El sistema no envía un aviso a esa hora; el recordatorio aparece en la sección Recordatorios.",
      parameters: {
        type: "object",
        required: ["title", "due_date"],
        properties: {
          title: { type: "string", description: "Título del recordatorio (1 a 180 caracteres)" },
          notes: { type: "string", description: "Notas adicionales" },
          due_date: { type: "string", description: "Fecha YYYY-MM-DD, hoy o futura (zona horaria Ciudad de México)" },
          time: { type: "string", description: "Hora opcional en formato HH:mm de 24 horas (por ejemplo 16:00 para las 4 de la tarde)" },
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
  // Solo start_date: ese día (nunca el mes actual).
  if (args.start_date) {
    return {
      clause: `${col} BETWEEN $${nextIdx} AND $${nextIdx + 1}`,
      params: [args.start_date, args.end_date || args.start_date]
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

// { start, end } en YYYY-MM-DD (fechas de negocio, Ciudad de México) o { error }.
function resolveSalesRange(args = {}) {
  const today = getMexicoCityDate();
  const start = args.date || args.start_date || args.end_date;
  if (start) {
    const end = args.date ? args.date : (args.end_date || start);
    if (!isValidBusinessDate(start) || !isValidBusinessDate(end)) {
      return { error: "Fecha inválida: usa el formato AAAA-MM-DD." };
    }
    if (start > end) return { error: "La fecha inicial es posterior a la fecha final." };
    return { start, end };
  }
  if (args.month !== undefined && args.month !== null) {
    const month = Number(args.month);
    const year = args.year ? Number(args.year) : Number(today.slice(0, 4));
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 1000 || year > 9999) {
      return { error: "Mes o año inválido." };
    }
    return getMonthRange(`${year}-${String(month).padStart(2, "0")}`);
  }
  if (args.year) return { error: "Indica el mes (month) o un rango de fechas (start_date y end_date)." };
  return getMonthRange(today.slice(0, 7));
}

const SALES_DAYS_DETAIL_LIMIT = 31;

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100 || 0;
}

function formatMoney(value) {
  return `$${Number(value).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;
}

// Texto final que el modelo debe repetir; todas las cifras salen del backend.
function buildSalesSummaryText({ start, end, salesCount, total, collectedFromCredits, pendingCredit }) {
  const period = start === end ? `El ${start}` : `Del ${start} al ${end}`;
  const parts = [`${period}: ${salesCount} venta(s), total cobrado ${formatMoney(total)} (regla del Corte Diario)`];
  if (collectedFromCredits > 0) {
    parts[0] += `, de los cuales ${formatMoney(collectedFromCredits)} son abonos cobrados a ventas a crédito (del periodo o anteriores) y ${formatMoney(roundMoney(total - collectedFromCredits))} corresponde a las ventas del periodo`;
  }
  parts[0] += ".";
  if (pendingCredit > 0) {
    parts.push(`Además se vendieron ${formatMoney(pendingCredit)} a crédito que quedaron pendientes de cobro al momento de la venta; esa cantidad NO está incluida en el total.`);
  }
  return parts.join(" ");
}

// Misma fuente que el Corte Diario (dailyCutService.listRealizedDailyCuts):
// business_id del actor, canceladas fuera, total = contado + enganche en
// la fecha de venta + abonos cobrados ese día. sales.sale_type es NOT NULL con
// CHECK ('ticket', 'invoice'), así que ticket_count + invoice_count = ventas.
// cash/card/transfer_total ya incluyen los abonos cobrados con ese método; el
// enganche no tiene método en el corte, así que es el remanente del total
// (también absorbe abonos registrados con método 'credit').
async function getSalesByPeriod(args, businessId, actor) {
  const range = resolveSalesRange(args);
  if (range.error) return { error: range.error };

  const days = await listDailyCuts({ date_from: range.start, date_to: range.end }, actor || { business_id: businessId });
  const sum = (key) => roundMoney(days.reduce((total, day) => total + Number(day[key] || 0), 0));
  const salesCount = days.reduce((total, day) => total + Number(day.ticket_count || 0) + Number(day.invoice_count || 0), 0);
  const total = sum("total_day");
  const cash = sum("cash_total");
  const card = sum("card_total");
  const transfer = sum("transfer_total");
  const collectedFromCredits = sum("credit_collected");
  const pendingCredit = sum("credit_generated");

  return {
    fecha_inicio: range.start,
    fecha_fin: range.end,
    resumen_texto: buildSalesSummaryText({ start: range.start, end: range.end, salesCount, total, collectedFromCredits, pendingCredit }),
    numero_de_ventas: salesCount,
    total_cobrado_en_el_periodo: total,
    total_se_compone_de: {
      cobrado_por_ventas_del_periodo: roundMoney(total - collectedFromCredits),
      abonos_cobrados_a_ventas_a_credito: collectedFromCredits
    },
    total_cobrado_por_metodo: {
      efectivo: cash,
      tarjeta: card,
      transferencia: transfer,
      enganches_de_ventas_a_credito: roundMoney(total - cash - card - transfer)
    },
    ventas_a_credito_pendientes_no_incluidas_en_total: pendingCredit,
    detalle_por_dia: days.length <= SALES_DAYS_DETAIL_LIMIT
      ? days.map((day) => ({
        fecha: day.cut_date,
        numero_de_ventas: Number(day.ticket_count || 0) + Number(day.invoice_count || 0),
        total_cobrado: roundMoney(day.total_day)
      }))
      : undefined,
    instrucciones: "Responde con resumen_texto. Reporta numero_de_ventas y total_cobrado_en_el_periodo tal cual. total_se_compone_de y total_cobrado_por_metodo ya suman el total cada uno; no los combines ni calcules otras cifras. ventas_a_credito_pendientes_no_incluidas_en_total NO forma parte del total."
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

// Same roles as POST /reminders in reminderRoutes.js (cocina and soporte
// cannot create reminders). Compared after normalizeRole, like requireRole.
const REMINDER_CREATE_ROLES = ["superadmin", "superusuario", "admin", "gerente", "clinico", "user", "cajero"];
const MAX_REMINDER_TITLE_LENGTH = 180;
// Same offset the Recordatorios form sends (frontend utils/timezone.ts,
// dateTimeLocalToIsoString): "YYYY-MM-DDTHH:mm:00-06:00".
const MEXICO_CITY_OFFSET = "-06:00";
const DUPLICATE_WINDOW_MINUTES = 10;

function normalizeReminderTitle(title) {
  return String(title || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function isRealDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

// Checks the tool arguments. Returns { error } with a message meant for the
// model (what to fix or ask the user), or the clean values.
function validateReminderArgs(args, actor) {
  const role = normalizeRole(actor?.role);
  if (!role || !REMINDER_CREATE_ROLES.map(normalizeRole).includes(role)) {
    return { error: "El rol de este usuario no puede crear recordatorios. Dile que no se creó y que se lo pida a un administrador o gerente." };
  }

  const title = String(args.title ?? "").trim();
  if (!title) {
    return { error: "Falta el título del recordatorio. Pregúntale al usuario qué quiere recordar; no se creó nada." };
  }
  if (Array.from(title).length > MAX_REMINDER_TITLE_LENGTH) {
    return { error: `El título tiene más de ${MAX_REMINDER_TITLE_LENGTH} caracteres. Resúmelo a ${MAX_REMINDER_TITLE_LENGTH} o menos y vuelve a intentarlo; no se creó nada.` };
  }

  const dueDate = typeof args.due_date === "string" ? args.due_date.trim() : "";
  if (!isRealDate(dueDate)) {
    return { error: "La fecha no es válida: usa due_date en formato YYYY-MM-DD con una fecha real (por ejemplo 2026-10-14). No se creó nada." };
  }
  const today = getMexicoCityDate();
  if (dueDate < today) {
    return { error: `La fecha ${dueDate} ya pasó (hoy es ${today} en Ciudad de México). Pregúntale al usuario para qué fecha lo quiere; no se creó nada.` };
  }

  let time = null;
  if (args.time !== undefined && args.time !== null && args.time !== "") {
    time = typeof args.time === "string" ? args.time.trim() : "";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      return { error: "La hora no es válida: usa time en formato HH:mm de 24 horas (por ejemplo 16:00 para las 4 de la tarde). No se creó nada." };
    }
    const now = getMexicoCityTime().slice(0, 5);
    if (dueDate === today && time < now) {
      return { error: `La hora ${time} de hoy ya pasó (son las ${now} en Ciudad de México). Pregúntale al usuario si lo quiere para otra hora o para otro día; no se creó nada.` };
    }
  }

  return { title, dueDate, time, notes: String(args.notes || "").trim() };
}

async function createReminder(args, businessId, userId, actor = null) {
  // Fase 6 follow-up: this AI-tool path writes directly to public.reminders
  // and never went through reminderService.createReminder, so it never got
  // the healthcare.reminders sync added there — same silent-gap pattern
  // already found once in Fase 1. Wrapped in a transaction (it wasn't one
  // before) for the same reason reminderService.createReminder was wrapped:
  // the mirror sync must commit/rollback atomically with the reminders
  // INSERT, not as a separate, best-effort follow-up call.
  //
  // The tool's own parameter schema (see the createReminder TOOLS entry
  // above) has no patient_id property — the AI assistant can never attach a
  // patient to a reminder it creates — so syncReminderToHealthcare's
  // auto-heal/resolveHealthcareSubject path never runs here; every mirror
  // row produced by this function is the "no subject" case.
  const valid = validateReminderArgs(args, actor);
  if (valid.error) return { error: valid.error };
  const { title, dueDate, time, notes } = valid;

  // Clinical only when the actor may create clinical reminders (same rule as
  // the REST route); otherwise forced to administrative, which keeps
  // syncReminderToHealthcare a no-op.
  let category = String(args.category || "").toLowerCase().includes("clinical") ? "clinical" : "administrative";
  if (category === "clinical") {
    try {
      assertClinicalReminderAccess({ category }, actor);
    } catch {
      category = "administrative";
    }
  }

  // Same metadata the Recordatorios form stores (start_at / calendar_start_at).
  const metadata = extractReminderMeta(time ? { start_date: `${dueDate}T${time}:00${MEXICO_CITY_OFFSET}` } : {});
  const createdBy = userId || null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Same user, title, date and time in the last minutes: return it instead
    // of inserting again (the model retried or the user resent the message).
    const { rows: duplicates } = await client.query(
      `SELECT id, title
       FROM reminders
       WHERE business_id = $1
         AND created_by IS NOT DISTINCT FROM $2
         AND LOWER(REGEXP_REPLACE(BTRIM(title), '\\s+', ' ', 'g')) = $3
         AND due_date = $4::date
         AND COALESCE(metadata->>'start_at', '') = $5
         AND created_at >= NOW() - INTERVAL '${DUPLICATE_WINDOW_MINUTES} minutes'
       ORDER BY id DESC
       LIMIT 1`,
      [Number(businessId), createdBy, normalizeReminderTitle(title), dueDate, metadata.start_at || ""]
    );
    if (duplicates[0]) {
      await client.query("COMMIT");
      return { id: duplicates[0].id, title: duplicates[0].title, due_date: dueDate, time, duplicate: true };
    }

    const { rows } = await client.query(
      `INSERT INTO reminders
         (title, notes, status, due_date, business_id, reminder_type, category, is_completed, created_by, metadata)
       VALUES ($1, $2, 'pending', $3, $4, 'manual', $5, FALSE, $6, $7::jsonb)
       RETURNING *`,
      [
        title,
        notes,
        dueDate,
        Number(businessId),
        category,
        createdBy,
        JSON.stringify(metadata)
      ]
    );
    // No-op automatically when category !== 'clinical' (see
    // syncReminderToHealthcare's guard in healthcareSubjectTranslation.js).
    await syncReminderToHealthcare(rows[0], { id: createdBy }, client);
    // Same audit entry as reminderService.createReminder, tagged as coming from the chat.
    await saveAuditLog({
      business_id: Number(businessId),
      usuario_id: createdBy,
      modulo: "reminders",
      accion: category === "clinical" ? "create_clinical_reminder" : "create_reminder",
      entidad_tipo: "reminder",
      entidad_id: rows[0].id,
      detalle_nuevo: { snapshot: rows[0] },
      metadata: { category, patient_id: null, source: "ai_chat" }
    }, { client, strict: false });
    await client.query("COMMIT");
    return { id: rows[0].id, title: rows[0].title, due_date: dueDate, time, duplicate: false };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[AI Tool] createReminder error:", error.message);
    return { error: "No se pudo guardar el recordatorio por un error del sistema. Dile al usuario que no se creó y que intente de nuevo en un momento." };
  } finally {
    client.release();
  }
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

// actor: the authenticated user (role checks for createReminder).
async function executeTool(toolName, args, businessId, userId = null, actor = null) {
  try {
    switch (toolName) {
      case "getSalesByPeriod":   return await getSalesByPeriod(args, businessId, actor);
      case "getTopProducts":     return await getTopProducts(args, businessId);
      case "getClientBalance":   return await getClientBalance(args, businessId);
      case "getSupplierInfo":    return await getSupplierInfo(args, businessId);
      case "createReminder":     return await createReminder(args, businessId, userId, actor);
      case "getExpensesByPeriod":return await getExpensesByPeriod(args, businessId);
      default:                   return { error: "Herramienta no reconocida." };
    }
  } catch (err) {
    // Error real con contexto en el log; al modelo solo le llega el mensaje genérico.
    console.error(
      `[AI Tool] ${toolName} failed: business_id=${businessId} user_id=${userId ?? "-"} args=${JSON.stringify(args ?? {})} code=${err?.code ?? "-"} message=${err?.message}`,
      err?.stack || ""
    );
    return { error: "No se pudo obtener la información." };
  }
}

module.exports = { TOOLS, executeTool, REMINDER_CREATE_ROLES };
