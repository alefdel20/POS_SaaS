-- Web Services Orders
-- Tabla para órdenes del servicio de creación de páginas web Ankode
-- Ejecutar: docker exec -i [container] psql -U postgres -d pos_saas < migrations/web_services_001.sql

CREATE TABLE IF NOT EXISTS web_service_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan VARCHAR(20) NOT NULL CHECK (plan IN ('basico', 'avanzado')),
  status VARCHAR(30) NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment','paid','in_progress','delivered','cancelled')),

  -- Datos del negocio
  business_name VARCHAR(200) NOT NULL,
  business_type VARCHAR(100) NOT NULL,
  business_address TEXT NOT NULL,
  business_phone VARCHAR(20) NOT NULL,
  business_hours VARCHAR(200),
  social_media VARCHAR(500),
  catalog_items TEXT,
  style_preferences TEXT,
  contact_email VARCHAR(200),

  -- Datos del sitio web
  desired_domain VARCHAR(100),
  functionality_type VARCHAR(20) CHECK (functionality_type IN ('tienda','reservas','ambas')),
  business_description TEXT,
  testimonials TEXT,
  uses_pos_ankode VARCHAR(20),

  -- Aceptación de T&C
  tc_accepted BOOLEAN NOT NULL DEFAULT false,
  tc_accepted_at TIMESTAMPTZ,
  tc_ip VARCHAR(45),

  -- Pago
  openpay_charge_id VARCHAR(100),
  openpay_order_id VARCHAR(100),
  amount_setup DECIMAL(10,2) NOT NULL,
  amount_hosting DECIMAL(10,2) NOT NULL,
  amount_total DECIMAL(10,2) NOT NULL,
  payment_method VARCHAR(20),
  paid_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_web_orders_status ON web_service_orders(status);
CREATE INDEX IF NOT EXISTS idx_web_orders_openpay ON web_service_orders(openpay_charge_id);
