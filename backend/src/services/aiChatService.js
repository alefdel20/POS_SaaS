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
    `INSERT INTO ai_chat_sessions (business_id, user_id, branch_id, title, model, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())
     RETURNING *`,
    [businessId, Number(actor.id), data.branch_id ? Number(data.branch_id) : null, title, model]
  );
  return rows[0];
}

async function getSessions(actor, limit = 20) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `SELECT id, business_id, user_id, branch_id, title, model, is_active, created_at, updated_at
     FROM ai_chat_sessions
     WHERE business_id = $1 AND user_id = $2 AND is_active = TRUE
     ORDER BY updated_at DESC
     LIMIT $3`,
    [businessId, Number(actor.id), Number(limit)]
  );
  return rows;
}

async function getSession(actor, sessionId) {
  const businessId = requireActorBusinessId(actor);
  const { rows: sessionRows } = await pool.query(
    `SELECT id, business_id, user_id, branch_id, title, model, is_active, created_at, updated_at
     FROM ai_chat_sessions
     WHERE id = $1 AND business_id = $2 AND is_active = TRUE
     LIMIT 1`,
    [Number(sessionId), businessId]
  );

  if (!sessionRows[0]) return null;

  const { rows: messageRows } = await pool.query(
    `SELECT id, business_id, session_id, role, content, model, input_tokens, output_tokens, metadata, created_at
     FROM ai_chat_messages
     WHERE session_id = $1 AND business_id = $2
     ORDER BY created_at ASC`,
    [Number(sessionId), businessId]
  );

  return { ...sessionRows[0], messages: messageRows };
}

async function addMessage(actor, sessionId, messageData) {
  const businessId = requireActorBusinessId(actor);
  const { rows } = await pool.query(
    `INSERT INTO ai_chat_messages
       (business_id, session_id, role, content, model, input_tokens, output_tokens, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     RETURNING *`,
    [
      businessId,
      Number(sessionId),
      messageData.role,
      messageData.content,
      messageData.model || null,
      messageData.input_tokens || null,
      messageData.output_tokens || null,
      JSON.stringify(messageData.metadata || {})
    ]
  );
  return rows[0];
}

async function updateTokenUsage(actor, tokensUsed) {
  const businessId = requireActorBusinessId(actor);
  const today = getMexicoCityDate();
  const monthStart = today.slice(0, 7) + "-01";

  await pool.query(
    `INSERT INTO ai_token_usage (business_id, user_id, month, tokens_used, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (business_id, user_id, month)
     DO UPDATE SET tokens_used = ai_token_usage.tokens_used + EXCLUDED.tokens_used`,
    [businessId, Number(actor.id), monthStart, Number(tokensUsed)]
  );
}

async function deleteSession(actor, sessionId) {
  const businessId = requireActorBusinessId(actor);
  const { rowCount } = await pool.query(
    `UPDATE ai_chat_sessions
     SET is_active = FALSE, updated_at = NOW()
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
         (business_id, session_id, role, content, model, input_tokens, output_tokens, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING *`,
      [
        businessId,
        Number(sessionId),
        assistantMessage.role,
        assistantMessage.content,
        assistantMessage.model || null,
        assistantMessage.input_tokens || null,
        assistantMessage.output_tokens || null,
        JSON.stringify(assistantMessage.metadata || {})
      ]
    );

    const today = getMexicoCityDate();
    const monthStart = today.slice(0, 7) + "-01";
    await client.query(
      `INSERT INTO ai_token_usage (business_id, user_id, month, tokens_used, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (business_id, user_id, month)
       DO UPDATE SET tokens_used = ai_token_usage.tokens_used + EXCLUDED.tokens_used`,
      [businessId, Number(actor.id), monthStart, Number(tokensUsed)]
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
