BEGIN;

ALTER TABLE business_subscriptions
  ADD COLUMN IF NOT EXISTS last_payment_date DATE;

ALTER TABLE business_subscriptions
  ADD COLUMN IF NOT EXISTS last_payment_note TEXT NOT NULL DEFAULT '';

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS movement_type VARCHAR(40) NOT NULL DEFAULT 'general_expense';

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_expenses_business_movement_type_date
  ON expenses(business_id, movement_type, date DESC);

COMMIT;
