ALTER TABLE products ADD COLUMN IF NOT EXISTS image_path TEXT;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS status VARCHAR(20);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancelled_by INTEGER REFERENCES users(id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;

UPDATE sales
SET status = 'completed'
WHERE status IS NULL OR BTRIM(status) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_status_check'
      AND conrelid = 'sales'::regclass
  ) THEN
    ALTER TABLE sales
    ADD CONSTRAINT sales_status_check
    CHECK (status IS NULL OR status IN ('completed', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sales_business_sale_date_status
  ON sales(business_id, sale_date, status);

CREATE INDEX IF NOT EXISTS idx_products_business_image_path
  ON products(business_id)
  WHERE image_path IS NOT NULL;
