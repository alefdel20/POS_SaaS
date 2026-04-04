CREATE TABLE IF NOT EXISTS product_categories (
  id SERIAL PRIMARY KEY,
  business_id INTEGER REFERENCES businesses(id),
  name VARCHAR(120) NOT NULL,
  source VARCHAR(30) NOT NULL DEFAULT 'manual',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pos_templates (
  id SERIAL PRIMARY KEY,
  pos_type VARCHAR(40) NOT NULL,
  type VARCHAR(40) NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_categories_business_name
  ON product_categories (business_id, LOWER(name));

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_templates_pos_type_type
  ON pos_templates (pos_type, type);

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
    ADD CONSTRAINT businesses_pos_type_check
    CHECK (pos_type IN (
      'Tlapaleria',
      'Tienda',
      'Farmacia',
      'Veterinaria',
      'Papeleria',
      'Dentista',
      'FarmaciaConsultorio',
      'ClinicaChica',
      'Otro'
    ));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
