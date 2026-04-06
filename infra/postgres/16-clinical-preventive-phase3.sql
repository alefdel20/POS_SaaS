ALTER TABLE patients
ADD COLUMN IF NOT EXISTS weight NUMERIC(10, 3);

ALTER TABLE patients
ADD COLUMN IF NOT EXISTS allergies TEXT NOT NULL DEFAULT '';

ALTER TABLE reminders
ADD COLUMN IF NOT EXISTS reminder_type VARCHAR(40) NOT NULL DEFAULT 'general';

ALTER TABLE reminders
ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT 'administrative';

ALTER TABLE reminders
ADD COLUMN IF NOT EXISTS patient_id INTEGER;

ALTER TABLE reminders
ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reminders_status_check'
      AND conrelid = 'reminders'::regclass
  ) THEN
    ALTER TABLE reminders DROP CONSTRAINT reminders_status_check;
  END IF;
END $$;

ALTER TABLE reminders
ADD CONSTRAINT reminders_status_check
CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reminders_category_check'
      AND conrelid = 'reminders'::regclass
  ) THEN
    ALTER TABLE reminders DROP CONSTRAINT reminders_category_check;
  END IF;
END $$;

ALTER TABLE reminders
ADD CONSTRAINT reminders_category_check
CHECK (category IN ('administrative', 'clinical'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_reminders_patient'
      AND conrelid = 'reminders'::regclass
  ) THEN
    ALTER TABLE reminders
    ADD CONSTRAINT fk_reminders_patient
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS medical_preventive_events (
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
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'medical_preventive_events_type_check'
      AND conrelid = 'medical_preventive_events'::regclass
  ) THEN
    ALTER TABLE medical_preventive_events DROP CONSTRAINT medical_preventive_events_type_check;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'medical_preventive_events_status_check'
      AND conrelid = 'medical_preventive_events'::regclass
  ) THEN
    ALTER TABLE medical_preventive_events DROP CONSTRAINT medical_preventive_events_status_check;
  END IF;
END $$;

ALTER TABLE medical_preventive_events
ADD CONSTRAINT medical_preventive_events_type_check
CHECK (event_type IN ('vaccination', 'deworming'));

ALTER TABLE medical_preventive_events
ADD CONSTRAINT medical_preventive_events_status_check
CHECK (status IN ('scheduled', 'completed', 'cancelled'));

DO $$
BEGIN
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
END $$;

CREATE TABLE IF NOT EXISTS sale_prescription_links (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  prescription_id BIGINT NOT NULL,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
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
END $$;

CREATE INDEX IF NOT EXISTS idx_reminders_business_category_due_date
  ON reminders(business_id, category, due_date);
CREATE INDEX IF NOT EXISTS idx_reminders_patient_id
  ON reminders(patient_id);
CREATE INDEX IF NOT EXISTS idx_medical_preventive_events_business_patient_date
  ON medical_preventive_events(business_id, patient_id, date_administered DESC);
CREATE INDEX IF NOT EXISTS idx_medical_preventive_events_business_due_date
  ON medical_preventive_events(business_id, next_due_date);
CREATE INDEX IF NOT EXISTS idx_sale_prescription_links_prescription_id
  ON sale_prescription_links(prescription_id);
CREATE INDEX IF NOT EXISTS idx_sale_prescription_links_sale_id
  ON sale_prescription_links(sale_id);
