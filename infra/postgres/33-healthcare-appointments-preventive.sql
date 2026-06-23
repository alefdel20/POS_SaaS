-- Migration 33: healthcare.appointments + healthcare.preventive_events
-- Depends on: 14-healthcare-modular-expansion.sql (schema healthcare, function touch_updated_at,
--   tables pets, pet_owners, patients, veterinary_encounters, inventory_batches, medication_catalog;
--   unique indexes uq_healthcare_*_id_business on all referenced tables).
-- Safe to re-run: all statements use IF NOT EXISTS / IF NOT EXISTS (pg_constraint/pg_trigger).

-- ============================================================================
-- TABLE 1: healthcare.appointments
-- ============================================================================

CREATE TABLE IF NOT EXISTS healthcare.appointments (
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
);

-- ============================================================================
-- TABLE 2: healthcare.preventive_events
-- ============================================================================

CREATE TABLE IF NOT EXISTS healthcare.preventive_events (
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
);

-- ============================================================================
-- UNIQUE INDEXES (id, business_id) — for future composite FK references
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_appointments_id_business
  ON healthcare.appointments (id, business_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_preventive_events_id_business
  ON healthcare.preventive_events (id, business_id);

-- ============================================================================
-- FOREIGN KEYS — appointments
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_appointments_pet'
      AND conrelid = 'healthcare.appointments'::regclass
  ) THEN
    ALTER TABLE healthcare.appointments
      ADD CONSTRAINT fk_healthcare_appointments_pet
      FOREIGN KEY (pet_id, business_id)
      REFERENCES healthcare.pets (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_appointments_owner'
      AND conrelid = 'healthcare.appointments'::regclass
  ) THEN
    ALTER TABLE healthcare.appointments
      ADD CONSTRAINT fk_healthcare_appointments_owner
      FOREIGN KEY (owner_id, business_id)
      REFERENCES healthcare.pet_owners (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_appointments_patient'
      AND conrelid = 'healthcare.appointments'::regclass
  ) THEN
    ALTER TABLE healthcare.appointments
      ADD CONSTRAINT fk_healthcare_appointments_patient
      FOREIGN KEY (patient_id, business_id)
      REFERENCES healthcare.patients (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_appointments_encounter'
      AND conrelid = 'healthcare.appointments'::regclass
  ) THEN
    ALTER TABLE healthcare.appointments
      ADD CONSTRAINT fk_healthcare_appointments_encounter
      FOREIGN KEY (resulting_encounter_id, business_id)
      REFERENCES healthcare.veterinary_encounters (id, business_id);
  END IF;
END $$;

-- ============================================================================
-- FOREIGN KEYS — preventive_events
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_preventive_events_pet'
      AND conrelid = 'healthcare.preventive_events'::regclass
  ) THEN
    ALTER TABLE healthcare.preventive_events
      ADD CONSTRAINT fk_healthcare_preventive_events_pet
      FOREIGN KEY (pet_id, business_id)
      REFERENCES healthcare.pets (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_preventive_events_patient'
      AND conrelid = 'healthcare.preventive_events'::regclass
  ) THEN
    ALTER TABLE healthcare.preventive_events
      ADD CONSTRAINT fk_healthcare_preventive_events_patient
      FOREIGN KEY (patient_id, business_id)
      REFERENCES healthcare.patients (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_preventive_events_product'
      AND conrelid = 'healthcare.preventive_events'::regclass
  ) THEN
    ALTER TABLE healthcare.preventive_events
      ADD CONSTRAINT fk_healthcare_preventive_events_product
      FOREIGN KEY (product_id, business_id)
      REFERENCES public.products (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_preventive_events_batch'
      AND conrelid = 'healthcare.preventive_events'::regclass
  ) THEN
    ALTER TABLE healthcare.preventive_events
      ADD CONSTRAINT fk_healthcare_preventive_events_batch
      FOREIGN KEY (batch_id, business_id)
      REFERENCES healthcare.inventory_batches (id, business_id);
  END IF;
END $$;

-- ============================================================================
-- OPERATIONAL INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_healthcare_appointments_business_date
  ON healthcare.appointments (business_id, appointment_date, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_healthcare_appointments_pet
  ON healthcare.appointments (business_id, pet_id, appointment_date DESC);

CREATE INDEX IF NOT EXISTS idx_healthcare_appointments_patient
  ON healthcare.appointments (business_id, patient_id, appointment_date DESC);

CREATE INDEX IF NOT EXISTS idx_healthcare_appointments_practitioner_date
  ON healthcare.appointments (business_id, practitioner_user_id, appointment_date, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_healthcare_preventive_events_pet_due
  ON healthcare.preventive_events (business_id, pet_id, next_due_date);

CREATE INDEX IF NOT EXISTS idx_healthcare_preventive_events_patient_due
  ON healthcare.preventive_events (business_id, patient_id, next_due_date);

CREATE INDEX IF NOT EXISTS idx_healthcare_preventive_events_business_date
  ON healthcare.preventive_events (business_id, date_administered DESC);

-- ============================================================================
-- TRIGGERS — reuse healthcare.touch_updated_at()
-- ============================================================================

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'appointments',
    'preventive_events'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgname = 'trg_' || table_name || '_touch_updated_at'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON healthcare.%I FOR EACH ROW EXECUTE FUNCTION healthcare.touch_updated_at()',
        'trg_' || table_name || '_touch_updated_at',
        table_name
      );
    END IF;
  END LOOP;
END $$;
