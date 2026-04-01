BEGIN;

  SET TIME ZONE 'America/Mexico_City';

  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(120) UNIQUE NOT NULL,
    full_name VARCHAR(120) NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL,
    pos_type VARCHAR(80) NOT NULL DEFAULT 'Otro',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    password_reset_by INTEGER,
    password_reset_at TIMESTAMP,
    password_changed_at TIMESTAMP,
    support_mode_active BOOLEAN NOT NULL DEFAULT FALSE,
    support_mode_activated_at TIMESTAMP,
    support_mode_deactivated_at TIMESTAMP,
    support_mode_updated_by INTEGER,
    business_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  -- =========================================================
  -- Recovery: base multitenant
  -- =========================================================

  CREATE TABLE IF NOT EXISTS businesses (
    id SERIAL PRIMARY KEY,
    name VARCHAR(180) NOT NULL UNIQUE,
    slug VARCHAR(80) NOT NULL UNIQUE,
    business_type VARCHAR(80),
    pos_type VARCHAR(80) NOT NULL DEFAULT 'Otro',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER,
    updated_by INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE businesses ADD COLUMN IF NOT EXISTS business_type VARCHAR(80);
  ALTER TABLE businesses ADD COLUMN IF NOT EXISTS pos_type VARCHAR(80) NOT NULL DEFAULT 'Otro';
  ALTER TABLE businesses ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE businesses ADD COLUMN IF NOT EXISTS created_by INTEGER;
  ALTER TABLE businesses ADD COLUMN IF NOT EXISTS updated_by INTEGER;
  ALTER TABLE businesses ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
  ALTER TABLE businesses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'businesses_pos_type_check'
        AND conrelid = 'businesses'::regclass
    ) THEN
      ALTER TABLE businesses
      ADD CONSTRAINT businesses_pos_type_check
      CHECK (pos_type IN ('Tlapaleria', 'Tienda', 'Farmacia', 'Veterinaria', 'Papeleria', 'Otro'));
    END IF;
  END $$;

  INSERT INTO businesses (name, slug, business_type, pos_type, is_active)
  SELECT 'Negocio Semilla', 'default', 'Otro',
         COALESCE((
           SELECT NULLIF(TRIM(pos_type), '')
           FROM users
           WHERE pos_type IN ('Tlapaleria', 'Tienda', 'Farmacia', 'Veterinaria', 'Papeleria', 'Otro')
           ORDER BY id ASC
           LIMIT 1
         ), 'Otro'),
         TRUE
  WHERE NOT EXISTS (
    SELECT 1
    FROM businesses
    WHERE slug = 'default'
  );

  UPDATE businesses
  SET business_type = COALESCE(NULLIF(TRIM(business_type), ''), CASE
    WHEN pos_type IN ('Tienda', 'Tlapaleria', 'Farmacia', 'Veterinaria') THEN pos_type
    WHEN pos_type = 'Papeleria' THEN 'Otro'
    ELSE 'Otro'
  END)
  WHERE business_type IS NULL OR TRIM(business_type) = '';

  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'users'
    ) THEN
      EXECUTE 'ALTER TABLE businesses
        ADD CONSTRAINT fk_businesses_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)';
    END IF;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'users'
    ) THEN
      EXECUTE 'ALTER TABLE businesses
        ADD CONSTRAINT fk_businesses_updated_by
        FOREIGN KEY (updated_by) REFERENCES users(id)';
    END IF;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  CREATE INDEX IF NOT EXISTS idx_businesses_slug ON businesses(slug);
  CREATE INDEX IF NOT EXISTS idx_businesses_is_active ON businesses(is_active);

  -- =========================================================
  -- Recovery: users
  -- =========================================================

  ALTER TABLE users ADD COLUMN IF NOT EXISTS pos_type VARCHAR(80) NOT NULL DEFAULT 'Otro';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS business_id INTEGER;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_by INTEGER;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_at TIMESTAMP;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_active BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_activated_at TIMESTAMP;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_deactivated_at TIMESTAMP;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_updated_by INTEGER;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
  ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

  UPDATE users
  SET role = 'superusuario'
  WHERE role = 'superadmin';

  UPDATE users
  SET role = 'cajero'
  WHERE role IN ('user', 'cashier');

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE users
  SET business_id = (SELECT id FROM seed)
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'users_role_check'
        AND conrelid = 'users'::regclass
    ) THEN
      ALTER TABLE users DROP CONSTRAINT users_role_check;
    END IF;

    ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('superusuario', 'admin', 'cajero', 'soporte'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE users
    ADD CONSTRAINT fk_users_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE users
    ADD CONSTRAINT fk_users_password_reset_by
    FOREIGN KEY (password_reset_by) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE users
    ADD CONSTRAINT fk_users_support_mode_updated_by
    FOREIGN KEY (support_mode_updated_by) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  ALTER TABLE users ALTER COLUMN business_id SET NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_users_business_id ON users(business_id);
  CREATE INDEX IF NOT EXISTS idx_users_role_business_id ON users(role, business_id);
  CREATE INDEX IF NOT EXISTS idx_users_is_active_business_id ON users(is_active, business_id);

  -- =========================================================
  -- Recovery: suppliers
  -- =========================================================

  CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(120),
    phone VARCHAR(40),
    whatsapp VARCHAR(40),
    observations TEXT NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    business_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(40);
  ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS observations TEXT NOT NULL DEFAULT '';
  ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS business_id INTEGER;
  ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
  ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE suppliers
  SET business_id = (SELECT id FROM seed)
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE suppliers
    ADD CONSTRAINT fk_suppliers_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  ALTER TABLE suppliers ALTER COLUMN business_id SET NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_suppliers_business_id ON suppliers(business_id);
  CREATE INDEX IF NOT EXISTS idx_suppliers_name_lower ON suppliers ((LOWER(name)));
  CREATE INDEX IF NOT EXISTS idx_suppliers_active_business_id ON suppliers(business_id, is_active);

  -- =========================================================
  -- Recovery: products
  -- =========================================================

  CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    sku VARCHAR(60),
    barcode VARCHAR(80),
    category VARCHAR(120),
    description TEXT NOT NULL DEFAULT '',
    price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    liquidation_price NUMERIC(12, 2),
    supplier_id INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'activo',
    discount_type VARCHAR(20),
    discount_value NUMERIC(12, 2),
    discount_start TIMESTAMP,
    discount_end TIMESTAMP,
    stock NUMERIC(12, 3) NOT NULL DEFAULT 0,
    stock_minimo NUMERIC(12, 3) NOT NULL DEFAULT 0,
    stock_maximo NUMERIC(12, 3) NOT NULL DEFAULT 0,
    unidad_de_venta VARCHAR(20),
    porcentaje_ganancia NUMERIC(7, 3),
    expires_at DATE,
    image_path TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    business_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE products ADD COLUMN IF NOT EXISTS business_id INTEGER;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id INTEGER;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'activo';
  ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(120);
  ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
  ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20);
  ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12, 2);
  ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_start TIMESTAMP;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_end TIMESTAMP;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS liquidation_price NUMERIC(12, 2);
  ALTER TABLE products ADD COLUMN IF NOT EXISTS expires_at DATE;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_minimo NUMERIC(12, 3) NOT NULL DEFAULT 0;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_maximo NUMERIC(12, 3);
  ALTER TABLE products ADD COLUMN IF NOT EXISTS unidad_de_venta VARCHAR(20);
  ALTER TABLE products ADD COLUMN IF NOT EXISTS porcentaje_ganancia NUMERIC(7, 3);
  ALTER TABLE products ADD COLUMN IF NOT EXISTS image_path TEXT;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE products ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
  ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

  ALTER TABLE products ALTER COLUMN stock TYPE NUMERIC(12, 3);
  ALTER TABLE products ALTER COLUMN stock_minimo TYPE NUMERIC(12, 3);
  ALTER TABLE products ALTER COLUMN stock_maximo TYPE NUMERIC(12, 3);

  UPDATE products
  SET status = 'activo'
  WHERE status IS NULL OR TRIM(status) = '';

  UPDATE products
  SET unidad_de_venta = 'pieza'
  WHERE unidad_de_venta IS NULL OR TRIM(unidad_de_venta) = '';

  UPDATE products
  SET stock_maximo = GREATEST(COALESCE(stock, 0), COALESCE(stock_minimo, 0))
  WHERE stock_maximo IS NULL;

  ALTER TABLE products ALTER COLUMN stock_maximo SET DEFAULT 0;

  UPDATE products
  SET stock_maximo = 0
  WHERE stock_maximo IS NULL;

  UPDATE products
  SET stock_maximo = stock_minimo
  WHERE stock_maximo < stock_minimo;

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE products
  SET business_id = (SELECT id FROM seed)
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE products
    ADD CONSTRAINT fk_products_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE products
    ADD CONSTRAINT fk_products_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'products_stock_maximo_check'
        AND conrelid = 'products'::regclass
    ) THEN
      ALTER TABLE products
      ADD CONSTRAINT products_stock_maximo_check
      CHECK (stock_maximo >= 0 AND stock_maximo >= stock_minimo);
    END IF;
  END $$;

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

  ALTER TABLE products ALTER COLUMN business_id SET NOT NULL;
  ALTER TABLE products ALTER COLUMN stock_maximo SET NOT NULL;

  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'products_sku_key'
        AND conrelid = 'products'::regclass
    ) THEN
      ALTER TABLE products DROP CONSTRAINT products_sku_key;
    END IF;
  EXCEPTION WHEN undefined_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'products_barcode_key'
        AND conrelid = 'products'::regclass
    ) THEN
      ALTER TABLE products DROP CONSTRAINT products_barcode_key;
    END IF;
  EXCEPTION WHEN undefined_object THEN NULL;
  END $$;

  CREATE UNIQUE INDEX IF NOT EXISTS uq_products_business_sku
    ON products(business_id, UPPER(sku))
    WHERE sku IS NOT NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS uq_products_business_barcode
    ON products(business_id, UPPER(barcode))
    WHERE barcode IS NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_products_business_id ON products(business_id);
  CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
  CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
  CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
  CREATE INDEX IF NOT EXISTS idx_products_supplier_id ON products(supplier_id);
  CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
  CREATE INDEX IF NOT EXISTS idx_products_stock_minimo ON products(stock_minimo);
  CREATE INDEX IF NOT EXISTS idx_products_stock_maximo ON products(stock_maximo);
  CREATE INDEX IF NOT EXISTS idx_products_business_image_path ON products(business_id) WHERE image_path IS NOT NULL;

  -- =========================================================
  -- Recovery: product_suppliers
  -- =========================================================

  CREATE TABLE IF NOT EXISTS product_suppliers (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL,
    supplier_id INTEGER NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    purchase_cost NUMERIC(12, 3),
    cost_updated_at TIMESTAMP,
    business_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(product_id, supplier_id)
  );

  ALTER TABLE product_suppliers ADD COLUMN IF NOT EXISTS purchase_cost NUMERIC(12, 3);
  ALTER TABLE product_suppliers ADD COLUMN IF NOT EXISTS cost_updated_at TIMESTAMP;
  ALTER TABLE product_suppliers ADD COLUMN IF NOT EXISTS business_id INTEGER;
  ALTER TABLE product_suppliers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

  ALTER TABLE product_suppliers ALTER COLUMN purchase_cost TYPE NUMERIC(12, 3);

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE product_suppliers
  SET business_id = COALESCE(product_suppliers.business_id, products.business_id, suppliers.business_id, (SELECT id FROM
  seed))
  FROM products, suppliers
  WHERE products.id = product_suppliers.product_id
    AND suppliers.id = product_suppliers.supplier_id
    AND product_suppliers.business_id IS NULL;

  UPDATE product_suppliers
  SET business_id = (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE product_suppliers
    ADD CONSTRAINT fk_product_suppliers_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE product_suppliers
    ADD CONSTRAINT fk_product_suppliers_supplier
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE product_suppliers
    ADD CONSTRAINT fk_product_suppliers_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  ALTER TABLE product_suppliers ALTER COLUMN business_id SET NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_product_suppliers_business_id ON product_suppliers(business_id);
  CREATE INDEX IF NOT EXISTS idx_product_suppliers_product_id ON product_suppliers(product_id);
  CREATE INDEX IF NOT EXISTS idx_product_suppliers_supplier_id ON product_suppliers(supplier_id);

  INSERT INTO product_suppliers (product_id, supplier_id, is_primary, purchase_cost, cost_updated_at, business_id)
  SELECT id, supplier_id, TRUE, cost_price, updated_at, business_id
  FROM products
  WHERE supplier_id IS NOT NULL
  ON CONFLICT (product_id, supplier_id) DO NOTHING;

  -- =========================================================
  -- Recovery: company_profiles
  -- =========================================================

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
    created_by INTEGER,
    updated_by INTEGER,
    business_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

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

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE company_profiles
  SET business_id = (SELECT id FROM seed)
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE company_profiles
    ADD CONSTRAINT fk_company_profiles_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE company_profiles
    ADD CONSTRAINT fk_company_profiles_created_by
    FOREIGN KEY (created_by) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE company_profiles
    ADD CONSTRAINT fk_company_profiles_updated_by
    FOREIGN KEY (updated_by) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
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

  ALTER TABLE company_profiles ALTER COLUMN business_id SET NOT NULL;

  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'uq_company_profiles_profile_key'
        AND conrelid = 'company_profiles'::regclass
    ) THEN
      ALTER TABLE company_profiles DROP CONSTRAINT uq_company_profiles_profile_key;
    END IF;
  EXCEPTION WHEN undefined_object THEN NULL;
  END $$;

  DROP INDEX IF EXISTS uq_company_profiles_profile_key;

  CREATE UNIQUE INDEX IF NOT EXISTS uq_company_profiles_business_profile_key
    ON company_profiles(business_id, profile_key);

  CREATE INDEX IF NOT EXISTS idx_company_profiles_business_id ON company_profiles(business_id);

  INSERT INTO company_profiles (business_id, profile_key, general_settings, is_active)
  SELECT businesses.id, 'default', '{}'::jsonb, TRUE
  FROM businesses
  WHERE NOT EXISTS (
    SELECT 1
    FROM company_profiles
    WHERE company_profiles.business_id = businesses.id
      AND company_profiles.profile_key = 'default'
  );

  -- =========================================================
  -- Recovery: company_stamp_movements
  -- =========================================================

  CREATE TABLE IF NOT EXISTS company_stamp_movements (
    id BIGSERIAL PRIMARY KEY,
    company_profile_id INTEGER NOT NULL,
    movement_type VARCHAR(30) NOT NULL,
    quantity INTEGER NOT NULL,
    balance_before INTEGER NOT NULL DEFAULT 0,
    balance_after INTEGER NOT NULL DEFAULT 0,
    related_sale_id INTEGER,
    note TEXT NOT NULL DEFAULT '',
    created_by INTEGER,
    business_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE company_stamp_movements ADD COLUMN IF NOT EXISTS related_sale_id INTEGER;
  ALTER TABLE company_stamp_movements ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
  ALTER TABLE company_stamp_movements ADD COLUMN IF NOT EXISTS created_by INTEGER;
  ALTER TABLE company_stamp_movements ADD COLUMN IF NOT EXISTS business_id INTEGER;
  ALTER TABLE company_stamp_movements ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE company_stamp_movements
  SET business_id = COALESCE(company_stamp_movements.business_id, company_profiles.business_id, (SELECT id FROM seed))
  FROM company_profiles
  WHERE company_profiles.id = company_stamp_movements.company_profile_id
    AND company_stamp_movements.business_id IS NULL;

  UPDATE company_stamp_movements
  SET business_id = (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE company_stamp_movements
    ADD CONSTRAINT fk_company_stamp_movements_profile
    FOREIGN KEY (company_profile_id) REFERENCES company_profiles(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE company_stamp_movements
    ADD CONSTRAINT fk_company_stamp_movements_created_by
    FOREIGN KEY (created_by) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE company_stamp_movements
    ADD CONSTRAINT fk_company_stamp_movements_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
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

  ALTER TABLE company_stamp_movements ALTER COLUMN business_id SET NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_company_stamp_movements_profile ON company_stamp_movements(company_profile_id);
  CREATE INDEX IF NOT EXISTS idx_company_stamp_movements_business_id ON company_stamp_movements(business_id);
  CREATE INDEX IF NOT EXISTS idx_company_stamp_movements_related_sale_id ON company_stamp_movements(related_sale_id);

  -- =========================================================
  -- Recovery: sales
  -- =========================================================

  CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    payment_method VARCHAR(20) NOT NULL,
    sale_type VARCHAR(20) NOT NULL,
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
    company_profile_id INTEGER,
    transfer_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    invoice_status VARCHAR(30) NOT NULL DEFAULT 'not_requested',
    stamp_status VARCHAR(30) NOT NULL DEFAULT 'not_applicable',
    stamp_movement_id BIGINT,
    stamp_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    requires_administrative_invoice BOOLEAN NOT NULL DEFAULT FALSE,
    administrative_invoice_id BIGINT,
    status VARCHAR(20),
    cancellation_reason TEXT,
    cancelled_by INTEGER,
    cancelled_at TIMESTAMP,
    sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
    sale_time TIME NOT NULL DEFAULT CURRENT_TIME,
    business_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE sales ADD COLUMN IF NOT EXISTS business_id INTEGER;
  ALTER TABLE sales ADD COLUMN IF NOT EXISTS send_reminder BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_name VARCHAR(150);
  ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(40);
  ALTER TABLE sales ADD COLUMN IF NOT EXISTS initial_payment NUMERIC(12, 2) NOT NULL DEFAULT 0;
  ALTER TABLE sales ADD COLUMN IF NOT EXISTS balance_due NUMERIC(12, 2) NOT NULL DEFAULT 0;
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
  ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancelled_by INTEGER;
  ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
  ALTER TABLE sales ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

  UPDATE sales
  SET status = 'completed'
  WHERE status IS NULL OR TRIM(status) = '';

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE sales
  SET business_id = COALESCE(sales.business_id, users.business_id, (SELECT id FROM seed))
  FROM users
  WHERE users.id = sales.user_id
    AND sales.business_id IS NULL;

  UPDATE sales
  SET business_id = (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE sales
    ADD CONSTRAINT fk_sales_user
    FOREIGN KEY (user_id) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE sales
    ADD CONSTRAINT fk_sales_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE sales
    ADD CONSTRAINT fk_sales_company_profile
    FOREIGN KEY (company_profile_id) REFERENCES company_profiles(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE sales
    ADD CONSTRAINT fk_sales_cancelled_by
    FOREIGN KEY (cancelled_by) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE sales
    ADD CONSTRAINT fk_sales_stamp_movement
    FOREIGN KEY (stamp_movement_id) REFERENCES company_stamp_movements(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE company_stamp_movements
    ADD CONSTRAINT fk_company_stamp_movements_related_sale
    FOREIGN KEY (related_sale_id) REFERENCES sales(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

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

  ALTER TABLE sales ALTER COLUMN business_id SET NOT NULL;

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'sales_payment_method_check'
        AND conrelid = 'sales'::regclass
    ) THEN
      ALTER TABLE sales
      ADD CONSTRAINT sales_payment_method_check
      CHECK (payment_method IN ('cash', 'card', 'credit', 'transfer'));
    END IF;
  END $$;

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'sales_sale_type_check'
        AND conrelid = 'sales'::regclass
    ) THEN
      ALTER TABLE sales
      ADD CONSTRAINT sales_sale_type_check
      CHECK (sale_type IN ('ticket', 'invoice'));
    END IF;
  END $$;

  CREATE INDEX IF NOT EXISTS idx_sales_business_id ON sales(business_id);
  CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales(sale_date);
  CREATE INDEX IF NOT EXISTS idx_sales_user_id ON sales(user_id);
  CREATE INDEX IF NOT EXISTS idx_sales_payment_method ON sales(payment_method);
  CREATE INDEX IF NOT EXISTS idx_sales_stamp_status ON sales(stamp_status);
  CREATE INDEX IF NOT EXISTS idx_sales_company_profile_id ON sales(company_profile_id);
  CREATE INDEX IF NOT EXISTS idx_sales_administrative_invoice_id ON sales(administrative_invoice_id);
  CREATE INDEX IF NOT EXISTS idx_sales_business_sale_date_status ON sales(business_id, sale_date, status);

  -- =========================================================
  -- Recovery: sale_items
  -- =========================================================

  CREATE TABLE IF NOT EXISTS sale_items (
    id SERIAL PRIMARY KEY,
    sale_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    business_id INTEGER,
    quantity NUMERIC(12, 3) NOT NULL,
    unit_price NUMERIC(12, 2) NOT NULL,
    unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
    subtotal NUMERIC(12, 2) NOT NULL,
    unidad_de_venta VARCHAR(20),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS business_id INTEGER;
  ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0;
  ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unidad_de_venta VARCHAR(20);
  ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

  ALTER TABLE sale_items ALTER COLUMN quantity TYPE NUMERIC(12, 3);

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE sale_items
  SET business_id = COALESCE(sale_items.business_id, sales.business_id, (SELECT id FROM seed))
  FROM sales
  WHERE sales.id = sale_items.sale_id
    AND sale_items.business_id IS NULL;

  UPDATE sale_items
  SET business_id = (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE sale_items
    ADD CONSTRAINT fk_sale_items_sale
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE sale_items
    ADD CONSTRAINT fk_sale_items_product
    FOREIGN KEY (product_id) REFERENCES products(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE sale_items
    ADD CONSTRAINT fk_sale_items_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  ALTER TABLE sale_items ALTER COLUMN business_id SET NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_sale_items_business_id ON sale_items(business_id);
  CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
  CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id);

  -- =========================================================
  -- Recovery: credit_payments
  -- =========================================================

  CREATE TABLE IF NOT EXISTS credit_payments (
    id SERIAL PRIMARY KEY,
    sale_id INTEGER NOT NULL,
    business_id INTEGER,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    amount NUMERIC(12, 2) NOT NULL,
    payment_method VARCHAR(20) NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE credit_payments ADD COLUMN IF NOT EXISTS business_id INTEGER;
  ALTER TABLE credit_payments ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
  ALTER TABLE credit_payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE credit_payments
  SET business_id = COALESCE(credit_payments.business_id, sales.business_id, (SELECT id FROM seed))
  FROM sales
  WHERE sales.id = credit_payments.sale_id
    AND credit_payments.business_id IS NULL;

  UPDATE credit_payments
  SET business_id = (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE credit_payments
    ADD CONSTRAINT fk_credit_payments_sale
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE credit_payments
    ADD CONSTRAINT fk_credit_payments_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  ALTER TABLE credit_payments ALTER COLUMN business_id SET NOT NULL;

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'credit_payments_payment_method_check'
        AND conrelid = 'credit_payments'::regclass
    ) THEN
      ALTER TABLE credit_payments
      ADD CONSTRAINT credit_payments_payment_method_check
      CHECK (payment_method IN ('cash', 'card', 'credit', 'transfer'));
    END IF;
  END $$;

  CREATE INDEX IF NOT EXISTS idx_credit_payments_business_id ON credit_payments(business_id);
  CREATE INDEX IF NOT EXISTS idx_credit_payments_sale_id ON credit_payments(sale_id);
  CREATE INDEX IF NOT EXISTS idx_credit_payments_payment_date ON credit_payments(payment_date);

  -- =========================================================
  -- Recovery: administrative_invoices
  -- =========================================================

  CREATE TABLE IF NOT EXISTS administrative_invoices (
    id BIGSERIAL PRIMARY KEY,
    business_id INTEGER,
    sale_id INTEGER NOT NULL,
    requested_by_user_id INTEGER,
    assigned_to_user_id INTEGER,
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

  ALTER TABLE administrative_invoices ADD COLUMN IF NOT EXISTS business_id INTEGER;
  ALTER TABLE administrative_invoices ADD COLUMN IF NOT EXISTS requested_by_user_id INTEGER;
  ALTER TABLE administrative_invoices ADD COLUMN IF NOT EXISTS assigned_to_user_id INTEGER;
  ALTER TABLE administrative_invoices ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'pending';
  ALTER TABLE administrative_invoices ADD COLUMN IF NOT EXISTS sale_folio VARCHAR(50);
  ALTER TABLE administrative_invoices ADD COLUMN IF NOT EXISTS sale_date DATE;
  ALTER TABLE administrative_invoices ADD COLUMN IF NOT EXISTS cashier_name VARCHAR(150);
  ALTER TABLE administrative_invoices ADD COLUMN IF NOT EXISTS sale_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE administrative_invoices ADD COLUMN IF NOT EXISTS customer_name VARCHAR(180);
  ALTER TABLE administrative_invoices ADD COLUMN IF NOT EXISTS rfc VARCHAR(20);
  ALTER TABLE administrative_invoices ADD COLUMN IF NOT EXISTS email VARCHAR(150);
  ALTER TABLE administrative_invoices ADD COLUMN IF NOT EXISTS phone VARCHAR(40);
  ALTER TABLE administrative_invoices ADD COLUMN IF NOT EXISTS fiscal_regime VARCHAR(120);
  ALTER TABLE administrative_invoices ADD COLUMN IF NOT EXISTS fiscal_data JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE administrative_invoices ADD COLUMN IF NOT EXISTS cantidad_clave TEXT NOT NULL DEFAULT '';
  ALTER TABLE administrative_invoices ADD COLUMN IF NOT EXISTS observations TEXT NOT NULL DEFAULT '';
  ALTER TABLE administrative_invoices ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
  ALTER TABLE administrative_invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE administrative_invoices
  SET business_id = COALESCE(administrative_invoices.business_id, sales.business_id, (SELECT id FROM seed))
  FROM sales
  WHERE sales.id = administrative_invoices.sale_id
    AND administrative_invoices.business_id IS NULL;

  UPDATE administrative_invoices
  SET business_id = (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE administrative_invoices
    ADD CONSTRAINT fk_administrative_invoices_sale
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE administrative_invoices
    ADD CONSTRAINT fk_administrative_invoices_requested_by
    FOREIGN KEY (requested_by_user_id) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE administrative_invoices
    ADD CONSTRAINT fk_administrative_invoices_assigned_to
    FOREIGN KEY (assigned_to_user_id) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE administrative_invoices
    ADD CONSTRAINT fk_administrative_invoices_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  ALTER TABLE administrative_invoices ALTER COLUMN business_id SET NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_administrative_invoices_business_id ON administrative_invoices(business_id);
  CREATE INDEX IF NOT EXISTS idx_administrative_invoices_sale_id ON administrative_invoices(sale_id);
  CREATE INDEX IF NOT EXISTS idx_administrative_invoices_status ON administrative_invoices(business_id, status);

  DO $$
  BEGIN
    ALTER TABLE sales
    ADD CONSTRAINT fk_sales_administrative_invoice
    FOREIGN KEY (administrative_invoice_id) REFERENCES administrative_invoices(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  -- =========================================================
  -- Recovery: daily_cuts
  -- =========================================================

  CREATE TABLE IF NOT EXISTS daily_cuts (
    id SERIAL PRIMARY KEY,
    cut_date DATE NOT NULL,
    total_day NUMERIC(12, 2) NOT NULL DEFAULT 0,
    cash_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
    card_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
    credit_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
    transfer_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
    invoice_count INTEGER NOT NULL DEFAULT 0,
    ticket_count INTEGER NOT NULL DEFAULT 0,
    gross_profit NUMERIC(12, 2) NOT NULL DEFAULT 0,
    gross_margin NUMERIC(12, 2) NOT NULL DEFAULT 0,
    business_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE daily_cuts ADD COLUMN IF NOT EXISTS business_id INTEGER;
  ALTER TABLE daily_cuts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
  ALTER TABLE daily_cuts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE daily_cuts
  SET business_id = (SELECT id FROM seed)
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE daily_cuts
    ADD CONSTRAINT fk_daily_cuts_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  ALTER TABLE daily_cuts ALTER COLUMN business_id SET NOT NULL;

  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'daily_cuts_cut_date_key'
        AND conrelid = 'daily_cuts'::regclass
    ) THEN
      ALTER TABLE daily_cuts DROP CONSTRAINT daily_cuts_cut_date_key;
    END IF;
  EXCEPTION WHEN undefined_object THEN NULL;
  END $$;

  CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_cuts_business_cut_date
    ON daily_cuts(business_id, cut_date);

  CREATE INDEX IF NOT EXISTS idx_daily_cuts_business_id ON daily_cuts(business_id);
  CREATE INDEX IF NOT EXISTS idx_daily_cuts_cut_date ON daily_cuts(cut_date);

  -- =========================================================
  -- Recovery: reminders
  -- =========================================================

  CREATE TABLE IF NOT EXISTS reminders (
    id SERIAL PRIMARY KEY,
    title VARCHAR(180) NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    due_date DATE,
    source_key VARCHAR(160),
    assigned_to INTEGER,
    created_by INTEGER,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    business_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE reminders ADD COLUMN IF NOT EXISTS business_id INTEGER;
  ALTER TABLE reminders ADD COLUMN IF NOT EXISTS source_key VARCHAR(160);
  ALTER TABLE reminders ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
  ALTER TABLE reminders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE reminders
  SET business_id = COALESCE(
    reminders.business_id,
    (SELECT u.business_id FROM users u WHERE u.id = reminders.created_by),
    (SELECT u.business_id FROM users u WHERE u.id = reminders.assigned_to),
    (SELECT id FROM seed)
  )
  WHERE reminders.business_id IS NULL;

  UPDATE reminders
  SET business_id = (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE reminders
    ADD CONSTRAINT fk_reminders_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  ALTER TABLE reminders ALTER COLUMN business_id SET NOT NULL;

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'reminders_status_check'
        AND conrelid = 'reminders'::regclass
    ) THEN
      ALTER TABLE reminders
      ADD CONSTRAINT reminders_status_check
      CHECK (status IN ('pending', 'in_progress', 'completed'));
    END IF;
  END $$;

  DROP INDEX IF EXISTS uq_reminders_source_key;

  CREATE UNIQUE INDEX IF NOT EXISTS uq_reminders_business_source_key
    ON reminders(business_id, source_key)
    WHERE source_key IS NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_reminders_business_id ON reminders(business_id);
  CREATE INDEX IF NOT EXISTS idx_reminders_due_date ON reminders(due_date);
  CREATE INDEX IF NOT EXISTS idx_reminders_assigned_to ON reminders(assigned_to);

  -- =========================================================
  -- Recovery: finances
  -- =========================================================

  CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    concept VARCHAR(180) NOT NULL,
    category VARCHAR(120) NOT NULL DEFAULT 'General',
    amount NUMERIC(12, 2) NOT NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT NOT NULL DEFAULT '',
    payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
    fixed_expense_id INTEGER,
    is_voided BOOLEAN NOT NULL DEFAULT FALSE,
    voided_at TIMESTAMP,
    voided_by INTEGER,
    void_reason TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_by INTEGER,
    business_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE expenses ADD COLUMN IF NOT EXISTS business_id INTEGER;
  ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fixed_expense_id INTEGER;
  ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP;
  ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_by INTEGER;
  ALTER TABLE expenses ADD COLUMN IF NOT EXISTS void_reason TEXT NOT NULL DEFAULT '';
  ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
  ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_by INTEGER;
  ALTER TABLE expenses ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE expenses
  SET business_id = (SELECT id FROM seed)
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE expenses
    ADD CONSTRAINT fk_expenses_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE expenses
    ADD CONSTRAINT fk_expenses_voided_by
    FOREIGN KEY (voided_by) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE expenses
    ADD CONSTRAINT fk_expenses_updated_by
    FOREIGN KEY (updated_by) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  ALTER TABLE expenses ALTER COLUMN business_id SET NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_expenses_business_id ON expenses(business_id);
  CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
  CREATE INDEX IF NOT EXISTS idx_expenses_is_voided ON expenses(is_voided);
  CREATE INDEX IF NOT EXISTS idx_expenses_fixed_expense_id ON expenses(fixed_expense_id);

  CREATE TABLE IF NOT EXISTS owner_loans (
    id SERIAL PRIMARY KEY,
    amount NUMERIC(12, 2) NOT NULL,
    type VARCHAR(20) NOT NULL,
    balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT NOT NULL DEFAULT '',
    is_voided BOOLEAN NOT NULL DEFAULT FALSE,
    voided_at TIMESTAMP,
    voided_by INTEGER,
    void_reason TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_by INTEGER,
    business_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS business_id INTEGER;
  ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
  ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP;
  ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS voided_by INTEGER;
  ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS void_reason TEXT NOT NULL DEFAULT '';
  ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
  ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS updated_by INTEGER;
  ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE owner_loans
  SET business_id = (SELECT id FROM seed)
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE owner_loans
    ADD CONSTRAINT fk_owner_loans_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE owner_loans
    ADD CONSTRAINT fk_owner_loans_voided_by
    FOREIGN KEY (voided_by) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE owner_loans
    ADD CONSTRAINT fk_owner_loans_updated_by
    FOREIGN KEY (updated_by) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'owner_loans_type_check'
        AND conrelid = 'owner_loans'::regclass
    ) THEN
      ALTER TABLE owner_loans
      ADD CONSTRAINT owner_loans_type_check
      CHECK (type IN ('entrada', 'abono'));
    END IF;
  END $$;

  ALTER TABLE owner_loans ALTER COLUMN business_id SET NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_owner_loans_business_id ON owner_loans(business_id);
  CREATE INDEX IF NOT EXISTS idx_owner_loans_date ON owner_loans(date);
  CREATE INDEX IF NOT EXISTS idx_owner_loans_is_voided ON owner_loans(is_voided);

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
    created_by INTEGER,
    updated_by INTEGER,
    business_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE fixed_expenses ADD COLUMN IF NOT EXISTS business_id INTEGER;
  ALTER TABLE fixed_expenses ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
  ALTER TABLE fixed_expenses ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE fixed_expenses ADD COLUMN IF NOT EXISTS created_by INTEGER;
  ALTER TABLE fixed_expenses ADD COLUMN IF NOT EXISTS updated_by INTEGER;
  ALTER TABLE fixed_expenses ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
  ALTER TABLE fixed_expenses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE fixed_expenses
  SET business_id = COALESCE(fixed_expenses.business_id, users.business_id, (SELECT id FROM seed))
  FROM users
  WHERE users.id = fixed_expenses.created_by
    AND fixed_expenses.business_id IS NULL;

  UPDATE fixed_expenses
  SET business_id = (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE fixed_expenses
    ADD CONSTRAINT fk_fixed_expenses_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE fixed_expenses
    ADD CONSTRAINT fk_fixed_expenses_created_by
    FOREIGN KEY (created_by) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE fixed_expenses
    ADD CONSTRAINT fk_fixed_expenses_updated_by
    FOREIGN KEY (updated_by) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE expenses
    ADD CONSTRAINT fk_expenses_fixed_expense
    FOREIGN KEY (fixed_expense_id) REFERENCES fixed_expenses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  ALTER TABLE fixed_expenses ALTER COLUMN business_id SET NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_fixed_expenses_business_id ON fixed_expenses(business_id);
  CREATE INDEX IF NOT EXISTS idx_fixed_expenses_is_active ON fixed_expenses(is_active);
  CREATE INDEX IF NOT EXISTS idx_fixed_expenses_due_day ON fixed_expenses(due_day);

  -- =========================================================
  -- Recovery: support and audit
  -- =========================================================

  CREATE TABLE IF NOT EXISTS support_access_logs (
    id SERIAL PRIMARY KEY,
    actor_user_id INTEGER NOT NULL,
    target_user_id INTEGER NOT NULL,
    business_id INTEGER,
    target_business_id INTEGER,
    reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE support_access_logs ADD COLUMN IF NOT EXISTS business_id INTEGER;
  ALTER TABLE support_access_logs ADD COLUMN IF NOT EXISTS target_business_id INTEGER;
  ALTER TABLE support_access_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE support_access_logs
  SET business_id = COALESCE(support_access_logs.business_id, actor.business_id, target.business_id, (SELECT id FROM
  seed)),
      target_business_id = COALESCE(support_access_logs.target_business_id, target.business_id, (SELECT id FROM seed))
  FROM users actor, users target
  WHERE actor.id = support_access_logs.actor_user_id
    AND target.id = support_access_logs.target_user_id
    AND (
      support_access_logs.business_id IS NULL
      OR support_access_logs.target_business_id IS NULL
    );

  UPDATE support_access_logs
  SET business_id = (
        SELECT id
        FROM businesses
        WHERE slug = 'default'
        LIMIT 1
      ),
      target_business_id = (
        SELECT id
        FROM businesses
        WHERE slug = 'default'
        LIMIT 1
      )
  WHERE business_id IS NULL OR target_business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE support_access_logs
    ADD CONSTRAINT fk_support_access_logs_actor
    FOREIGN KEY (actor_user_id) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE support_access_logs
    ADD CONSTRAINT fk_support_access_logs_target
    FOREIGN KEY (target_user_id) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE support_access_logs
    ADD CONSTRAINT fk_support_access_logs_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE support_access_logs
    ADD CONSTRAINT fk_support_access_logs_target_business
    FOREIGN KEY (target_business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  ALTER TABLE support_access_logs ALTER COLUMN business_id SET NOT NULL;
  ALTER TABLE support_access_logs ALTER COLUMN target_business_id SET NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_support_access_logs_business_id ON support_access_logs(business_id);
  CREATE INDEX IF NOT EXISTS idx_support_access_logs_actor ON support_access_logs(actor_user_id);
  CREATE INDEX IF NOT EXISTS idx_support_access_logs_target_user_id ON support_access_logs(target_user_id);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    business_id INTEGER,
    usuario_id INTEGER,
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

  ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS business_id INTEGER;
  ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS detalle_anterior JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS detalle_nuevo JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS motivo TEXT NOT NULL DEFAULT '';
  ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE audit_logs
  SET business_id = COALESCE(business_id, (SELECT id FROM seed))
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE audit_logs
    ADD CONSTRAINT fk_audit_logs_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE audit_logs
    ADD CONSTRAINT fk_audit_logs_usuario_id
    FOREIGN KEY (usuario_id) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  ALTER TABLE audit_logs ALTER COLUMN business_id SET NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_audit_logs_business_id ON audit_logs(business_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_usuario_id ON audit_logs(usuario_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_modulo ON audit_logs(modulo);

  -- =========================================================
  -- Recovery: import/sync/reporting auxiliary tables
  -- =========================================================

  CREATE TABLE IF NOT EXISTS import_jobs (
    id SERIAL PRIMARY KEY,
    job_type VARCHAR(40) NOT NULL,
    source_name VARCHAR(140) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by INTEGER,
    business_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS business_id INTEGER;
  ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'import_jobs_job_type_check'
        AND conrelid = 'import_jobs'::regclass
    ) THEN
      ALTER TABLE import_jobs
      ADD CONSTRAINT import_jobs_job_type_check
      CHECK (job_type IN ('google_sheets', 'excel', 'n8n_sync'));
    END IF;
  END $$;

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE import_jobs
  SET business_id = COALESCE(import_jobs.business_id, users.business_id, (SELECT id FROM seed))
  FROM users
  WHERE users.id = import_jobs.created_by
    AND import_jobs.business_id IS NULL;

  UPDATE import_jobs
  SET business_id = (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE import_jobs
    ADD CONSTRAINT fk_import_jobs_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE import_jobs
    ADD CONSTRAINT fk_import_jobs_created_by
    FOREIGN KEY (created_by) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  ALTER TABLE import_jobs ALTER COLUMN business_id SET NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_import_jobs_business_id ON import_jobs(business_id);
  CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);
  CREATE INDEX IF NOT EXISTS idx_import_jobs_created_by ON import_jobs(created_by);

  CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(120),
    phone VARCHAR(40),
    tax_id VARCHAR(60),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    business_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE clients ADD COLUMN IF NOT EXISTS business_id INTEGER;

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE clients
  SET business_id = (SELECT id FROM seed)
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE clients
    ADD CONSTRAINT fk_clients_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  ALTER TABLE clients ALTER COLUMN business_id SET NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_clients_business_id ON clients(business_id);
  CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);

  CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    report_type VARCHAR(60) NOT NULL,
    report_date DATE NOT NULL DEFAULT CURRENT_DATE,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by INTEGER,
    business_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE reports ADD COLUMN IF NOT EXISTS business_id INTEGER;

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE reports
  SET business_id = COALESCE(reports.business_id, users.business_id, (SELECT id FROM seed))
  FROM users
  WHERE users.id = reports.created_by
    AND reports.business_id IS NULL;

  UPDATE reports
  SET business_id = (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE reports
    ADD CONSTRAINT fk_reports_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$
  BEGIN
    ALTER TABLE reports
    ADD CONSTRAINT fk_reports_created_by
    FOREIGN KEY (created_by) REFERENCES users(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  ALTER TABLE reports ALTER COLUMN business_id SET NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_reports_business_id ON reports(business_id);
  CREATE INDEX IF NOT EXISTS idx_reports_report_date ON reports(report_date);

  CREATE TABLE IF NOT EXISTS sync_logs (
    id SERIAL PRIMARY KEY,
    provider VARCHAR(40) NOT NULL,
    direction VARCHAR(20) NOT NULL DEFAULT 'outbound',
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    response JSONB NOT NULL DEFAULT '{}'::jsonb,
    business_id INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

  ALTER TABLE sync_logs ADD COLUMN IF NOT EXISTS business_id INTEGER;

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'sync_logs_provider_check'
        AND conrelid = 'sync_logs'::regclass
    ) THEN
      ALTER TABLE sync_logs
      ADD CONSTRAINT sync_logs_provider_check
      CHECK (provider IN ('google_sheets', 'excel', 'n8n'));
    END IF;
  END $$;

  WITH seed AS (
    SELECT id
    FROM businesses
    WHERE slug = 'default'
    LIMIT 1
  )
  UPDATE sync_logs
  SET business_id = (SELECT id FROM seed)
  WHERE business_id IS NULL;

  DO $$
  BEGIN
    ALTER TABLE sync_logs
    ADD CONSTRAINT fk_sync_logs_business
    FOREIGN KEY (business_id) REFERENCES businesses(id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  ALTER TABLE sync_logs ALTER COLUMN business_id SET NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_sync_logs_business_id ON sync_logs(business_id);
  CREATE INDEX IF NOT EXISTS idx_sync_logs_status ON sync_logs(status);

  -- =========================================================
  -- Recovery: support users by business
  -- =========================================================

  INSERT INTO users (
    username,
    email,
    full_name,
    password_hash,
    role,
    pos_type,
    business_id,
    is_active,
    must_change_password,
    password_changed_at
  )
  SELECT
    'soporte_' || businesses.slug,
    'soporte+' || businesses.slug || '@ankode.local',
    'Soporte ' || businesses.name,
    encode(gen_random_bytes(32), 'hex'),
    'soporte',
    COALESCE(NULLIF(TRIM(businesses.pos_type), ''), 'Otro'),
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

  UPDATE businesses
  SET pos_type = source.pos_type,
      updated_at = NOW()
  FROM (
    SELECT business_id, MAX(pos_type) AS pos_type
    FROM users
    WHERE pos_type IN ('Tlapaleria', 'Tienda', 'Farmacia', 'Veterinaria', 'Papeleria', 'Otro')
    GROUP BY business_id
  ) AS source
  WHERE businesses.id = source.business_id;

  COMMIT;

  -- =========================================================
  -- Validaciones post-migracion
  -- =========================================================

  SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN (
      'businesses',
      'users',
      'suppliers',
      'products',
      'product_suppliers',
      'sales',
      'sale_items',
      'credit_payments',
      'administrative_invoices',
      'company_profiles',
      'company_stamp_movements',
      'daily_cuts',
      'expenses',
      'owner_loans',
      'fixed_expenses',
      'reminders',
      'support_access_logs',
      'audit_logs',
      'clients',
      'reports',
      'sync_logs',
      'import_jobs'
    )
  ORDER BY table_name, ordinal_position;

  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'businesses',
      'users',
      'suppliers',
      'products',
      'product_suppliers',
      'sales',
      'sale_items',
      'credit_payments',
      'administrative_invoices',
      'company_profiles',
      'company_stamp_movements',
      'daily_cuts',
      'expenses',
      'owner_loans',
      'fixed_expenses',
      'reminders',
      'support_access_logs',
      'audit_logs',
      'clients',
      'reports',
      'sync_logs',
      'import_jobs'
    )
  ORDER BY table_name;

  SELECT schemaname, tablename, indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename IN (
      'users',
      'suppliers',
      'products',
      'product_suppliers',
      'sales',
      'sale_items',
      'credit_payments',
      'administrative_invoices',
      'company_profiles',
      'company_stamp_movements',
      'daily_cuts',
      'expenses',
      'owner_loans',
      'fixed_expenses',
      'reminders',
      'support_access_logs',
      'audit_logs',
      'clients',
      'reports',
      'sync_logs',
      'import_jobs'
    )
  ORDER BY tablename, indexname;

  SELECT
    conrelid::regclass AS table_name,
    conname AS constraint_name,
    pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
  WHERE conrelid::regclass::text IN (
    'users',
    'suppliers',
    'products',
    'product_suppliers',
    'sales',
    'sale_items',
    'credit_payments',
    'administrative_invoices',
    'company_profiles',
    'company_stamp_movements',
    'daily_cuts',
    'expenses',
    'owner_loans',
    'fixed_expenses',
    'reminders',
    'support_access_logs',
    'audit_logs',
    'clients',
    'reports',
    'sync_logs',
    'import_jobs',
    'businesses'
  )
  ORDER BY conrelid::regclass::text, conname;

  SELECT
    COUNT(*) FILTER (WHERE business_id IS NULL) AS users_without_business
  FROM users;

  SELECT
    COUNT(*) FILTER (WHERE business_id IS NULL) AS products_without_business
  FROM products;

  SELECT
    COUNT(*) FILTER (WHERE business_id IS NULL) AS sales_without_business
  FROM sales;

  SELECT
    COUNT(*) FILTER (WHERE business_id IS NULL) AS reminders_without_business
  FROM reminders;

  SELECT
    COUNT(*) FILTER (WHERE administrative_invoice_id IS NOT NULL) AS sales_linked_to_admin_invoice,
    COUNT(*) FILTER (WHERE requires_administrative_invoice IS TRUE) AS sales_marked_admin_invoice
  FROM sales;