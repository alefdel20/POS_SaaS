const crypto = require("crypto");
const pool = require("./pool");

const POS_TYPES = ["Tlapaleria", "Tienda", "Farmacia", "Veterinaria", "Papeleria", "Dentista", "FarmaciaConsultorio", "ClinicaChica", "Otro", "Restaurante"];
const SEED_BUSINESS = { name: "Negocio Semilla", slug: "default" };
const INIT_VERSION_MARKER = "=== DB INIT VERSION 2026-04-01 FIX 3 ===";

function summarizeQuery(statement) {
  return String(statement || "").replace(/\s+/g, " ").trim();
}

async function execQuery(client, statement, params) {
  const sql = summarizeQuery(statement);
  console.info(`[DB-COMPAT] Executing query: ${sql}`);

  try {
    if (params === undefined) {
      return await client.query(statement);
    }
    return await client.query(statement, params);
  } catch (error) {
    console.error(`[DB-COMPAT] Failed query: ${sql}`);
    if (params !== undefined) {
      console.error("[DB-COMPAT] Query params:", params);
    }
    console.error("[DB-COMPAT] Original error:", error);
    throw error;
  }
}

async function run(client, statements) {
  for (const statement of statements) {
    await execQuery(client, statement);
  }
}

async function ensureSchema(client) {
  await run(client, [
    "CREATE EXTENSION IF NOT EXISTS pgcrypto",
    `CREATE TABLE IF NOT EXISTS businesses (
      id SERIAL PRIMARY KEY,
      name VARCHAR(180) NOT NULL UNIQUE,
      slug VARCHAR(80) NOT NULL UNIQUE,
      pos_type VARCHAR(40) NOT NULL CHECK (pos_type IN ('Tlapaleria', 'Tienda', 'Farmacia', 'Veterinaria', 'Papeleria', 'Dentista', 'FarmaciaConsultorio', 'ClinicaChica', 'Otro')),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE businesses ADD COLUMN IF NOT EXISTS business_type VARCHAR(80)",
    "ALTER TABLE businesses ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE",
    `CREATE TABLE IF NOT EXISTS branches (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      pos_type VARCHAR(100) NOT NULL,
      address TEXT,
      phone VARCHAR(50),
      is_active BOOLEAN DEFAULT TRUE,
      is_default BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS branches_business_default
     ON branches(business_id) WHERE is_default = TRUE`,
    `CREATE TABLE IF NOT EXISTS business_subscriptions (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
      plan_type VARCHAR(20),
      billing_anchor_date DATE,
      next_payment_date DATE,
      last_payment_date DATE,
      last_payment_note TEXT NOT NULL DEFAULT '',
      grace_period_days INTEGER NOT NULL DEFAULT 0,
      enforcement_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      manual_adjustment_reason TEXT NOT NULL DEFAULT '',
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS initial_catalog_seed_runs (
      business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
      seed_version VARCHAR(40) NOT NULL,
      catalog_key VARCHAR(80),
      inserted_count INTEGER NOT NULL DEFAULT 0,
      skipped_existing_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      seeded_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS last_payment_date DATE",
    "ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS last_payment_note TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS openpay_customer_id VARCHAR(100) DEFAULT NULL",
    "ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS openpay_plan_id VARCHAR(100) DEFAULT NULL",
    "ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS openpay_subscription_id VARCHAR(100) DEFAULT NULL",
    "ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(20) NOT NULL DEFAULT 'manual'",
    "ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS subscription_amount NUMERIC(10,2) DEFAULT NULL",
    "ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS subscription_currency VARCHAR(3) NOT NULL DEFAULT 'MXN'",
    "ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS plan_name VARCHAR(50) DEFAULT NULL",
    "ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS extra_branches_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP DEFAULT NULL",
    "ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS cancellation_reason TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) NOT NULL DEFAULT 'active'",
    "ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP DEFAULT NULL",
    "ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMP DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS pos_type VARCHAR(40) NOT NULL DEFAULT 'Otro'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(40)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS professional_license VARCHAR(80)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS specialty VARCHAR(120)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS medical_specialty VARCHAR(120)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(20) NOT NULL DEFAULT 'dark'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_by INTEGER REFERENCES users(id)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_at TIMESTAMP",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_active BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_activated_at TIMESTAMP",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_deactivated_at TIMESTAMP",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS support_mode_updated_by INTEGER REFERENCES users(id)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS tutorial_seen BOOLEAN NOT NULL DEFAULT FALSE",

    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(40)",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS observations TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",

    "ALTER TABLE products ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'activo'",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS category VARCHAR(120)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS catalog_type VARCHAR(20)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12, 2)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_start TIMESTAMP",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_end TIMESTAMP",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS liquidation_price NUMERIC(12, 2)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS expires_at DATE",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_minimo NUMERIC(12, 3) NOT NULL DEFAULT 0",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_maximo NUMERIC(12, 3)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS unidad_de_venta VARCHAR(20)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS porcentaje_ganancia NUMERIC(7, 3)",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS image_path TEXT",
    "ALTER TABLE products ALTER COLUMN price TYPE NUMERIC(12, 5)",
    "ALTER TABLE products ALTER COLUMN cost_price TYPE NUMERIC(12, 5)",
    "ALTER TABLE products ALTER COLUMN liquidation_price TYPE NUMERIC(12, 5)",
    "ALTER TABLE products ALTER COLUMN stock TYPE NUMERIC(12, 3)",
    "ALTER TABLE products ALTER COLUMN stock_minimo TYPE NUMERIC(12, 3)",
    "ALTER TABLE products ALTER COLUMN stock_maximo TYPE NUMERIC(12, 3)",
    `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_id_business_id_unique'
          AND conrelid = 'products'::regclass
      ) THEN
        ALTER TABLE products
        ADD CONSTRAINT products_id_business_id_unique
        UNIQUE (id, business_id);
      END IF;
    END $$;
    `,

    // === KITS / COMBOS ===
    `CREATE TABLE IF NOT EXISTS product_kits (
      id           SERIAL NOT NULL,
      business_id  INTEGER NOT NULL REFERENCES businesses(id),
      sku          VARCHAR(100),
      name         VARCHAR(255) NOT NULL,
      description  TEXT,
      price_mode   VARCHAR(20) NOT NULL DEFAULT 'fixed',
      fixed_price  NUMERIC(12,2),
      discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
      active       BOOLEAN NOT NULL DEFAULT TRUE,
      created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (id, business_id),
      UNIQUE (sku, business_id),
      CHECK (price_mode IN ('fixed', 'calculated')),
      CHECK (fixed_price IS NOT NULL OR price_mode = 'calculated'),
      CHECK (discount_pct >= 0 AND discount_pct <= 100)
    )`,

    `CREATE TABLE IF NOT EXISTS product_kit_items (
      id          SERIAL PRIMARY KEY,
      kit_id      INTEGER NOT NULL,
      business_id INTEGER NOT NULL,
      product_id  INTEGER NOT NULL,
      quantity    NUMERIC(12,4) NOT NULL DEFAULT 1,
      CHECK (quantity > 0),
      FOREIGN KEY (kit_id, business_id) REFERENCES product_kits(id, business_id),
      FOREIGN KEY (product_id, business_id) REFERENCES products(id, business_id),
      UNIQUE (kit_id, product_id, business_id)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_product_kit_items_kit_business ON product_kit_items(kit_id, business_id)",

    `CREATE TABLE IF NOT EXISTS product_categories (
      id SERIAL PRIMARY KEY,
      business_id INTEGER,
      name VARCHAR(120) NOT NULL,
      source VARCHAR(30) NOT NULL DEFAULT 'manual',
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS services (
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
    )`,

    `CREATE TABLE IF NOT EXISTS supplier_catalog_items (
      id BIGSERIAL PRIMARY KEY,
      business_id INTEGER,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id),
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
    )`,

    `CREATE TABLE IF NOT EXISTS product_suppliers (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      purchase_cost NUMERIC(12, 5),
      cost_updated_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(product_id, supplier_id)
    )`,
    "ALTER TABLE product_suppliers ADD COLUMN IF NOT EXISTS business_id INTEGER",

    `CREATE TABLE IF NOT EXISTS product_update_requests (
      id BIGSERIAL PRIMARY KEY,
      business_id INTEGER,
      product_id INTEGER NOT NULL REFERENCES products(id),
      requested_by_user_id INTEGER NOT NULL REFERENCES users(id),
      reviewed_by_user_id INTEGER REFERENCES users(id),
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      reason TEXT NOT NULL DEFAULT '',
      current_price_snapshot NUMERIC(12, 5) NOT NULL,
      requested_price NUMERIC(12, 5),
      current_stock_snapshot NUMERIC(12, 3) NOT NULL,
      requested_stock NUMERIC(12, 3),
      review_note TEXT NOT NULL DEFAULT '',
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS product_id INTEGER",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS requested_by_user_id INTEGER",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS requested_by INTEGER",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS reviewed_by_user_id INTEGER",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS reviewed_by INTEGER",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending'",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS current_price_snapshot NUMERIC(12, 5)",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS requested_price NUMERIC(12, 5)",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS current_stock_snapshot NUMERIC(12, 3)",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS requested_stock NUMERIC(12, 3)",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS request_type VARCHAR(30) NOT NULL DEFAULT 'update'",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS old_values JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS new_values JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS before_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS after_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()",
    "ALTER TABLE product_update_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()",

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
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS requires_administrative_invoice BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS administrative_invoice_id BIGINT",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS status VARCHAR(20)",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancellation_reason TEXT",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancelled_by INTEGER REFERENCES users(id)",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP",
    "ALTER TABLE sales ALTER COLUMN subtotal TYPE NUMERIC(14, 5)",
    "ALTER TABLE sales ALTER COLUMN total TYPE NUMERIC(14, 5)",
    "ALTER TABLE sales ALTER COLUMN total_cost TYPE NUMERIC(14, 5)",
    "ALTER TABLE sales ALTER COLUMN initial_payment TYPE NUMERIC(14, 5)",
    "ALTER TABLE sales ALTER COLUMN balance_due TYPE NUMERIC(14, 5)",

    "ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0",
    "ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unidad_de_venta VARCHAR(20)",
    "ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS product_name_snapshot VARCHAR(200) NOT NULL DEFAULT ''",
    "ALTER TABLE sale_items ALTER COLUMN unit_price TYPE NUMERIC(12, 5)",
    "ALTER TABLE sale_items ALTER COLUMN unit_cost TYPE NUMERIC(12, 5)",
    "ALTER TABLE sale_items ALTER COLUMN subtotal TYPE NUMERIC(14, 5)",
    "ALTER TABLE sale_items ALTER COLUMN quantity TYPE NUMERIC(12, 3)",
    // kit_id y product_id son mutuamente excluyentes: cuando se vende un kit, kit_id apunta al kit y product_id es NULL
    "ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS kit_id INTEGER",

    `CREATE TABLE IF NOT EXISTS returns (
      id              SERIAL PRIMARY KEY,
      sale_id         INTEGER NOT NULL REFERENCES sales(id),
      business_id     INTEGER NOT NULL,
      return_date     DATE NOT NULL DEFAULT CURRENT_DATE,
      return_reason   TEXT NOT NULL,
      resolution_type VARCHAR(20) NOT NULL CHECK (resolution_type IN ('refund_cash', 'credit_note', 'exchange')),
      total_returned  NUMERIC(14,5) NOT NULL DEFAULT 0,
      status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      initiated_by    INTEGER NOT NULL REFERENCES users(id),
      authorized_by   INTEGER REFERENCES users(id),
      authorized_at   TIMESTAMP,
      notes           TEXT,
      created_at      TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS return_items (
      id                SERIAL PRIMARY KEY,
      return_id         INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
      sale_item_id      INTEGER NOT NULL REFERENCES sale_items(id),
      product_id        INTEGER NOT NULL REFERENCES products(id),
      business_id       INTEGER NOT NULL,
      quantity_returned NUMERIC(12,3) NOT NULL,
      unit_price        NUMERIC(12,5) NOT NULL,
      subtotal_returned NUMERIC(14,5) NOT NULL,
      restock           BOOLEAN NOT NULL DEFAULT true,
      created_at        TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS exchange_items (
      id          SERIAL PRIMARY KEY,
      return_id   INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
      product_id  INTEGER NOT NULL REFERENCES products(id),
      business_id INTEGER NOT NULL,
      quantity    NUMERIC(12,3) NOT NULL,
      unit_price  NUMERIC(12,5) NOT NULL,
      subtotal    NUMERIC(14,5) NOT NULL,
      created_at  TIMESTAMP DEFAULT NOW()
    )`,

    "ALTER TABLE product_suppliers ALTER COLUMN purchase_cost TYPE NUMERIC(12, 5)",

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
    `CREATE TABLE IF NOT EXISTS manual_cuts (
      id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL,
      cut_date DATE NOT NULL,
      cut_type VARCHAR(20) NOT NULL DEFAULT 'manual',
      notes TEXT NOT NULL DEFAULT '',
      performed_by_user_id INTEGER REFERENCES users(id),
      performed_by_name_snapshot VARCHAR(180) NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,

    "ALTER TABLE reminders ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE reminders ADD COLUMN IF NOT EXISTS source_key VARCHAR(160)",
    "ALTER TABLE reminders ADD COLUMN IF NOT EXISTS reminder_type VARCHAR(40) NOT NULL DEFAULT 'general'",
    "ALTER TABLE reminders ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT 'administrative'",
    "ALTER TABLE reminders ADD COLUMN IF NOT EXISTS patient_id INTEGER",
    "ALTER TABLE reminders ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb",

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
    "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS movement_type VARCHAR(40) NOT NULL DEFAULT 'general_expense'",
    "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb",

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
    "ALTER TABLE fixed_expenses ADD COLUMN IF NOT EXISTS base_date DATE",

    `CREATE TABLE IF NOT EXISTS product_restock_history (
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
    )`,

    `CREATE TABLE IF NOT EXISTS support_access_logs (
      id SERIAL PRIMARY KEY,
      actor_user_id INTEGER NOT NULL REFERENCES users(id),
      target_user_id INTEGER NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE support_access_logs ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE support_access_logs ADD COLUMN IF NOT EXISTS target_business_id INTEGER",
    "ALTER TABLE support_access_logs ADD COLUMN IF NOT EXISTS support_session_token UUID NOT NULL DEFAULT gen_random_uuid()",
    "ALTER TABLE support_access_logs ADD COLUMN IF NOT EXISTS started_at TIMESTAMP NOT NULL DEFAULT NOW()",
    "ALTER TABLE support_access_logs ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes')",
    "ALTER TABLE support_access_logs ADD COLUMN IF NOT EXISTS ended_at TIMESTAMP",
    "ALTER TABLE support_access_logs ADD COLUMN IF NOT EXISTS ended_by_user_id INTEGER REFERENCES users(id)",

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

    `CREATE TABLE IF NOT EXISTS automation_events (
      id BIGSERIAL PRIMARY KEY,
      business_id INTEGER,
      event_type VARCHAR(80) NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      processed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS processed BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()",

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
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS supplier_id INTEGER",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS product_id INTEGER",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS supplier_product_code VARCHAR(120)",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS supplier_product_name VARCHAR(220)",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS supplier_description TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS supplier_category VARCHAR(120)",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS supplier_unit VARCHAR(20)",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS purchase_cost NUMERIC(12, 5) NOT NULL DEFAULT 0",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS previous_purchase_cost NUMERIC(12, 5)",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'MXN'",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS pack_size VARCHAR(80)",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS min_order_qty NUMERIC(12, 3)",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS cost_changed BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS catalog_status VARCHAR(30) NOT NULL DEFAULT 'pending'",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS source_file TEXT",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS last_cost_applied_at TIMESTAMP",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS imported_at TIMESTAMP NOT NULL DEFAULT NOW()",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()",
    "ALTER TABLE supplier_catalog_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()",

    `CREATE TABLE IF NOT EXISTS pos_templates (
      id SERIAL PRIMARY KEY,
      pos_type VARCHAR(40) NOT NULL,
      type VARCHAR(40) NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,

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

    `CREATE TABLE IF NOT EXISTS administrative_invoices (
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
    )`,
    "ALTER TABLE administrative_invoices ADD COLUMN IF NOT EXISTS business_id INTEGER",

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
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id)",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2) DEFAULT NULL",
    "ALTER TABLE clients ADD COLUMN IF NOT EXISTS credit_days INTEGER DEFAULT 30",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL",
    // NOTE: this predicate (deleted_at IS NULL) is historical/pre-migration-45.
    // ensureClientSoftDeleteReconciliation below drops and recreates this same
    // index with WHERE is_active = TRUE on every boot — is_active is the real
    // source of truth now. Left as-is here (not rewritten) to match this
    // codebase's convention of not editing historical ensureSchema lines.
    "CREATE UNIQUE INDEX IF NOT EXISTS clients_business_name_phone_uq ON clients (business_id, LOWER(TRIM(name)), COALESCE(LOWER(TRIM(phone)), '')) WHERE deleted_at IS NULL",

    `CREATE TABLE IF NOT EXISTS patients (
      id SERIAL PRIMARY KEY,
      business_id INTEGER,
      client_id INTEGER NOT NULL,
      name VARCHAR(150) NOT NULL,
      species VARCHAR(120),
      breed VARCHAR(120),
      sex VARCHAR(20),
      birth_date DATE,
      notes TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS client_id INTEGER",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS name VARCHAR(150)",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS species VARCHAR(120)",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS breed VARCHAR(120)",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS sex VARCHAR(20)",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS birth_date DATE",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS phone VARCHAR(30)",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS weight NUMERIC(10, 3)",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS allergies TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id)",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()",

    `CREATE TABLE IF NOT EXISTS consultations (
      id SERIAL PRIMARY KEY,
      business_id INTEGER,
      patient_id INTEGER NOT NULL,
      client_id INTEGER NOT NULL,
      consultation_date TIMESTAMP NOT NULL DEFAULT NOW(),
      motivo_consulta TEXT NOT NULL DEFAULT '',
      diagnostico TEXT NOT NULL DEFAULT '',
      tratamiento TEXT NOT NULL DEFAULT '',
      notas TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE consultations ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE consultations ADD COLUMN IF NOT EXISTS patient_id INTEGER",
    "ALTER TABLE consultations ADD COLUMN IF NOT EXISTS client_id INTEGER",
    "ALTER TABLE consultations ADD COLUMN IF NOT EXISTS consultation_date TIMESTAMP NOT NULL DEFAULT NOW()",
    "ALTER TABLE consultations ADD COLUMN IF NOT EXISTS motivo_consulta TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE consultations ADD COLUMN IF NOT EXISTS diagnostico TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE consultations ADD COLUMN IF NOT EXISTS tratamiento TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE consultations ADD COLUMN IF NOT EXISTS notas TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE consultations ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE consultations ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE consultations ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)",
    "ALTER TABLE consultations ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id)",
    "ALTER TABLE consultations ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()",
    "ALTER TABLE consultations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()",

    `CREATE TABLE IF NOT EXISTS medical_prescriptions (
      id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      consultation_id INTEGER,
      doctor_user_id INTEGER REFERENCES users(id),
      diagnosis TEXT NOT NULL DEFAULT '',
      indications TEXT NOT NULL DEFAULT '',
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE medical_prescriptions ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE medical_prescriptions ADD COLUMN IF NOT EXISTS patient_id INTEGER",
    "ALTER TABLE medical_prescriptions ADD COLUMN IF NOT EXISTS consultation_id INTEGER",
    "ALTER TABLE medical_prescriptions ADD COLUMN IF NOT EXISTS doctor_user_id INTEGER REFERENCES users(id)",
    "ALTER TABLE medical_prescriptions ADD COLUMN IF NOT EXISTS diagnosis TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE medical_prescriptions ADD COLUMN IF NOT EXISTS indications TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE medical_prescriptions ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'draft'",
    "ALTER TABLE medical_prescriptions ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE medical_prescriptions ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)",
    "ALTER TABLE medical_prescriptions ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id)",
    "ALTER TABLE medical_prescriptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()",
    "ALTER TABLE medical_prescriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()",

    `CREATE TABLE IF NOT EXISTS medical_prescription_items (
      id BIGSERIAL PRIMARY KEY,
      prescription_id BIGINT NOT NULL,
      product_id INTEGER NOT NULL,
      medication_name_snapshot VARCHAR(200) NOT NULL,
      presentation_snapshot VARCHAR(160),
      dose VARCHAR(160),
      frequency VARCHAR(160),
      duration VARCHAR(160),
      route_of_administration VARCHAR(160),
      notes TEXT NOT NULL DEFAULT '',
      stock_snapshot NUMERIC(12, 3),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE medical_prescription_items ADD COLUMN IF NOT EXISTS prescription_id BIGINT",
    "ALTER TABLE medical_prescription_items ADD COLUMN IF NOT EXISTS product_id INTEGER",
    "ALTER TABLE medical_prescription_items ADD COLUMN IF NOT EXISTS medication_name_snapshot VARCHAR(200)",
    "ALTER TABLE medical_prescription_items ADD COLUMN IF NOT EXISTS presentation_snapshot VARCHAR(160)",
    "ALTER TABLE medical_prescription_items ADD COLUMN IF NOT EXISTS dose VARCHAR(160)",
    "ALTER TABLE medical_prescription_items ADD COLUMN IF NOT EXISTS frequency VARCHAR(160)",
    "ALTER TABLE medical_prescription_items ADD COLUMN IF NOT EXISTS duration VARCHAR(160)",
    "ALTER TABLE medical_prescription_items ADD COLUMN IF NOT EXISTS route_of_administration VARCHAR(160)",
    "ALTER TABLE medical_prescription_items ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE medical_prescription_items ADD COLUMN IF NOT EXISTS stock_snapshot NUMERIC(12, 3)",
    "ALTER TABLE medical_prescription_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()",

    `CREATE TABLE IF NOT EXISTS appointments (
      id SERIAL PRIMARY KEY,
      business_id INTEGER,
      patient_id INTEGER NOT NULL,
      client_id INTEGER NOT NULL,
      doctor_user_id INTEGER REFERENCES users(id),
      appointment_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      area VARCHAR(20) NOT NULL DEFAULT 'CLINICA',
      specialty VARCHAR(120),
      status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
      notes TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS patient_id INTEGER",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS client_id INTEGER",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS doctor_user_id INTEGER REFERENCES users(id)",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS appointment_date DATE",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS start_time TIME",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS end_time TIME",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS area VARCHAR(20) NOT NULL DEFAULT 'CLINICA'",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS specialty VARCHAR(120)",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'scheduled'",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id)",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()",
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()",

    `CREATE TABLE IF NOT EXISTS medical_preventive_events (
      id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      patient_id INTEGER NOT NULL,
      event_type VARCHAR(20) NOT NULL,
      product_id INTEGER,
      product_name_snapshot VARCHAR(200) NOT NULL DEFAULT '',
      dose VARCHAR(160),
      date_administered DATE,
      next_due_date DATE,
      status VARCHAR(20) NOT NULL DEFAULT 'completed',
      notes TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE medical_preventive_events ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE medical_preventive_events ADD COLUMN IF NOT EXISTS patient_id INTEGER",
    "ALTER TABLE medical_preventive_events ADD COLUMN IF NOT EXISTS event_type VARCHAR(20)",
    "ALTER TABLE medical_preventive_events ADD COLUMN IF NOT EXISTS product_id INTEGER",
    "ALTER TABLE medical_preventive_events ADD COLUMN IF NOT EXISTS product_name_snapshot VARCHAR(200) NOT NULL DEFAULT ''",
    "ALTER TABLE medical_preventive_events ADD COLUMN IF NOT EXISTS dose VARCHAR(160)",
    "ALTER TABLE medical_preventive_events ADD COLUMN IF NOT EXISTS date_administered DATE",
    "ALTER TABLE medical_preventive_events ADD COLUMN IF NOT EXISTS next_due_date DATE",
    "ALTER TABLE medical_preventive_events ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'completed'",
    "ALTER TABLE medical_preventive_events ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE medical_preventive_events ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE medical_preventive_events ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)",
    "ALTER TABLE product_restock_history ADD COLUMN IF NOT EXISTS product_name_snapshot VARCHAR(200) NOT NULL DEFAULT ''",
    "ALTER TABLE product_restock_history ADD COLUMN IF NOT EXISTS category_snapshot VARCHAR(120) NOT NULL DEFAULT ''",
    "ALTER TABLE product_restock_history ADD COLUMN IF NOT EXISTS supplier_name_snapshot VARCHAR(200) NOT NULL DEFAULT ''",
    "ALTER TABLE medical_preventive_events ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id)",
    "ALTER TABLE medical_preventive_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()",
    "ALTER TABLE medical_preventive_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()",

    `CREATE TABLE IF NOT EXISTS sale_prescription_links (
      id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      prescription_id BIGINT NOT NULL,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE sale_prescription_links ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE sale_prescription_links ADD COLUMN IF NOT EXISTS prescription_id BIGINT",
    "ALTER TABLE sale_prescription_links ADD COLUMN IF NOT EXISTS sale_id INTEGER",
    "ALTER TABLE sale_prescription_links ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)",
    "ALTER TABLE sale_prescription_links ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()",

    // Migration 49 — Fase 5 Parte B: sale_prescription_item_links. Unlike
    // sale_prescription_links (whole sale <-> whole prescription),
    // this links one sale_item to one medical_prescription_item with the
    // quantity dispensed on that line. References medical_prescription_items
    // (public), not healthcare.prescription_items — same convention
    // sale_prescription_links already uses for prescription_id, since
    // saleService.js writes to public.* as the master; the translation to
    // healthcare.dispensing_logs happens separately, at write time, via
    // source_prescription_item_id (see healthcareSubjectTranslation.js).
    `CREATE TABLE IF NOT EXISTS sale_prescription_item_links (
      id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      sale_item_id INTEGER NOT NULL,
      prescription_item_id BIGINT NOT NULL,
      quantity_dispensed NUMERIC(12, 3) NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE sale_prescription_item_links ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE sale_prescription_item_links ADD COLUMN IF NOT EXISTS sale_item_id INTEGER",
    "ALTER TABLE sale_prescription_item_links ADD COLUMN IF NOT EXISTS prescription_item_id BIGINT",
    "ALTER TABLE sale_prescription_item_links ADD COLUMN IF NOT EXISTS quantity_dispensed NUMERIC(12, 3)",
    "ALTER TABLE sale_prescription_item_links ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)",
    "ALTER TABLE sale_prescription_item_links ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()",

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
    "ALTER TABLE sync_logs ADD COLUMN IF NOT EXISTS business_id INTEGER",

    `CREATE TABLE IF NOT EXISTS subscription_payment_history (
      id                     SERIAL PRIMARY KEY,
      business_id            INTEGER       NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      openpay_transaction_id VARCHAR(100),
      openpay_order_id       VARCHAR(100),
      payment_provider       VARCHAR(20)   NOT NULL DEFAULT 'manual',
      amount                 NUMERIC(10,2) NOT NULL,
      currency               VARCHAR(3)    NOT NULL DEFAULT 'MXN',
      status                 VARCHAR(20)   NOT NULL,
      payment_method         VARCHAR(30),
      card_last4             VARCHAR(4),
      card_brand             VARCHAR(20),
      error_message          TEXT,
      raw_webhook_payload    JSONB,
      paid_at                TIMESTAMP,
      created_at             TIMESTAMP     NOT NULL DEFAULT NOW()
    )`,
    "CREATE INDEX IF NOT EXISTS idx_payment_history_business_id ON subscription_payment_history(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_payment_history_transaction_id ON subscription_payment_history(openpay_transaction_id)",

    `CREATE TABLE IF NOT EXISTS pending_onboardings (
      id                      SERIAL PRIMARY KEY,
      order_id                VARCHAR(100) NOT NULL UNIQUE,
      openpay_customer_id     VARCHAR(100),
      openpay_plan_id         VARCHAR(100),
      openpay_subscription_id VARCHAR(100),
      business_name           VARCHAR(180) NOT NULL,
      owner_name              VARCHAR(180) NOT NULL,
      email                   VARCHAR(255) NOT NULL,
      password_hash           TEXT NOT NULL,
      pos_type                VARCHAR(40) NOT NULL,
      plan_type               VARCHAR(20) NOT NULL DEFAULT 'monthly',
      plan_name               VARCHAR(50) NOT NULL,
      amount                  NUMERIC(10,2) NOT NULL,
      currency                VARCHAR(3) NOT NULL DEFAULT 'MXN',
      status                  VARCHAR(20) NOT NULL DEFAULT 'pending',
      failure_reason          TEXT,
      provisioned_business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
      provisioned_user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      idempotency_key         VARCHAR(100) UNIQUE,
      raw_checkout_payload    JSONB,
      created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    "CREATE INDEX IF NOT EXISTS idx_pending_onboardings_order_id ON pending_onboardings(order_id)",
    "CREATE INDEX IF NOT EXISTS idx_pending_onboardings_email ON pending_onboardings(email)",
    "CREATE INDEX IF NOT EXISTS idx_pending_onboardings_status ON pending_onboardings(status)",

    // === RESTAURANT MODULE ===
    `CREATE TABLE IF NOT EXISTS restaurant_zones (
      id           SERIAL PRIMARY KEY,
      business_id  INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name         VARCHAR(80) NOT NULL,
      description  TEXT,
      is_active    BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_by   INTEGER REFERENCES users(id),
      created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS restaurant_tables (
      id           SERIAL PRIMARY KEY,
      business_id  INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      zone_id      INTEGER NOT NULL REFERENCES restaurant_zones(id) ON DELETE CASCADE,
      name         VARCHAR(40) NOT NULL,
      capacity     INTEGER NOT NULL DEFAULT 4,
      status       VARCHAR(20) NOT NULL DEFAULT 'available',
      is_active    BOOLEAN NOT NULL DEFAULT TRUE,
      position_x   NUMERIC(6,2) DEFAULT NULL,
      position_y   NUMERIC(6,2) DEFAULT NULL,
      created_by   INTEGER REFERENCES users(id),
      created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT restaurant_tables_status_check
        CHECK (status IN ('available','occupied','bill_requested','reserved','cleaning'))
    )`,

    `CREATE TABLE IF NOT EXISTS restaurant_orders (
      id               SERIAL PRIMARY KEY,
      business_id      INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      table_id         INTEGER NOT NULL REFERENCES restaurant_tables(id),
      zone_id          INTEGER NOT NULL REFERENCES restaurant_zones(id),
      order_number     VARCHAR(20) NOT NULL,
      status           VARCHAR(20) NOT NULL DEFAULT 'open',
      diners_count     INTEGER NOT NULL DEFAULT 1,
      notes            TEXT,
      opened_by        INTEGER REFERENCES users(id),
      closed_by        INTEGER REFERENCES users(id),
      opened_at        TIMESTAMP NOT NULL DEFAULT NOW(),
      closed_at        TIMESTAMP,
      total_amount     NUMERIC(10,2) NOT NULL DEFAULT 0,
      created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT restaurant_orders_status_check
        CHECK (status IN ('open','bill_requested','paid','cancelled'))
    )`,

    `CREATE TABLE IF NOT EXISTS restaurant_order_items (
      id              SERIAL PRIMARY KEY,
      business_id     INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      order_id        INTEGER NOT NULL REFERENCES restaurant_orders(id) ON DELETE CASCADE,
      product_id      INTEGER REFERENCES products(id),
      product_name    VARCHAR(180) NOT NULL,
      product_price   NUMERIC(10,2) NOT NULL,
      quantity        INTEGER NOT NULL DEFAULT 1,
      notes           TEXT,
      status          VARCHAR(20) NOT NULL DEFAULT 'pending',
      sent_to_kitchen_at TIMESTAMP,
      prepared_at     TIMESTAMP,
      served_at       TIMESTAMP,
      created_by      INTEGER REFERENCES users(id),
      created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT restaurant_order_items_status_check
        CHECK (status IN ('pending','sent','preparing','ready','served','cancelled'))
    )`,

    `CREATE TABLE IF NOT EXISTS restaurant_payments (
      id              SERIAL PRIMARY KEY,
      business_id     INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      order_id        INTEGER NOT NULL REFERENCES restaurant_orders(id) ON DELETE CASCADE,
      payment_method  VARCHAR(30) NOT NULL DEFAULT 'cash',
      amount          NUMERIC(10,2) NOT NULL,
      tip_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
      diner_number    INTEGER,
      notes           TEXT,
      created_by      INTEGER REFERENCES users(id),
      created_at      TIMESTAMP NOT NULL DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS restaurant_modifier_groups (
      id            SERIAL PRIMARY KEY,
      business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name          VARCHAR(100) NOT NULL,
      required      BOOLEAN NOT NULL DEFAULT FALSE,
      multi_select  BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS restaurant_modifiers (
      id            SERIAL PRIMARY KEY,
      group_id      INTEGER NOT NULL REFERENCES restaurant_modifier_groups(id) ON DELETE CASCADE,
      business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name          VARCHAR(100) NOT NULL,
      price_delta   NUMERIC(10,2) NOT NULL DEFAULT 0,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      is_active     BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMP DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS restaurant_product_modifiers (
      product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      group_id      INTEGER NOT NULL REFERENCES restaurant_modifier_groups(id) ON DELETE CASCADE,
      PRIMARY KEY (product_id, group_id)
    )`,

    `CREATE TABLE IF NOT EXISTS restaurant_order_item_modifiers (
      id            SERIAL PRIMARY KEY,
      order_item_id INTEGER NOT NULL REFERENCES restaurant_order_items(id) ON DELETE CASCADE,
      modifier_id   INTEGER NOT NULL REFERENCES restaurant_modifiers(id),
      name          VARCHAR(100) NOT NULL,
      price_delta   NUMERIC(10,2) NOT NULL DEFAULT 0
    )`,

    "CREATE INDEX IF NOT EXISTS idx_restaurant_zones_business_id ON restaurant_zones(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_restaurant_tables_business_id ON restaurant_tables(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_restaurant_tables_zone_id ON restaurant_tables(zone_id)",
    "CREATE INDEX IF NOT EXISTS idx_restaurant_tables_status ON restaurant_tables(business_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_restaurant_orders_business_id ON restaurant_orders(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_restaurant_orders_table_id ON restaurant_orders(table_id)",
    "CREATE INDEX IF NOT EXISTS idx_restaurant_orders_status ON restaurant_orders(business_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_restaurant_orders_opened_by ON restaurant_orders(opened_by)",
    "CREATE INDEX IF NOT EXISTS idx_restaurant_order_items_order_id ON restaurant_order_items(order_id)",
    "CREATE INDEX IF NOT EXISTS idx_restaurant_order_items_status ON restaurant_order_items(business_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_restaurant_payments_order_id ON restaurant_payments(order_id)",
    "CREATE INDEX IF NOT EXISTS idx_modifier_groups_business ON restaurant_modifier_groups(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_modifiers_group ON restaurant_modifiers(group_id)",
    "CREATE INDEX IF NOT EXISTS idx_order_item_modifiers_item ON restaurant_order_item_modifiers(order_item_id)",

    // === BRANCHES: branch_id nullable en tablas clave ===
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL",
    "ALTER TABLE products ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL",
    "ALTER TABLE sales ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL",
    "ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL",
    "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL",
    "ALTER TABLE fixed_expenses ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL",
    "ALTER TABLE daily_cuts ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL",

    // === BRANCHES: migración — crea sucursal default para cada negocio existente ===
    `INSERT INTO branches (business_id, name, pos_type, is_default, is_active, created_at, updated_at)
     SELECT b.id, b.name,
       COALESCE(u.pos_type, 'Tienda') AS pos_type,
       TRUE AS is_default,
       TRUE AS is_active,
       NOW(), NOW()
     FROM businesses b
     LEFT JOIN users u ON u.business_id = b.id AND u.role = 'admin'
     WHERE NOT EXISTS (
       SELECT 1 FROM branches WHERE business_id = b.id AND is_default = TRUE
     )
     ON CONFLICT DO NOTHING`
  ]);
}

async function ensureSeedBusiness(client) {
  await execQuery(client, "UPDATE users SET role = 'superusuario' WHERE role = 'superadmin'");
  await execQuery(client, "UPDATE users SET role = 'cajero' WHERE role IN ('user', 'cashier')");
  await execQuery(client, "UPDATE products SET status = 'activo' WHERE status IS NULL");
  await execQuery(client, "UPDATE sales SET status = 'completed' WHERE status IS NULL OR BTRIM(status) = ''");
  await execQuery(client, "UPDATE products SET unidad_de_venta = 'pieza' WHERE unidad_de_venta IS NULL OR unidad_de_venta = ''");
  await execQuery(
    client,
    "UPDATE products SET stock_maximo = GREATEST(COALESCE(stock, 0), COALESCE(stock_minimo, 0)) WHERE stock_maximo IS NULL"
  );
  await execQuery(client, "ALTER TABLE products ALTER COLUMN stock_maximo SET DEFAULT 0");
  await execQuery(client, "UPDATE products SET stock_maximo = 0 WHERE stock_maximo IS NULL");
  await execQuery(client, "ALTER TABLE products ALTER COLUMN stock_maximo SET NOT NULL");
  await execQuery(client, "UPDATE products SET stock_maximo = stock_minimo WHERE stock_maximo < stock_minimo");
  await execQuery(client, "UPDATE businesses SET business_type = COALESCE(business_type, pos_type) WHERE business_type IS NULL");

  await execQuery(
    client,
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
  const { rows } = await execQuery(
    client,
    "SELECT id FROM businesses WHERE slug = $1 LIMIT 1",
    [SEED_BUSINESS.slug]
  );

  if (!rows.length) {
    throw new Error("Seed business not found after ensureSeedBusiness()");
  }

  const businessId = rows[0].id;

  await run(client, [
    `UPDATE users SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE suppliers SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE products SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE expenses SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE owner_loans SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE daily_cuts SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE company_profiles SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE product_categories SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE services SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE supplier_catalog_items sci
     SET business_id = COALESCE(
       sci.business_id,
       (SELECT s.business_id FROM suppliers s WHERE s.id = sci.supplier_id),
       (SELECT p.business_id FROM products p WHERE p.id = sci.product_id),
       ${businessId}
     )
     WHERE sci.business_id IS NULL`,
    `UPDATE automation_events SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE clients SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE sync_logs SET business_id = ${businessId} WHERE business_id IS NULL`
  ]);

  await execQuery(
    client,
    `UPDATE sales
     SET business_id = COALESCE(sales.business_id, users.business_id, $1)
     FROM users
     WHERE users.id = sales.user_id
       AND sales.business_id IS NULL`,
    [businessId]
  );

  await execQuery(
    client,
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

  await execQuery(
    client,
    `UPDATE fixed_expenses
     SET business_id = COALESCE(fixed_expenses.business_id, users.business_id, $1)
     FROM users
     WHERE users.id = fixed_expenses.created_by
       AND fixed_expenses.business_id IS NULL`,
    [businessId]
  );

  await execQuery(
    client,
    `UPDATE product_suppliers
     SET business_id = COALESCE(product_suppliers.business_id, products.business_id, suppliers.business_id, $1)
     FROM products, suppliers
     WHERE products.id = product_suppliers.product_id
       AND suppliers.id = product_suppliers.supplier_id
       AND product_suppliers.business_id IS NULL`,
    [businessId]
  );

  await execQuery(
    client,
    `UPDATE sale_items
     SET business_id = COALESCE(sale_items.business_id, sales.business_id, $1)
     FROM sales
     WHERE sales.id = sale_items.sale_id
       AND sale_items.business_id IS NULL`,
    [businessId]
  );

  await execQuery(
    client,
    `UPDATE sale_items
     SET product_name_snapshot = COALESCE(NULLIF(sale_items.product_name_snapshot, ''), products.name, '')
     FROM products
     WHERE products.id = sale_items.product_id
       AND products.business_id = sale_items.business_id
       AND COALESCE(sale_items.product_name_snapshot, '') = ''`
  );

  await execQuery(
    client,
    `UPDATE product_restock_history
     SET product_name_snapshot = COALESCE(NULLIF(product_restock_history.product_name_snapshot, ''), products.name, ''),
         category_snapshot = COALESCE(NULLIF(product_restock_history.category_snapshot, ''), products.category, '')
     FROM products
     WHERE products.id = product_restock_history.product_id
       AND products.business_id = product_restock_history.business_id
       AND (
         COALESCE(product_restock_history.product_name_snapshot, '') = ''
         OR COALESCE(product_restock_history.category_snapshot, '') = ''
       )`
  );

  await execQuery(
    client,
    `UPDATE product_restock_history
     SET supplier_name_snapshot = COALESCE(NULLIF(product_restock_history.supplier_name_snapshot, ''), suppliers.name, '')
     FROM suppliers
     WHERE suppliers.id = product_restock_history.supplier_id
       AND suppliers.business_id = product_restock_history.business_id
       AND COALESCE(product_restock_history.supplier_name_snapshot, '') = ''`
  );

  await execQuery(
    client,
    `UPDATE credit_payments
     SET business_id = COALESCE(credit_payments.business_id, sales.business_id, $1)
     FROM sales
     WHERE sales.id = credit_payments.sale_id
       AND credit_payments.business_id IS NULL`,
    [businessId]
  );

  await execQuery(
    client,
    `UPDATE company_stamp_movements
     SET business_id = COALESCE(company_stamp_movements.business_id, company_profiles.business_id, $1)
     FROM company_profiles
     WHERE company_profiles.id = company_stamp_movements.company_profile_id
       AND company_stamp_movements.business_id IS NULL`,
    [businessId]
  );

  await execQuery(
    client,
    `UPDATE administrative_invoices
     SET business_id = COALESCE(administrative_invoices.business_id, sales.business_id, $1)
     FROM sales
     WHERE sales.id = administrative_invoices.sale_id
       AND administrative_invoices.business_id IS NULL`,
    [businessId]
  );

  await execQuery(
    client,
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

  await execQuery(
    client,
    `UPDATE support_access_logs
     SET started_at = COALESCE(started_at, created_at),
         expires_at = COALESCE(expires_at, created_at + INTERVAL '30 minutes'),
         ended_at = COALESCE(ended_at, created_at),
         ended_by_user_id = COALESCE(ended_by_user_id, actor_user_id)`
  );

  await execQuery(
    client,
    `UPDATE reports
     SET business_id = COALESCE(reports.business_id, users.business_id, $1)
     FROM users
     WHERE users.id = reports.created_by
       AND reports.business_id IS NULL`,
    [businessId]
  );

  await execQuery(
    client,
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

  await execQuery(
    client,
    `INSERT INTO business_subscriptions (
       business_id,
       plan_type,
       billing_anchor_date,
       next_payment_date,
       grace_period_days,
       enforcement_enabled,
       manual_adjustment_reason
     )
     SELECT
       businesses.id,
       NULL,
       businesses.created_at::date,
       NULL,
       0,
       FALSE,
       ''
     FROM businesses
     WHERE NOT EXISTS (
       SELECT 1
       FROM business_subscriptions
       WHERE business_subscriptions.business_id = businesses.id
     )`
  );

  await execQuery(
    client,
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
    `UPDATE supplier_catalog_items SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE sale_items SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE credit_payments SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE company_stamp_movements SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE administrative_invoices SET business_id = ${businessId} WHERE business_id IS NULL`,
    `UPDATE patients
       SET business_id = COALESCE(patients.business_id, clients.business_id, ${businessId})
     FROM clients
     WHERE clients.id = patients.client_id
       AND patients.business_id IS NULL`,
    `UPDATE consultations
       SET business_id = COALESCE(consultations.business_id, patients.business_id, clients.business_id, ${businessId}),
           client_id = COALESCE(consultations.client_id, patients.client_id)
     FROM patients
     LEFT JOIN clients ON clients.id = patients.client_id
     WHERE patients.id = consultations.patient_id
       AND (consultations.business_id IS NULL OR consultations.client_id IS NULL)`,
    `UPDATE appointments
       SET business_id = COALESCE(appointments.business_id, patients.business_id, clients.business_id, ${businessId}),
           client_id = COALESCE(appointments.client_id, patients.client_id)
     FROM patients
     LEFT JOIN clients ON clients.id = patients.client_id
     WHERE patients.id = appointments.patient_id
       AND (appointments.business_id IS NULL OR appointments.client_id IS NULL)`,
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
    "ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_client_fk",
    "ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_client_id_fkey",
    "ALTER TABLE consultations DROP CONSTRAINT IF EXISTS consultations_patient_fk",
    "ALTER TABLE consultations DROP CONSTRAINT IF EXISTS consultations_client_fk",
    "ALTER TABLE consultations DROP CONSTRAINT IF EXISTS consultations_patient_id_fkey",
    "ALTER TABLE consultations DROP CONSTRAINT IF EXISTS consultations_client_id_fkey",
    "ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_patient_fk",
    "ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_client_fk",
    "ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_patient_id_fkey",
    "ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_client_id_fkey",
    "DROP INDEX IF EXISTS uq_company_profiles_profile_key",
    "DROP INDEX IF EXISTS uq_reminders_source_key"
  ]);

  await execQuery(
    client,
    `
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
        FOREIGN KEY (stamp_movement_id)
        REFERENCES company_stamp_movements(id);
      END IF;
    END $$;
    `
  );

  await execQuery(
    client,
    `
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
        FOREIGN KEY (administrative_invoice_id)
        REFERENCES administrative_invoices(id);
      END IF;
    END $$;
    `
  );

  await execQuery(
    client,
    `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_patients_client'
          AND conrelid = 'patients'::regclass
      ) THEN
        ALTER TABLE patients
        ADD CONSTRAINT fk_patients_client
        FOREIGN KEY (client_id) REFERENCES clients(id);
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_consultations_patient'
          AND conrelid = 'consultations'::regclass
      ) THEN
        ALTER TABLE consultations
        ADD CONSTRAINT fk_consultations_patient
        FOREIGN KEY (patient_id) REFERENCES patients(id);
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_consultations_client'
          AND conrelid = 'consultations'::regclass
      ) THEN
        ALTER TABLE consultations
        ADD CONSTRAINT fk_consultations_client
        FOREIGN KEY (client_id) REFERENCES clients(id);
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_appointments_patient'
          AND conrelid = 'appointments'::regclass
      ) THEN
        ALTER TABLE appointments
        ADD CONSTRAINT fk_appointments_patient
        FOREIGN KEY (patient_id) REFERENCES patients(id);
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_appointments_client'
          AND conrelid = 'appointments'::regclass
      ) THEN
        ALTER TABLE appointments
        ADD CONSTRAINT fk_appointments_client
        FOREIGN KEY (client_id) REFERENCES clients(id);
      END IF;
    END $$;
    `
  );

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
    "product_categories",
    "services",
    "supplier_catalog_items",
    "automation_events",
    "expenses",
    "owner_loans",
    "fixed_expenses",
    "company_profiles",
    "company_stamp_movements",
    "administrative_invoices",
    "clients",
    "patients",
    "consultations",
    "appointments",
    "product_update_requests"
  ];

  for (const table of fks) {
    await execQuery(client, `ALTER TABLE ${table} ALTER COLUMN business_id SET NOT NULL`);
    await execQuery(
      client,
      `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_${table}_business'
            AND conrelid = '${table}'::regclass
        ) THEN
          ALTER TABLE ${table}
          ADD CONSTRAINT fk_${table}_business
          FOREIGN KEY (business_id) REFERENCES businesses(id);
        END IF;
      END $$;
      `
    );
  }

  await execQuery(client, "ALTER TABLE support_access_logs ALTER COLUMN business_id SET NOT NULL");
  await execQuery(client, "ALTER TABLE support_access_logs ALTER COLUMN target_business_id SET NOT NULL");

  await execQuery(
    client,
    `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_support_access_logs_business'
          AND conrelid = 'support_access_logs'::regclass
      ) THEN
        ALTER TABLE support_access_logs
        ADD CONSTRAINT fk_support_access_logs_business
        FOREIGN KEY (business_id) REFERENCES businesses(id);
      END IF;
    END $$;
    `
  );

  await execQuery(
    client,
    `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_support_access_logs_target_business'
          AND conrelid = 'support_access_logs'::regclass
      ) THEN
        ALTER TABLE support_access_logs
        ADD CONSTRAINT fk_support_access_logs_target_business
        FOREIGN KEY (target_business_id) REFERENCES businesses(id);
      END IF;
    END $$;
    `
  );

  await execQuery(
    client,
    `
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
      ADD CONSTRAINT businesses_pos_type_check CHECK (pos_type IN ('Tlapaleria', 'Tienda', 'Farmacia', 'Veterinaria', 'Papeleria', 'Dentista', 'FarmaciaConsultorio', 'ClinicaChica', 'Otro', 'Restaurante'));

      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_role_check'
          AND conrelid = 'users'::regclass
      ) THEN
        ALTER TABLE users DROP CONSTRAINT users_role_check;
      END IF;

      ALTER TABLE users
      ADD CONSTRAINT users_role_check CHECK (role IN ('superusuario', 'admin', 'gerente', 'clinico', 'cajero', 'cocina', 'soporte'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
    `
  );

  console.log("[DB-FIX] Cleaning controlled enum values...");
  await execQuery(
    client,
    `
    DO $$
    DECLARE
      normalized_roles_count INTEGER := 0;
      normalized_catalog_type_count INTEGER := 0;
      normalized_reminder_category_count INTEGER := 0;
      normalized_reminder_status_count INTEGER := 0;
      normalized_prescription_status_count INTEGER := 0;
      normalized_preventive_type_count INTEGER := 0;
      normalized_preventive_status_count INTEGER := 0;
    BEGIN
      UPDATE users
      SET role = CASE
        WHEN role IS NULL THEN 'cajero'
        WHEN LOWER(role) IN ('superusuario', 'superadmin') THEN 'superusuario'
        WHEN LOWER(role) = 'admin' THEN 'admin'
        WHEN LOWER(role) = 'gerente' THEN 'gerente'
        WHEN LOWER(role) IN ('clinico', 'medico', 'veterinario') THEN 'clinico'
        WHEN LOWER(role) IN ('soporte', 'support') THEN 'soporte'
        ELSE 'cajero'
      END
      WHERE role IS NULL
         OR LOWER(role) NOT IN ('superusuario', 'superadmin', 'admin', 'gerente', 'clinico', 'medico', 'veterinario', 'soporte', 'support', 'cajero', 'cashier', 'user')
         OR role <> CASE
           WHEN LOWER(role) IN ('superusuario', 'superadmin') THEN 'superusuario'
           WHEN LOWER(role) = 'admin' THEN 'admin'
           WHEN LOWER(role) = 'gerente' THEN 'gerente'
           WHEN LOWER(role) IN ('clinico', 'medico', 'veterinario') THEN 'clinico'
           WHEN LOWER(role) IN ('soporte', 'support') THEN 'soporte'
           ELSE 'cajero'
         END;
      GET DIAGNOSTICS normalized_roles_count = ROW_COUNT;

      UPDATE reminders
      SET category = CASE
        WHEN category IS NULL THEN 'administrative'
        WHEN LOWER(category) IN ('admin', 'administrativo') THEN 'administrative'
        WHEN LOWER(category) IN ('medical', 'medico', 'clinical') THEN 'clinical'
        WHEN patient_id IS NOT NULL THEN 'clinical'
        ELSE 'administrative'
      END;
      GET DIAGNOSTICS normalized_reminder_category_count = ROW_COUNT;

      UPDATE reminders
      SET status = CASE
        WHEN status IS NULL THEN 'pending'
        WHEN LOWER(status) IN ('pending', 'pendiente') THEN 'pending'
        WHEN LOWER(status) IN ('in_progress', 'progreso') THEN 'in_progress'
        WHEN LOWER(status) IN ('completed', 'completado') THEN 'completed'
        ELSE 'cancelled'
      END
      WHERE status IS NULL
         OR LOWER(status) NOT IN ('pending', 'pendiente', 'in_progress', 'progreso', 'completed', 'completado', 'cancelled', 'canceled', 'cancelado');
      GET DIAGNOSTICS normalized_reminder_status_count = ROW_COUNT;

      UPDATE products
      SET catalog_type = CASE
        WHEN LOWER(COALESCE(category, '')) SIMILAR TO '%(medicament|farmac|insumo|vacun|antibiot|curacion|quirurg)%'
          OR LOWER(COALESCE(name, '')) SIMILAR TO '%(medicament|farmac|insumo|vacun|antibiot|curacion|quirurg)%'
        THEN 'medications'
        WHEN LOWER(COALESCE(category, '')) SIMILAR TO '%(alimento|accesor|snack|juguete|collar|correa|cama|arena)%'
          OR LOWER(COALESCE(name, '')) SIMILAR TO '%(alimento|accesor|snack|juguete|collar|correa|cama|arena)%'
        THEN 'accessories'
        ELSE COALESCE(catalog_type, 'accessories')
      END
      WHERE catalog_type IS NULL OR BTRIM(catalog_type) = '';
      GET DIAGNOSTICS normalized_catalog_type_count = ROW_COUNT;

      UPDATE medical_prescriptions
      SET status = CASE
        WHEN LOWER(COALESCE(status, '')) IN ('draft', 'borrador') THEN 'draft'
        WHEN LOWER(COALESCE(status, '')) IN ('issued', 'emitida') THEN 'issued'
        ELSE 'cancelled'
      END
      WHERE status IS NULL
         OR LOWER(status) NOT IN ('draft', 'borrador', 'issued', 'emitida', 'cancelled', 'canceled', 'cancelada');
      GET DIAGNOSTICS normalized_prescription_status_count = ROW_COUNT;

      UPDATE medical_preventive_events
      SET event_type = CASE
        WHEN LOWER(COALESCE(event_type, '')) IN ('vaccination', 'vacuna', 'vacunacion', 'vacunación') THEN 'vaccination'
        ELSE 'deworming'
      END
      WHERE event_type IS NULL
         OR LOWER(event_type) NOT IN ('vaccination', 'vacuna', 'vacunacion', 'vacunación', 'deworming', 'desparasitacion', 'desparasitación');
      GET DIAGNOSTICS normalized_preventive_type_count = ROW_COUNT;

      UPDATE medical_preventive_events
      SET status = CASE
        WHEN LOWER(COALESCE(status, '')) IN ('scheduled', 'programado') THEN 'scheduled'
        WHEN LOWER(COALESCE(status, '')) IN ('completed', 'completado') THEN 'completed'
        ELSE 'cancelled'
      END
      WHERE status IS NULL
         OR LOWER(status) NOT IN ('scheduled', 'programado', 'completed', 'completado', 'cancelled', 'canceled', 'cancelado');
      GET DIAGNOSTICS normalized_preventive_status_count = ROW_COUNT;

      RAISE NOTICE '[DB-FIX] users.role normalized rows: %', normalized_roles_count;
      RAISE NOTICE '[DB-FIX] products.catalog_type normalized rows: %', normalized_catalog_type_count;
      RAISE NOTICE '[DB-FIX] reminders.category normalized rows: %', normalized_reminder_category_count;
      RAISE NOTICE '[DB-FIX] reminders.status normalized rows: %', normalized_reminder_status_count;
      RAISE NOTICE '[DB-FIX] medical_prescriptions.status normalized rows: %', normalized_prescription_status_count;
      RAISE NOTICE '[DB-FIX] medical_preventive_events.event_type normalized rows: %', normalized_preventive_type_count;
      RAISE NOTICE '[DB-FIX] medical_preventive_events.status normalized rows: %', normalized_preventive_status_count;

      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_catalog_type_check'
          AND conrelid = 'products'::regclass
      ) THEN
        ALTER TABLE products DROP CONSTRAINT products_catalog_type_check;
      END IF;

      ALTER TABLE products
      ADD CONSTRAINT products_catalog_type_check CHECK (catalog_type IN ('accessories', 'medications'));

      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'reminders_status_check'
          AND conrelid = 'reminders'::regclass
      ) THEN
        ALTER TABLE reminders DROP CONSTRAINT reminders_status_check;
      END IF;

      ALTER TABLE reminders
      ADD CONSTRAINT reminders_status_check CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'));

      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'reminders_category_check'
          AND conrelid = 'reminders'::regclass
      ) THEN
        ALTER TABLE reminders DROP CONSTRAINT reminders_category_check;
      END IF;

      ALTER TABLE reminders
      ADD CONSTRAINT reminders_category_check CHECK (category IN ('administrative', 'clinical'));

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_reminders_patient'
          AND conrelid = 'reminders'::regclass
      ) THEN
        ALTER TABLE reminders
        ADD CONSTRAINT fk_reminders_patient
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'medical_prescriptions_status_check'
          AND conrelid = 'medical_prescriptions'::regclass
      ) THEN
        ALTER TABLE medical_prescriptions DROP CONSTRAINT medical_prescriptions_status_check;
      END IF;

      ALTER TABLE medical_prescriptions
      ADD CONSTRAINT medical_prescriptions_status_check CHECK (status IN ('draft', 'issued', 'cancelled'));

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_medical_prescriptions_patient'
          AND conrelid = 'medical_prescriptions'::regclass
      ) THEN
        ALTER TABLE medical_prescriptions
        ADD CONSTRAINT fk_medical_prescriptions_patient
        FOREIGN KEY (patient_id) REFERENCES patients(id);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_medical_prescriptions_consultation'
          AND conrelid = 'medical_prescriptions'::regclass
      ) THEN
        ALTER TABLE medical_prescriptions
        ADD CONSTRAINT fk_medical_prescriptions_consultation
        FOREIGN KEY (consultation_id) REFERENCES consultations(id);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_medical_prescription_items_prescription'
          AND conrelid = 'medical_prescription_items'::regclass
      ) THEN
        ALTER TABLE medical_prescription_items
        ADD CONSTRAINT fk_medical_prescription_items_prescription
        FOREIGN KEY (prescription_id) REFERENCES medical_prescriptions(id) ON DELETE CASCADE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_medical_prescription_items_product'
          AND conrelid = 'medical_prescription_items'::regclass
      ) THEN
        ALTER TABLE medical_prescription_items
        ADD CONSTRAINT fk_medical_prescription_items_product
        FOREIGN KEY (product_id) REFERENCES products(id);
      END IF;

      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'medical_preventive_events_type_check'
          AND conrelid = 'medical_preventive_events'::regclass
      ) THEN
        ALTER TABLE medical_preventive_events DROP CONSTRAINT medical_preventive_events_type_check;
      END IF;

      ALTER TABLE medical_preventive_events
      ADD CONSTRAINT medical_preventive_events_type_check CHECK (event_type IN ('vaccination', 'deworming'));

      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'medical_preventive_events_status_check'
          AND conrelid = 'medical_preventive_events'::regclass
      ) THEN
        ALTER TABLE medical_preventive_events DROP CONSTRAINT medical_preventive_events_status_check;
      END IF;

      ALTER TABLE medical_preventive_events
      ADD CONSTRAINT medical_preventive_events_status_check CHECK (status IN ('scheduled', 'completed', 'cancelled'));

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_medical_preventive_events_patient'
          AND conrelid = 'medical_preventive_events'::regclass
      ) THEN
        ALTER TABLE medical_preventive_events
        ADD CONSTRAINT fk_medical_preventive_events_patient
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_medical_preventive_events_product'
          AND conrelid = 'medical_preventive_events'::regclass
      ) THEN
        ALTER TABLE medical_preventive_events
        ADD CONSTRAINT fk_medical_preventive_events_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_sale_prescription_links_prescription'
          AND conrelid = 'sale_prescription_links'::regclass
      ) THEN
        ALTER TABLE sale_prescription_links
        ADD CONSTRAINT fk_sale_prescription_links_prescription
        FOREIGN KEY (prescription_id) REFERENCES medical_prescriptions(id) ON DELETE CASCADE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_sale_prescription_links_sale'
          AND conrelid = 'sale_prescription_links'::regclass
      ) THEN
        ALTER TABLE sale_prescription_links
        ADD CONSTRAINT fk_sale_prescription_links_sale
        FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE;
      END IF;

      -- Migration 49 — Fase 5 Parte B: sale_prescription_item_links FKs.
      -- prescription_item_id references medical_prescription_items(id)
      -- (public), same convention as fk_sale_prescription_links_prescription
      -- above referencing medical_prescriptions(id), not the healthcare.*
      -- mirror.
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_sale_prescription_item_links_sale_item'
          AND conrelid = 'sale_prescription_item_links'::regclass
      ) THEN
        ALTER TABLE sale_prescription_item_links
        ADD CONSTRAINT fk_sale_prescription_item_links_sale_item
        FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE CASCADE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_sale_prescription_item_links_prescription_item'
          AND conrelid = 'sale_prescription_item_links'::regclass
      ) THEN
        ALTER TABLE sale_prescription_item_links
        ADD CONSTRAINT fk_sale_prescription_item_links_prescription_item
        FOREIGN KEY (prescription_item_id) REFERENCES medical_prescription_items(id) ON DELETE CASCADE;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'sale_prescription_item_links_qty_check'
          AND conrelid = 'sale_prescription_item_links'::regclass
      ) THEN
        ALTER TABLE sale_prescription_item_links DROP CONSTRAINT sale_prescription_item_links_qty_check;
      END IF;

      ALTER TABLE sale_prescription_item_links
      ADD CONSTRAINT sale_prescription_item_links_qty_check CHECK (quantity_dispensed > 0);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
    `
  );
  console.log("[DB-FIX] Controlled enum constraints applied successfully.");

  await execQuery(
    client,
    `
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
        WHERE conname = 'products_unidad_de_venta_check'
          AND conrelid = 'products'::regclass
      ) THEN
        ALTER TABLE products
        ADD CONSTRAINT products_unidad_de_venta_check
        CHECK (unidad_de_venta IS NULL OR unidad_de_venta IN ('pieza', 'kg', 'litro', 'caja'));
      END IF;

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

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'business_subscriptions_plan_type_check'
          AND conrelid = 'business_subscriptions'::regclass
      ) THEN
        ALTER TABLE business_subscriptions
        ADD CONSTRAINT business_subscriptions_plan_type_check
        CHECK (plan_type IS NULL OR plan_type IN ('monthly', 'yearly'));
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'supplier_catalog_items_status_check'
          AND conrelid = 'supplier_catalog_items'::regclass
      ) THEN
        ALTER TABLE supplier_catalog_items
        ADD CONSTRAINT supplier_catalog_items_status_check
        CHECK (catalog_status IN ('new', 'pending', 'linked', 'cost_changed', 'cost_applied', 'inactive'));
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'automation_events_type_check'
          AND conrelid = 'automation_events'::regclass
      ) THEN
        ALTER TABLE automation_events
        ADD CONSTRAINT automation_events_type_check
        CHECK (event_type IN ('sale_created', 'low_stock_detected', 'credit_payment_received', 'product_created'));
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'appointments_area_check'
          AND conrelid = 'appointments'::regclass
      ) THEN
        ALTER TABLE appointments
        ADD CONSTRAINT appointments_area_check
        CHECK (area IN ('CLINICA', 'ESTETICA'));
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'appointments_status_check'
          AND conrelid = 'appointments'::regclass
      ) THEN
        ALTER TABLE appointments
        ADD CONSTRAINT appointments_status_check
        CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'));
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'appointments_time_check'
          AND conrelid = 'appointments'::regclass
      ) THEN
        ALTER TABLE appointments
        ADD CONSTRAINT appointments_time_check
        CHECK (end_time > start_time);
      END IF;
    END $$;
    `
  );

  await run(client, [
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_company_profiles_business_profile_key ON company_profiles(business_id, profile_key)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_business_subscriptions_business_id ON business_subscriptions(business_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_cuts_business_cut_date ON daily_cuts(business_id, cut_date)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_product_categories_business_name ON product_categories(business_id, LOWER(name))",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_templates_pos_type_type ON pos_templates(pos_type, type)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_catalog_items_supplier_code ON supplier_catalog_items(business_id, supplier_id, LOWER(supplier_product_code)) WHERE supplier_product_code IS NOT NULL AND BTRIM(supplier_product_code) <> ''",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_products_business_sku ON products(business_id, UPPER(sku)) WHERE sku IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_products_business_barcode ON products(business_id, UPPER(barcode)) WHERE barcode IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_reminders_business_source_key ON reminders(business_id, source_key) WHERE source_key IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_support_access_logs_active_actor ON support_access_logs(actor_user_id) WHERE ended_at IS NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_support_access_logs_session_token ON support_access_logs(support_session_token)",
    "CREATE INDEX IF NOT EXISTS idx_users_business_id ON users(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_suppliers_business_id ON suppliers(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_products_business_id ON products(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_products_business_catalog_type ON products(business_id, catalog_type)",
    "CREATE INDEX IF NOT EXISTS idx_products_business_image_path ON products(business_id) WHERE image_path IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_product_update_requests_business_status_created ON product_update_requests(business_id, status, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_product_update_requests_business_requester_created ON product_update_requests(business_id, requested_by_user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_product_update_requests_product_id ON product_update_requests(product_id)",
    "CREATE INDEX IF NOT EXISTS idx_product_suppliers_business_id ON product_suppliers(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_sales_business_id ON sales(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_sales_business_sale_date_status ON sales(business_id, sale_date, status)",
    "CREATE INDEX IF NOT EXISTS idx_sale_items_business_id ON sale_items(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_credit_payments_business_id ON credit_payments(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_daily_cuts_business_id ON daily_cuts(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_manual_cuts_business_cut_date ON manual_cuts(business_id, cut_date DESC, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_reminders_business_id ON reminders(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_reminders_business_category_due_date ON reminders(business_id, category, due_date)",
    "CREATE INDEX IF NOT EXISTS idx_reminders_patient_id ON reminders(patient_id)",
    "CREATE INDEX IF NOT EXISTS idx_product_categories_business_id ON product_categories(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_supplier_catalog_items_business_id ON supplier_catalog_items(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_supplier_catalog_items_supplier_id ON supplier_catalog_items(supplier_id)",
    "CREATE INDEX IF NOT EXISTS idx_supplier_catalog_items_product_id ON supplier_catalog_items(product_id)",
    "CREATE INDEX IF NOT EXISTS idx_supplier_catalog_items_status ON supplier_catalog_items(business_id, supplier_id, catalog_status, cost_changed)",
    "CREATE INDEX IF NOT EXISTS idx_supplier_catalog_items_name ON supplier_catalog_items(business_id, supplier_id, LOWER(supplier_product_name))",
    "CREATE INDEX IF NOT EXISTS idx_services_business_id ON services(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_automation_events_business_id ON automation_events(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_automation_events_processed ON automation_events(business_id, processed, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_expenses_business_id ON expenses(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_expenses_business_movement_type_date ON expenses(business_id, movement_type, date DESC)",
    "CREATE INDEX IF NOT EXISTS idx_owner_loans_business_id ON owner_loans(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_fixed_expenses_business_id ON fixed_expenses(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_product_restock_history_business_created ON product_restock_history(business_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_product_restock_history_business_product ON product_restock_history(business_id, product_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_product_restock_history_business_supplier ON product_restock_history(business_id, supplier_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_product_restock_history_business_product_name ON product_restock_history(business_id, LOWER(product_name_snapshot))",
    "CREATE INDEX IF NOT EXISTS idx_product_restock_history_business_category_name ON product_restock_history(business_id, LOWER(category_snapshot))",
    "CREATE INDEX IF NOT EXISTS idx_product_restock_history_business_supplier_name ON product_restock_history(business_id, LOWER(supplier_name_snapshot))",
    "CREATE INDEX IF NOT EXISTS idx_sales_credit_customer_name ON sales(business_id, LOWER(customer_name)) WHERE payment_method = 'credit' AND COALESCE(status, 'completed') <> 'cancelled'",
    "CREATE INDEX IF NOT EXISTS idx_sales_credit_customer_phone ON sales(business_id, customer_phone) WHERE payment_method = 'credit' AND COALESCE(status, 'completed') <> 'cancelled'",
    "CREATE INDEX IF NOT EXISTS idx_company_profiles_business_id ON company_profiles(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_business_subscriptions_next_payment_date ON business_subscriptions(next_payment_date)",
    "CREATE INDEX IF NOT EXISTS idx_company_stamp_movements_business_id ON company_stamp_movements(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_administrative_invoices_business_id ON administrative_invoices(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_administrative_invoices_sale_id ON administrative_invoices(sale_id)",
    "CREATE INDEX IF NOT EXISTS idx_administrative_invoices_status ON administrative_invoices(business_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_support_access_logs_business_id ON support_access_logs(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_support_access_logs_actor ON support_access_logs(actor_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_support_access_logs_session ON support_access_logs(support_session_token)",
    "CREATE INDEX IF NOT EXISTS idx_audit_logs_usuario_id ON audit_logs(usuario_id)",
    "CREATE INDEX IF NOT EXISTS idx_audit_logs_modulo ON audit_logs(modulo)",
    "CREATE INDEX IF NOT EXISTS idx_suppliers_name_lower ON suppliers ((LOWER(name)))",
    "CREATE INDEX IF NOT EXISTS idx_products_supplier_id ON products(supplier_id)",
    "CREATE INDEX IF NOT EXISTS idx_product_suppliers_product_id ON product_suppliers(product_id)",
    "CREATE INDEX IF NOT EXISTS idx_product_suppliers_supplier_id ON product_suppliers(supplier_id)",
    "CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales(sale_date)",
    "CREATE INDEX IF NOT EXISTS idx_sales_user_id ON sales(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_credit_payments_sale_id ON credit_payments(sale_id)",
    "CREATE INDEX IF NOT EXISTS idx_reminders_due_date ON reminders(due_date)",
    "CREATE INDEX IF NOT EXISTS idx_clients_business_id_active_name ON clients(business_id, is_active, LOWER(name))",
    "CREATE INDEX IF NOT EXISTS idx_clients_business_phone ON clients(business_id, phone)",
    "CREATE INDEX IF NOT EXISTS idx_clients_business_email ON clients(business_id, email)",
    "CREATE INDEX IF NOT EXISTS idx_patients_business_id_active_name ON patients(business_id, is_active, LOWER(name))",
    "CREATE INDEX IF NOT EXISTS idx_patients_client_id ON patients(business_id, client_id)",
    "CREATE INDEX IF NOT EXISTS idx_consultations_business_patient_date ON consultations(business_id, patient_id, consultation_date DESC)",
    "CREATE INDEX IF NOT EXISTS idx_medical_prescriptions_business_patient_created ON medical_prescriptions(business_id, patient_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_medical_prescriptions_consultation_id ON medical_prescriptions(consultation_id)",
    "CREATE INDEX IF NOT EXISTS idx_medical_prescriptions_doctor_user_id ON medical_prescriptions(doctor_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_medical_prescription_items_prescription_id ON medical_prescription_items(prescription_id)",
    "CREATE INDEX IF NOT EXISTS idx_medical_preventive_events_business_patient_date ON medical_preventive_events(business_id, patient_id, date_administered DESC)",
    "CREATE INDEX IF NOT EXISTS idx_medical_preventive_events_business_due_date ON medical_preventive_events(business_id, next_due_date)",
    "CREATE INDEX IF NOT EXISTS idx_sale_prescription_links_prescription_id ON sale_prescription_links(prescription_id)",
    "CREATE INDEX IF NOT EXISTS idx_sale_prescription_links_sale_id ON sale_prescription_links(sale_id)",
    "CREATE INDEX IF NOT EXISTS idx_sale_prescription_item_links_sale_item_id ON sale_prescription_item_links(sale_item_id)",
    "CREATE INDEX IF NOT EXISTS idx_sale_prescription_item_links_prescription_item_id ON sale_prescription_item_links(prescription_item_id)",
    "CREATE INDEX IF NOT EXISTS idx_consultations_business_client_date ON consultations(business_id, client_id, consultation_date DESC)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_business_date_area ON appointments(business_id, appointment_date, area, start_time, end_time)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_business_patient_date ON appointments(business_id, patient_id, appointment_date DESC)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_business_doctor_date ON appointments(business_id, doctor_user_id, appointment_date DESC)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_business_doctor_schedule ON appointments(business_id, doctor_user_id, appointment_date, status, start_time, end_time)",
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(64) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    "CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash ON password_reset_tokens(token_hash)",

    `CREATE TABLE IF NOT EXISTS business_addons (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      addon_key VARCHAR(50) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','inactive','suspended')),
      activated_at TIMESTAMPTZ,
      deactivated_at TIMESTAMPTZ,
      activated_by INTEGER REFERENCES users(id),
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(business_id, addon_key)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_business_addons_business_id ON business_addons(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_business_addons_key_status ON business_addons(addon_key, status)",

    `CREATE TABLE IF NOT EXISTS business_cfdi_config (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
      facturapi_org_id VARCHAR(120),
      facturapi_live_key VARCHAR(200),
      facturapi_test_key VARCHAR(200),
      pac_mode VARCHAR(20) NOT NULL DEFAULT 'test' CHECK (pac_mode IN ('test','production')),
      legal_name VARCHAR(200),
      rfc VARCHAR(13),
      tax_regime VARCHAR(10),
      zip_code VARCHAR(10),
      csd_uploaded BOOLEAN DEFAULT FALSE,
      csd_expires_at DATE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    `CREATE TABLE IF NOT EXISTS cfdi_invoices (
      id SERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      sale_id INTEGER REFERENCES sales(id),
      facturapi_invoice_id VARCHAR(120),
      folio_number INTEGER,
      series VARCHAR(10) DEFAULT 'A',
      status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','valid','canceled','cancellation_request')),
      total NUMERIC(12,2),
      pdf_url TEXT,
      xml_url TEXT,
      cfdi_use VARCHAR(10),
      payment_method VARCHAR(10),
      client_rfc VARCHAR(13),
      client_name VARCHAR(200),
      client_email VARCHAR(200),
      stamped_at TIMESTAMPTZ,
      canceled_at TIMESTAMPTZ,
      cancel_reason VARCHAR(200),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    "CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_business_id ON cfdi_invoices(business_id)",
    "CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_sale_id ON cfdi_invoices(sale_id)",
    "CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_status ON cfdi_invoices(business_id, status)",

    `ALTER TABLE subscription_payment_history
      ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'plan'
      CHECK (source IN ('plan','cfdi_addon'))`
  ]);
}

// Migration 45 — public.clients soft-delete unification. is_active becomes
// the operational source of truth for "is this client alive" everywhere
// (clientService.js, creditCollectionService.js); deleted_at stays as a
// historical/audit-only column, not dropped, not filtered on anymore. See
// infra/postgres/45-clients-unify-soft-delete.sql for the full rationale on
// why reconciling existing data this way is safe (no restore endpoint exists
// anywhere in the backend, no other module treats deleted_at as terminal).
// Idempotent — a second run touches zero rows once reconciled, and the
// DROP+CREATE INDEX pair is a no-op churn once the predicate matches.
async function ensureClientSoftDeleteReconciliation(client) {
  await run(client, [
    "UPDATE clients SET is_active = FALSE WHERE deleted_at IS NOT NULL AND is_active = TRUE",
    "DROP INDEX IF EXISTS clients_business_name_phone_uq",
    `CREATE UNIQUE INDEX IF NOT EXISTS clients_business_name_phone_uq
     ON clients (business_id, LOWER(TRIM(name)), COALESCE(LOWER(TRIM(phone)), ''))
     WHERE is_active = TRUE`
  ]);
}

// Migration 46 — public.appointments.client_id becomes nullable. Business
// decision: a rescued animal without a resolved owner/responsible party yet
// still needs to be able to receive care and have appointments scheduled.
// Same shape as migration 44 (healthcare.pets.owner_id -> nullable): a
// responsible party that isn't fixed at record-creation time, resolved later.
// The FK fk_appointments_client is untouched — Postgres never evaluates a
// simple FK when the column is NULL, so it keeps validating normally whenever
// client_id does carry a value. See infra/postgres/46-appointments-client-
// optional.sql for the full investigation notes (no CHECK/unique index on
// this column, no billing/report depends on it, dashboardService.js and
// reminderService.js never JOIN clients for appointments at all).
// Idempotent — DROP NOT NULL on an already-nullable column is a no-op.
async function ensureAppointmentsClientOptional(client) {
  await run(client, [
    "ALTER TABLE appointments ALTER COLUMN client_id DROP NOT NULL"
  ]);
}

// Migration 47 — Fase 4 schema prep for public.consultations: (a) client_id
// becomes nullable, same product decision/mechanics as migration 46 for
// appointments.client_id (a patient attended before a responsible party is
// resolved is a valid state — consultations never got this fix when 46 shipped
// for appointments). (b) appointment_id is added so a consultation can
// explicitly declare which appointment it resulted from — deliberately NOT
// backfilled by heuristic (see migration 39's same-patient/same-date heuristic,
// which only ever existed as a one-time backfill reconciliation because no FK
// ever linked appointments and consultations at all); for live writes an
// explicit, caller-declared link is the only non-ambiguous option. See
// infra/postgres/47-consultations-schema-fase4-prep.sql for the full
// investigation notes.
// Idempotent — DROP NOT NULL on an already-nullable column and
// ADD COLUMN IF NOT EXISTS are both no-ops on a second run.
async function ensureConsultationsSchemaFase4Prep(client) {
  await run(client, [
    "ALTER TABLE consultations ALTER COLUMN client_id DROP NOT NULL",
    "ALTER TABLE consultations ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id)",
    "CREATE INDEX IF NOT EXISTS idx_consultations_appointment_id ON consultations (business_id, appointment_id)"
  ]);
}

// Base DDL for the healthcare vertical: schema, tables, indexes, FKs,
// triggers and the antibiotic-book view from infra/postgres/14-healthcare-
// modular-expansion.sql (schema itself) and infra/postgres/33-healthcare-
// appointments-preventive.sql (appointments/preventive_events). Both source
// files were historically run manually via docker exec/psql against staging
// and production, never by this file — so a database whose only schema
// source is ensureDatabaseCompatibility() (no environment currently boots
// this way, but nothing guarantees one never will) never got healthcare.*
// at all, and every create/update touching a patient/pet/appointment/
// prescription/reminder would fail with "relation does not exist".
//
// Deliberately NOT replicated here: migrations 34/35/36 (backfill of
// legacy public.clients/public.patients rows into healthcare.pet_owners/
// patients/pets). Those are one-time historical data migrations, not
// schema — a database that only ever goes through this file has no legacy
// public.clients/public.patients rows to backfill in the first place (every
// row such a database ever gets is created after this schema already
// exists, through the create-time mirror sync in
// healthcareSubjectTranslation.js added across Fases 1-6). Re-running the
// 34/35/36 INSERT...SELECT statements here would just be a permanent
// no-op — dead code — on every database that actually needs this function.
//
// Every statement below is idempotent (IF NOT EXISTS / CREATE OR REPLACE /
// pg_constraint-guarded DO blocks), matching migrations 14 and 33 verbatim,
// so re-running this against a database that already has healthcare.* from
// the .sql files (staging, production) is a guaranteed no-op.
async function ensureHealthcareSchemaBase(client) {
  await run(client, [
    "CREATE SCHEMA IF NOT EXISTS healthcare",

    `CREATE OR REPLACE FUNCTION healthcare.touch_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$`,

    // Composite unique indexes on the public tables that healthcare.*
    // composite FKs (id, business_id) point at — required before any of
    // those FKs below can be created.
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_id_business_id ON users (id, business_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_products_id_business_id ON products (id, business_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_id_business_id ON sales (id, business_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_id_business_id ON clients (id, business_id)",

    `CREATE TABLE IF NOT EXISTS healthcare.business_modules (
      id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      module_key VARCHAR(80) NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      activated_at TIMESTAMPTZ,
      activated_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT business_modules_module_key_check CHECK (
        module_key IN (
          'clinical_core',
          'clinical_human',
          'clinical_dental',
          'veterinary_core',
          'pharmacy_core',
          'pharmacy_regulatory',
          'prescriptions',
          'dispensing',
          'inventory_batches',
          'temperature_humidity',
          'privacy_consents'
        )
      ),
      CONSTRAINT uq_business_modules UNIQUE (business_id, module_key)
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.patients (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      patient_code VARCHAR(60),
      first_name VARCHAR(120) NOT NULL,
      last_name VARCHAR(120) NOT NULL DEFAULT '',
      second_last_name VARCHAR(120) NOT NULL DEFAULT '',
      sex VARCHAR(20),
      birth_date DATE,
      blood_type VARCHAR(5),
      phone VARCHAR(40),
      email VARCHAR(120),
      address TEXT NOT NULL DEFAULT '',
      occupation VARCHAR(120),
      emergency_contact_name VARCHAR(180),
      emergency_contact_phone VARCHAR(40),
      allergies_summary TEXT NOT NULL DEFAULT '',
      chronic_conditions_summary TEXT NOT NULL DEFAULT '',
      privacy_level VARCHAR(20) NOT NULL DEFAULT 'standard',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT patients_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT uq_healthcare_patients_business_code UNIQUE (business_id, patient_code),
      CONSTRAINT patients_status_check CHECK (status IN ('active', 'inactive', 'deceased', 'blocked')),
      CONSTRAINT patients_privacy_level_check CHECK (privacy_level IN ('standard', 'restricted', 'highly_restricted')),
      CONSTRAINT patients_sex_check CHECK (sex IS NULL OR sex IN ('female', 'male', 'intersex', 'unspecified'))
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.clinical_encounters (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      patient_id BIGINT NOT NULL,
      clinician_user_id INTEGER REFERENCES public.users(id),
      encounter_type VARCHAR(30) NOT NULL DEFAULT 'consultation',
      encounter_status VARCHAR(20) NOT NULL DEFAULT 'completed',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      reason_for_visit TEXT NOT NULL DEFAULT '',
      triage_summary TEXT NOT NULL DEFAULT '',
      subjective_summary TEXT NOT NULL DEFAULT '',
      objective_summary TEXT NOT NULL DEFAULT '',
      assessment_summary TEXT NOT NULL DEFAULT '',
      plan_summary TEXT NOT NULL DEFAULT '',
      follow_up_instructions TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT clinical_encounters_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT clinical_encounters_type_check CHECK (encounter_type IN ('consultation', 'follow_up', 'urgent_care', 'procedure', 'dental')),
      CONSTRAINT clinical_encounters_status_check CHECK (encounter_status IN ('draft', 'in_progress', 'completed', 'cancelled')),
      CONSTRAINT clinical_encounters_row_status_check CHECK (status IN ('active', 'amended', 'entered_in_error')),
      CONSTRAINT clinical_encounters_time_check CHECK (ended_at IS NULL OR ended_at >= started_at)
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.vital_sign_records (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      encounter_id BIGINT NOT NULL,
      patient_id BIGINT NOT NULL,
      measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      temperature_c NUMERIC(5,2),
      systolic_bp NUMERIC(6,2),
      diastolic_bp NUMERIC(6,2),
      heart_rate_bpm NUMERIC(6,2),
      respiratory_rate_bpm NUMERIC(6,2),
      oxygen_saturation NUMERIC(5,2),
      weight_kg NUMERIC(8,3),
      height_cm NUMERIC(8,2),
      glucose_mg_dl NUMERIC(8,2),
      bmi NUMERIC(8,2),
      notes TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT vital_sign_records_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT vital_sign_records_status_check CHECK (status IN ('active', 'corrected'))
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.clinical_notes (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      encounter_id BIGINT NOT NULL,
      patient_id BIGINT NOT NULL,
      note_type VARCHAR(30) NOT NULL DEFAULT 'progress',
      note_text TEXT NOT NULL,
      authored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      appended_to_note_id BIGINT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT clinical_notes_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT clinical_notes_type_check CHECK (note_type IN ('initial', 'progress', 'evolution', 'procedure', 'discharge', 'correction')),
      CONSTRAINT clinical_notes_status_check CHECK (status IN ('active', 'corrected', 'entered_in_error'))
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.diagnoses (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      encounter_id BIGINT NOT NULL,
      patient_id BIGINT NOT NULL,
      diagnosis_code VARCHAR(40),
      diagnosis_label VARCHAR(255) NOT NULL,
      diagnosis_type VARCHAR(20) NOT NULL DEFAULT 'primary',
      diagnosis_status VARCHAR(20) NOT NULL DEFAULT 'active',
      diagnosed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      notes TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT diagnoses_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT diagnoses_type_check CHECK (diagnosis_type IN ('primary', 'secondary', 'presumptive', 'differential')),
      CONSTRAINT diagnoses_status_check CHECK (diagnosis_status IN ('active', 'resolved', 'ruled_out', 'corrected'))
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.prescriptions (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      folio_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      subject_type VARCHAR(20) NOT NULL,
      patient_id BIGINT,
      pet_id BIGINT,
      clinical_encounter_id BIGINT,
      veterinary_encounter_id BIGINT,
      prescriber_user_id INTEGER REFERENCES public.users(id),
      document_folio_id BIGINT,
      prescription_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      valid_until TIMESTAMPTZ,
      indications_general TEXT NOT NULL DEFAULT '',
      diagnosis_summary TEXT NOT NULL DEFAULT '',
      issue_status VARCHAR(20) NOT NULL DEFAULT 'issued',
      regulatory_scope VARCHAR(20) NOT NULL DEFAULT 'standard',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT prescriptions_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT prescriptions_folio_uuid_unique UNIQUE (folio_uuid),
      CONSTRAINT prescriptions_subject_check CHECK (subject_type IN ('human', 'pet')),
      CONSTRAINT prescriptions_issue_status_check CHECK (issue_status IN ('draft', 'issued', 'partially_dispensed', 'fully_dispensed', 'cancelled', 'expired')),
      CONSTRAINT prescriptions_regulatory_scope_check CHECK (regulatory_scope IN ('standard', 'antibiotic', 'controlled')),
      CONSTRAINT prescriptions_row_status_check CHECK (status IN ('active', 'corrected', 'entered_in_error')),
      CONSTRAINT prescriptions_subject_fk_check CHECK (
        (subject_type = 'human' AND patient_id IS NOT NULL AND pet_id IS NULL)
        OR
        (subject_type = 'pet' AND pet_id IS NOT NULL AND patient_id IS NULL)
      )
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.prescription_items (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      prescription_id BIGINT NOT NULL,
      product_id INTEGER NOT NULL,
      medication_catalog_id BIGINT,
      line_number INTEGER NOT NULL DEFAULT 1,
      item_type VARCHAR(20) NOT NULL DEFAULT 'medication',
      prescribed_quantity NUMERIC(14,3) NOT NULL,
      dispensed_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
      dose VARCHAR(120),
      route VARCHAR(120),
      frequency VARCHAR(120),
      duration VARCHAR(120),
      instructions TEXT NOT NULL DEFAULT '',
      substitution_allowed BOOLEAN NOT NULL DEFAULT FALSE,
      requires_batch_tracking BOOLEAN NOT NULL DEFAULT FALSE,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT prescription_items_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT prescription_items_type_check CHECK (item_type IN ('medication', 'supply', 'service')),
      CONSTRAINT prescription_items_status_check CHECK (status IN ('active', 'partially_dispensed', 'fully_dispensed', 'cancelled', 'corrected')),
      CONSTRAINT prescription_items_qty_check CHECK (prescribed_quantity > 0 AND dispensed_quantity >= 0 AND dispensed_quantity <= prescribed_quantity)
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.pet_owners (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      client_id INTEGER,
      owner_code VARCHAR(60),
      first_name VARCHAR(120) NOT NULL,
      last_name VARCHAR(120) NOT NULL DEFAULT '',
      phone VARCHAR(40),
      email VARCHAR(120),
      address TEXT NOT NULL DEFAULT '',
      tax_id VARCHAR(60),
      notes TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT pet_owners_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT uq_pet_owners_business_code UNIQUE (business_id, owner_code),
      CONSTRAINT pet_owners_status_check CHECK (status IN ('active', 'inactive', 'blocked'))
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.pets (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      owner_id BIGINT NOT NULL,
      pet_code VARCHAR(60),
      name VARCHAR(150) NOT NULL,
      species VARCHAR(120) NOT NULL,
      breed VARCHAR(120),
      sex VARCHAR(20),
      color_markings VARCHAR(120),
      birth_date DATE,
      weight_kg NUMERIC(8,3),
      sterilized BOOLEAN NOT NULL DEFAULT FALSE,
      microchip_number VARCHAR(80),
      allergies_summary TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT pets_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT uq_pets_business_code UNIQUE (business_id, pet_code),
      CONSTRAINT pets_status_check CHECK (status IN ('active', 'inactive', 'deceased', 'blocked')),
      CONSTRAINT pets_sex_check CHECK (sex IS NULL OR sex IN ('female', 'male', 'intersex', 'unspecified'))
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.veterinary_encounters (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      pet_id BIGINT NOT NULL,
      owner_id BIGINT NOT NULL,
      veterinarian_user_id INTEGER REFERENCES public.users(id),
      encounter_type VARCHAR(30) NOT NULL DEFAULT 'consultation',
      encounter_status VARCHAR(20) NOT NULL DEFAULT 'completed',
      encounter_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      chief_complaint TEXT NOT NULL DEFAULT '',
      anamnesis TEXT NOT NULL DEFAULT '',
      physical_exam TEXT NOT NULL DEFAULT '',
      assessment TEXT NOT NULL DEFAULT '',
      plan TEXT NOT NULL DEFAULT '',
      weight_kg NUMERIC(8,3),
      temperature_c NUMERIC(5,2),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT veterinary_encounters_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT veterinary_encounters_type_check CHECK (encounter_type IN ('consultation', 'vaccination', 'surgery', 'grooming', 'follow_up', 'emergency')),
      CONSTRAINT veterinary_encounters_status_check CHECK (encounter_status IN ('draft', 'in_progress', 'completed', 'cancelled')),
      CONSTRAINT veterinary_encounters_row_status_check CHECK (status IN ('active', 'amended', 'entered_in_error'))
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.veterinary_notes (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      veterinary_encounter_id BIGINT NOT NULL,
      pet_id BIGINT NOT NULL,
      note_type VARCHAR(30) NOT NULL DEFAULT 'progress',
      note_text TEXT NOT NULL,
      authored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      appended_to_note_id BIGINT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT veterinary_notes_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT veterinary_notes_type_check CHECK (note_type IN ('initial', 'progress', 'evolution', 'procedure', 'correction')),
      CONSTRAINT veterinary_notes_status_check CHECK (status IN ('active', 'corrected', 'entered_in_error'))
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.veterinary_treatments (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      veterinary_encounter_id BIGINT NOT NULL,
      pet_id BIGINT NOT NULL,
      product_id INTEGER,
      treatment_type VARCHAR(30) NOT NULL DEFAULT 'medication',
      treatment_name VARCHAR(255) NOT NULL,
      dose VARCHAR(120),
      route VARCHAR(120),
      frequency VARCHAR(120),
      duration VARCHAR(120),
      quantity NUMERIC(14,3),
      instructions TEXT NOT NULL DEFAULT '',
      administered_in_house BOOLEAN NOT NULL DEFAULT FALSE,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT veterinary_treatments_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT veterinary_treatments_type_check CHECK (treatment_type IN ('medication', 'procedure', 'vaccination', 'diet', 'care')),
      CONSTRAINT veterinary_treatments_status_check CHECK (status IN ('active', 'stopped', 'completed', 'corrected'))
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.medication_catalog (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      product_id INTEGER NOT NULL,
      active_ingredient VARCHAR(255) NOT NULL,
      strength VARCHAR(120),
      dosage_form VARCHAR(120),
      route_of_administration VARCHAR(120),
      requires_prescription BOOLEAN NOT NULL DEFAULT FALSE,
      is_antibiotic BOOLEAN NOT NULL DEFAULT FALSE,
      is_controlled_substance BOOLEAN NOT NULL DEFAULT FALSE,
      control_schedule VARCHAR(40),
      sanitary_registration VARCHAR(80),
      fraction_type VARCHAR(20) NOT NULL DEFAULT 'unit',
      target_species VARCHAR(120),
      storage_notes TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT medication_catalog_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT uq_medication_catalog_business_product UNIQUE (business_id, product_id),
      CONSTRAINT medication_catalog_fraction_type_check CHECK (fraction_type IN ('unit', 'blister', 'box', 'ml', 'g')),
      CONSTRAINT medication_catalog_status_check CHECK (status IN ('active', 'inactive', 'archived'))
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.inventory_batches (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      product_id INTEGER NOT NULL,
      medication_catalog_id BIGINT,
      supplier_id INTEGER REFERENCES public.suppliers(id),
      batch_number VARCHAR(120) NOT NULL,
      serial_reference VARCHAR(120),
      manufactured_at DATE,
      expiry_date DATE NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      quantity_received NUMERIC(14,3) NOT NULL,
      quantity_available NUMERIC(14,3) NOT NULL,
      unit_cost NUMERIC(14,5),
      purchase_reference VARCHAR(120),
      storage_location VARCHAR(120),
      quarantine_status VARCHAR(20) NOT NULL DEFAULT 'released',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT inventory_batches_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT uq_inventory_batches_business_product_batch UNIQUE (business_id, product_id, batch_number),
      CONSTRAINT inventory_batches_qty_check CHECK (quantity_received > 0 AND quantity_available >= 0 AND quantity_available <= quantity_received),
      CONSTRAINT inventory_batches_quarantine_status_check CHECK (quarantine_status IN ('released', 'quarantine', 'blocked', 'expired')),
      CONSTRAINT inventory_batches_status_check CHECK (status IN ('active', 'depleted', 'expired', 'blocked'))
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.dispensing_logs (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      folio_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      prescription_id BIGINT,
      prescription_item_id BIGINT,
      sale_id INTEGER,
      product_id INTEGER NOT NULL,
      batch_id BIGINT NOT NULL,
      subject_type VARCHAR(20) NOT NULL,
      patient_id BIGINT,
      pet_id BIGINT,
      dispensed_quantity NUMERIC(14,3) NOT NULL,
      unit_of_measure VARCHAR(30) NOT NULL DEFAULT 'pieza',
      dispensed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      dispensed_by_user_id INTEGER REFERENCES public.users(id),
      requires_prescription BOOLEAN NOT NULL DEFAULT FALSE,
      prescription_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      notes TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'dispensed',
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT dispensing_logs_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT dispensing_logs_folio_uuid_unique UNIQUE (folio_uuid),
      CONSTRAINT dispensing_logs_subject_check CHECK (subject_type IN ('human', 'pet', 'anonymous')),
      CONSTRAINT dispensing_logs_qty_check CHECK (dispensed_quantity > 0),
      CONSTRAINT dispensing_logs_status_check CHECK (status IN ('prepared', 'dispensed', 'reversed', 'corrected')),
      CONSTRAINT dispensing_logs_subject_fk_check CHECK (
        (subject_type = 'human' AND patient_id IS NOT NULL AND pet_id IS NULL)
        OR
        (subject_type = 'pet' AND pet_id IS NOT NULL AND patient_id IS NULL)
        OR
        (subject_type = 'anonymous' AND patient_id IS NULL AND pet_id IS NULL)
      )
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.antibiotic_dispensing_logs (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      dispensing_log_id BIGINT NOT NULL,
      prescription_id BIGINT,
      physician_name VARCHAR(255) NOT NULL,
      physician_license VARCHAR(80) NOT NULL,
      physician_institution VARCHAR(255),
      diagnosis_reference VARCHAR(255),
      retention_required BOOLEAN NOT NULL DEFAULT TRUE,
      retention_reference VARCHAR(120),
      book_entry_number VARCHAR(60),
      notes TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'recorded',
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT antibiotic_dispensing_logs_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT uq_antibiotic_dispensing_log UNIQUE (business_id, dispensing_log_id),
      CONSTRAINT antibiotic_dispensing_logs_status_check CHECK (status IN ('recorded', 'corrected'))
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.controlled_substance_ledger (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      folio_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      product_id INTEGER NOT NULL,
      batch_id BIGINT,
      related_dispensing_log_id BIGINT,
      movement_type VARCHAR(20) NOT NULL,
      movement_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      quantity NUMERIC(14,3) NOT NULL,
      quantity_balance NUMERIC(14,3) NOT NULL DEFAULT 0,
      reference_document VARCHAR(120),
      reason TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'posted',
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT controlled_substance_ledger_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT controlled_substance_ledger_folio_uuid_unique UNIQUE (folio_uuid),
      CONSTRAINT controlled_substance_ledger_type_check CHECK (movement_type IN ('purchase', 'dispense', 'adjustment_in', 'adjustment_out', 'return', 'destruction')),
      CONSTRAINT controlled_substance_ledger_status_check CHECK (status IN ('posted', 'corrected')),
      CONSTRAINT controlled_substance_ledger_qty_check CHECK (quantity > 0 AND quantity_balance >= 0)
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.temperature_humidity_logs (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      area_code VARCHAR(80) NOT NULL,
      measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      temperature_c NUMERIC(5,2) NOT NULL,
      humidity_percent NUMERIC(5,2),
      min_temperature_c NUMERIC(5,2),
      max_temperature_c NUMERIC(5,2),
      device_reference VARCHAR(120),
      notes TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'recorded',
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT temperature_humidity_logs_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT temperature_humidity_logs_status_check CHECK (status IN ('recorded', 'corrected')),
      CONSTRAINT temperature_humidity_logs_humidity_check CHECK (humidity_percent IS NULL OR (humidity_percent >= 0 AND humidity_percent <= 100))
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.document_folios (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      document_type VARCHAR(40) NOT NULL,
      series VARCHAR(20) NOT NULL DEFAULT 'A',
      folio_number BIGINT NOT NULL,
      folio_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      related_table VARCHAR(80),
      related_record_uuid UUID,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status VARCHAR(20) NOT NULL DEFAULT 'issued',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT document_folios_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT document_folios_folio_uuid_unique UNIQUE (folio_uuid),
      CONSTRAINT uq_document_folios_business_series_number UNIQUE (business_id, document_type, series, folio_number),
      CONSTRAINT document_folios_type_check CHECK (document_type IN ('prescription', 'dispensing', 'antibiotic_book', 'controlled_ledger', 'consent')),
      CONSTRAINT document_folios_status_check CHECK (status IN ('issued', 'voided', 'replaced'))
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.record_corrections (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      target_table VARCHAR(80) NOT NULL,
      target_record_uuid UUID NOT NULL,
      correction_type VARCHAR(30) NOT NULL DEFAULT 'append_note',
      original_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      corrected_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      correction_note TEXT NOT NULL,
      reason TEXT NOT NULL,
      corrected_by INTEGER NOT NULL REFERENCES public.users(id),
      corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'applied',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT record_corrections_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT record_corrections_type_check CHECK (correction_type IN ('append_note', 'regulatory_correction', 'metadata_fix')),
      CONSTRAINT record_corrections_status_check CHECK (status IN ('applied'))
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.access_audit_logs (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      actor_user_id INTEGER NOT NULL REFERENCES public.users(id),
      access_type VARCHAR(30) NOT NULL,
      target_table VARCHAR(80) NOT NULL,
      target_record_uuid UUID,
      target_business_id INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      ip_address INET,
      user_agent TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT access_audit_logs_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT access_audit_logs_type_check CHECK (access_type IN ('view', 'search', 'export', 'print', 'open_prescription', 'open_record'))
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.privacy_consents (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      subject_type VARCHAR(20) NOT NULL,
      patient_id BIGINT,
      owner_id BIGINT,
      consent_type VARCHAR(40) NOT NULL,
      granted BOOLEAN NOT NULL DEFAULT TRUE,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      document_folio_id BIGINT,
      notes TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT privacy_consents_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT privacy_consents_subject_check CHECK (subject_type IN ('human', 'owner')),
      CONSTRAINT privacy_consents_type_check CHECK (consent_type IN ('privacy_notice', 'treatment', 'data_sharing', 'surgery', 'controlled_dispensing')),
      CONSTRAINT privacy_consents_status_check CHECK (status IN ('active', 'revoked', 'expired')),
      CONSTRAINT privacy_consents_subject_fk_check CHECK (
        (subject_type = 'human' AND patient_id IS NOT NULL AND owner_id IS NULL)
        OR
        (subject_type = 'owner' AND owner_id IS NOT NULL AND patient_id IS NULL)
      )
    )`,

    "CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_patients_id_business ON healthcare.patients (id, business_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_clinical_encounters_id_business ON healthcare.clinical_encounters (id, business_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_prescriptions_id_business ON healthcare.prescriptions (id, business_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_prescription_items_id_business ON healthcare.prescription_items (id, business_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_pet_owners_id_business ON healthcare.pet_owners (id, business_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_pets_id_business ON healthcare.pets (id, business_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_veterinary_encounters_id_business ON healthcare.veterinary_encounters (id, business_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_medication_catalog_id_business ON healthcare.medication_catalog (id, business_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_inventory_batches_id_business ON healthcare.inventory_batches (id, business_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_dispensing_logs_id_business ON healthcare.dispensing_logs (id, business_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_document_folios_id_business ON healthcare.document_folios (id, business_id)"
  ]);

  // FK constraints from migration 14 — split into the same four DO $$ blocks
  // as the source .sql file (patients/encounters/prescriptions side, pets/
  // veterinary side, dispensing/controlled-ledger side, cross-cutting side),
  // each guarded by pg_constraint so re-running is a no-op.
  await execQuery(
    client,
    `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_clinical_encounters_patient' AND conrelid = 'healthcare.clinical_encounters'::regclass) THEN
        ALTER TABLE healthcare.clinical_encounters ADD CONSTRAINT fk_healthcare_clinical_encounters_patient FOREIGN KEY (patient_id, business_id) REFERENCES healthcare.patients (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_vital_sign_records_encounter' AND conrelid = 'healthcare.vital_sign_records'::regclass) THEN
        ALTER TABLE healthcare.vital_sign_records ADD CONSTRAINT fk_healthcare_vital_sign_records_encounter FOREIGN KEY (encounter_id, business_id) REFERENCES healthcare.clinical_encounters (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_vital_sign_records_patient' AND conrelid = 'healthcare.vital_sign_records'::regclass) THEN
        ALTER TABLE healthcare.vital_sign_records ADD CONSTRAINT fk_healthcare_vital_sign_records_patient FOREIGN KEY (patient_id, business_id) REFERENCES healthcare.patients (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_clinical_notes_encounter' AND conrelid = 'healthcare.clinical_notes'::regclass) THEN
        ALTER TABLE healthcare.clinical_notes ADD CONSTRAINT fk_healthcare_clinical_notes_encounter FOREIGN KEY (encounter_id, business_id) REFERENCES healthcare.clinical_encounters (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_clinical_notes_patient' AND conrelid = 'healthcare.clinical_notes'::regclass) THEN
        ALTER TABLE healthcare.clinical_notes ADD CONSTRAINT fk_healthcare_clinical_notes_patient FOREIGN KEY (patient_id, business_id) REFERENCES healthcare.patients (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_clinical_notes_parent' AND conrelid = 'healthcare.clinical_notes'::regclass) THEN
        ALTER TABLE healthcare.clinical_notes ADD CONSTRAINT fk_healthcare_clinical_notes_parent FOREIGN KEY (appended_to_note_id) REFERENCES healthcare.clinical_notes (id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_diagnoses_encounter' AND conrelid = 'healthcare.diagnoses'::regclass) THEN
        ALTER TABLE healthcare.diagnoses ADD CONSTRAINT fk_healthcare_diagnoses_encounter FOREIGN KEY (encounter_id, business_id) REFERENCES healthcare.clinical_encounters (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_diagnoses_patient' AND conrelid = 'healthcare.diagnoses'::regclass) THEN
        ALTER TABLE healthcare.diagnoses ADD CONSTRAINT fk_healthcare_diagnoses_patient FOREIGN KEY (patient_id, business_id) REFERENCES healthcare.patients (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_prescriptions_patient' AND conrelid = 'healthcare.prescriptions'::regclass) THEN
        ALTER TABLE healthcare.prescriptions ADD CONSTRAINT fk_healthcare_prescriptions_patient FOREIGN KEY (patient_id, business_id) REFERENCES healthcare.patients (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_prescriptions_clinical_encounter' AND conrelid = 'healthcare.prescriptions'::regclass) THEN
        ALTER TABLE healthcare.prescriptions ADD CONSTRAINT fk_healthcare_prescriptions_clinical_encounter FOREIGN KEY (clinical_encounter_id, business_id) REFERENCES healthcare.clinical_encounters (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_prescription_items_prescription' AND conrelid = 'healthcare.prescription_items'::regclass) THEN
        ALTER TABLE healthcare.prescription_items ADD CONSTRAINT fk_healthcare_prescription_items_prescription FOREIGN KEY (prescription_id, business_id) REFERENCES healthcare.prescriptions (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_prescription_items_product' AND conrelid = 'healthcare.prescription_items'::regclass) THEN
        ALTER TABLE healthcare.prescription_items ADD CONSTRAINT fk_healthcare_prescription_items_product FOREIGN KEY (product_id, business_id) REFERENCES public.products (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_prescription_items_medication_catalog' AND conrelid = 'healthcare.prescription_items'::regclass) THEN
        ALTER TABLE healthcare.prescription_items ADD CONSTRAINT fk_healthcare_prescription_items_medication_catalog FOREIGN KEY (medication_catalog_id, business_id) REFERENCES healthcare.medication_catalog (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_pet_owners_client' AND conrelid = 'healthcare.pet_owners'::regclass) THEN
        ALTER TABLE healthcare.pet_owners ADD CONSTRAINT fk_healthcare_pet_owners_client FOREIGN KEY (client_id, business_id) REFERENCES public.clients (id, business_id);
      END IF;
    END $$;
    `
  );

  await execQuery(
    client,
    `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_pets_owner' AND conrelid = 'healthcare.pets'::regclass) THEN
        ALTER TABLE healthcare.pets ADD CONSTRAINT fk_healthcare_pets_owner FOREIGN KEY (owner_id, business_id) REFERENCES healthcare.pet_owners (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_veterinary_encounters_pet' AND conrelid = 'healthcare.veterinary_encounters'::regclass) THEN
        ALTER TABLE healthcare.veterinary_encounters ADD CONSTRAINT fk_healthcare_veterinary_encounters_pet FOREIGN KEY (pet_id, business_id) REFERENCES healthcare.pets (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_veterinary_encounters_owner' AND conrelid = 'healthcare.veterinary_encounters'::regclass) THEN
        ALTER TABLE healthcare.veterinary_encounters ADD CONSTRAINT fk_healthcare_veterinary_encounters_owner FOREIGN KEY (owner_id, business_id) REFERENCES healthcare.pet_owners (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_veterinary_notes_encounter' AND conrelid = 'healthcare.veterinary_notes'::regclass) THEN
        ALTER TABLE healthcare.veterinary_notes ADD CONSTRAINT fk_healthcare_veterinary_notes_encounter FOREIGN KEY (veterinary_encounter_id, business_id) REFERENCES healthcare.veterinary_encounters (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_veterinary_notes_pet' AND conrelid = 'healthcare.veterinary_notes'::regclass) THEN
        ALTER TABLE healthcare.veterinary_notes ADD CONSTRAINT fk_healthcare_veterinary_notes_pet FOREIGN KEY (pet_id, business_id) REFERENCES healthcare.pets (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_veterinary_notes_parent' AND conrelid = 'healthcare.veterinary_notes'::regclass) THEN
        ALTER TABLE healthcare.veterinary_notes ADD CONSTRAINT fk_healthcare_veterinary_notes_parent FOREIGN KEY (appended_to_note_id) REFERENCES healthcare.veterinary_notes (id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_veterinary_treatments_encounter' AND conrelid = 'healthcare.veterinary_treatments'::regclass) THEN
        ALTER TABLE healthcare.veterinary_treatments ADD CONSTRAINT fk_healthcare_veterinary_treatments_encounter FOREIGN KEY (veterinary_encounter_id, business_id) REFERENCES healthcare.veterinary_encounters (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_veterinary_treatments_pet' AND conrelid = 'healthcare.veterinary_treatments'::regclass) THEN
        ALTER TABLE healthcare.veterinary_treatments ADD CONSTRAINT fk_healthcare_veterinary_treatments_pet FOREIGN KEY (pet_id, business_id) REFERENCES healthcare.pets (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_veterinary_treatments_product' AND conrelid = 'healthcare.veterinary_treatments'::regclass) THEN
        ALTER TABLE healthcare.veterinary_treatments ADD CONSTRAINT fk_healthcare_veterinary_treatments_product FOREIGN KEY (product_id, business_id) REFERENCES public.products (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_medication_catalog_product' AND conrelid = 'healthcare.medication_catalog'::regclass) THEN
        ALTER TABLE healthcare.medication_catalog ADD CONSTRAINT fk_healthcare_medication_catalog_product FOREIGN KEY (product_id, business_id) REFERENCES public.products (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_inventory_batches_product' AND conrelid = 'healthcare.inventory_batches'::regclass) THEN
        ALTER TABLE healthcare.inventory_batches ADD CONSTRAINT fk_healthcare_inventory_batches_product FOREIGN KEY (product_id, business_id) REFERENCES public.products (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_inventory_batches_medication_catalog' AND conrelid = 'healthcare.inventory_batches'::regclass) THEN
        ALTER TABLE healthcare.inventory_batches ADD CONSTRAINT fk_healthcare_inventory_batches_medication_catalog FOREIGN KEY (medication_catalog_id, business_id) REFERENCES healthcare.medication_catalog (id, business_id);
      END IF;
    END $$;
    `
  );

  await execQuery(
    client,
    `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_dispensing_logs_prescription' AND conrelid = 'healthcare.dispensing_logs'::regclass) THEN
        ALTER TABLE healthcare.dispensing_logs ADD CONSTRAINT fk_healthcare_dispensing_logs_prescription FOREIGN KEY (prescription_id, business_id) REFERENCES healthcare.prescriptions (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_dispensing_logs_prescription_item' AND conrelid = 'healthcare.dispensing_logs'::regclass) THEN
        ALTER TABLE healthcare.dispensing_logs ADD CONSTRAINT fk_healthcare_dispensing_logs_prescription_item FOREIGN KEY (prescription_item_id, business_id) REFERENCES healthcare.prescription_items (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_dispensing_logs_sale' AND conrelid = 'healthcare.dispensing_logs'::regclass) THEN
        ALTER TABLE healthcare.dispensing_logs ADD CONSTRAINT fk_healthcare_dispensing_logs_sale FOREIGN KEY (sale_id, business_id) REFERENCES public.sales (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_dispensing_logs_product' AND conrelid = 'healthcare.dispensing_logs'::regclass) THEN
        ALTER TABLE healthcare.dispensing_logs ADD CONSTRAINT fk_healthcare_dispensing_logs_product FOREIGN KEY (product_id, business_id) REFERENCES public.products (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_dispensing_logs_batch' AND conrelid = 'healthcare.dispensing_logs'::regclass) THEN
        ALTER TABLE healthcare.dispensing_logs ADD CONSTRAINT fk_healthcare_dispensing_logs_batch FOREIGN KEY (batch_id, business_id) REFERENCES healthcare.inventory_batches (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_dispensing_logs_patient' AND conrelid = 'healthcare.dispensing_logs'::regclass) THEN
        ALTER TABLE healthcare.dispensing_logs ADD CONSTRAINT fk_healthcare_dispensing_logs_patient FOREIGN KEY (patient_id, business_id) REFERENCES healthcare.patients (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_dispensing_logs_pet' AND conrelid = 'healthcare.dispensing_logs'::regclass) THEN
        ALTER TABLE healthcare.dispensing_logs ADD CONSTRAINT fk_healthcare_dispensing_logs_pet FOREIGN KEY (pet_id, business_id) REFERENCES healthcare.pets (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_antibiotic_dispensing_logs_dispensing' AND conrelid = 'healthcare.antibiotic_dispensing_logs'::regclass) THEN
        ALTER TABLE healthcare.antibiotic_dispensing_logs ADD CONSTRAINT fk_healthcare_antibiotic_dispensing_logs_dispensing FOREIGN KEY (dispensing_log_id, business_id) REFERENCES healthcare.dispensing_logs (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_antibiotic_dispensing_logs_prescription' AND conrelid = 'healthcare.antibiotic_dispensing_logs'::regclass) THEN
        ALTER TABLE healthcare.antibiotic_dispensing_logs ADD CONSTRAINT fk_healthcare_antibiotic_dispensing_logs_prescription FOREIGN KEY (prescription_id, business_id) REFERENCES healthcare.prescriptions (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_controlled_ledger_product' AND conrelid = 'healthcare.controlled_substance_ledger'::regclass) THEN
        ALTER TABLE healthcare.controlled_substance_ledger ADD CONSTRAINT fk_healthcare_controlled_ledger_product FOREIGN KEY (product_id, business_id) REFERENCES public.products (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_controlled_ledger_batch' AND conrelid = 'healthcare.controlled_substance_ledger'::regclass) THEN
        ALTER TABLE healthcare.controlled_substance_ledger ADD CONSTRAINT fk_healthcare_controlled_ledger_batch FOREIGN KEY (batch_id, business_id) REFERENCES healthcare.inventory_batches (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_controlled_ledger_dispensing' AND conrelid = 'healthcare.controlled_substance_ledger'::regclass) THEN
        ALTER TABLE healthcare.controlled_substance_ledger ADD CONSTRAINT fk_healthcare_controlled_ledger_dispensing FOREIGN KEY (related_dispensing_log_id, business_id) REFERENCES healthcare.dispensing_logs (id, business_id);
      END IF;
    END $$;
    `
  );

  await execQuery(
    client,
    `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_prescriptions_veterinary_encounter' AND conrelid = 'healthcare.prescriptions'::regclass) THEN
        ALTER TABLE healthcare.prescriptions ADD CONSTRAINT fk_healthcare_prescriptions_veterinary_encounter FOREIGN KEY (veterinary_encounter_id, business_id) REFERENCES healthcare.veterinary_encounters (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_prescriptions_pet' AND conrelid = 'healthcare.prescriptions'::regclass) THEN
        ALTER TABLE healthcare.prescriptions ADD CONSTRAINT fk_healthcare_prescriptions_pet FOREIGN KEY (pet_id, business_id) REFERENCES healthcare.pets (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_prescriptions_document_folio' AND conrelid = 'healthcare.prescriptions'::regclass) THEN
        ALTER TABLE healthcare.prescriptions ADD CONSTRAINT fk_healthcare_prescriptions_document_folio FOREIGN KEY (document_folio_id, business_id) REFERENCES healthcare.document_folios (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_privacy_consents_patient' AND conrelid = 'healthcare.privacy_consents'::regclass) THEN
        ALTER TABLE healthcare.privacy_consents ADD CONSTRAINT fk_healthcare_privacy_consents_patient FOREIGN KEY (patient_id, business_id) REFERENCES healthcare.patients (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_privacy_consents_owner' AND conrelid = 'healthcare.privacy_consents'::regclass) THEN
        ALTER TABLE healthcare.privacy_consents ADD CONSTRAINT fk_healthcare_privacy_consents_owner FOREIGN KEY (owner_id, business_id) REFERENCES healthcare.pet_owners (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_privacy_consents_document_folio' AND conrelid = 'healthcare.privacy_consents'::regclass) THEN
        ALTER TABLE healthcare.privacy_consents ADD CONSTRAINT fk_healthcare_privacy_consents_document_folio FOREIGN KEY (document_folio_id, business_id) REFERENCES healthcare.document_folios (id, business_id);
      END IF;
    END $$;
    `
  );

  await run(client, [
    "CREATE INDEX IF NOT EXISTS idx_healthcare_business_modules_enabled ON healthcare.business_modules (business_id, enabled, module_key)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_patients_lookup ON healthcare.patients (business_id, is_active, LOWER(first_name), LOWER(last_name))",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_clinical_encounters_patient_date ON healthcare.clinical_encounters (business_id, patient_id, started_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_vital_sign_records_patient_date ON healthcare.vital_sign_records (business_id, patient_id, measured_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_clinical_notes_encounter_date ON healthcare.clinical_notes (business_id, encounter_id, authored_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_diagnoses_patient ON healthcare.diagnoses (business_id, patient_id, diagnosed_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_prescriptions_subject ON healthcare.prescriptions (business_id, subject_type, prescription_date DESC)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_prescription_items_prescription ON healthcare.prescription_items (business_id, prescription_id, line_number)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_pet_owners_lookup ON healthcare.pet_owners (business_id, is_active, LOWER(first_name), LOWER(last_name))",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_pets_lookup ON healthcare.pets (business_id, owner_id, is_active, LOWER(name))",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_veterinary_encounters_pet_date ON healthcare.veterinary_encounters (business_id, pet_id, encounter_date DESC)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_veterinary_notes_encounter_date ON healthcare.veterinary_notes (business_id, veterinary_encounter_id, authored_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_medication_catalog_flags ON healthcare.medication_catalog (business_id, is_antibiotic, is_controlled_substance, is_active)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_inventory_batches_product_expiry ON healthcare.inventory_batches (business_id, product_id, expiry_date, quantity_available)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_dispensing_logs_product_date ON healthcare.dispensing_logs (business_id, product_id, dispensed_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_dispensing_logs_sale ON healthcare.dispensing_logs (business_id, sale_id)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_antibiotic_dispensing_logs_date ON healthcare.antibiotic_dispensing_logs (business_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_controlled_substance_ledger_product_date ON healthcare.controlled_substance_ledger (business_id, product_id, movement_date DESC)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_temperature_humidity_logs_area_date ON healthcare.temperature_humidity_logs (business_id, area_code, measured_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_document_folios_lookup ON healthcare.document_folios (business_id, document_type, issued_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_record_corrections_target ON healthcare.record_corrections (business_id, target_table, target_record_uuid, corrected_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_access_audit_logs_target ON healthcare.access_audit_logs (business_id, target_table, target_record_uuid, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_access_audit_logs_actor ON healthcare.access_audit_logs (business_id, actor_user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_privacy_consents_subject ON healthcare.privacy_consents (business_id, subject_type, granted_at DESC)"
  ]);

  // touch_updated_at triggers — migration 14's table list.
  await execQuery(
    client,
    `
    DO $$
    DECLARE
      table_name TEXT;
    BEGIN
      FOREACH table_name IN ARRAY ARRAY[
        'business_modules', 'patients', 'clinical_encounters', 'vital_sign_records',
        'clinical_notes', 'diagnoses', 'prescriptions', 'prescription_items',
        'pet_owners', 'pets', 'veterinary_encounters', 'veterinary_notes',
        'veterinary_treatments', 'medication_catalog', 'inventory_batches',
        'dispensing_logs', 'antibiotic_dispensing_logs', 'controlled_substance_ledger',
        'temperature_humidity_logs', 'document_folios', 'record_corrections',
        'access_audit_logs', 'privacy_consents'
      ]
      LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || table_name || '_touch_updated_at') THEN
          EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE ON healthcare.%I FOR EACH ROW EXECUTE FUNCTION healthcare.touch_updated_at()',
            'trg_' || table_name || '_touch_updated_at',
            table_name
          );
        END IF;
      END LOOP;
    END $$;
    `
  );

  // Default (all-disabled, except privacy_consents) module flags per
  // business. ON CONFLICT DO NOTHING makes this safe to re-run for
  // existing businesses and self-serving for any business created later.
  await execQuery(
    client,
    `
    INSERT INTO healthcare.business_modules (business_id, module_key, enabled, activated_at, created_at, updated_at)
    SELECT b.id, module_key, enabled, NOW(), NOW(), NOW()
    FROM public.businesses b
    JOIN (
      VALUES
        ('clinical_core', FALSE), ('clinical_human', FALSE), ('clinical_dental', FALSE),
        ('veterinary_core', FALSE), ('pharmacy_core', FALSE), ('pharmacy_regulatory', FALSE),
        ('prescriptions', FALSE), ('dispensing', FALSE), ('inventory_batches', FALSE),
        ('temperature_humidity', FALSE), ('privacy_consents', TRUE)
    ) AS defaults(module_key, enabled) ON TRUE
    ON CONFLICT (business_id, module_key) DO NOTHING;
    `
  );

  await execQuery(
    client,
    `
    CREATE OR REPLACE VIEW healthcare.view_libro_antibioticos AS
    SELECT
      dl.dispensed_at AS fecha_dispensacion,
      p.name AS producto,
      mc.active_ingredient AS sustancia_activa,
      ib.batch_number AS lote_numero,
      ib.expiry_date AS fecha_caducidad,
      dl.dispensed_quantity AS cantidad_dispensada,
      adl.physician_name AS nombre_medico,
      adl.physician_license AS cedula_profesional,
      pr.folio_uuid AS receta_folio,
      dl.folio_uuid AS dispensacion_folio,
      dl.business_id
    FROM healthcare.antibiotic_dispensing_logs adl
    INNER JOIN healthcare.dispensing_logs dl ON dl.id = adl.dispensing_log_id AND dl.business_id = adl.business_id
    INNER JOIN public.products p ON p.id = dl.product_id AND p.business_id = dl.business_id
    LEFT JOIN healthcare.medication_catalog mc ON mc.product_id = dl.product_id AND mc.business_id = dl.business_id
    LEFT JOIN healthcare.inventory_batches ib ON ib.id = dl.batch_id AND ib.business_id = dl.business_id
    LEFT JOIN healthcare.prescriptions pr ON pr.id = dl.prescription_id AND pr.business_id = dl.business_id;
    `
  );

  // Migration 33 — healthcare.appointments + healthcare.preventive_events.
  await run(client, [
    `CREATE TABLE IF NOT EXISTS healthcare.appointments (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      subject_type VARCHAR(20) NOT NULL,
      patient_id BIGINT,
      pet_id BIGINT,
      owner_id BIGINT,
      practitioner_user_id INTEGER REFERENCES public.users(id),
      area VARCHAR(20) NOT NULL DEFAULT 'clinica',
      specialty VARCHAR(80),
      appointment_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
      reason TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      resulting_encounter_id BIGINT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT appointments_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT appointments_subject_check CHECK (subject_type IN ('human', 'pet')),
      CONSTRAINT appointments_subject_fk_check CHECK (
        (subject_type = 'human' AND patient_id IS NOT NULL AND pet_id IS NULL AND owner_id IS NULL)
        OR
        (subject_type = 'pet' AND pet_id IS NOT NULL AND patient_id IS NULL)
      ),
      CONSTRAINT appointments_area_check CHECK (area IN ('clinica', 'estetica')),
      CONSTRAINT appointments_status_check CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),
      CONSTRAINT appointments_time_check CHECK (end_time > start_time)
    )`,

    `CREATE TABLE IF NOT EXISTS healthcare.preventive_events (
      id BIGSERIAL PRIMARY KEY,
      record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
      business_id INTEGER NOT NULL REFERENCES public.businesses(id),
      subject_type VARCHAR(20) NOT NULL,
      patient_id BIGINT,
      pet_id BIGINT,
      practitioner_user_id INTEGER REFERENCES public.users(id),
      event_type VARCHAR(30) NOT NULL,
      product_id INTEGER,
      batch_id BIGINT,
      date_administered DATE NOT NULL,
      next_due_date DATE,
      dose VARCHAR(120),
      notes TEXT NOT NULL DEFAULT '',
      status VARCHAR(20) NOT NULL DEFAULT 'completed',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES public.users(id),
      updated_by INTEGER REFERENCES public.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT preventive_events_record_uuid_unique UNIQUE (record_uuid),
      CONSTRAINT preventive_events_subject_check CHECK (subject_type IN ('human', 'pet')),
      CONSTRAINT preventive_events_subject_fk_check CHECK (
        (subject_type = 'human' AND patient_id IS NOT NULL AND pet_id IS NULL)
        OR
        (subject_type = 'pet' AND pet_id IS NOT NULL AND patient_id IS NULL)
      ),
      CONSTRAINT preventive_events_type_check CHECK (event_type IN ('vaccination', 'deworming', 'flea_tick_treatment', 'other')),
      CONSTRAINT preventive_events_status_check CHECK (status IN ('completed', 'scheduled', 'overdue', 'cancelled'))
    )`,

    "CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_appointments_id_business ON healthcare.appointments (id, business_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_preventive_events_id_business ON healthcare.preventive_events (id, business_id)"
  ]);

  await execQuery(
    client,
    `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_appointments_pet' AND conrelid = 'healthcare.appointments'::regclass) THEN
        ALTER TABLE healthcare.appointments ADD CONSTRAINT fk_healthcare_appointments_pet FOREIGN KEY (pet_id, business_id) REFERENCES healthcare.pets (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_appointments_owner' AND conrelid = 'healthcare.appointments'::regclass) THEN
        ALTER TABLE healthcare.appointments ADD CONSTRAINT fk_healthcare_appointments_owner FOREIGN KEY (owner_id, business_id) REFERENCES healthcare.pet_owners (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_appointments_patient' AND conrelid = 'healthcare.appointments'::regclass) THEN
        ALTER TABLE healthcare.appointments ADD CONSTRAINT fk_healthcare_appointments_patient FOREIGN KEY (patient_id, business_id) REFERENCES healthcare.patients (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_appointments_encounter' AND conrelid = 'healthcare.appointments'::regclass) THEN
        ALTER TABLE healthcare.appointments ADD CONSTRAINT fk_healthcare_appointments_encounter FOREIGN KEY (resulting_encounter_id, business_id) REFERENCES healthcare.veterinary_encounters (id, business_id);
      END IF;
    END $$;
    `
  );

  await execQuery(
    client,
    `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_preventive_events_pet' AND conrelid = 'healthcare.preventive_events'::regclass) THEN
        ALTER TABLE healthcare.preventive_events ADD CONSTRAINT fk_healthcare_preventive_events_pet FOREIGN KEY (pet_id, business_id) REFERENCES healthcare.pets (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_preventive_events_patient' AND conrelid = 'healthcare.preventive_events'::regclass) THEN
        ALTER TABLE healthcare.preventive_events ADD CONSTRAINT fk_healthcare_preventive_events_patient FOREIGN KEY (patient_id, business_id) REFERENCES healthcare.patients (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_preventive_events_product' AND conrelid = 'healthcare.preventive_events'::regclass) THEN
        ALTER TABLE healthcare.preventive_events ADD CONSTRAINT fk_healthcare_preventive_events_product FOREIGN KEY (product_id, business_id) REFERENCES public.products (id, business_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_healthcare_preventive_events_batch' AND conrelid = 'healthcare.preventive_events'::regclass) THEN
        ALTER TABLE healthcare.preventive_events ADD CONSTRAINT fk_healthcare_preventive_events_batch FOREIGN KEY (batch_id, business_id) REFERENCES healthcare.inventory_batches (id, business_id);
      END IF;
    END $$;
    `
  );

  await run(client, [
    "CREATE INDEX IF NOT EXISTS idx_healthcare_appointments_business_date ON healthcare.appointments (business_id, appointment_date, start_time, end_time)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_appointments_pet ON healthcare.appointments (business_id, pet_id, appointment_date DESC)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_appointments_patient ON healthcare.appointments (business_id, patient_id, appointment_date DESC)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_appointments_practitioner_date ON healthcare.appointments (business_id, practitioner_user_id, appointment_date, start_time, end_time)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_preventive_events_pet_due ON healthcare.preventive_events (business_id, pet_id, next_due_date)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_preventive_events_patient_due ON healthcare.preventive_events (business_id, patient_id, next_due_date)",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_preventive_events_business_date ON healthcare.preventive_events (business_id, date_administered DESC)"
  ]);

  await execQuery(
    client,
    `
    DO $$
    DECLARE
      table_name TEXT;
    BEGIN
      FOREACH table_name IN ARRAY ARRAY['appointments', 'preventive_events']
      LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || table_name || '_touch_updated_at') THEN
          EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE ON healthcare.%I FOR EACH ROW EXECUTE FUNCTION healthcare.touch_updated_at()',
            'trg_' || table_name || '_touch_updated_at',
            table_name
          );
        END IF;
      END LOOP;
    END $$;
    `
  );
}

// Structural DDL for the healthcare vertical carried by later migrations
// (schema and base tables themselves now created by ensureHealthcareSchemaBase
// above, mirroring infra/postgres/14-healthcare-modular-expansion.sql and
// infra/postgres/33-healthcare-appointments-preventive.sql). This function
// only replicates the ALTER TABLE / CREATE INDEX changes applied by
// migrations 37-40 and 42 (data backfill already run in staging), so that
// re-running ensureSchema against the SAME database does not drift.
//
// Everything here is still gated on the healthcare schema existing: the
// guard below is now unreachable in practice (ensureHealthcareSchemaBase
// runs first and unconditionally creates the schema), but is left in place
// as a defensive no-op rather than removed, since it costs nothing and keeps
// this function safe to call standalone.
async function ensureHealthcareStructuralSync(client) {
  const { rows } = await client.query(
    "SELECT 1 FROM information_schema.schemata WHERE schema_name = 'healthcare'"
  );

  if (!rows.length) {
    console.info("[DB-COMPAT] healthcare schema not present — skipping healthcare structural sync (migrations 37-40)");
    return;
  }

  await run(client, [
    // Migration 37 — public.appointments -> healthcare.appointments
    "ALTER TABLE healthcare.appointments ADD COLUMN IF NOT EXISTS source_appointment_id INTEGER",
    "CREATE INDEX IF NOT EXISTS idx_hc_appointments_source_appointment_id ON healthcare.appointments (source_appointment_id, business_id)",

    // Migration 38 — public.medical_preventive_events -> healthcare.preventive_events
    "ALTER TABLE healthcare.preventive_events ADD COLUMN IF NOT EXISTS source_event_id INTEGER",
    "CREATE INDEX IF NOT EXISTS idx_hc_preventive_events_source_event_id ON healthcare.preventive_events (source_event_id, business_id)",

    // Migration 39 — public.consultations -> healthcare.clinical_encounters / healthcare.veterinary_encounters
    "ALTER TABLE healthcare.clinical_encounters ADD COLUMN IF NOT EXISTS source_consultation_id INTEGER",
    "CREATE INDEX IF NOT EXISTS idx_hc_clinical_encounters_source_consultation_id ON healthcare.clinical_encounters (source_consultation_id, business_id)",
    "ALTER TABLE healthcare.veterinary_encounters ADD COLUMN IF NOT EXISTS source_consultation_id INTEGER",
    "CREATE INDEX IF NOT EXISTS idx_hc_veterinary_encounters_source_consultation_id ON healthcare.veterinary_encounters (source_consultation_id, business_id)",

    // Migration 40 — public.medical_prescriptions / medical_prescription_items -> healthcare.prescriptions / prescription_items
    "ALTER TABLE healthcare.prescriptions ADD COLUMN IF NOT EXISTS source_prescription_id INTEGER",
    "CREATE INDEX IF NOT EXISTS idx_hc_prescriptions_source_prescription_id ON healthcare.prescriptions (source_prescription_id, business_id)",
    "ALTER TABLE healthcare.prescription_items ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE healthcare.prescription_items ADD COLUMN IF NOT EXISTS source_prescription_item_id INTEGER",
    "CREATE INDEX IF NOT EXISTS idx_hc_prescription_items_source_prescription_item_id ON healthcare.prescription_items (source_prescription_item_id, business_id)",

    // Migration 42 — Fase 0 prep: credit_limit/credit_days real columns + owner_id
    // (per-visit responsible party) on the human side of clinical_encounters/prescriptions
    "ALTER TABLE healthcare.pet_owners ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2) DEFAULT NULL",
    "ALTER TABLE healthcare.pet_owners ADD COLUMN IF NOT EXISTS credit_days INTEGER DEFAULT 30",
    "ALTER TABLE healthcare.clinical_encounters ADD COLUMN IF NOT EXISTS owner_id BIGINT",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_clinical_encounters_owner ON healthcare.clinical_encounters (business_id, owner_id)",
    "ALTER TABLE healthcare.prescriptions ADD COLUMN IF NOT EXISTS owner_id BIGINT",
    "CREATE INDEX IF NOT EXISTS idx_healthcare_prescriptions_owner ON healthcare.prescriptions (business_id, owner_id)",

    // Migration 43 — healthcare.preventive_events.date_administered becomes
    // nullable (a "scheduled" event has no application date yet, only next_due_date)
    "ALTER TABLE healthcare.preventive_events ALTER COLUMN date_administered DROP NOT NULL",

    // Migration 44 — healthcare.pets.owner_id becomes nullable. patients.client_id
    // stopped being captured on patient creation since commit 6db95fc ("replace
    // client link with phone field on patients", 2026-04-23); the owner/payer for
    // a pet is now resolved per visit, same as it already was for the human side
    // (migration 42). owner_id NOT NULL blocked every pet created since that
    // commit from ever getting a healthcare.pets mirror row (migration 36's
    // INNER JOIN against pet_owners requires a resolved owner_id), which is why
    // resolveHealthcareSubject returns 409 for any patient created after that
    // date. See healthcareSubjectTranslation.js (syncPatientToHealthcare) for the
    // create-time sync this unblocks.
    "ALTER TABLE healthcare.pets ALTER COLUMN owner_id DROP NOT NULL",

    // Migration 48 — healthcare.veterinary_encounters.owner_id becomes
    // nullable. Fase 4's consultation sync resolves owner_id from the
    // consultation's client_id (optional since migration 47) via
    // healthcare.pet_owners; until this migration, NOT NULL forced
    // insertVeterinaryEncounterMirror to skip the mirror insert entirely
    // whenever owner_id could not be resolved. Reviewed every CONSTRAINT on
    // this table first (see infra/postgres/48-healthcare-veterinary-
    // encounters-owner-nullable.sql) — no CHECK references owner_id (unlike
    // healthcare.appointments' appointments_subject_fk_check), only a plain
    // FK, which Postgres never evaluates when the column is NULL.
    "ALTER TABLE healthcare.veterinary_encounters ALTER COLUMN owner_id DROP NOT NULL",

    // Migration 50 — Fase 5 Parte B: healthcare.dispensing_logs.batch_id
    // becomes nullable. saleService.js starts writing real dispensing_logs
    // rows when a sale_item declares prescription_item_id, but no batch/lot
    // ledger exists yet (migration 41) — batch_id NOT NULL would block every
    // such INSERT. Same pattern as migrations 44/48: no CHECK references
    // batch_id, only the plain FK fk_healthcare_dispensing_logs_batch, which
    // Postgres never evaluates when the column is NULL.
    // view_libro_antibioticos already LEFT JOINs healthcare.inventory_batches
    // via dl.batch_id (migration 14), so it already tolerates NULL without
    // any change to the view itself.
    "ALTER TABLE healthcare.dispensing_logs ALTER COLUMN batch_id DROP NOT NULL",

    // Migration 51 — Fase 6: healthcare.reminders, mirror of ONLY the
    // public.reminders rows with category = 'clinical'. Reminders with
    // category = 'administrative' (stock bajo, gastos, prestamos de dueno,
    // gastos fijos, pagos de suscripcion) never reach this table — the guard
    // lives in healthcareSubjectTranslation.js (syncReminderToHealthcare/
    // OnUpdate return null immediately when category !== 'clinical'), not in
    // a CHECK here, since this table is never supposed to see a non-clinical
    // row at all. patient_id is nullable on public.reminders (a clinical
    // reminder is not always tied to one specific patient), so subject_type/
    // patient_id/pet_id are nullable here too — see
    // healthcare_reminders_subject_check in migration 51's own file for the
    // explicit "no subject" branch, unlike healthcare.prescriptions/
    // appointments where a subject is always required.
    `CREATE TABLE IF NOT EXISTS healthcare.reminders (
      id BIGSERIAL PRIMARY KEY,
      business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      source_reminder_id INTEGER NOT NULL,
      subject_type VARCHAR(10),
      patient_id BIGINT,
      pet_id BIGINT,
      reminder_type VARCHAR(40) NOT NULL DEFAULT 'general',
      title VARCHAR(180) NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      due_date DATE,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by INTEGER REFERENCES users(id),
      updated_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE healthcare.reminders ADD COLUMN IF NOT EXISTS business_id INTEGER",
    "ALTER TABLE healthcare.reminders ADD COLUMN IF NOT EXISTS source_reminder_id INTEGER",
    "ALTER TABLE healthcare.reminders ADD COLUMN IF NOT EXISTS subject_type VARCHAR(10)",
    "ALTER TABLE healthcare.reminders ADD COLUMN IF NOT EXISTS patient_id BIGINT",
    "ALTER TABLE healthcare.reminders ADD COLUMN IF NOT EXISTS pet_id BIGINT",
    "ALTER TABLE healthcare.reminders ADD COLUMN IF NOT EXISTS reminder_type VARCHAR(40) NOT NULL DEFAULT 'general'",
    "ALTER TABLE healthcare.reminders ADD COLUMN IF NOT EXISTS title VARCHAR(180) NOT NULL DEFAULT ''",
    "ALTER TABLE healthcare.reminders ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE healthcare.reminders ADD COLUMN IF NOT EXISTS due_date DATE",
    "ALTER TABLE healthcare.reminders ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending'",
    "ALTER TABLE healthcare.reminders ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE healthcare.reminders ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)",
    "ALTER TABLE healthcare.reminders ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id)",
    "ALTER TABLE healthcare.reminders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    "ALTER TABLE healthcare.reminders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    "CREATE INDEX IF NOT EXISTS idx_hc_reminders_source_reminder_id ON healthcare.reminders (source_reminder_id, business_id)",
    "CREATE INDEX IF NOT EXISTS idx_hc_reminders_business_status_due_date ON healthcare.reminders (business_id, status, due_date)",
    "CREATE INDEX IF NOT EXISTS idx_hc_reminders_patient_id ON healthcare.reminders (patient_id)",
    "CREATE INDEX IF NOT EXISTS idx_hc_reminders_pet_id ON healthcare.reminders (pet_id)"
  ]);

  // Migration 51 — healthcare.reminders constraints. Runs here (inside
  // ensureHealthcareStructuralSync, guarded by the "healthcare schema
  // present" check at the top of this function), not inside
  // ensureConstraints — that function runs BEFORE this one (see call order
  // in ensureDatabaseCompatibility), so a 'healthcare.reminders'::regclass
  // cast there would throw "relation does not exist" on any database where
  // this table hasn't been created yet, and that error is not a
  // duplicate_object, so the EXCEPTION handler in ensureConstraints would not
  // catch it — it would abort init entirely.
  await execQuery(
    client,
    `
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'healthcare_reminders_status_check'
          AND conrelid = 'healthcare.reminders'::regclass
      ) THEN
        ALTER TABLE healthcare.reminders DROP CONSTRAINT healthcare_reminders_status_check;
      END IF;

      ALTER TABLE healthcare.reminders
      ADD CONSTRAINT healthcare_reminders_status_check
      CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'));

      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'healthcare_reminders_subject_check'
          AND conrelid = 'healthcare.reminders'::regclass
      ) THEN
        ALTER TABLE healthcare.reminders DROP CONSTRAINT healthcare_reminders_subject_check;
      END IF;

      -- Unlike healthcare.prescriptions/appointments (subject always
      -- required), a clinical reminder may have no patient at all
      -- (patient_id nullable on public.reminders) — the "no subject" case is
      -- a first-class valid state here, not an unresolved gap.
      ALTER TABLE healthcare.reminders
      ADD CONSTRAINT healthcare_reminders_subject_check
      CHECK (
        (subject_type IS NULL AND patient_id IS NULL AND pet_id IS NULL)
        OR
        (subject_type = 'human' AND patient_id IS NOT NULL AND pet_id IS NULL)
        OR
        (subject_type = 'pet' AND pet_id IS NOT NULL AND patient_id IS NULL)
      );

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_healthcare_reminders_source_reminder'
          AND conrelid = 'healthcare.reminders'::regclass
      ) THEN
        ALTER TABLE healthcare.reminders
        ADD CONSTRAINT fk_healthcare_reminders_source_reminder
        FOREIGN KEY (source_reminder_id) REFERENCES reminders(id) ON DELETE CASCADE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_healthcare_reminders_patient'
          AND conrelid = 'healthcare.reminders'::regclass
      ) THEN
        ALTER TABLE healthcare.reminders
        ADD CONSTRAINT fk_healthcare_reminders_patient
        FOREIGN KEY (patient_id) REFERENCES healthcare.patients(id) ON DELETE CASCADE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_healthcare_reminders_pet'
          AND conrelid = 'healthcare.reminders'::regclass
      ) THEN
        ALTER TABLE healthcare.reminders
        ADD CONSTRAINT fk_healthcare_reminders_pet
        FOREIGN KEY (pet_id) REFERENCES healthcare.pets(id) ON DELETE CASCADE;
      END IF;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
    `
  );

  // Migration 42 — backfill credit_limit/credit_days from metadata (saved there by
  // migration 34) and mark each row so a re-run does not clobber later manual edits.
  // Body copied verbatim from infra/postgres/42-healthcare-schema-fase0-prep.sql section 1.
  await execQuery(
    client,
    `
    UPDATE healthcare.pet_owners
    SET
      credit_limit = NULLIF(metadata->>'credit_limit', '')::NUMERIC(12,2),
      credit_days  = COALESCE(NULLIF(metadata->>'credit_days', '')::INTEGER, 30),
      metadata     = metadata || jsonb_build_object('credit_backfilled_at', NOW()::text)
    WHERE metadata ? 'credit_limit'
      AND NOT (metadata ? 'credit_backfilled_at');
    `
  );

  // Migration 42 — FK guards for the new owner_id columns. ADD CONSTRAINT has no
  // IF NOT EXISTS form in Postgres, so this mirrors the DO $$ guard pattern already
  // used for the migration 33/14 FK sections above.
  await execQuery(
    client,
    `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_healthcare_clinical_encounters_owner'
          AND conrelid = 'healthcare.clinical_encounters'::regclass
      ) THEN
        ALTER TABLE healthcare.clinical_encounters
          ADD CONSTRAINT fk_healthcare_clinical_encounters_owner
          FOREIGN KEY (owner_id, business_id)
          REFERENCES healthcare.pet_owners (id, business_id);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_healthcare_prescriptions_owner'
          AND conrelid = 'healthcare.prescriptions'::regclass
      ) THEN
        ALTER TABLE healthcare.prescriptions
          ADD CONSTRAINT fk_healthcare_prescriptions_owner
          FOREIGN KEY (owner_id, business_id)
          REFERENCES healthcare.pet_owners (id, business_id);
      END IF;
    END $$;
    `
  );

  // Migration 39, section 1b — healthcare.appointments.resulting_encounter_id had
  // a single FK pointing only at healthcare.veterinary_encounters (gap from
  // migration 33; Postgres cannot express a polymorphic FK to either
  // clinical_encounters or veterinary_encounters depending on subject_type).
  // Drop that FK and replace it with a validation trigger. Body copied verbatim
  // from infra/postgres/39-migrate-consultations-to-encounters.sql section 1b.
  await execQuery(
    client,
    `
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_healthcare_appointments_encounter'
          AND conrelid = 'healthcare.appointments'::regclass
      ) THEN
        ALTER TABLE healthcare.appointments
          DROP CONSTRAINT fk_healthcare_appointments_encounter;
      END IF;
    END $$;
    `
  );

  await execQuery(
    client,
    `
    CREATE OR REPLACE FUNCTION healthcare.validate_appointment_resulting_encounter()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.resulting_encounter_id IS NULL THEN
        RETURN NEW;
      END IF;

      IF NEW.subject_type = 'human' THEN
        IF NOT EXISTS (
          SELECT 1 FROM healthcare.clinical_encounters
          WHERE id = NEW.resulting_encounter_id AND business_id = NEW.business_id
        ) THEN
          RAISE EXCEPTION
            'resulting_encounter_id % not found in healthcare.clinical_encounters for business_id % (appointment subject_type = human)',
            NEW.resulting_encounter_id, NEW.business_id;
        END IF;
      ELSIF NEW.subject_type = 'pet' THEN
        IF NOT EXISTS (
          SELECT 1 FROM healthcare.veterinary_encounters
          WHERE id = NEW.resulting_encounter_id AND business_id = NEW.business_id
        ) THEN
          RAISE EXCEPTION
            'resulting_encounter_id % not found in healthcare.veterinary_encounters for business_id % (appointment subject_type = pet)',
            NEW.resulting_encounter_id, NEW.business_id;
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$;
    `
  );

  await execQuery(
    client,
    `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_appointments_validate_resulting_encounter'
      ) THEN
        CREATE TRIGGER trg_appointments_validate_resulting_encounter
          BEFORE INSERT OR UPDATE OF resulting_encounter_id, subject_type ON healthcare.appointments
          FOR EACH ROW
          EXECUTE FUNCTION healthcare.validate_appointment_resulting_encounter();
      END IF;
    END $$;
    `
  );
}

async function ensureSupportUsers(client) {
  const { rows } = await execQuery(
    client,
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
    await execQuery(
      client,
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

  await execQuery(
    client,
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

  console.info(INIT_VERSION_MARKER);
  console.info("[DB-COMPAT] start ensureDatabaseCompatibility");

  try {
    console.info("[DB-COMPAT] BEGIN");
    await execQuery(client, "BEGIN");

    console.info("[DB-COMPAT] SET TIME ZONE");
    await execQuery(client, "SET TIME ZONE 'America/Mexico_City'");

    console.info("[DB-COMPAT] ensureSchema");
    await ensureSchema(client);

    console.info("[DB-COMPAT] ensureSeedBusiness");
    await ensureSeedBusiness(client);

    console.info("[DB-COMPAT] backfillBusinessIds");
    await backfillBusinessIds(client);

    console.info("[DB-COMPAT] ensureConstraints");
    await ensureConstraints(client);

    console.info("[DB-COMPAT] ensureClientSoftDeleteReconciliation");
    await ensureClientSoftDeleteReconciliation(client);

    console.info("[DB-COMPAT] ensureAppointmentsClientOptional");
    await ensureAppointmentsClientOptional(client);

    console.info("[DB-COMPAT] ensureConsultationsSchemaFase4Prep");
    await ensureConsultationsSchemaFase4Prep(client);

    console.info("[DB-COMPAT] ensureHealthcareSchemaBase");
    await ensureHealthcareSchemaBase(client);

    console.info("[DB-COMPAT] ensureHealthcareStructuralSync");
    await ensureHealthcareStructuralSync(client);

    console.info("[DB-COMPAT] ensureSupportUsers");
    await ensureSupportUsers(client);

    console.info("[DB-COMPAT] COMMIT");
    await execQuery(client, "COMMIT");
  } catch (error) {
    console.error("[DB-COMPAT] Fatal compatibility error:", error);

    try {
      await client.query("ROLLBACK");
      console.info("[DB-COMPAT] ROLLBACK OK");
    } catch (rollbackError) {
      console.error("[DB-COMPAT] ROLLBACK failed:", rollbackError);
    }

    throw error;
  } finally {
    client.release();
  }
}

module.exports = { ensureDatabaseCompatibility };
