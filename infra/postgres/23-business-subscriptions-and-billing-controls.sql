CREATE TABLE IF NOT EXISTS business_subscriptions (
  business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  plan_type VARCHAR(20),
  billing_anchor_date DATE,
  next_payment_date DATE,
  grace_period_days INTEGER NOT NULL DEFAULT 0,
  enforcement_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  manual_adjustment_reason TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_subscriptions_plan_type_check'
      AND conrelid = 'business_subscriptions'::regclass
  ) THEN
    ALTER TABLE business_subscriptions
    ADD CONSTRAINT business_subscriptions_plan_type_check
    CHECK (plan_type IS NULL OR plan_type IN ('monthly', 'yearly'));
  END IF;
END $$;

INSERT INTO business_subscriptions (
  business_id,
  plan_type,
  billing_anchor_date,
  next_payment_date,
  grace_period_days,
  enforcement_enabled,
  manual_adjustment_reason
)
SELECT
  businesses.id,
  NULL,
  businesses.created_at::date,
  NULL,
  0,
  FALSE,
  ''
FROM businesses
WHERE NOT EXISTS (
  SELECT 1
  FROM business_subscriptions
  WHERE business_subscriptions.business_id = businesses.id
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_subscriptions_business_id
  ON business_subscriptions(business_id);

CREATE INDEX IF NOT EXISTS idx_business_subscriptions_next_payment_date
  ON business_subscriptions(next_payment_date);
