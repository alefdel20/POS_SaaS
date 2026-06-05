-- Documenta columnas de horas de alerta que ya existen en producción (ADD COLUMN IF NOT EXISTS es idempotente)
ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS report_hour INTEGER;
ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS stock_alert_hour_morning INTEGER;
ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS stock_alert_hour_evening INTEGER;
ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS inventory_alert_hour INTEGER;

-- Nuevas columnas
ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS inventory_alert_hour_evening INTEGER;
ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS report_whatsapp_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE business_subscriptions ADD COLUMN IF NOT EXISTS report_email_enabled BOOLEAN NOT NULL DEFAULT FALSE;
