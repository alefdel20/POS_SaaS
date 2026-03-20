BEGIN;

CREATE TABLE IF NOT EXISTS businesses (
  id SERIAL PRIMARY KEY,
  name VARCHAR(180) NOT NULL UNIQUE,
  slug VARCHAR(80) NOT NULL UNIQUE,
  pos_type VARCHAR(40) NOT NULL CHECK (pos_type IN ('Tlapaleria', 'Tienda', 'Farmacia', 'Papeleria', 'Otro')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO businesses (name, slug, pos_type, is_active)
SELECT 'Negocio Semilla', 'default', COALESCE((SELECT pos_type FROM users ORDER BY id ASC LIMIT 1), 'Otro'), TRUE
WHERE NOT EXISTS (SELECT 1 FROM businesses WHERE slug = 'default');

ALTER TABLE users ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE product_suppliers ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE credit_payments ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE daily_cuts ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE fixed_expenses ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE company_stamp_movements ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE support_access_logs ADD COLUMN IF NOT EXISTS business_id INTEGER;
ALTER TABLE support_access_logs ADD COLUMN IF NOT EXISTS target_business_id INTEGER;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS business_id INTEGER;

WITH seed AS (SELECT id FROM businesses WHERE slug = 'default')
UPDATE users SET business_id = (SELECT id FROM seed) WHERE business_id IS NULL;
WITH seed AS (SELECT id FROM businesses WHERE slug = 'default')
UPDATE suppliers SET business_id = (SELECT id FROM seed) WHERE business_id IS NULL;
WITH seed AS (SELECT id FROM businesses WHERE slug = 'default')
UPDATE products SET business_id = (SELECT id FROM seed) WHERE business_id IS NULL;
WITH seed AS (SELECT id FROM businesses WHERE slug = 'default')
UPDATE expenses SET business_id = (SELECT id FROM seed) WHERE business_id IS NULL;
WITH seed AS (SELECT id FROM businesses WHERE slug = 'default')
UPDATE owner_loans SET business_id = (SELECT id FROM seed) WHERE business_id IS NULL;
WITH seed AS (SELECT id FROM businesses WHERE slug = 'default')
UPDATE daily_cuts SET business_id = (SELECT id FROM seed) WHERE business_id IS NULL;
WITH seed AS (SELECT id FROM businesses WHERE slug = 'default')
UPDATE company_profiles SET business_id = (SELECT id FROM seed) WHERE business_id IS NULL;

WITH seed AS (SELECT id FROM businesses WHERE slug = 'default')
UPDATE sales
SET business_id = COALESCE(sales.business_id, users.business_id, (SELECT id FROM seed))
FROM users
WHERE users.id = sales.user_id AND sales.business_id IS NULL;

WITH seed AS (SELECT id FROM businesses WHERE slug = 'default')
UPDATE reminders
SET business_id = COALESCE(reminders.business_id, users.business_id, (SELECT id FROM seed))
FROM users
WHERE users.id = reminders.created_by AND reminders.business_id IS NULL;

WITH seed AS (SELECT id FROM businesses WHERE slug = 'default')
UPDATE fixed_expenses
SET business_id = COALESCE(fixed_expenses.business_id, users.business_id, (SELECT id FROM seed))
FROM users
WHERE users.id = fixed_expenses.created_by AND fixed_expenses.business_id IS NULL;

WITH seed AS (SELECT id FROM businesses WHERE slug = 'default')
UPDATE product_suppliers
SET business_id = COALESCE(product_suppliers.business_id, products.business_id, suppliers.business_id, (SELECT id FROM seed))
FROM products, suppliers
WHERE products.id = product_suppliers.product_id
  AND suppliers.id = product_suppliers.supplier_id
  AND product_suppliers.business_id IS NULL;

WITH seed AS (SELECT id FROM businesses WHERE slug = 'default')
UPDATE sale_items
SET business_id = COALESCE(sale_items.business_id, sales.business_id, (SELECT id FROM seed))
FROM sales
WHERE sales.id = sale_items.sale_id AND sale_items.business_id IS NULL;

WITH seed AS (SELECT id FROM businesses WHERE slug = 'default')
UPDATE credit_payments
SET business_id = COALESCE(credit_payments.business_id, sales.business_id, (SELECT id FROM seed))
FROM sales
WHERE sales.id = credit_payments.sale_id AND credit_payments.business_id IS NULL;

WITH seed AS (SELECT id FROM businesses WHERE slug = 'default')
UPDATE company_stamp_movements
SET business_id = COALESCE(company_stamp_movements.business_id, company_profiles.business_id, (SELECT id FROM seed))
FROM company_profiles
WHERE company_profiles.id = company_stamp_movements.company_profile_id
  AND company_stamp_movements.business_id IS NULL;

WITH seed AS (SELECT id FROM businesses WHERE slug = 'default')
UPDATE support_access_logs
SET business_id = COALESCE(support_access_logs.business_id, actor.business_id, target.business_id, (SELECT id FROM seed)),
    target_business_id = COALESCE(support_access_logs.target_business_id, target.business_id, (SELECT id FROM seed))
FROM users actor, users target
WHERE actor.id = support_access_logs.actor_user_id
  AND target.id = support_access_logs.target_user_id
  AND (support_access_logs.business_id IS NULL OR support_access_logs.target_business_id IS NULL);

WITH seed AS (SELECT id FROM businesses WHERE slug = 'default')
UPDATE audit_logs
SET business_id = COALESCE(audit_logs.business_id, users.business_id, (SELECT id FROM seed))
FROM users
WHERE users.id = audit_logs.usuario_id AND audit_logs.business_id IS NULL;

ALTER TABLE users ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE suppliers ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE products ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE product_suppliers ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE sales ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE sale_items ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE credit_payments ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE daily_cuts ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE reminders ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE expenses ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE owner_loans ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE fixed_expenses ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE company_profiles ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE company_stamp_movements ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE support_access_logs ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE support_access_logs ALTER COLUMN target_business_id SET NOT NULL;
ALTER TABLE audit_logs ALTER COLUMN business_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_cuts_business_cut_date ON daily_cuts(business_id, cut_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_business_sku ON products(business_id, UPPER(sku));
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_business_barcode ON products(business_id, UPPER(barcode));
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_profiles_business_profile_key ON company_profiles(business_id, profile_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reminders_business_source_key ON reminders(business_id, source_key) WHERE source_key IS NOT NULL;

INSERT INTO company_profiles (business_id, profile_key, general_settings, is_active)
SELECT businesses.id, 'default', '{}'::jsonb, TRUE
FROM businesses
WHERE NOT EXISTS (
  SELECT 1
  FROM company_profiles
  WHERE company_profiles.business_id = businesses.id
    AND company_profiles.profile_key = 'default'
);

INSERT INTO users (username, email, full_name, password_hash, role, pos_type, business_id, is_active, must_change_password, password_changed_at)
SELECT 'soporte_' || businesses.slug,
       'soporte+' || businesses.slug || '@ankode.local',
       'Soporte ' || businesses.name,
       encode(gen_random_bytes(32), 'hex'),
       'soporte',
       businesses.pos_type,
       businesses.id,
       TRUE,
       TRUE,
       NOW()
FROM businesses
WHERE NOT EXISTS (
  SELECT 1
  FROM users
  WHERE users.business_id = businesses.id
    AND users.role = 'soporte'
);

COMMIT;
