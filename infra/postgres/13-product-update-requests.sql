BEGIN;

CREATE TABLE IF NOT EXISTS product_update_requests (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER,
  product_id INTEGER NOT NULL REFERENCES products(id),
  requested_by_user_id INTEGER NOT NULL REFERENCES users(id),
  reviewed_by_user_id INTEGER REFERENCES users(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  reason TEXT NOT NULL DEFAULT '',
  current_price_snapshot NUMERIC(12, 5) NOT NULL,
  requested_price NUMERIC(12, 5),
  current_stock_snapshot NUMERIC(12, 3) NOT NULL,
  requested_stock NUMERIC(12, 3),
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS product_id INTEGER;
ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS requested_by_user_id INTEGER;
ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS reviewed_by_user_id INTEGER;
ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending';
ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT '';
ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS current_price_snapshot NUMERIC(12, 5);
ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS requested_price NUMERIC(12, 5);
ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS current_stock_snapshot NUMERIC(12, 3);
ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS requested_stock NUMERIC(12, 3);
ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;
ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_product_update_requests_business'
      AND conrelid = 'product_update_requests'::regclass
  ) THEN
    ALTER TABLE product_update_requests
    ADD CONSTRAINT fk_product_update_requests_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'product_update_requests_status_check'
      AND conrelid = 'product_update_requests'::regclass
  ) THEN
    ALTER TABLE product_update_requests
    ADD CONSTRAINT product_update_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_update_requests_business_status_created
  ON product_update_requests(business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_update_requests_business_requester_created
  ON product_update_requests(business_id, requested_by_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_update_requests_product_id
  ON product_update_requests(product_id);

COMMIT;
