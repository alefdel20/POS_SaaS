// Synthetic harness: ai_chat_messages rows take business_id from their session
// row, and the INSERT itself checks that the session belongs to the actor's
// business and is active. No real DB: pool.query / pool.connect are mocked
// against in-memory sessions, evaluating the INSERT ... SELECT's WHERE with the
// bound parameters.
//
// Run with: node --test src/utils/aiChatMessageTenant.test.js   (from backend/)
const test = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../db/pool");
const { addMessage, saveAssistantTurn } = require("../services/aiChatService");

const SESSIONS = [
  { id: 10, business_id: 6, status: "active" },
  { id: 20, business_id: 7, status: "active" },
  { id: 30, business_id: 6, status: "deleted" }
];

function installFakeDb() {
  const queries = [];
  const messages = [];
  async function query(sql, params = []) {
    queries.push({ sql, params });
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
    if (/INSERT INTO ai_chat_messages/i.test(sql)) {
      const [sessionId, actorBusinessId, role, content, tokensUsed] = params;
      const session = SESSIONS.find(
        (s) => s.id === sessionId && s.business_id === actorBusinessId && s.status === "active"
      );
      if (!session) return { rows: [], rowCount: 0 };
      const row = { id: messages.length + 1, business_id: session.business_id, session_id: session.id, role, content, tokens_used: tokensUsed };
      messages.push(row);
      return { rows: [row], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }
  pool.query = query;
  pool.connect = async () => ({ query, release() {} });
  return { queries, messages };
}

const sql = (queries, pattern) => queries.filter((q) => pattern.test(q.sql));

test("addMessage: business_id sale de la sesion y $2 es el negocio del actor", async () => {
  const { queries, messages } = installFakeDb();
  const actor = { id: 3, role: "cajero", business_id: 6 };

  const row = await addMessage(actor, 10, { role: "user", content: "hola" });

  const [insert] = sql(queries, /INSERT INTO ai_chat_messages/);
  assert.match(insert.sql, /\(business_id, session_id, role, content, tokens_used, created_at\)/);
  assert.match(insert.sql, /SELECT s\.business_id, s\.id, \$3, \$4, \$5, NOW\(\)/);
  assert.match(insert.sql, /WHERE s\.id = \$1 AND s\.business_id = \$2 AND s\.status = 'active'/);
  assert.deepEqual(insert.params, [10, 6, "user", "hola", 0]);
  assert.equal(row.business_id, 6);
  assert.equal(messages.length, 1);
});

test("saveAssistantTurn: guarda con business_id de la sesion y suma tokens del negocio", async () => {
  const { queries, messages } = installFakeDb();
  const actor = { id: 3, role: "admin", business_id: 6 };

  await saveAssistantTurn(actor, 10, { role: "assistant", content: "respuesta" }, 150);

  const [insert] = sql(queries, /INSERT INTO ai_chat_messages/);
  assert.deepEqual(insert.params, [10, 6, "assistant", "respuesta", 0]);
  assert.equal(messages[0].business_id, 6);
  const [usage] = sql(queries, /ai_token_usage/);
  assert.equal(usage.params[0], 6);
  assert.equal(usage.params[3], 150);
  assert.ok(sql(queries, /^\s*COMMIT/).length === 1);
});

test("aislamiento: actor del negocio A con sesion del negocio B -> 404 y no inserta", async () => {
  const { queries, messages } = installFakeDb();
  const actorA = { id: 3, role: "admin", business_id: 6 };

  await assert.rejects(
    addMessage(actorA, 20, { role: "user", content: "intento" }),
    (err) => err.statusCode === 404 && err.message === "Sesión no encontrada."
  );
  assert.equal(messages.length, 0);
  assert.deepEqual(sql(queries, /INSERT INTO ai_chat_messages/)[0].params.slice(0, 2), [20, 6]);
});

test("aislamiento: saveAssistantTurn con sesion ajena -> 404, ROLLBACK y no toca ai_token_usage", async () => {
  const { queries, messages } = installFakeDb();
  const actorA = { id: 3, role: "admin", business_id: 6 };

  await assert.rejects(
    saveAssistantTurn(actorA, 20, { role: "assistant", content: "x" }, 500),
    (err) => err.statusCode === 404
  );
  assert.equal(messages.length, 0);
  assert.equal(sql(queries, /ai_token_usage/).length, 0);
  assert.equal(sql(queries, /UPDATE ai_chat_sessions/).length, 0);
  assert.equal(sql(queries, /^\s*ROLLBACK/).length, 1);
  assert.equal(sql(queries, /^\s*COMMIT/).length, 0);
});

test("sesion con status 'deleted' -> 404 en ambos caminos", async () => {
  const { queries, messages } = installFakeDb();
  const actor = { id: 3, role: "admin", business_id: 6 };

  await assert.rejects(addMessage(actor, 30, { role: "user", content: "x" }), (err) => err.statusCode === 404);
  await assert.rejects(saveAssistantTurn(actor, 30, { role: "assistant", content: "x" }, 10), (err) => err.statusCode === 404);
  assert.equal(messages.length, 0);
  assert.equal(sql(queries, /ai_token_usage/).length, 0);
});

test("superusuario en modo soporte guarda con el business_id del negocio atendido", async () => {
  const { queries, messages } = installFakeDb();
  // authMiddleware.js:53-56 replaces business_id with the support session's target business.
  const supportActor = {
    id: 1,
    role: "superusuario",
    business_id: 6,
    support_session_id: 99,
    support_context: { actor_business_id: 1, business_id: 6 }
  };

  await addMessage(supportActor, 10, { role: "user", content: "soporte" });
  await saveAssistantTurn(supportActor, 10, { role: "assistant", content: "ok" }, 40);

  assert.deepEqual(messages.map((m) => m.business_id), [6, 6]);
  for (const insert of sql(queries, /INSERT INTO ai_chat_messages/)) {
    assert.equal(insert.params[1], 6);
  }
  assert.equal(sql(queries, /ai_token_usage/)[0].params[0], 6);
});
