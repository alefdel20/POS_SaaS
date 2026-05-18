const pool = require("../db/pool");
const { requireActorBusinessId } = require("../utils/tenant");
const { getMexicoCityDate } = require("../utils/timezone");
const ApiError = require("../utils/ApiError");

async function createSession(actor, data) {
  const businessId = requireActorBusinessId(actor);
  const title = String(data.title || "Nueva conversación").slice(0, 180);
  const model = process.env.AI_PROVIDER === "deepseek"
    ? (process.env.DEEPSEEK_MODEL || "deepseek-chat")
    : (process.env.OLLAMA_MODEL || "gemma4");

  const { rows } = await pool.query(
    `INSERT INTO ai_chat_sessions (business_id, user_id, title, model, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'active', NOW(), NOW())
     RETURNING *`,
    [businessId, Number(actor.id), title, model]
  );
  return rows[0];
}

async function getSessions(actor, limit = 20) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `SELECT id, business_id, user_id, title, model, status, created_at, updated_at
     FROM ai_chat_sessions
     WHERE business_id = $1 AND user_id = $2 AND status = 'active'
     ORDER BY updated_at DESC
     LIMIT $3`,
    [businessId, Number(actor.id), Number(limit)]
  );
  return rows;
}

async function getSession(actor, sessionId) {
  const businessId = requireActorBusinessId(actor);
  const { rows: sessionRows } = await pool.query(
    `SELECT id, business_id, user_id, title, model, status, created_at, updated_at
     FROM ai_chat_sessions
     WHERE id = $1 AND business_id = $2 AND status = 'active'
     LIMIT 1`,
    [Number(sessionId), businessId]
  );

  if (!sessionRows[0]) return null;

  const { rows: messageRows } = await pool.query(
    `SELECT id, session_id, role, content, tokens_used, created_at
     FROM ai_chat_messages
     WHERE session_id = $1
     ORDER BY created_at ASC`,
    [Number(sessionId)]
  );

  return { ...sessionRows[0], messages: messageRows };
}

async function addMessage(actor, sessionId, messageData) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `INSERT INTO ai_chat_messages
       (session_id, role, content, tokens_used, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING *`,
    [
      Number(sessionId),
      messageData.role,
      messageData.content,
      messageData.tokens_used || 0
    ]
  );
  return rows[0];
}

async function updateTokenUsage(actor, tokensUsed) {
  const businessId = requireActorBusinessId(actor);
  const today = getMexicoCityDate();
  const [yearStr, monthStr] = today.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);

  await pool.query(
    `INSERT INTO ai_token_usage (business_id, month, year, total_tokens_used, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (business_id, month, year)
     DO UPDATE SET total_tokens_used = ai_token_usage.total_tokens_used + EXCLUDED.total_tokens_used`,
    [businessId, month, year, Number(tokensUsed)]
  );
}

async function deleteSession(actor, sessionId) {
  const businessId = requireActorBusinessId(actor);
  const { rowCount } = await pool.query(
    `UPDATE ai_chat_sessions
     SET status = 'deleted', updated_at = NOW()
     WHERE id = $1 AND business_id = $2`,
    [Number(sessionId), businessId]
  );
  return rowCount > 0;
}

async function updateSessionTimestamp(sessionId, businessId) {
  await pool.query(
    `UPDATE ai_chat_sessions SET updated_at = NOW()
     WHERE id = $1 AND business_id = $2`,
    [Number(sessionId), Number(businessId)]
  );
}

async function saveAssistantTurn(actor, sessionId, assistantMessage, tokensUsed) {
  const businessId = requireActorBusinessId(actor);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO ai_chat_messages
         (session_id, role, content, tokens_used, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [
        Number(sessionId),
        assistantMessage.role,
        assistantMessage.content,
        assistantMessage.tokens_used || 0
      ]
    );

    const today = getMexicoCityDate();
    const [yearStr, monthStr] = today.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    await client.query(
      `INSERT INTO ai_token_usage (business_id, month, year, total_tokens_used, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (business_id, month, year)
       DO UPDATE SET total_tokens_used = ai_token_usage.total_tokens_used + EXCLUDED.total_tokens_used`,
      [businessId, month, year, Number(tokensUsed)]
    );

    await client.query(
      `UPDATE ai_chat_sessions SET updated_at = NOW()
       WHERE id = $1 AND business_id = $2`,
      [Number(sessionId), businessId]
    );

    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createSession,
  getSessions,
  getSession,
  addMessage,
  updateTokenUsage,
  deleteSession,
  updateSessionTimestamp,
  saveAssistantTurn
};
