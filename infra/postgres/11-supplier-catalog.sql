BEGIN;

CREATE TABLE IF NOT EXISTS supplier_catalog_items (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER,
  supplier_id INTEGER NOT NULL,
  product_id INTEGER,
  supplier_product_code VARCHAR(120),
  supplier_product_name VARCHAR(220) NOT NULL,
  supplier_description TEXT NOT NULL DEFAULT '',
  supplier_category VARCHAR(120),
  supplier_unit VARCHAR(20),
  purchase_cost NUMERIC(12, 5) NOT NULL DEFAULT 0,
  previous_purchase_cost NUMERIC(12, 5),
  currency VARCHAR(10) NOT NULL DEFAULT 'MXN',
  pack_size VARCHAR(80),
  min_order_qty NUMERIC(12, 3),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  cost_changed BOOLEAN NOT NULL DEFAULT FALSE,
  catalog_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  source_file TEXT,
  last_cost_applied_at TIMESTAMP,
  imported_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS supplier_id INTEGER;
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS product_id INTEGER;
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS supplier_product_code VARCHAR(120);
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS supplier_product_name VARCHAR(220);
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS supplier_description TEXT NOT NULL DEFAULT '';
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS supplier_category VARCHAR(120);
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS supplier_unit VARCHAR(20);
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS purchase_cost NUMERIC(12, 5) NOT NULL DEFAULT 0;
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS previous_purchase_cost NUMERIC(12, 5);
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'MXN';
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS pack_size VARCHAR(80);
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS min_order_qty NUMERIC(12, 3);
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS cost_changed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS catalog_status VARCHAR(30) NOT NULL DEFAULT 'pending';
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS source_file TEXT;
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS last_cost_applied_at TIMESTAMP;
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS imported_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_supplier_catalog_items_business'
      AND conrelid = 'supplier_catalog_items'::regclass
  ) THEN
    ALTER TABLE supplier_catalog_items
    ADD CONSTRAINT fk_supplier_catalog_items_business
    FOREIGN KEY (business_id) REFERENCES businesses(id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_supplier_catalog_items_supplier'
      AND conrelid = 'supplier_catalog_items'::regclass
  ) THEN
    ALTER TABLE supplier_catalog_items
    ADD CONSTRAINT fk_supplier_catalog_items_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_supplier_catalog_items_product'
      AND conrelid = 'supplier_catalog_items'::regclass
  ) THEN
    ALTER TABLE supplier_catalog_items
    ADD CONSTRAINT fk_supplier_catalog_items_product
    FOREIGN KEY (product_id) REFERENCES products(id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'supplier_catalog_items_status_check'
      AND conrelid = 'supplier_catalog_items'::regclass
  ) THEN
    ALTER TABLE supplier_catalog_items
    ADD CONSTRAINT supplier_catalog_items_status_check
    CHECK (catalog_status IN ('new', 'pending', 'linked', 'cost_changed', 'cost_applied', 'inactive')) NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_catalog_items_supplier_code
  ON supplier_catalog_items (business_id, supplier_id, LOWER(supplier_product_code))
  WHERE supplier_product_code IS NOT NULL AND BTRIM(supplier_product_code) <> '';

CREATE INDEX IF NOT EXISTS idx_supplier_catalog_items_business_id
  ON supplier_catalog_items (business_id);

CREATE INDEX IF NOT EXISTS idx_supplier_catalog_items_supplier_id
  ON supplier_catalog_items (supplier_id);

CREATE INDEX IF NOT EXISTS idx_supplier_catalog_items_product_id
  ON supplier_catalog_items (product_id);

CREATE INDEX IF NOT EXISTS idx_supplier_catalog_items_status
  ON supplier_catalog_items (business_id, supplier_id, catalog_status, cost_changed);

CREATE INDEX IF NOT EXISTS idx_supplier_catalog_items_name
  ON supplier_catalog_items (business_id, supplier_id, LOWER(supplier_product_name));

COMMIT;
