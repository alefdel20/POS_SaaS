CREATE TABLE IF NOT EXISTS automation_events (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER,
  event_type VARCHAR(80) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS processed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'automation_events_type_check'
      AND conrelid = 'automation_events'::regclass
  ) THEN
    ALTER TABLE automation_events
    ADD CONSTRAINT automation_events_type_check
    CHECK (event_type IN ('sale_created', 'low_stock_detected', 'credit_payment_received', 'product_created'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_automation_events_business'
      AND conrelid = 'automation_events'::regclass
  ) THEN
    ALTER TABLE automation_events
    ADD CONSTRAINT fk_automation_events_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_automation_events_business_id ON automation_events(business_id);
CREATE INDEX IF NOT EXISTS idx_automation_events_processed ON automation_events(business_id, processed, created_at DESC);
