CREATE TABLE IF NOT EXISTS product_restock_history (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  quantity_added NUMERIC(14, 3) NOT NULL,
  stock_before NUMERIC(14, 3) NOT NULL,
  stock_after NUMERIC(14, 3) NOT NULL,
  unit_cost NUMERIC(12, 5) NOT NULL DEFAULT 0,
  total_cost NUMERIC(14, 5) NOT NULL DEFAULT 0,
  actor_user_id INTEGER REFERENCES users(id),
  actor_name_snapshot VARCHAR(180) NOT NULL DEFAULT '',
  product_name_snapshot VARCHAR(200) NOT NULL DEFAULT '',
  category_snapshot VARCHAR(120) NOT NULL DEFAULT '',
  supplier_name_snapshot VARCHAR(200) NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE product_restock_history ADD COLUMN IF NOT EXISTS product_name_snapshot VARCHAR(200) NOT NULL DEFAULT '';
ALTER TABLE product_restock_history ADD COLUMN IF NOT EXISTS category_snapshot VARCHAR(120) NOT NULL DEFAULT '';
ALTER TABLE product_restock_history ADD COLUMN IF NOT EXISTS supplier_name_snapshot VARCHAR(200) NOT NULL DEFAULT '';

ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS product_name_snapshot VARCHAR(200) NOT NULL DEFAULT '';

UPDATE sale_items
SET product_name_snapshot = COALESCE(NULLIF(sale_items.product_name_snapshot, ''), products.name, '')
FROM products
WHERE products.id = sale_items.product_id
  AND products.business_id = sale_items.business_id
  AND COALESCE(sale_items.product_name_snapshot, '') = '';

UPDATE product_restock_history
SET product_name_snapshot = COALESCE(NULLIF(product_restock_history.product_name_snapshot, ''), products.name, ''),
    category_snapshot = COALESCE(NULLIF(product_restock_history.category_snapshot, ''), products.category, '')
FROM products
WHERE products.id = product_restock_history.product_id
  AND products.business_id = product_restock_history.business_id
  AND (
    COALESCE(product_restock_history.product_name_snapshot, '') = ''
    OR COALESCE(product_restock_history.category_snapshot, '') = ''
  );

UPDATE product_restock_history
SET supplier_name_snapshot = COALESCE(NULLIF(product_restock_history.supplier_name_snapshot, ''), suppliers.name, '')
FROM suppliers
WHERE suppliers.id = product_restock_history.supplier_id
  AND suppliers.business_id = product_restock_history.business_id
  AND COALESCE(product_restock_history.supplier_name_snapshot, '') = '';

CREATE INDEX IF NOT EXISTS idx_product_restock_history_business_created
  ON product_restock_history(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_restock_history_business_product
  ON product_restock_history(business_id, product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_restock_history_business_supplier
  ON product_restock_history(business_id, supplier_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_restock_history_business_product_name
  ON product_restock_history(business_id, LOWER(product_name_snapshot));

CREATE INDEX IF NOT EXISTS idx_product_restock_history_business_category_name
  ON product_restock_history(business_id, LOWER(category_snapshot));

CREATE INDEX IF NOT EXISTS idx_product_restock_history_business_supplier_name
  ON product_restock_history(business_id, LOWER(supplier_name_snapshot));

CREATE INDEX IF NOT EXISTS idx_sales_credit_customer_name
  ON sales(business_id, LOWER(customer_name))
  WHERE payment_method = 'credit' AND COALESCE(status, 'completed') <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_sales_credit_customer_phone
  ON sales(business_id, customer_phone)
  WHERE payment_method = 'credit' AND COALESCE(status, 'completed') <> 'cancelled';
