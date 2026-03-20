CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(120) UNIQUE NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('superusuario', 'admin', 'cajero', 'soporte')),
  pos_type VARCHAR(40) NOT NULL DEFAULT 'Otro',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  password_reset_by INTEGER REFERENCES users(id),
  password_reset_at TIMESTAMP,
  password_changed_at TIMESTAMP,
  support_mode_active BOOLEAN NOT NULL DEFAULT FALSE,
  support_mode_activated_at TIMESTAMP,
  support_mode_deactivated_at TIMESTAMP,
  support_mode_updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(120),
  phone VARCHAR(40),
  whatsapp VARCHAR(40),
  observations TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_profiles (
  id SERIAL PRIMARY KEY,
  profile_key VARCHAR(50) NOT NULL DEFAULT 'default',
  owner_name VARCHAR(150),
  company_name VARCHAR(180),
  phone VARCHAR(40),
  email VARCHAR(120),
  address TEXT NOT NULL DEFAULT '',
  general_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  bank_name VARCHAR(120),
  bank_clabe VARCHAR(32),
  bank_beneficiary VARCHAR(180),
  fiscal_rfc VARCHAR(20),
  fiscal_business_name VARCHAR(180),
  fiscal_regime VARCHAR(120),
  fiscal_address TEXT NOT NULL DEFAULT '',
  pac_provider VARCHAR(120),
  pac_mode VARCHAR(20) NOT NULL DEFAULT 'test',
  stamps_available INTEGER NOT NULL DEFAULT 0,
  stamps_used INTEGER NOT NULL DEFAULT 0,
  stamp_alert_threshold INTEGER NOT NULL DEFAULT 10,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  sku VARCHAR(60) UNIQUE NOT NULL,
  barcode VARCHAR(80) UNIQUE NOT NULL,
  category VARCHAR(120),
  description TEXT NOT NULL DEFAULT '',
  price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  liquidation_price NUMERIC(12, 2),
  supplier_id INTEGER REFERENCES suppliers(id),
  status VARCHAR(20) NOT NULL DEFAULT 'activo',
  discount_type VARCHAR(20),
  discount_value NUMERIC(12, 2),
  discount_start TIMESTAMP,
  discount_end TIMESTAMP,
  stock NUMERIC(12, 2) NOT NULL DEFAULT 0,
  stock_minimo NUMERIC(12, 2) NOT NULL DEFAULT 0,
  expires_at DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_suppliers (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  purchase_cost NUMERIC(12, 2),
  cost_updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(product_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash', 'card', 'credit', 'transfer')),
  sale_type VARCHAR(20) NOT NULL CHECK (sale_type IN ('ticket', 'invoice')),
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  customer_name VARCHAR(150),
  customer_phone VARCHAR(40),
  initial_payment NUMERIC(12, 2) NOT NULL DEFAULT 0,
  balance_due NUMERIC(12, 2) NOT NULL DEFAULT 0,
  send_reminder BOOLEAN NOT NULL DEFAULT FALSE,
  invoice_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  company_profile_id INTEGER REFERENCES company_profiles(id),
  transfer_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  invoice_status VARCHAR(30) NOT NULL DEFAULT 'not_requested',
  stamp_status VARCHAR(30) NOT NULL DEFAULT 'not_applicable',
  stamp_movement_id BIGINT,
  stamp_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
  sale_time TIME NOT NULL DEFAULT CURRENT_TIME,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sale_items (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity NUMERIC(12, 2) NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL,
  unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_payments (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(12, 2) NOT NULL,
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash', 'card', 'credit', 'transfer')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_cuts (
  id SERIAL PRIMARY KEY,
  cut_date DATE UNIQUE NOT NULL,
  total_day NUMERIC(12, 2) NOT NULL DEFAULT 0,
  cash_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  card_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  credit_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  transfer_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  invoice_count INTEGER NOT NULL DEFAULT 0,
  ticket_count INTEGER NOT NULL DEFAULT 0,
  gross_profit NUMERIC(12, 2) NOT NULL DEFAULT 0,
  gross_margin NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reminders (
  id SERIAL PRIMARY KEY,
  title VARCHAR(180) NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  due_date DATE,
  source_key VARCHAR(160),
  assigned_to INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  is_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id SERIAL PRIMARY KEY,
  job_type VARCHAR(40) NOT NULL CHECK (job_type IN ('google_sheets', 'excel', 'n8n_sync')),
  source_name VARCHAR(140) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(120),
  phone VARCHAR(40),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  concept VARCHAR(180) NOT NULL,
  category VARCHAR(120) NOT NULL DEFAULT 'General',
  amount NUMERIC(12, 2) NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT NOT NULL DEFAULT '',
  payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS owner_loans (
  id SERIAL PRIMARY KEY,
  amount NUMERIC(12, 2) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('entrada', 'abono')),
  balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_access_logs (
  id SERIAL PRIMARY KEY,
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  target_user_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fixed_expenses (
  id SERIAL PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  category VARCHAR(120) NOT NULL DEFAULT 'General',
  default_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  frequency VARCHAR(20) NOT NULL DEFAULT 'monthly',
  payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
  due_day INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES users(id),
  modulo VARCHAR(60) NOT NULL,
  accion VARCHAR(60) NOT NULL,
  entidad_tipo VARCHAR(60) NOT NULL,
  entidad_id VARCHAR(80),
  detalle_anterior JSONB NOT NULL DEFAULT '{}'::jsonb,
  detalle_nuevo JSONB NOT NULL DEFAULT '{}'::jsonb,
  motivo TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  report_type VARCHAR(60) NOT NULL,
  report_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_logs (
  id SERIAL PRIMARY KEY,
  provider VARCHAR(40) NOT NULL CHECK (provider IN ('google_sheets', 'excel', 'n8n')),
  direction VARCHAR(20) NOT NULL DEFAULT 'outbound',
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_stamp_movements (
  id BIGSERIAL PRIMARY KEY,
  company_profile_id INTEGER NOT NULL REFERENCES company_profiles(id),
  movement_type VARCHAR(30) NOT NULL,
  quantity INTEGER NOT NULL,
  balance_before INTEGER NOT NULL DEFAULT 0,
  balance_after INTEGER NOT NULL DEFAULT 0,
  related_sale_id INTEGER REFERENCES sales(id),
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_active BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_activated_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_deactivated_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_updated_by INTEGER REFERENCES users(id);

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(40);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS observations TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS company_profile_id INTEGER REFERENCES company_profiles(id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS transfer_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS invoice_status VARCHAR(30) NOT NULL DEFAULT 'not_requested';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS stamp_status VARCHAR(30) NOT NULL DEFAULT 'not_applicable';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS stamp_movement_id BIGINT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS stamp_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fixed_expense_id INTEGER REFERENCES fixed_expenses(id);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES users(id);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS void_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id);

ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP;
ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES users(id);
ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS void_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_minimo NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE product_suppliers ADD COLUMN IF NOT EXISTS purchase_cost NUMERIC(12, 2);
ALTER TABLE product_suppliers ADD COLUMN IF NOT EXISTS cost_updated_at TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_sales_stamp_movement'
      AND conrelid = 'sales'::regclass
  ) THEN
    ALTER TABLE sales
    ADD CONSTRAINT fk_sales_stamp_movement
    FOREIGN KEY (stamp_movement_id) REFERENCES company_stamp_movements(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'company_profiles_pac_mode_check'
      AND conrelid = 'company_profiles'::regclass
  ) THEN
    ALTER TABLE company_profiles
    ADD CONSTRAINT company_profiles_pac_mode_check
    CHECK (pac_mode IN ('test', 'production'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'company_stamp_movements_type_check'
      AND conrelid = 'company_stamp_movements'::regclass
  ) THEN
    ALTER TABLE company_stamp_movements
    ADD CONSTRAINT company_stamp_movements_type_check
    CHECK (movement_type IN ('load', 'consume', 'adjustment', 'rollback', 'expire'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_profiles_profile_key ON company_profiles(profile_key);

CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_supplier_id ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_stock_minimo ON products(stock_minimo);
CREATE INDEX IF NOT EXISTS idx_product_suppliers_product_id ON product_suppliers(product_id);
CREATE INDEX IF NOT EXISTS idx_product_suppliers_supplier_id ON product_suppliers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_name_lower ON suppliers ((LOWER(name)));
CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_user_id ON sales(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_payment_method ON sales(payment_method);
CREATE INDEX IF NOT EXISTS idx_sales_stamp_status ON sales(stamp_status);
CREATE INDEX IF NOT EXISTS idx_credit_payments_sale_id ON credit_payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_reminders_due_date ON reminders(due_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reminders_source_key ON reminders(source_key) WHERE source_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_is_voided ON expenses(is_voided);
CREATE INDEX IF NOT EXISTS idx_expenses_fixed_expense_id ON expenses(fixed_expense_id);
CREATE INDEX IF NOT EXISTS idx_fixed_expenses_is_active ON fixed_expenses(is_active);
CREATE INDEX IF NOT EXISTS idx_owner_loans_date ON owner_loans(date);
CREATE INDEX IF NOT EXISTS idx_owner_loans_is_voided ON owner_loans(is_voided);
CREATE INDEX IF NOT EXISTS idx_support_access_logs_actor ON support_access_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_usuario_id ON audit_logs(usuario_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_modulo ON audit_logs(modulo);
CREATE INDEX IF NOT EXISTS idx_company_stamp_movements_profile ON company_stamp_movements(company_profile_id);

INSERT INTO product_suppliers (product_id, supplier_id, is_primary, purchase_cost, cost_updated_at)
SELECT id, supplier_id, TRUE, cost_price, updated_at
FROM products
WHERE supplier_id IS NOT NULL
ON CONFLICT (product_id, supplier_id) DO NOTHING;
