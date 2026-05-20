ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS cart_discount_type  VARCHAR(10)    CHECK (cart_discount_type IN ('percentage', 'fixed')),
  ADD COLUMN IF NOT EXISTS cart_discount_value NUMERIC(12,2)  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cart_discount_amount NUMERIC(12,2) DEFAULT 0;
