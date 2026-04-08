BEGIN;

ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS phone VARCHAR(40);
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS professional_license VARCHAR(80);
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS specialty VARCHAR(120);
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(20) NOT NULL DEFAULT 'dark';

ALTER TABLE IF EXISTS product_update_requests ADD COLUMN IF NOT EXISTS request_type VARCHAR(30) NOT NULL DEFAULT 'update';
ALTER TABLE IF EXISTS product_update_requests ADD COLUMN IF NOT EXISTS before_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS product_update_requests ADD COLUMN IF NOT EXISTS after_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS product_update_requests ADD COLUMN IF NOT EXISTS changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS manual_cuts (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL,
  cut_date DATE NOT NULL,
  cut_type VARCHAR(20) NOT NULL DEFAULT 'manual',
  notes TEXT NOT NULL DEFAULT '',
  performed_by_user_id INTEGER REFERENCES users(id),
  performed_by_name_snapshot VARCHAR(180) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS appointments ADD COLUMN IF NOT EXISTS doctor_user_id INTEGER REFERENCES users(id);
ALTER TABLE IF EXISTS appointments ADD COLUMN IF NOT EXISTS specialty VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_manual_cuts_business_cut_date ON manual_cuts(business_id, cut_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_business_doctor_date ON appointments(business_id, doctor_user_id, appointment_date DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_business_doctor_schedule ON appointments(business_id, doctor_user_id, appointment_date, status, start_time, end_time);

COMMIT;
