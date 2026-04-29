-- Allow creating patients without a linked client (for Farmacia human-patient flow)
ALTER TABLE patients ALTER COLUMN client_id DROP NOT NULL;

-- Add lot_number to products for pharmacy/clinical inventory tracking
ALTER TABLE products ADD COLUMN IF NOT EXISTS lot_number VARCHAR(80);

-- Index for lot_number lookups by business
CREATE INDEX IF NOT EXISTS idx_products_business_lot_number
  ON products (business_id, lot_number)
  WHERE lot_number IS NOT NULL;
