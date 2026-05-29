ALTER TABLE sales ADD COLUMN IF NOT EXISTS is_write_off BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_sales_write_off ON sales(business_id, is_write_off) WHERE is_write_off = TRUE;
