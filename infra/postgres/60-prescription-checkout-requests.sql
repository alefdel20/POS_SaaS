-- =============================================================================
-- Migration 60: prescription_checkout_requests
-- =============================================================================
-- Cola "recetas/consultas pendientes de cobro" del flujo veterinario
-- "Pasar a cobro" — espeja el patron de product_update_requests
-- (infra/postgres/13-product-update-requests.sql), pero SI incluye el FK a
-- businesses(id) y el CHECK de status espejados en init.js (el precedente
-- tiene ese gap; aqui no se repite).
--
-- Safety properties:
--   Idempotent   — CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
--                  constraints via DO $$ IF NOT EXISTS (pg_constraint)
--   Atomic       — single BEGIN/COMMIT
--   Multi-tenant — business_id NOT NULL, FK a businesses(id)
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/60-prescription-checkout-requests.sql
--
-- Production:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/60-prescription-checkout-requests.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS prescription_checkout_requests (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL,
  consultation_id INTEGER NOT NULL REFERENCES consultations(id),
  prescription_id INTEGER REFERENCES medical_prescriptions(id),
  requested_by_user_id INTEGER NOT NULL REFERENCES users(id),
  charge_consultation BOOLEAN NOT NULL DEFAULT FALSE,
  consultation_amount NUMERIC(12, 5),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  sale_id INTEGER REFERENCES sales(id),
  completed_by_user_id INTEGER REFERENCES users(id),
  completed_at TIMESTAMP,
  cancelled_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE prescription_checkout_requests ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE prescription_checkout_requests ADD COLUMN IF NOT EXISTS consultation_id INTEGER;
ALTER TABLE prescription_checkout_requests ADD COLUMN IF NOT EXISTS prescription_id INTEGER;
ALTER TABLE prescription_checkout_requests ADD COLUMN IF NOT EXISTS requested_by_user_id INTEGER;
ALTER TABLE prescription_checkout_requests ADD COLUMN IF NOT EXISTS charge_consultation BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE prescription_checkout_requests ADD COLUMN IF NOT EXISTS consultation_amount NUMERIC(12, 5);
ALTER TABLE prescription_checkout_requests ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending';
ALTER TABLE prescription_checkout_requests ADD COLUMN IF NOT EXISTS sale_id INTEGER;
ALTER TABLE prescription_checkout_requests ADD COLUMN IF NOT EXISTS completed_by_user_id INTEGER;
ALTER TABLE prescription_checkout_requests ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
ALTER TABLE prescription_checkout_requests ADD COLUMN IF NOT EXISTS cancelled_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE prescription_checkout_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE prescription_checkout_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_prescription_checkout_requests_business'
      AND conrelid = 'prescription_checkout_requests'::regclass
  ) THEN
    ALTER TABLE prescription_checkout_requests
    ADD CONSTRAINT fk_prescription_checkout_requests_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'prescription_checkout_requests_status_check'
      AND conrelid = 'prescription_checkout_requests'::regclass
  ) THEN
    ALTER TABLE prescription_checkout_requests
    ADD CONSTRAINT prescription_checkout_requests_status_check
    CHECK (status IN ('pending', 'completed', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_prescription_checkout_requests_business_status_created
  ON prescription_checkout_requests(business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prescription_checkout_requests_consultation_id
  ON prescription_checkout_requests(consultation_id);

-- ---------------------------------------------------------------------------
-- Verificacion final
-- ---------------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM prescription_checkout_requests)::INT AS total_rows,
  (SELECT COUNT(*) FROM pg_constraint WHERE conname = 'fk_prescription_checkout_requests_business')::INT AS fk_business_present,
  (SELECT COUNT(*) FROM pg_constraint WHERE conname = 'prescription_checkout_requests_status_check')::INT AS status_check_present;

COMMIT;
