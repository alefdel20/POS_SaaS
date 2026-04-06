ALTER TABLE products
ADD COLUMN IF NOT EXISTS catalog_type VARCHAR(20);

UPDATE products
SET catalog_type = CASE
  WHEN LOWER(COALESCE(category, '') || ' ' || COALESCE(name, '')) ~ '(medicament|farmac|insumo|vacun|antibiot|curacion|quirurg)' THEN 'medications'
  WHEN LOWER(COALESCE(category, '') || ' ' || COALESCE(name, '')) ~ '(alimento|accesor|snack|juguete|collar|correa|cama|arena)' THEN 'accessories'
  ELSE COALESCE(NULLIF(BTRIM(catalog_type), ''), 'accessories')
END
WHERE catalog_type IS NULL OR BTRIM(catalog_type) = '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_catalog_type_check'
      AND conrelid = 'products'::regclass
  ) THEN
    ALTER TABLE products DROP CONSTRAINT products_catalog_type_check;
  END IF;
END $$;

ALTER TABLE products
ADD CONSTRAINT products_catalog_type_check
CHECK (catalog_type IN ('accessories', 'medications'));

CREATE INDEX IF NOT EXISTS idx_products_business_catalog_type ON products(business_id, catalog_type);

CREATE TABLE IF NOT EXISTS medical_prescriptions (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL,
  consultation_id INTEGER NULL,
  doctor_user_id INTEGER NULL REFERENCES users(id),
  diagnosis TEXT NOT NULL DEFAULT '',
  indications TEXT NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by INTEGER NULL REFERENCES users(id),
  updated_by INTEGER NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS medical_prescription_items (
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
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'medical_prescriptions_status_check'
      AND conrelid = 'medical_prescriptions'::regclass
  ) THEN
    ALTER TABLE medical_prescriptions DROP CONSTRAINT medical_prescriptions_status_check;
  END IF;
END $$;

ALTER TABLE medical_prescriptions
ADD CONSTRAINT medical_prescriptions_status_check
CHECK (status IN ('draft', 'issued', 'cancelled'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_medical_prescriptions_patient'
      AND conrelid = 'medical_prescriptions'::regclass
  ) THEN
    ALTER TABLE medical_prescriptions
    ADD CONSTRAINT fk_medical_prescriptions_patient
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_medical_prescriptions_consultation'
      AND conrelid = 'medical_prescriptions'::regclass
  ) THEN
    ALTER TABLE medical_prescriptions
    ADD CONSTRAINT fk_medical_prescriptions_consultation
    FOREIGN KEY (consultation_id) REFERENCES consultations(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_medical_prescription_items_prescription'
      AND conrelid = 'medical_prescription_items'::regclass
  ) THEN
    ALTER TABLE medical_prescription_items
    ADD CONSTRAINT fk_medical_prescription_items_prescription
    FOREIGN KEY (prescription_id) REFERENCES medical_prescriptions(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_medical_prescription_items_product'
      AND conrelid = 'medical_prescription_items'::regclass
  ) THEN
    ALTER TABLE medical_prescription_items
    ADD CONSTRAINT fk_medical_prescription_items_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_medical_prescriptions_business_patient_created
  ON medical_prescriptions(business_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_medical_prescriptions_consultation_id
  ON medical_prescriptions(consultation_id);
CREATE INDEX IF NOT EXISTS idx_medical_prescriptions_doctor_user_id
  ON medical_prescriptions(doctor_user_id);
CREATE INDEX IF NOT EXISTS idx_medical_prescription_items_prescription_id
  ON medical_prescription_items(prescription_id);
