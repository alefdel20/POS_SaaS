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
    CREATE TABLE IF NOT EXISTS support_access_logs (
      id SERIAL PRIMARY KEY,
      actor_user_id INTEGER NOT NULL REFERENCES users(id),
      target_user_id INTEGER NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_suppliers_name_lower ON suppliers ((LOWER(name)))");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_products_supplier_id ON products(supplier_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_products_status ON products(status)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_owner_loans_date ON owner_loans(date)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_support_access_logs_actor ON support_access_logs(actor_user_id)");
}

module.exports = {
  ensureDatabaseCompatibility
};
