ALTER TABLE products ADD COLUMN IF NOT EXISTS unidad_de_venta VARCHAR(20);
ALTER TABLE products ADD COLUMN IF NOT EXISTS porcentaje_ganancia NUMERIC(7, 3);
ALTER TABLE products ALTER COLUMN stock TYPE NUMERIC(12, 3);
ALTER TABLE products ALTER COLUMN stock_minimo TYPE NUMERIC(12, 3);
ALTER TABLE products ALTER COLUMN stock_maximo TYPE NUMERIC(12, 3);

UPDATE products
SET unidad_de_venta = 'pieza'
WHERE unidad_de_venta IS NULL OR unidad_de_venta = '';

ALTER TABLE sale_items ALTER COLUMN quantity TYPE NUMERIC(12, 3);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unidad_de_venta VARCHAR(20);
ALTER TABLE product_suppliers ALTER COLUMN purchase_cost TYPE NUMERIC(12, 3);

ALTER TABLE sales ADD COLUMN IF NOT EXISTS requires_administrative_invoice BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS administrative_invoice_id BIGINT;

CREATE TABLE IF NOT EXISTS administrative_invoices (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  requested_by_user_id INTEGER REFERENCES users(id),
  assigned_to_user_id INTEGER REFERENCES users(id),
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  sale_folio VARCHAR(50) NOT NULL,
  sale_date DATE NOT NULL,
  cashier_name VARCHAR(150),
  sale_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  customer_name VARCHAR(180),
  rfc VARCHAR(20),
  email VARCHAR(150),
  phone VARCHAR(40),
  fiscal_regime VARCHAR(120),
  fiscal_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  cantidad_clave TEXT NOT NULL DEFAULT '',
  observations TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_unidad_de_venta_check'
      AND conrelid = 'products'::regclass
  ) THEN
    ALTER TABLE products
    ADD CONSTRAINT products_unidad_de_venta_check
    CHECK (unidad_de_venta IS NULL OR unidad_de_venta IN ('pieza', 'kg', 'litro', 'caja'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_sales_administrative_invoice'
      AND conrelid = 'sales'::regclass
  ) THEN
    ALTER TABLE sales
    ADD CONSTRAINT fk_sales_administrative_invoice
    FOREIGN KEY (administrative_invoice_id) REFERENCES administrative_invoices(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_administrative_invoices_business_id ON administrative_invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_administrative_invoices_sale_id ON administrative_invoices(sale_id);
CREATE INDEX IF NOT EXISTS idx_administrative_invoices_status ON administrative_invoices(business_id, status);
