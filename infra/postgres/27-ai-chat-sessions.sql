-- 27-ai-chat-sessions.sql
-- AI Chat Module: session history, message storage, and monthly token usage tracking.

CREATE TABLE IF NOT EXISTS ai_chat_sessions (
  id          BIGSERIAL   PRIMARY KEY,
  business_id INTEGER     NOT NULL REFERENCES businesses(id),
  user_id     INTEGER     NOT NULL REFERENCES users(id),
  branch_id   INTEGER     REFERENCES branches(id),
  title       VARCHAR(180) NOT NULL DEFAULT 'Nueva conversación',
  model       VARCHAR(80)  NOT NULL DEFAULT 'deepseek',
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id            BIGSERIAL   PRIMARY KEY,
  business_id   INTEGER     NOT NULL REFERENCES businesses(id),
  session_id    BIGINT      NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  role          VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content       TEXT        NOT NULL,
  model         VARCHAR(80),
  input_tokens  INTEGER,
  output_tokens INTEGER,
  metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_token_usage (
  id           BIGSERIAL PRIMARY KEY,
  business_id  INTEGER   NOT NULL REFERENCES businesses(id),
  user_id      INTEGER   NOT NULL REFERENCES users(id),
  month        DATE      NOT NULL,
  tokens_used  INTEGER   NOT NULL DEFAULT 0,
  tokens_limit INTEGER,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ai_token_usage_business_user_month UNIQUE (business_id, user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_business_user
  ON ai_chat_sessions (business_id, user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_business_active
  ON ai_chat_sessions (business_id, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session
  ON ai_chat_messages (session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_business
  ON ai_chat_messages (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_token_usage_business_month
  ON ai_token_usage (business_id, month DESC);

CREATE INDEX IF NOT EXISTS idx_ai_token_usage_user_month
  ON ai_token_usage (user_id, month DESC);
