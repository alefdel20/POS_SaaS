// AI chat createReminder tool (aiFunctions.js) and the per-turn cap in
// aiChatController.sendMessage. No real DB: pool.connect / pool.query are an
// in-memory fake that keeps reminders, healthcare mirror rows and audit logs,
// and evaluates the duplicate lookup with the bound params. The clock is
// mocked (Date only), so "today" and "now" are fixed per test.
//
// Run with: node --test src/utils/aiReminderTool.test.js   (from backend/)
for (const name of Object.keys(process.env)) {
  if (/^(AI_|DEEPSEEK_|OLLAMA_|ANTHROPIC_)/.test(name)) delete process.env[name];
}
process.env.AI_PROVIDER = "deepseek";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const pool = require("../db/pool");
const { executeTool, REMINDER_CREATE_ROLES } = require("./aiFunctions");
const { extractReminderMeta } = require("../services/reminderService");
const { normalizeRole } = require("./roles");
const llmService = require("../services/llmService");
const aiChatService = require("../services/aiChatService");
const controller = require("../controllers/aiChatController");

// Friday 2026-10-16, 16:30 in Mexico City (UTC-6).
const NOW = new Date("2026-10-16T22:30:00Z");
const TOMORROW = "2026-10-17";

const ADMIN = { id: 42, business_id: 7, role: "admin" };
const CAJERO = { id: 43, business_id: 7, role: "cajero" };

// ─── Fake database ───────────────────────────────────────────────────────────

let db;

function normalized(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

function resetDb({ failInsert = false } = {}) {
  db = { reminders: [], mirrors: [], audits: [], queries: [], nextId: 500, failInsert };
}

async function fakeQuery(sqlText, params = []) {
  const sql = normalized(sqlText);
  db.queries.push({ sql, params });
  if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) return { rows: [] };
  if (/^SELECT id, title FROM reminders WHERE business_id = \$1/.test(sql)) {
    const [businessId, createdBy, title, dueDate, startAt] = params;
    const windowStart = Date.now() - 10 * 60 * 1000;
    const rows = db.reminders
      .filter((r) => r.business_id === businessId
        && r.created_by === createdBy
        && r.title.trim().replace(/\s+/g, " ").toLowerCase() === title
        && r.due_date === dueDate
        && (r.metadata.start_at || "") === startAt
        && r.created_at >= windowStart)
      .sort((a, b) => b.id - a.id)
      .slice(0, 1)
      .map(({ id, title: rowTitle }) => ({ id, title: rowTitle }));
    return { rows };
  }
  if (/^INSERT INTO reminders\b/.test(sql)) {
    if (db.failInsert) throw new Error("db down");
    const [title, notes, dueDate, businessId, category, createdBy, metadata] = params;
    const row = {
      id: db.nextId++, title, notes, status: "pending", due_date: dueDate, source_key: null,
      assigned_to: null, created_by: createdBy, is_completed: false, business_id: businessId,
      reminder_type: "manual", category, patient_id: null, metadata: JSON.parse(metadata),
      created_at: Date.now()
    };
    db.reminders.push(row);
    return { rows: [row] };
  }
  if (/^INSERT INTO healthcare\.reminders\b/.test(sql)) {
    db.mirrors.push(params);
    return { rows: [{ id: 9000 + db.mirrors.length }] };
  }
  if (/^INSERT INTO audit_logs\b/.test(sql)) {
    const [businessId, usuarioId, modulo, accion, entidadTipo, entidadId, , detalleNuevo, , metadata] = params;
    const row = { businessId, usuarioId, modulo, accion, entidadTipo, entidadId, detalleNuevo: JSON.parse(detalleNuevo), metadata: JSON.parse(metadata) };
    db.audits.push(row);
    return { rows: [row] };
  }
  // Business context and anything else read-only.
  return { rows: [] };
}

pool.query = fakeQuery;
pool.connect = async () => ({ query: fakeQuery, release() {} });

function inserts() {
  return db.queries.filter((q) => /^INSERT INTO reminders\b/.test(q.sql));
}

function startCase(t, options) {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  resetDb(options);
}

const create = (args, actor = ADMIN, businessId = actor.business_id) => executeTool("createReminder", args, businessId, actor.id, actor);

// ─── Success ─────────────────────────────────────────────────────────────────

test("con hora: metadata.start_at igual que el formulario normal, due_date es la fecha y se audita", async (t) => {
  startCase(t);
  const result = await create({ title: "  Comprar a   Pan Bimbo ", notes: "Pasa el proveedor", due_date: TOMORROW, time: "16:00" });

  assert.deepEqual(result, { id: 500, title: "Comprar a   Pan Bimbo", due_date: TOMORROW, time: "16:00", duplicate: false });
  const row = db.reminders[0];
  // The Recordatorios form sends start_date as dateTimeLocalToIsoString("2026-10-17T16:00").
  const formMetadata = extractReminderMeta({ start_date: "2026-10-17T16:00:00-06:00" });
  assert.deepEqual(row.metadata, formMetadata);
  assert.deepEqual(row.metadata, { start_at: "2026-10-17T16:00:00-06:00", calendar_start_at: "2026-10-17T16:00:00-06:00" });
  assert.equal(row.due_date, TOMORROW);
  assert.equal(row.notes, "Pasa el proveedor");
  assert.equal(row.category, "administrative");
  assert.equal(row.business_id, 7);
  assert.equal(row.created_by, 42);

  assert.equal(db.audits.length, 1);
  assert.deepEqual(
    { ...db.audits[0], detalleNuevo: undefined },
    {
      businessId: 7, usuarioId: 42, modulo: "reminders", accion: "create_reminder", entidadTipo: "reminder", entidadId: "500",
      detalleNuevo: undefined, metadata: { category: "administrative", patient_id: null, source: "ai_chat" }
    }
  );
  assert.equal(db.audits[0].detalleNuevo.snapshot.id, 500);
  assert.deepEqual(db.mirrors, []);
  assert.ok(db.queries.some((q) => q.sql === "COMMIT"));
});

test("sin hora: metadata vacia y time null; la hora no se copia a notes", async (t) => {
  startCase(t);
  const result = await create({ title: "Pagar luz", due_date: TOMORROW });
  assert.deepEqual(result, { id: 500, title: "Pagar luz", due_date: TOMORROW, time: null, duplicate: false });
  assert.deepEqual(db.reminders[0].metadata, {});
  assert.equal(db.reminders[0].notes, "");

  resetDb();
  await create({ title: "Pagar agua", due_date: TOMORROW, time: "09:15", notes: "" });
  assert.equal(db.reminders[0].notes, "");
});

test("hoy: hora futura o sin hora pasa; 180 caracteres exactos pasa", async (t) => {
  startCase(t);
  assert.equal((await create({ title: "Cerrar caja", due_date: "2026-10-16", time: "16:30" })).duplicate, false);
  assert.equal((await create({ title: "Cerrar caja tarde", due_date: "2026-10-16", time: "23:59" })).duplicate, false);
  assert.equal((await create({ title: "Hoy sin hora", due_date: "2026-10-16" })).duplicate, false);
  assert.equal((await create({ title: "x".repeat(180), due_date: TOMORROW })).duplicate, false);
  assert.equal(db.reminders.length, 4);
});

// ─── Validation ──────────────────────────────────────────────────────────────

test("rechazos con mensaje especifico para el modelo y sin tocar la base", async (t) => {
  const cases = [
    { args: { title: "Pagar", due_date: "2026-10-15" }, pattern: /La fecha 2026-10-15 ya pasó \(hoy es 2026-10-16 en Ciudad de México\)\. Pregúntale al usuario/ },
    { args: { title: "Pagar", due_date: "17/10/2026" }, pattern: /La fecha no es válida: usa due_date en formato YYYY-MM-DD/ },
    { args: { title: "Pagar", due_date: "2026-02-30" }, pattern: /La fecha no es válida/ },
    { args: { title: "Pagar" }, pattern: /La fecha no es válida/ },
    { args: { title: "Pagar", due_date: 20261017 }, pattern: /La fecha no es válida/ },
    { args: { title: "Pagar", due_date: TOMORROW, time: "25:00" }, pattern: /La hora no es válida: usa time en formato HH:mm de 24 horas/ },
    { args: { title: "Pagar", due_date: TOMORROW, time: "4pm" }, pattern: /La hora no es válida/ },
    { args: { title: "Pagar", due_date: TOMORROW, time: "4:00" }, pattern: /La hora no es válida/ },
    { args: { title: "Pagar", due_date: "2026-10-16", time: "16:29" }, pattern: /La hora 16:29 de hoy ya pasó \(son las 16:30 en Ciudad de México\)\. Pregúntale al usuario/ },
    { args: { title: "", due_date: TOMORROW }, pattern: /Falta el título del recordatorio\. Pregúntale al usuario/ },
    { args: { title: "   ", due_date: TOMORROW }, pattern: /Falta el título/ },
    { args: { due_date: TOMORROW }, pattern: /Falta el título/ },
    { args: { title: "x".repeat(181), due_date: TOMORROW }, pattern: /El título tiene más de 180 caracteres/ }
  ];
  for (const { args, pattern } of cases) {
    startCase(t);
    const result = await create(args);
    assert.match(result.error, pattern, JSON.stringify(args));
    assert.doesNotMatch(result.error, /No se pudo obtener la información/);
    assert.equal(db.queries.length, 0, JSON.stringify(args));
    t.mock.timers.reset();
  }
});

test("error de base: mensaje especifico de escritura y ROLLBACK", async (t) => {
  startCase(t, { failInsert: true });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  let result;
  try {
    result = await create({ title: "Pagar", due_date: TOMORROW });
  } finally {
    console.error = original;
  }
  assert.match(result.error, /No se pudo guardar el recordatorio por un error del sistema/);
  assert.ok(db.queries.some((q) => q.sql === "ROLLBACK"));
  assert.equal(db.queries.some((q) => q.sql === "COMMIT"), false);
  assert.equal(db.audits.length, 0);
});

// ─── Roles and category ──────────────────────────────────────────────────────

test("roles: los mismos de POST /reminders; cocina, soporte y sin actor no pueden", async (t) => {
  const routes = fs.readFileSync(path.join(__dirname, "../routes/reminderRoutes.js"), "utf8");
  const postLine = routes.split(/\r?\n/).find((line) => line.startsWith('router.post("/", '));
  const routeRoles = JSON.parse(postLine.match(/requireRole\((\[[^\]]*\])\)/)[1]);
  assert.deepEqual(REMINDER_CREATE_ROLES, routeRoles);

  for (const role of ["cocina", "kitchen", "soporte", undefined]) {
    startCase(t);
    const result = await create({ title: "Pagar", due_date: TOMORROW }, { id: 50, business_id: 7, role });
    assert.match(result.error, /El rol de este usuario no puede crear recordatorios/, String(role));
    assert.equal(db.queries.length, 0);
    t.mock.timers.reset();
  }
  startCase(t);
  assert.match((await executeTool("createReminder", { title: "Pagar", due_date: TOMORROW }, 7, 42)).error, /El rol de este usuario/);

  for (const role of ["superadmin", "superusuario", "admin", "gerente", "clinico", "user", "cajero"]) {
    resetDb();
    const result = await create({ title: `Pagar ${role}`, due_date: TOMORROW }, { id: 60, business_id: 7, role });
    assert.equal(result.duplicate, false, role);
    assert.ok(REMINDER_CREATE_ROLES.map(normalizeRole).includes(normalizeRole(role)));
  }
});

test("categoria clinica: cajero y gerente quedan en administrative sin sincronizar; admin y clinico si sincronizan", async (t) => {
  for (const role of ["cajero", "gerente"]) {
    startCase(t);
    await create({ title: "Vacuna", due_date: TOMORROW, category: "clinical" }, { id: 70, business_id: 7, role });
    assert.equal(db.reminders[0].category, "administrative", role);
    assert.deepEqual(db.mirrors, [], role);
    assert.equal(db.audits[0].accion, "create_reminder", role);
    assert.equal(db.audits[0].metadata.category, "administrative");
    t.mock.timers.reset();
  }
  for (const role of ["admin", "clinico"]) {
    startCase(t);
    await create({ title: "Vacuna", due_date: TOMORROW, category: "clinical" }, { id: 71, business_id: 7, role });
    assert.equal(db.reminders[0].category, "clinical", role);
    assert.equal(db.mirrors.length, 1, role);
    assert.equal(db.audits[0].accion, "create_clinical_reminder", role);
    t.mock.timers.reset();
  }
});

// ─── Duplicates and isolation ────────────────────────────────────────────────

test("duplicado en 10 minutos: devuelve el existente con duplicate true y no inserta ni audita", async (t) => {
  startCase(t);
  const first = await create({ title: "Comprar a Pan Bimbo", due_date: TOMORROW, time: "16:00" });
  t.mock.timers.setTime(NOW.getTime() + 9 * 60 * 1000);
  const again = await create({ title: "  comprar a  PAN BIMBO ", due_date: TOMORROW, time: "16:00" });

  assert.deepEqual(again, { id: first.id, title: "Comprar a Pan Bimbo", due_date: TOMORROW, time: "16:00", duplicate: true });
  assert.equal(db.reminders.length, 1);
  assert.equal(inserts().length, 1);
  assert.equal(db.audits.length, 1);

  const lookup = db.queries.find((q) => /^SELECT id, title FROM reminders/.test(q.sql));
  assert.match(lookup.sql, /WHERE business_id = \$1 AND created_by IS NOT DISTINCT FROM \$2/);
  assert.match(lookup.sql, /created_at >= NOW\(\) - INTERVAL '10 minutes'/);
  assert.deepEqual(lookup.params, [7, 42, "comprar a pan bimbo", TOMORROW, "2026-10-17T16:00:00-06:00"]);
});

test("no es duplicado: otra hora, sin hora, otro usuario, otro negocio o despues de 10 minutos", async (t) => {
  startCase(t);
  await create({ title: "Pagar", due_date: TOMORROW, time: "16:00" });
  assert.equal((await create({ title: "Pagar", due_date: TOMORROW, time: "17:00" })).duplicate, false);
  assert.equal((await create({ title: "Pagar", due_date: TOMORROW })).duplicate, false);
  assert.equal((await create({ title: "Pagar", due_date: TOMORROW, time: "16:00" }, CAJERO)).duplicate, false);
  const otherBusiness = { id: 42, business_id: 8, role: "admin" };
  const other = await create({ title: "Pagar", due_date: TOMORROW, time: "16:00" }, otherBusiness);
  assert.equal(other.duplicate, false);
  assert.equal(db.reminders.find((r) => r.id === other.id).business_id, 8);

  t.mock.timers.setTime(NOW.getTime() + 11 * 60 * 1000);
  assert.equal((await create({ title: "Pagar", due_date: TOMORROW, time: "16:00" })).duplicate, false);
  assert.equal(db.reminders.length, 6);
  // Every insert and lookup carries the business of the call, never another one.
  for (const q of db.queries.filter((x) => /reminders/.test(x.sql) && !/healthcare/.test(x.sql))) {
    const businessId = /^INSERT/.test(q.sql) ? q.params[3] : q.params[0];
    assert.ok([7, 8].includes(businessId));
  }
});

// ─── Per-turn cap in the controller ──────────────────────────────────────────

function chatHarness(actor) {
  aiChatService.getSession = async () => ({ id: 9, messages: [] });
  aiChatService.addMessage = async () => ({});
  aiChatService.saveAssistantTurn = async () => ({});
  aiChatService.updateTokenUsage = async () => ({});
  const rounds = [];
  const res = {
    headersSent: false,
    setHeader() {},
    write() { this.headersSent = true; },
    end() {}
  };
  const req = { params: { sessionId: "9" }, body: { message: "Recuérdame cuatro cosas" }, user: actor, auth: {} };
  return { req, res, rounds };
}

test("tope por turno: el cuarto createReminder no se ejecuta y devuelve un error con el tope", async (t) => {
  startCase(t);
  const { req, res, rounds } = chatHarness(ADMIN);
  const original = llmService.streamChat;
  llmService.streamChat = async function* (messages, options) {
    rounds.push({ messages: messages.slice(), options });
    if (rounds.length === 1) {
      yield {
        type: "tool_call",
        tool_calls: [1, 2, 3, 4].map((n) => ({
          id: `call_${n}`,
          type: "function",
          function: { name: "createReminder", arguments: JSON.stringify({ title: `Tarea ${n}`, due_date: TOMORROW }) }
        }))
      };
      return;
    }
    yield "Listo";
  };
  try {
    await controller.sendMessage(req, res, (err) => { throw err; });
  } finally {
    llmService.streamChat = original;
  }

  assert.equal(inserts().length, 3);
  assert.deepEqual(db.reminders.map((r) => r.title), ["Tarea 1", "Tarea 2", "Tarea 3"]);
  const toolMessages = rounds[1].messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content));
  assert.equal(toolMessages.length, 4);
  assert.deepEqual(toolMessages.slice(0, 3).map((m) => m.duplicate), [false, false, false]);
  assert.match(toolMessages[3].error, /Ya se ejecutaron 3 createReminder en este mensaje, el máximo por turno/);
  // The tools are still offered on a normal (no attachment) turn.
  assert.ok(rounds[0].options.tools.some((tool) => tool.function.name === "createReminder"));
});

test("el controlador pasa el actor: cocina recibe el error de rol por el chat", async (t) => {
  startCase(t);
  const kitchen = { id: 80, business_id: 7, role: "cocina" };
  const { req, res, rounds } = chatHarness(kitchen);
  const original = llmService.streamChat;
  llmService.streamChat = async function* (messages) {
    rounds.push({ messages: messages.slice() });
    if (rounds.length === 1) {
      yield {
        type: "tool_call",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "createReminder", arguments: JSON.stringify({ title: "Pedir gas", due_date: TOMORROW }) } }]
      };
      return;
    }
    yield "No puedo";
  };
  try {
    await controller.sendMessage(req, res, (err) => { throw err; });
  } finally {
    llmService.streamChat = original;
  }
  assert.equal(inserts().length, 0);
  const toolMessage = JSON.parse(rounds[1].messages.find((m) => m.role === "tool").content);
  assert.match(toolMessage.error, /El rol de este usuario no puede crear recordatorios/);
});
