-- Migration 57: healthcare.cardex_entries
-- Depends on: 14-healthcare-modular-expansion.sql (schema healthcare, function touch_updated_at,
--   tables patients, pets; unique indexes uq_healthcare_*_id_business on referenced tables).
-- Safe to re-run: all statements use IF NOT EXISTS / IF NOT EXISTS (pg_constraint/pg_trigger),
-- same pattern as 33-healthcare-appointments-preventive.sql.
--
-- Cardex: evolucion clinica completa del paciente (consulta, tratamiento, cirugia,
-- hospitalizacion, laboratorio, receta), ademas de vacunacion/desparasitacion —
-- estas dos ultimas se auto-espejan aqui cuando se registran desde
-- healthcare.preventive_events (ver backend/src/services/healthcarePreventiveEventService.js),
-- sin captura manual duplicada.

-- ============================================================================
-- TABLE: healthcare.cardex_entries
-- ============================================================================

CREATE TABLE IF NOT EXISTS healthcare.cardex_entries (
  id BIGSERIAL PRIMARY KEY,
  record_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES public.businesses(id),
  subject_type VARCHAR(20) NOT NULL,
  patient_id BIGINT,
  pet_id BIGINT,
  veterinarian_user_id INTEGER REFERENCES public.users(id),
  event_type VARCHAR(30) NOT NULL,
  event_date DATE NOT NULL,
  weight_kg NUMERIC(8,3),
  temperature_c NUMERIC(5,2),
  heart_rate_bpm NUMERIC(6,2),
  respiratory_rate_bpm NUMERIC(6,2),
  diagnosis TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'completed',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES public.users(id),
  updated_by INTEGER REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cardex_entries_record_uuid_unique UNIQUE (record_uuid),
  CONSTRAINT cardex_entries_subject_check CHECK (subject_type IN ('human', 'pet')),
  CONSTRAINT cardex_entries_subject_fk_check CHECK (
    (subject_type = 'human' AND patient_id IS NOT NULL AND pet_id IS NULL)
    OR
    (subject_type = 'pet' AND pet_id IS NOT NULL AND patient_id IS NULL)
  ),
  CONSTRAINT cardex_entries_type_check CHECK (event_type IN (
    'consultation', 'treatment', 'surgery', 'hospitalization', 'lab',
    'prescription', 'vaccination', 'deworming'
  )),
  CONSTRAINT cardex_entries_status_check CHECK (status IN ('completed', 'pending', 'cancelled'))
);

-- ============================================================================
-- UNIQUE INDEX (id, business_id) — for future composite FK references
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_healthcare_cardex_entries_id_business
  ON healthcare.cardex_entries (id, business_id);

-- ============================================================================
-- FOREIGN KEYS
-- ============================================================================
-- Deliberately NOT NULL-constrained on patient_id/pet_id individually (same
-- criterion 44-healthcare-pets-owner-nullable.sql already applied to
-- healthcare.pets.owner_id) — a composite FK (col, business_id) is simply not
-- evaluated by Postgres (MATCH SIMPLE, the default) when col IS NULL, so the
-- CHECK above is what actually enforces "exactly one of patient_id/pet_id".

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_cardex_entries_patient'
      AND conrelid = 'healthcare.cardex_entries'::regclass
  ) THEN
    ALTER TABLE healthcare.cardex_entries
      ADD CONSTRAINT fk_healthcare_cardex_entries_patient
      FOREIGN KEY (patient_id, business_id)
      REFERENCES healthcare.patients (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_cardex_entries_pet'
      AND conrelid = 'healthcare.cardex_entries'::regclass
  ) THEN
    ALTER TABLE healthcare.cardex_entries
      ADD CONSTRAINT fk_healthcare_cardex_entries_pet
      FOREIGN KEY (pet_id, business_id)
      REFERENCES healthcare.pets (id, business_id);
  END IF;
END $$;

-- ============================================================================
-- OPERATIONAL INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_healthcare_cardex_entries_patient_date
  ON healthcare.cardex_entries (business_id, patient_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_healthcare_cardex_entries_pet_date
  ON healthcare.cardex_entries (business_id, pet_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_healthcare_cardex_entries_business_date
  ON healthcare.cardex_entries (business_id, event_date DESC);

-- ============================================================================
-- TRIGGER — reuse healthcare.touch_updated_at()
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_cardex_entries_touch_updated_at'
  ) THEN
    CREATE TRIGGER trg_cardex_entries_touch_updated_at
      BEFORE UPDATE ON healthcare.cardex_entries
      FOR EACH ROW EXECUTE FUNCTION healthcare.touch_updated_at();
  END IF;
END $$;
