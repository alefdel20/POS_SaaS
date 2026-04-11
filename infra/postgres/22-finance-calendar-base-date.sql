BEGIN;

SET TIME ZONE 'America/Mexico_City';

ALTER TABLE fixed_expenses
  ADD COLUMN IF NOT EXISTS base_date DATE;

COMMIT;
