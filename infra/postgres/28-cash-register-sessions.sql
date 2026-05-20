CREATE TABLE IF NOT EXISTS cash_register_sessions (
  id SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  branch_id INTEGER REFERENCES branches(id),
  opened_by INTEGER NOT NULL REFERENCES users(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opening_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  closing_amount NUMERIC(12,2),
  closed_at TIMESTAMPTZ,
  closed_by INTEGER REFERENCES users(id),
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_register_sessions_business
  ON cash_register_sessions(business_id, branch_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_register_open_session
  ON cash_register_sessions(business_id, branch_id)
  WHERE status = 'open';

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_register_open_session_no_branch
  ON cash_register_sessions(business_id)
  WHERE status = 'open' AND branch_id IS NULL;
