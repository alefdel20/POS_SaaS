const crypto = require("crypto");
const pool = require("./pool");

const POS_TYPES = ["Tlapaleria", "Tienda", "Farmacia", "Veterinaria", "Papeleria", "Dentista", "FarmaciaConsultorio", "ClinicaChica", "Otro"];
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
      ADD CONSTRAINT businesses_pos_type_check CHECK (pos_type IN ('Tlapaleria', 'Tienda', 'Farmacia', 'Veterinaria', 'Papeleria', 'Dentista', 'FarmaciaConsultorio', 'ClinicaChica', 'Otro'));

      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_role_check'
          AND conrelid = 'users'::regclass
      ) THEN
        ALTER TABLE users DROP CONSTRAINT users_role_check;
      END IF;

      ALTER TABLE users
      ADD CONSTRAINT users_role_check CHECK (role IN ('superusuario', 'admin', 'clinico', 'cajero', 'soporte'));
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
        WHEN LOWER(role) IN ('clinico', 'medico', 'veterinario') THEN 'clinico'
        WHEN LOWER(role) IN ('soporte', 'support') THEN 'soporte'
        ELSE 'cajero'
      END
      WHERE role IS NULL
         OR LOWER(role) NOT IN ('superusuario', 'superadmin', 'admin', 'clinico', 'medico', 'veterinario', 'soporte', 'support', 'cajero', 'cashier', 'user')
         OR role <> CASE
           WHEN LOWER(role) IN ('superusuario', 'superadmin') THEN 'superusuario'
           WHEN LOWER(role) = 'admin' THEN 'admin'
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
    "CREATE INDEX IF NOT EXISTS idx_consultations_business_client_date ON consultations(business_id, client_id, consultation_date DESC)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_business_date_area ON appointments(business_id, appointment_date, area, start_time, end_time)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_business_patient_date ON appointments(business_id, patient_id, appointment_date DESC)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_business_doctor_date ON appointments(business_id, doctor_user_id, appointment_date DESC)",
    "CREATE INDEX IF NOT EXISTS idx_appointments_business_doctor_schedule ON appointments(business_id, doctor_user_id, appointment_date, status, start_time, end_time)"
  ]);
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
