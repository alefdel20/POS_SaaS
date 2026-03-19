const pool = require("./pool");

async function ensureDatabaseCompatibility() {
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS pos_type VARCHAR(40) NOT NULL DEFAULT 'Otro'");
  await pool.query("UPDATE users SET role = 'superusuario' WHERE role = 'superadmin'");
  await pool.query("UPDATE users SET role = 'cajero' WHERE role IN ('user', 'cashier')");
  await pool.query(`
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
    END $$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_role_check'
          AND conrelid = 'users'::regclass
      ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_role_check CHECK (role IN ('superusuario', 'admin', 'cajero', 'soporte'));
      END IF;
    END $$;
  `);
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_by INTEGER REFERENCES users(id)");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_at TIMESTAMP");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_active BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_activated_at TIMESTAMP");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_deactivated_at TIMESTAMP");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_updated_by INTEGER REFERENCES users(id)");

  await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id)");
  await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'activo'");
  await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20)");
  await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12, 2)");
  await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_start TIMESTAMP");
  await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_end TIMESTAMP");
  await pool.query("UPDATE products SET status = 'activo' WHERE status IS NULL");
  await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS send_reminder BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(120)");
  await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS liquidation_price NUMERIC(12, 2)");
  await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS expires_at DATE");
  await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_minimo NUMERIC(12, 2) NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_name VARCHAR(150)");
  await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(40)");
  await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS initial_payment NUMERIC(12, 2) NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS balance_due NUMERIC(12, 2) NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS invoice_data JSONB NOT NULL DEFAULT '{}'::jsonb");
  await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS credit_payments (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
      amount NUMERIC(12, 2) NOT NULL,
      payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash', 'card', 'credit', 'transfer')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      concept VARCHAR(180) NOT NULL,
      category VARCHAR(120) NOT NULL DEFAULT 'General',
      amount NUMERIC(12, 2) NOT NULL,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      notes TEXT NOT NULL DEFAULT '',
      payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS owner_loans (
      id SERIAL PRIMARY KEY,
      amount NUMERIC(12, 2) NOT NULL,
      type VARCHAR(20) NOT NULL CHECK (type IN ('entrada', 'abono')),
      balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
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
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_access_logs (
      id SERIAL PRIMARY KEY,
      actor_user_id INTEGER NOT NULL REFERENCES users(id),
      target_user_id INTEGER NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
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
    )
  `);
  await pool.query(`
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
    )
  `);
  await pool.query(`
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
    )
  `);
  await pool.query(`
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
  `);
  await pool.query(`
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
  `);
  await pool.query(`
    INSERT INTO company_profiles (profile_key, general_settings, is_active)
    SELECT 'default', '{}'::jsonb, TRUE
    WHERE NOT EXISTS (
      SELECT 1
      FROM company_profiles
      WHERE profile_key = 'default'
    )
  `);
  await pool.query("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fixed_expense_id INTEGER REFERENCES fixed_expenses(id)");
  await pool.query("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP");
  await pool.query("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES users(id)");
  await pool.query("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS void_reason TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()");
  await pool.query("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id)");
  await pool.query("ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP");
  await pool.query("ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES users(id)");
  await pool.query("ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS void_reason TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()");
  await pool.query("ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id)");
  await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS company_profile_id INTEGER REFERENCES company_profiles(id)");
  await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS transfer_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb");
  await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS invoice_status VARCHAR(30) NOT NULL DEFAULT 'not_requested'");
  await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS stamp_status VARCHAR(30) NOT NULL DEFAULT 'not_applicable'");
  await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS stamp_movement_id BIGINT REFERENCES company_stamp_movements(id)");
  await pool.query("ALTER TABLE sales ADD COLUMN IF NOT EXISTS stamp_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_suppliers_name_lower ON suppliers ((LOWER(name)))");
  await pool.query("ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(40)");
  await pool.query("ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS observations TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_products_supplier_id ON products(supplier_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_products_status ON products(status)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_products_stock_minimo ON products(stock_minimo)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales(sale_date)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_sales_user_id ON sales(user_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_sales_payment_method ON sales(payment_method)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_sales_stamp_status ON sales(stamp_status)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_expenses_is_voided ON expenses(is_voided)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_expenses_fixed_expense_id ON expenses(fixed_expense_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_fixed_expenses_is_active ON fixed_expenses(is_active)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_owner_loans_date ON owner_loans(date)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_owner_loans_is_voided ON owner_loans(is_voided)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_support_access_logs_actor ON support_access_logs(actor_user_id)");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS uq_company_profiles_profile_key ON company_profiles(profile_key)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_audit_logs_usuario_id ON audit_logs(usuario_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_audit_logs_modulo ON audit_logs(modulo)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_company_stamp_movements_profile ON company_stamp_movements(company_profile_id)");
  await pool.query("ALTER TABLE reminders ADD COLUMN IF NOT EXISTS source_key VARCHAR(160)");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS uq_reminders_source_key ON reminders(source_key) WHERE source_key IS NOT NULL");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_suppliers (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(product_id, supplier_id)
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_product_suppliers_product_id ON product_suppliers(product_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_product_suppliers_supplier_id ON product_suppliers(supplier_id)");
  await pool.query(`
    INSERT INTO product_suppliers (product_id, supplier_id, is_primary)
    SELECT id, supplier_id, TRUE
    FROM products
    WHERE supplier_id IS NOT NULL
    ON CONFLICT (product_id, supplier_id) DO NOTHING
  `);
}

module.exports = {
  ensureDatabaseCompatibility
};
