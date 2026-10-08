// Synthetic harness: every query against ai_token_usage must match the real
// production schema (the repo's infra/postgres/27-ai-chat-sessions.sql is out
// of date for this table):
//   id (default), business_id, month, year, total_tokens_used (default 0),
//   updated_at (default now()), UNIQUE (business_id, month, year). No created_at.
// No real DB: pool is mocked; the upsert is applied to an in-memory table keyed
// by the unique constraint so per-business totals can be checked.
//
// Run with: node --test src/utils/aiTokenUsageSchema.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");
const { updateTokenUsage, saveAssistantTurn } = require("../services/aiChatService");
const { requireAiAccess } = require("../middleware/aiAuth");
const { getMexicoCityDate } = require("./timezone");

const REAL_COLUMNS = new Set(["id", "business_id", "month", "year", "total_tokens_used", "updated_at"]);
const UNIQUE_KEY = ["business_id", "month", "year"];

const columnList = (text) => text.split(",").map((c) => c.trim()).filter(Boolean);

function assertUpsertMatchesSchema(sql) {
  const insertCols = columnList(sql.match(/INSERT INTO ai_token_usage\s*\(([^)]*)\)/i)[1]);
  for (const col of insertCols) assert.ok(REAL_COLUMNS.has(col), `INSERT manda columna inexistente: ${col}`);
  for (const col of UNIQUE_KEY) assert.ok(insertCols.includes(col), `INSERT no manda ${col}`);
  assert.ok(!insertCols.includes("created_at"));

  const valueCount = columnList(sql.match(/VALUES\s*\(([^)]*)\)/i)[1]).length;
  assert.equal(valueCount, insertCols.length, "VALUES no coincide con la lista de columnas");

  assert.deepEqual(columnList(sql.match(/ON CONFLICT\s*\(([^)]*)\)/i)[1]), UNIQUE_KEY);

  const setClause = sql.match(/DO UPDATE SET([\s\S]+)$/i)[1];
  const setCols = setClause.split(",").map((a) => a.split("=")[0].trim());
  for (const col of setCols) assert.ok(REAL_COLUMNS.has(col), `DO UPDATE toca columna inexistente: ${col}`);
  assert.match(setClause, /total_tokens_used = ai_token_usage\.total_tokens_used \+ EXCLUDED\.total_tokens_used/);
  assert.match(setClause, /updated_at = NOW\(\)/);
  return insertCols;
}

function installFakeDb({ sessions = [{ id: 10, business_id: 6 }, { id: 20, business_id: 7 }] } = {}) {
  const queries = [];
  const usage = new Map(); // "business|month|year" -> row
  async function query(sql, params = []) {
    queries.push({ sql, params });
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
    if (/INSERT INTO ai_chat_messages/i.test(sql)) {
      const session = sessions.find((s) => s.id === params[0] && s.business_id === params[1]);
      return session ? { rows: [{ id: 1, business_id: session.business_id, session_id: session.id }] } : { rows: [] };
    }
    if (/INSERT INTO ai_token_usage/i.test(sql)) {
      const cols = assertUpsertMatchesSchema(sql);
      const values = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
      const key = UNIQUE_KEY.map((c) => values[c]).join("|");
      const existing = usage.get(key);
      if (existing) {
        existing.total_tokens_used += values.total_tokens_used;
        existing.updated_at = "now()";
      } else {
        usage.set(key, { ...values, updated_at: "now()" });
      }
      return { rows: [], rowCount: 1 };
    }
    if (/FROM business_subscriptions/i.test(sql)) return { rows: [{ plan_type: "monthly", plan_name: "Premium" }] };
    if (/FROM ai_token_usage/i.test(sql)) {
      const [businessId, month, year] = params;
      const row = usage.get([businessId, month, year].join("|"));
      return { rows: row ? [{ total_tokens_used: row.total_tokens_used }] : [] };
    }
    return { rows: [], rowCount: 1 };
  }
  pool.query = query;
  pool.connect = async () => ({ query, release() {} });
  return { queries, usage };
}

const [YEAR, MONTH] = getMexicoCityDate().split("-").map(Number);

test("updateTokenUsage (/quick): columnas del INSERT coinciden con el esquema real", async () => {
  const { queries, usage } = installFakeDb();
  await updateTokenUsage({ id: 1, role: "admin", business_id: 6 }, 120);

  const [insert] = queries.filter((q) => /INSERT INTO ai_token_usage/i.test(q.sql));
  assert.deepEqual(assertUpsertMatchesSchema(insert.sql), ["business_id", "month", "year", "total_tokens_used"]);
  assert.deepEqual(insert.params, [6, MONTH, YEAR, 120]);
  assert.equal(usage.get(`6|${MONTH}|${YEAR}`).total_tokens_used, 120);
});

test("saveAssistantTurn: mismo upsert contra el esquema real, dentro de la transaccion", async () => {
  const { queries } = installFakeDb();
  await saveAssistantTurn({ id: 1, role: "admin", business_id: 6 }, 10, { role: "assistant", content: "ok" }, 80);

  const [insert] = queries.filter((q) => /INSERT INTO ai_token_usage/i.test(q.sql));
  assert.deepEqual(assertUpsertMatchesSchema(insert.sql), ["business_id", "month", "year", "total_tokens_used"]);
  assert.deepEqual(insert.params, [6, MONTH, YEAR, 80]);
  assert.equal(queries.filter((q) => /^\s*COMMIT/.test(q.sql)).length, 1);
});

test("dos negocios: cada upsert suma solo a su fila (business_id, month, year)", async () => {
  const { usage } = installFakeDb();
  const actorA = { id: 1, role: "admin", business_id: 6 };
  const actorB = { id: 2, role: "cajero", business_id: 7 };

  await saveAssistantTurn(actorA, 10, { role: "assistant", content: "a" }, 100);
  await updateTokenUsage(actorA, 50);
  await saveAssistantTurn(actorB, 20, { role: "assistant", content: "b" }, 30);

  assert.equal(usage.get(`6|${MONTH}|${YEAR}`).total_tokens_used, 150);
  assert.equal(usage.get(`7|${MONTH}|${YEAR}`).total_tokens_used, 30);
  assert.equal(usage.size, 2);
});

test("requireAiAccess: la lectura del cupo usa solo columnas reales y el negocio del actor", async () => {
  const { queries } = installFakeDb();
  await updateTokenUsage({ id: 1, role: "admin", business_id: 6 }, 1000);

  const req = { user: { id: 1, role: "admin", business_id: 6 } };
  // asyncHandler does not return its promise: wait for next() instead.
  const nextErr = await new Promise((resolve) => requireAiAccess(req, {}, resolve));

  assert.equal(nextErr, undefined);
  const [read] = queries.filter((q) => /FROM ai_token_usage/i.test(q.sql) && /^\s*SELECT/i.test(q.sql));
  const selected = columnList(read.sql.match(/SELECT([\s\S]*?)FROM/i)[1]);
  const filtered = [...read.sql.matchAll(/(\w+)\s*=\s*\$\d/g)].map((m) => m[1]);
  for (const col of [...selected, ...filtered]) assert.ok(REAL_COLUMNS.has(col), `lectura usa columna inexistente: ${col}`);
  assert.deepEqual(read.params, [6, MONTH, YEAR]);
  assert.equal(req.aiQuota.used, 1000);
});
