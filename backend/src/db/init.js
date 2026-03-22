const crypto = require("crypto");
const pool = require("./pool");

const POS_TYPES = ["Tlapaleria", "Tienda", "Farmacia", "Veterinaria", "Papeleria", "Otro"];
const SEED_BUSINESS = { name: "Negocio Semilla", slug: "default" };

async function run(client, statements) {
  for (const statement of statements) {
    await client.query(statement);
  }
}

async function ensureSchema(client) {
  await run(client, [
    `CREATE TABLE IF NOT EXISTS businesses (
      id SERIAL PRIMARY KEY,
      name VARCHAR(180) NOT NULL UNIQUE,
      slug VARCHAR(80) NOT NULL UNIQUE,
      pos_type VARCHAR(40) NOT NULL CHECK (pos_type IN ('Tlapaleria', 'Tienda', 'Farmacia', 'Veterinaria', 'Papeleria', 'Otro')),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE businesses ADD COLUMN IF NOT EXISTS business_type VARCHAR(80)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS pos_type VARCHAR(40) NOT NULL DEFAULT 'Otro'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_by INTEGER REFERENCES users(id)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_at TIMESTAMP",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_active BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_activated_at TIMESTAMP",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_deactivated_at TIMESTAMP",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_updated_by INTEGER REFERENCES users(id)",

    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(40)",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS observations TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",

    "ALTER TABLE products ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'activo'",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(120)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12, 2)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_start TIMESTAMP",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_end TIMESTAMP",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS liquidation_price NUMERIC(12, 2)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS expires_at DATE",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_minimo NUMERIC(12, 2) NOT NULL DEFAULT 0",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_maximo NUMERIC(12, 2)",

    `CREATE TABLE IF NOT EXISTS product_suppliers (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      purchase_cost NUMERIC(12, 2),
      cost_updated_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(product_id, supplier_id)
    )`,
    "ALTER TABLE product_suppliers ADD COLUMN IF NOT EXISTS business_id INTEGER",

    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS send_reminder BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_name VARCHAR(150)",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(40)",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS initial_payment NUMERIC(12, 2) NOT NULL DEFAULT 0",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS balance_due NUMERIC(12, 2) NOT NULL DEFAULT 0",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS invoice_data JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS company_profile_id INTEGER",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS transfer_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS invoice_status VARCHAR(30) NOT NULL DEFAULT 'not_requested'",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS stamp_status VARCHAR(30) NOT NULL DEFAULT 'not_applicable'",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS stamp_movement_id BIGINT",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS stamp_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb",

    "ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0",

    `CREATE TABLE IF NOT EXISTS credit_payments (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
      amount NUMERIC(12, 2) NOT NULL,
      payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash', 'card', 'credit', 'transfer')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE credit_payments ADD COLUMN IF NOT EXISTS business_id INTEGER",

    "ALTER TABLE daily_cuts ADD COLUMN IF NOT EXISTS business_id INTEGER",

    "ALTER TABLE reminders ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE reminders ADD COLUMN IF NOT EXISTS source_key VARCHAR(160)",

    `CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      concept VARCHAR(180) NOT NULL,
      category VARCHAR(120) NOT NULL DEFAULT 'General',
      amount NUMERIC(12, 2) NOT NULL,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      notes TEXT NOT NULL DEFAULT '',
      payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS fixed_expense_id INTEGER",
    "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP",
    "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES users(id)",
    "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS void_reason TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()",
    "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id)",

    `CREATE TABLE IF NOT EXISTS owner_loans (
      id SERIAL PRIMARY KEY,
      amount NUMERIC(12, 2) NOT NULL,
      type VARCHAR(20) NOT NULL CHECK (type IN ('entrada', 'abono')),
      balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP",
    "ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES users(id)",
    "ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS void_reason TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()",
    "ALTER TABLE owner_loans ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id)",

    `CREATE TABLE IF NOT EXISTS fixed_expenses (
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
    )`,
    "ALTER TABLE fixed_expenses ADD COLUMN IF NOT EXISTS business_id INTEGER",

    `CREATE TABLE IF NOT EXISTS support_access_logs (
      id SERIAL PRIMARY KEY,
      actor_user_id INTEGER NOT NULL REFERENCES users(id),
      target_user_id INTEGER NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE support_access_logs ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE support_access_logs ADD COLUMN IF NOT EXISTS target_business_id INTEGER",

    `CREATE TABLE IF NOT EXISTS audit_logs (
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
    )`,
    "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS business_id INTEGER",

    `CREATE TABLE IF NOT EXISTS company_profiles (
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
    )`,
    "ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS business_id INTEGER",

    `CREATE TABLE IF NOT EXISTS company_stamp_movements (
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
    )`,
    "ALTER TABLE company_stamp_movements ADD COLUMN IF NOT EXISTS business_id INTEGER",

    `CREATE TABLE IF NOT EXISTS import_jobs (
      id SERIAL PRIMARY KEY,
      job_type VARCHAR(40) NOT NULL CHECK (job_type IN ('google_sheets', 'excel', 'n8n_sync')),
      source_name VARCHAR(140) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      result JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS business_id INTEGER",

    `CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      email VARCHAR(120),
      phone VARCHAR(40),
      tax_id VARCHAR(60),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS business_id INTEGER",

    `CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      report_type VARCHAR(60) NOT NULL,
      report_date DATE NOT NULL DEFAULT CURRENT_DATE,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS business_id INTEGER",

    `CREATE TABLE IF NOT EXISTS sync_logs (
      id SERIAL PRIMARY KEY,
      provider VARCHAR(40) NOT NULL CHECK (provider IN ('google_sheets', 'excel', 'n8n')),
      direction VARCHAR(20) NOT NULL DEFAULT 'outbound',
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      response JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE sync_logs ADD COLUMN IF NOT EXISTS business_id INTEGER"
  ]);
}

async function ensureSeedBusiness(client) {
  await client.query("UPDATE users SET role = 'superusuario' WHERE role = 'superadmin'");
  await client.query("UPDATE users SET role = 'cajero' WHERE role IN ('user', 'cashier')");
  await client.query("UPDATE products SET status = 'activo' WHERE status IS NULL");
  await client.query("UPDATE products SET stock_maximo = GREATEST(COALESCE(stock, 0), COALESCE(stock_minimo, 0)) WHERE stock_maximo IS NULL");
  await client.query("ALTER TABLE products ALTER COLUMN stock_maximo SET DEFAULT 0");
  await client.query("UPDATE products SET stock_maximo = 0 WHERE stock_maximo IS NULL");
  await client.query("ALTER TABLE products ALTER COLUMN stock_maximo SET NOT NULL");
  await client.query("UPDATE products SET stock_maximo = stock_minimo WHERE stock_maximo < stock_minimo");
  await client.query("UPDATE businesses SET business_type = COALESCE(business_type, pos_type) WHERE business_type IS NULL");

  await client.query(
    `INSERT INTO businesses (name, slug, pos_type, is_active)
     SELECT $1::varchar, $2::varchar,
            COALESCE((
              SELECT pos_type
              FROM users
              WHERE pos_type = ANY($3::varchar[])
              GROUP BY pos_type
              ORDER BY COUNT(*) DESC, pos_type ASC
              LIMIT 1
            ), 'Otro'),
            TRUE
     WHERE NOT EXISTS (SELECT 1 FROM businesses WHERE slug = $2::varchar)`,
    [SEED_BUSINESS.name, SEED_BUSINESS.slug, POS_TYPES]
  );
}

async function backfillBusinessIds(client) {
  const { rows } = await client.query(
    "SELECT id FROM businesses WHERE slug = $1 LIMIT 1",
    [SEED_BUSINESS.slug]
  );

  const businessId = rows[0].id;

  await run(client, [
    `UPDATE users SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE suppliers SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE products SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE expenses SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE owner_loans SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE daily_cuts SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE company_profiles SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE clients SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE sync_logs SET business_id = ${businessId} WHERE business_id IS NULL`
  ]);

  await client.query(
    `UPDATE sales
     SET business_id = COALESCE(sales.business_id, users.business_id, $1)
     FROM users
     WHERE users.id = sales.user_id
       AND sales.business_id IS NULL`,
    [businessId]
  );

  await client.query(
    `UPDATE reminders
     SET business_id = COALESCE(
       reminders.business_id,
       (SELECT u.business_id FROM users u WHERE u.id = reminders.created_by),
       (SELECT u.business_id FROM users u WHERE u.id = reminders.assigned_to),
       $1
     )
     WHERE reminders.business_id IS NULL`,
    [businessId]
  );

  await client.query(
    `UPDATE fixed_expenses
     SET business_id = COALESCE(fixed_expenses.business_id, users.business_id, $1)
     FROM users
     WHERE users.id = fixed_expenses.created_by
       AND fixed_expenses.business_id IS NULL`,
    [businessId]
  );

  await client.query(
    `UPDATE product_suppliers
     SET business_id = COALESCE(product_suppliers.business_id, products.business_id, suppliers.business_id, $1)
     FROM products, suppliers
     WHERE products.id = product_suppliers.product_id
       AND suppliers.id = product_suppliers.supplier_id
       AND product_suppliers.business_id IS NULL`,
    [businessId]
  );

  await client.query(
    `UPDATE sale_items
     SET business_id = COALESCE(sale_items.business_id, sales.business_id, $1)
     FROM sales
     WHERE sales.id = sale_items.sale_id
       AND sale_items.business_id IS NULL`,
    [businessId]
  );

  await client.query(
    `UPDATE credit_payments
     SET business_id = COALESCE(credit_payments.business_id, sales.business_id, $1)
     FROM sales
     WHERE sales.id = credit_payments.sale_id
       AND credit_payments.business_id IS NULL`,
    [businessId]
  );

  await client.query(
    `UPDATE company_stamp_movements
     SET business_id = COALESCE(company_stamp_movements.business_id, company_profiles.business_id, $1)
     FROM company_profiles
     WHERE company_profiles.id = company_stamp_movements.company_profile_id
       AND company_stamp_movements.business_id IS NULL`,
    [businessId]
  );

  await client.query(
    `UPDATE support_access_logs
     SET business_id = COALESCE(support_access_logs.business_id, actor.business_id, target.business_id, $1),
         target_business_id = COALESCE(support_access_logs.target_business_id, target.business_id, $1)
     FROM users actor, users target
     WHERE actor.id = support_access_logs.actor_user_id
       AND target.id = support_access_logs.target_user_id
       AND (
         support_access_logs.business_id IS NULL
         OR support_access_logs.target_business_id IS NULL
       )`,
    [businessId]
  );

  // import_jobs backfill omitido temporalmente:
  // la base actual no garantiza que exista import_jobs.created_by

  await client.query(
    `UPDATE reports
     SET business_id = COALESCE(reports.business_id, users.business_id, $1)
     FROM users
     WHERE users.id = reports.created_by
       AND reports.business_id IS NULL`,
    [businessId]
  );

  await client.query(
    `INSERT INTO company_profiles (business_id, profile_key, general_settings, is_active)
     SELECT businesses.id, 'default', '{}'::jsonb, TRUE
     FROM businesses
     WHERE NOT EXISTS (
       SELECT 1
       FROM company_profiles
       WHERE company_profiles.business_id = businesses.id
         AND company_profiles.profile_key = 'default'
     )`
  );

  await client.query(
    `INSERT INTO product_suppliers (product_id, supplier_id, is_primary, purchase_cost, cost_updated_at, business_id)
     SELECT id, supplier_id, TRUE, cost_price, updated_at, business_id
     FROM products
     WHERE supplier_id IS NOT NULL
     ON CONFLICT (product_id, supplier_id) DO NOTHING`
  );

  await run(client, [
    `UPDATE reminders SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE fixed_expenses SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE reports SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE product_suppliers SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE sale_items SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE credit_payments SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE company_stamp_movements SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE support_access_logs
       SET business_id = ${businessId}, target_business_id = ${businessId}
     WHERE business_id IS NULL OR target_business_id IS NULL`,
    `SELECT 1`
  ]);
}

async function ensureConstraints(client) {
  await run(client, [
    "ALTER TABLE daily_cuts DROP CONSTRAINT IF EXISTS daily_cuts_cut_date_key",
    "ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key",
    "ALTER TABLE products DROP CONSTRAINT IF EXISTS products_barcode_key",
    "ALTER TABLE company_profiles DROP CONSTRAINT IF EXISTS uq_company_profiles_profile_key",
    "DROP INDEX IF EXISTS uq_company_profiles_profile_key",
    "DROP INDEX IF EXISTS uq_reminders_source_key"
  ]);

  await client.query("ALTER TABLE sales DROP CONSTRAINT IF EXISTS fk_sales_stamp_movement");
  await client
    .query("ALTER TABLE sales ADD CONSTRAINT fk_sales_stamp_movement FOREIGN KEY (stamp_movement_id) REFERENCES company_stamp_movements(id)")
    .catch(() => {});

  const fks = [
    "users",
    "suppliers",
    "products",
    "product_suppliers",
    "sales",
    "sale_items",
    "credit_payments",
    "daily_cuts",
    "reminders",
    "expenses",
    "owner_loans",
    "fixed_expenses",
    "company_profiles",
    "company_stamp_movements"
  ];

  for (const table of fks) {
    await client.query(`ALTER TABLE ${table} ALTER COLUMN business_id SET NOT NULL`).catch(() => {});
    await client.query(`ALTER TABLE ${table} ADD CONSTRAINT fk_${table}_business FOREIGN KEY (business_id) REFERENCES businesses(id)`).catch(() => {});
  }

  await client.query("ALTER TABLE support_access_logs ALTER COLUMN business_id SET NOT NULL").catch(() => {});
  await client.query("ALTER TABLE support_access_logs ALTER COLUMN target_business_id SET NOT NULL").catch(() => {});
  await client.query("ALTER TABLE support_access_logs ADD CONSTRAINT fk_support_access_logs_business FOREIGN KEY (business_id) REFERENCES businesses(id)").catch(() => {});
  await client.query("ALTER TABLE support_access_logs ADD CONSTRAINT fk_support_access_logs_target_business FOREIGN KEY (target_business_id) REFERENCES businesses(id)").catch(() => {});

  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'businesses_pos_type_check'
          AND conrelid = 'businesses'::regclass
      ) THEN
        ALTER TABLE businesses DROP CONSTRAINT businesses_pos_type_check;
      END IF;

      ALTER TABLE businesses
      ADD CONSTRAINT businesses_pos_type_check CHECK (pos_type IN ('Tlapaleria', 'Tienda', 'Farmacia', 'Veterinaria', 'Papeleria', 'Otro'));

      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_role_check'
          AND conrelid = 'users'::regclass
      ) THEN
        ALTER TABLE users DROP CONSTRAINT users_role_check;
      END IF;

      ALTER TABLE users
      ADD CONSTRAINT users_role_check CHECK (role IN ('superusuario', 'admin', 'cajero', 'soporte'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await client.query(`
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

  await run(client, [
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_company_profiles_business_profile_key ON company_profiles(business_id, profile_key)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_cuts_business_cut_date ON daily_cuts(business_id, cut_date)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_products_business_sku ON products(business_id, UPPER(sku)) WHERE sku IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_products_business_barcode ON products(business_id, UPPER(barcode)) WHERE barcode IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_reminders_business_source_key ON reminders(business_id, source_key) WHERE source_key IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_users_business_id ON users(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_suppliers_business_id ON suppliers(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_products_business_id ON products(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_product_suppliers_business_id ON product_suppliers(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_sales_business_id ON sales(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_sale_items_business_id ON sale_items(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_credit_payments_business_id ON credit_payments(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_daily_cuts_business_id ON daily_cuts(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_reminders_business_id ON reminders(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_expenses_business_id ON expenses(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_owner_loans_business_id ON owner_loans(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_fixed_expenses_business_id ON fixed_expenses(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_company_profiles_business_id ON company_profiles(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_company_stamp_movements_business_id ON company_stamp_movements(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_support_access_logs_business_id ON support_access_logs(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_support_access_logs_actor ON support_access_logs(actor_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_audit_logs_usuario_id ON audit_logs(usuario_id)",
    "CREATE INDEX IF NOT EXISTS idx_audit_logs_modulo ON audit_logs(modulo)",
    "CREATE INDEX IF NOT EXISTS idx_suppliers_name_lower ON suppliers ((LOWER(name)))",
    "CREATE INDEX IF NOT EXISTS idx_products_supplier_id ON products(supplier_id)",
    "CREATE INDEX IF NOT EXISTS idx_product_suppliers_product_id ON product_suppliers(product_id)",
    "CREATE INDEX IF NOT EXISTS idx_product_suppliers_supplier_id ON product_suppliers(supplier_id)",
    "CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales(sale_date)",
    "CREATE INDEX IF NOT EXISTS idx_sales_user_id ON sales(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_credit_payments_sale_id ON credit_payments(sale_id)",
    "CREATE INDEX IF NOT EXISTS idx_reminders_due_date ON reminders(due_date)"
  ]);
}

async function ensureSupportUsers(client) {
  const { rows } = await client.query(
    `SELECT id, slug, name, pos_type
     FROM businesses
     WHERE NOT EXISTS (
       SELECT 1
       FROM users
       WHERE users.business_id = businesses.id
         AND users.role = 'soporte'
     )`
  );

  for (const business of rows) {
    await client.query(
      `INSERT INTO users (
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
      ) VALUES ($1, $2, $3, $4, 'soporte', $5, $6, TRUE, TRUE, NOW())`,
      [
        `soporte_${business.slug}`,
        `soporte+${business.slug}@ankode.local`,
        `Soporte ${business.name}`,
        crypto.randomBytes(16).toString("hex"),
        business.pos_type || "Otro",
        business.id
      ]
    );
  }

  await client.query(
    `UPDATE businesses
     SET pos_type = source.pos_type,
         updated_at = NOW()
     FROM (
       SELECT business_id, MAX(pos_type) AS pos_type
       FROM users
       WHERE pos_type = ANY($1::text[])
       GROUP BY business_id
     ) AS source
     WHERE businesses.id = source.business_id`,
    [POS_TYPES]
  );
}

async function ensureDatabaseCompatibility() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensureSchema(client);
    await ensureSeedBusiness(client);
    await backfillBusinessIds(client);
    await ensureConstraints(client);
    await ensureSupportUsers(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { ensureDatabaseCompatibility };
