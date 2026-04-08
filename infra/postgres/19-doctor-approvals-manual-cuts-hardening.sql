BEGIN;

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS professional_license VARCHAR(80);

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS specialty VARCHAR(120);

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS medical_specialty VARCHAR(120);

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(20) NOT NULL DEFAULT 'dark';

UPDATE users
SET medical_specialty = COALESCE(NULLIF(medical_specialty, ''), specialty)
WHERE COALESCE(NULLIF(medical_specialty, ''), '') = ''
  AND COALESCE(NULLIF(specialty, ''), '') <> '';

CREATE TABLE IF NOT EXISTS product_update_requests (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  requested_by_user_id INTEGER,
  requested_by INTEGER,
  reviewed_by_user_id INTEGER,
  reviewed_by INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  reason TEXT NOT NULL DEFAULT '',
  current_price_snapshot NUMERIC(12, 5),
  requested_price NUMERIC(12, 5),
  current_stock_snapshot NUMERIC(12, 3),
  requested_stock NUMERIC(12, 3),
  old_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  before_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS business_id INTEGER;

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS product_id INTEGER;

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS requested_by_user_id INTEGER;

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS requested_by INTEGER;

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id INTEGER;

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS reviewed_by INTEGER;

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending';

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS current_price_snapshot NUMERIC(12, 5);

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS requested_price NUMERIC(12, 5);

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS current_stock_snapshot NUMERIC(12, 3);

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS requested_stock NUMERIC(12, 3);

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS old_values JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS new_values JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS before_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS after_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

ALTER TABLE IF EXISTS product_update_requests
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

UPDATE product_update_requests
SET requested_by = COALESCE(requested_by, requested_by_user_id),
    reviewed_by = COALESCE(reviewed_by, reviewed_by_user_id),
    old_values = CASE
      WHEN old_values = '{}'::jsonb AND before_snapshot <> '{}'::jsonb THEN before_snapshot
      ELSE old_values
    END,
    new_values = CASE
      WHEN new_values = '{}'::jsonb AND after_snapshot <> '{}'::jsonb THEN after_snapshot
      ELSE new_values
    END,
    before_snapshot = CASE
      WHEN before_snapshot = '{}'::jsonb AND old_values <> '{}'::jsonb THEN old_values
      ELSE before_snapshot
    END,
    after_snapshot = CASE
      WHEN after_snapshot = '{}'::jsonb AND new_values <> '{}'::jsonb THEN new_values
      ELSE after_snapshot
    END
WHERE TRUE;

CREATE INDEX IF NOT EXISTS idx_product_update_requests_business_status_created_v2
  ON product_update_requests(business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_update_requests_business_product_created_v2
  ON product_update_requests(business_id, product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_update_requests_business_requested_by_v2
  ON product_update_requests(business_id, requested_by, created_at DESC);

CREATE TABLE IF NOT EXISTS manual_cuts (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL,
  cut_date DATE NOT NULL DEFAULT CURRENT_DATE,
  cut_type VARCHAR(20) NOT NULL DEFAULT 'manual',
  notes TEXT NOT NULL DEFAULT '',
  performed_by_user_id INTEGER,
  performed_by_name_snapshot VARCHAR(180) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS manual_cuts
  ADD COLUMN IF NOT EXISTS business_id INTEGER;

ALTER TABLE IF EXISTS manual_cuts
  ADD COLUMN IF NOT EXISTS cut_date DATE NOT NULL DEFAULT CURRENT_DATE;

ALTER TABLE IF EXISTS manual_cuts
  ADD COLUMN IF NOT EXISTS cut_type VARCHAR(20) NOT NULL DEFAULT 'manual';

ALTER TABLE IF EXISTS manual_cuts
  ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS manual_cuts
  ADD COLUMN IF NOT EXISTS performed_by_user_id INTEGER;

ALTER TABLE IF EXISTS manual_cuts
  ADD COLUMN IF NOT EXISTS performed_by_name_snapshot VARCHAR(180) NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS manual_cuts
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

ALTER TABLE IF EXISTS manual_cuts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_manual_cuts_business_created_v2
  ON manual_cuts(business_id, created_at DESC);

COMMIT;
