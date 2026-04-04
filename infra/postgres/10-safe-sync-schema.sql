-- Safe schema sync for Fases 1-4
-- Objetivo: compatibilidad idempotente entre código y PostgreSQL sin cambios destructivos.
-- Recomendado ejecutar antes de desplegar backend nuevo en producción.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Catálogos y plantillas por vertical
CREATE TABLE IF NOT EXISTS product_categories (
  id SERIAL PRIMARY KEY,
  business_id INTEGER,
  name VARCHAR(120) NOT NULL,
  source VARCHAR(30) NOT NULL DEFAULT 'manual',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pos_templates (
  id SERIAL PRIMARY KEY,
  pos_type VARCHAR(40) NOT NULL,
  type VARCHAR(40) NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 2) Servicios base
CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY,
  business_id INTEGER,
  name VARCHAR(160) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  category VARCHAR(120) NOT NULL DEFAULT 'General',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE services ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE services ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE services ADD COLUMN IF NOT EXISTS price NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN IF NOT EXISTS category VARCHAR(120) NOT NULL DEFAULT 'General';
ALTER TABLE services ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
ALTER TABLE services ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id);
ALTER TABLE services ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE services ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

-- 3) Eventos internos para automatizaciones futuras
CREATE TABLE IF NOT EXISTS automation_events (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER,
  event_type VARCHAR(80) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS event_type VARCHAR(80);
ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS processed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

-- 4) Company profile y JSONB usado por onboarding/configuración
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS general_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS pac_provider VARCHAR(120);
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS pac_mode VARCHAR(20) NOT NULL DEFAULT 'test';
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS stamps_available INTEGER NOT NULL DEFAULT 0;
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS stamps_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS stamp_alert_threshold INTEGER NOT NULL DEFAULT 10;
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS created_by INTEGER;
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS updated_by INTEGER;
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

-- 5) Productos / ventas / cobranza usados por Fases 1-4
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(40);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS observations TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE products ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'activo';
ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(120);
ALTER TABLE products ADD COLUMN IF NOT EXISTS expires_at DATE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_minimo NUMERIC(12, 3) NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_maximo NUMERIC(12, 3);
ALTER TABLE products ADD COLUMN IF NOT EXISTS unidad_de_venta VARCHAR(20);
ALTER TABLE products ADD COLUMN IF NOT EXISTS porcentaje_ganancia NUMERIC(7, 3);
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_path TEXT;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS send_reminder BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_name VARCHAR(150);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(40);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS initial_payment NUMERIC(14, 5) NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS balance_due NUMERIC(14, 5) NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS invoice_data JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS company_profile_id INTEGER;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS transfer_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS invoice_status VARCHAR(30) NOT NULL DEFAULT 'not_requested';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS stamp_status VARCHAR(30) NOT NULL DEFAULT 'not_applicable';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS stamp_movement_id BIGINT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS stamp_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS requires_administrative_invoice BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS administrative_invoice_id BIGINT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS status VARCHAR(20);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancelled_by INTEGER REFERENCES users(id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;

ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12, 5) NOT NULL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unidad_de_venta VARCHAR(20);

ALTER TABLE credit_payments ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE credit_payments ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
ALTER TABLE credit_payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

ALTER TABLE reminders ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS source_key VARCHAR(160);

ALTER TABLE users ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pos_type VARCHAR(40) NOT NULL DEFAULT 'Otro';
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_by INTEGER REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_active BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_activated_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_deactivated_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_updated_by INTEGER REFERENCES users(id);

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS business_type VARCHAR(80);

-- 6) Tabla soporte shell/base veterinaria ya existente en bootstrap
CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(120),
  phone VARCHAR(40),
  tax_id VARCHAR(60),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS business_id INTEGER;

-- 7) Backfill seguro de business_id donde el código lo asume
DO $$
DECLARE
  seed_business_id INTEGER;
BEGIN
  SELECT id INTO seed_business_id
  FROM businesses
  WHERE slug = 'default'
  LIMIT 1;

  IF seed_business_id IS NOT NULL THEN
    UPDATE company_profiles SET business_id = seed_business_id WHERE business_id IS NULL;
    UPDATE product_categories SET business_id = seed_business_id WHERE business_id IS NULL;
    UPDATE services SET business_id = seed_business_id WHERE business_id IS NULL;
    UPDATE automation_events SET business_id = seed_business_id WHERE business_id IS NULL;
    UPDATE clients SET business_id = seed_business_id WHERE business_id IS NULL;
    UPDATE suppliers SET business_id = seed_business_id WHERE business_id IS NULL;
    UPDATE products SET business_id = seed_business_id WHERE business_id IS NULL;
    UPDATE users SET business_id = seed_business_id WHERE business_id IS NULL;
  END IF;
END $$;

UPDATE sales
SET business_id = COALESCE(sales.business_id, users.business_id)
FROM users
WHERE users.id = sales.user_id
  AND sales.business_id IS NULL;

UPDATE credit_payments
SET business_id = COALESCE(credit_payments.business_id, sales.business_id)
FROM sales
WHERE sales.id = credit_payments.sale_id
  AND credit_payments.business_id IS NULL;

UPDATE sale_items
SET business_id = COALESCE(sale_items.business_id, sales.business_id)
FROM sales
WHERE sales.id = sale_items.sale_id
  AND sale_items.business_id IS NULL;

UPDATE reminders
SET business_id = COALESCE(
  reminders.business_id,
  (SELECT u.business_id FROM users u WHERE u.id = reminders.created_by),
  (SELECT u.business_id FROM users u WHERE u.id = reminders.assigned_to)
)
WHERE reminders.business_id IS NULL;

-- 8) FKs y constraints de forma segura (NOT VALID para no romper datos reales)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_product_categories_business'
      AND conrelid = 'product_categories'::regclass
  ) THEN
    ALTER TABLE product_categories
    ADD CONSTRAINT fk_product_categories_business
    FOREIGN KEY (business_id) REFERENCES businesses(id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_services_business'
      AND conrelid = 'services'::regclass
  ) THEN
    ALTER TABLE services
    ADD CONSTRAINT fk_services_business
    FOREIGN KEY (business_id) REFERENCES businesses(id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_automation_events_business'
      AND conrelid = 'automation_events'::regclass
  ) THEN
    ALTER TABLE automation_events
    ADD CONSTRAINT fk_automation_events_business
    FOREIGN KEY (business_id) REFERENCES businesses(id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_company_profiles_business'
      AND conrelid = 'company_profiles'::regclass
  ) THEN
    ALTER TABLE company_profiles
    ADD CONSTRAINT fk_company_profiles_business
    FOREIGN KEY (business_id) REFERENCES businesses(id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_credit_payments_business'
      AND conrelid = 'credit_payments'::regclass
  ) THEN
    ALTER TABLE credit_payments
    ADD CONSTRAINT fk_credit_payments_business
    FOREIGN KEY (business_id) REFERENCES businesses(id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_credit_payments_sale'
      AND conrelid = 'credit_payments'::regclass
  ) THEN
    ALTER TABLE credit_payments
    ADD CONSTRAINT fk_credit_payments_sale
    FOREIGN KEY (sale_id) REFERENCES sales(id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_clients_business'
      AND conrelid = 'clients'::regclass
  ) THEN
    ALTER TABLE clients
    ADD CONSTRAINT fk_clients_business
    FOREIGN KEY (business_id) REFERENCES businesses(id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'automation_events_type_check'
      AND conrelid = 'automation_events'::regclass
  ) THEN
    ALTER TABLE automation_events
    ADD CONSTRAINT automation_events_type_check
    CHECK (event_type IN ('sale_created', 'low_stock_detected', 'credit_payment_received', 'product_created')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'company_profiles_pac_mode_check'
      AND conrelid = 'company_profiles'::regclass
  ) THEN
    ALTER TABLE company_profiles
    ADD CONSTRAINT company_profiles_pac_mode_check
    CHECK (pac_mode IN ('test', 'production')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_unidad_de_venta_check'
      AND conrelid = 'products'::regclass
  ) THEN
    ALTER TABLE products
    ADD CONSTRAINT products_unidad_de_venta_check
    CHECK (unidad_de_venta IS NULL OR unidad_de_venta IN ('pieza', 'kg', 'litro', 'caja')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_stock_maximo_check'
      AND conrelid = 'products'::regclass
  ) THEN
    ALTER TABLE products
    ADD CONSTRAINT products_stock_maximo_check
    CHECK (stock_maximo IS NULL OR (stock_maximo >= 0 AND stock_maximo >= stock_minimo)) NOT VALID;
  END IF;
END $$;

-- 9) NOT NULL solo cuando ya sea seguro
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM company_profiles WHERE business_id IS NULL) THEN
    ALTER TABLE company_profiles ALTER COLUMN business_id SET NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM product_categories WHERE business_id IS NULL) THEN
    ALTER TABLE product_categories ALTER COLUMN business_id SET NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM services WHERE business_id IS NULL) THEN
    ALTER TABLE services ALTER COLUMN business_id SET NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM automation_events WHERE business_id IS NULL) THEN
    ALTER TABLE automation_events ALTER COLUMN business_id SET NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM credit_payments WHERE business_id IS NULL) THEN
    ALTER TABLE credit_payments ALTER COLUMN business_id SET NOT NULL;
  END IF;
END $$;

-- 10) Índices y uniqueness que el código ya aprovecha
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_categories_business_name
  ON product_categories (business_id, LOWER(name));

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_templates_pos_type_type
  ON pos_templates (pos_type, type);

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_profiles_business_profile_key
  ON company_profiles (business_id, profile_key);

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_business_sku
  ON products (business_id, UPPER(sku))
  WHERE sku IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_business_barcode
  ON products (business_id, UPPER(barcode))
  WHERE barcode IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_reminders_business_source_key
  ON reminders (business_id, source_key)
  WHERE source_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_categories_business_id
  ON product_categories (business_id);

CREATE INDEX IF NOT EXISTS idx_services_business_id
  ON services (business_id);

CREATE INDEX IF NOT EXISTS idx_automation_events_business_id
  ON automation_events (business_id);

CREATE INDEX IF NOT EXISTS idx_automation_events_processed
  ON automation_events (business_id, processed, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_company_profiles_business_id
  ON company_profiles (business_id);

CREATE INDEX IF NOT EXISTS idx_products_business_id
  ON products (business_id);

CREATE INDEX IF NOT EXISTS idx_sales_business_id
  ON sales (business_id);

CREATE INDEX IF NOT EXISTS idx_sales_business_sale_date_status
  ON sales (business_id, sale_date, status);

CREATE INDEX IF NOT EXISTS idx_credit_payments_business_id
  ON credit_payments (business_id);

CREATE INDEX IF NOT EXISTS idx_credit_payments_sale_id
  ON credit_payments (sale_id);

CREATE INDEX IF NOT EXISTS idx_reminders_business_id
  ON reminders (business_id);

CREATE INDEX IF NOT EXISTS idx_products_supplier_id
  ON products (supplier_id);

CREATE INDEX IF NOT EXISTS idx_suppliers_business_id
  ON suppliers (business_id);

CREATE INDEX IF NOT EXISTS idx_users_business_id
  ON users (business_id);

CREATE INDEX IF NOT EXISTS idx_clients_business_id
  ON clients (business_id);

COMMIT;
