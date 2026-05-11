BEGIN;

-- clients table already exists from 01-schema.sql.
-- business_id was added in 03-multitenant-migration.sql.
-- Add missing columns needed for POS catalog deduplication.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes     TEXT      NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Unique client per business, keyed on normalized name + phone.
-- Partial index excludes soft-deleted rows so they can be re-created.
CREATE UNIQUE INDEX IF NOT EXISTS clients_business_name_phone_uq
  ON clients (business_id, LOWER(TRIM(name)), COALESCE(LOWER(TRIM(phone)), ''))
  WHERE deleted_at IS NULL;

-- FK from sales to the clients catalog (nullable — historical rows stay NULL).
-- ON DELETE SET NULL keeps historical sales intact if a client is hard-deleted.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_client_id ON sales (client_id) WHERE client_id IS NOT NULL;

COMMIT;
