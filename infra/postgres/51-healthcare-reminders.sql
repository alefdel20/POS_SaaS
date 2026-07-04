-- =============================================================================
-- Migration 51: healthcare.reminders (Fase 6 — mirror SOLO de reminders clinicos)
-- =============================================================================
-- Contexto: public.reminders (migracion 03: business_id: migracion 16:
-- reminder_type/category/patient_id/metadata) es una sola tabla que mezcla
-- reminders clinicos (category = 'clinical', ej. proxima cita, vacuna
-- pendiente) con reminders puramente administrativos/financieros
-- (category = 'administrative': stock bajo, gastos, prestamos de dueno,
-- gastos fijos, cobros, pagos de suscripcion — ver reminder_type
-- 'finance_expense'/'finance_owner_loan'/'finance_fixed_expense' en
-- reminderService.js, todos con category = 'administrative').
--
-- healthcare.reminders mirroria EXCLUSIVAMENTE los reminders con
-- category = 'clinical'. Los de category = 'administrative' nunca se
-- sincronizan, nunca se auto-sanan, nunca se leen desde este schema — mismo
-- principio de particion por dominio que ya separa medical_prescriptions de
-- las finanzas del negocio. El guard vive en codigo
-- (healthcareSubjectTranslation.js: syncReminderToHealthcare/OnUpdate
-- retornan null de inmediato si category !== 'clinical'), no en un CHECK de
-- esta tabla, porque esta tabla JAMAS recibe una fila no-clinica: no hay nada
-- que journalizar.
--
-- patient_id es NULLABLE en public.reminders (un reminder clinico puede no
-- estar ligado a un paciente especifico, ej. un recordatorio clinico
-- administrativo general del consultorio) — por eso subject_type/patient_id/
-- pet_id son NULLABLE aqui tambien, a diferencia de healthcare.prescriptions
-- (que siempre requiere un paciente). Ver el CHECK
-- healthcare_reminders_subject_check abajo: permite explicitamente el caso
-- "sin sujeto" ademas de los dos casos human/pet ya usados en otras mirrors.
--
-- source_reminder_id referencia public.reminders(id) ON DELETE CASCADE: a
-- diferencia de las demas mirrors (que nunca borran fisicamente su fuente),
-- reminders SI se borran fisicamente (reminderService.deleteReminder /
-- removeAutomaticReminder). CASCADE aqui evita dejar mirrors huerfanos
-- apuntando a un source_reminder_id que ya no existe — no se requiere codigo
-- de aplicacion para el borrado del mirror, la FK lo resuelve.
--
-- Sin backfill historico: mismo principio que migraciones 41/49 — esta tabla
-- nace vacia y solo se llena hacia adelante, a partir de que
-- reminderService.js empiece a llamar a syncReminderToHealthcare/OnUpdate.
--
-- Safety properties:
--   Idempotente  — CREATE TABLE IF NOT EXISTS + ADD CONSTRAINT guardado con
--                  pg_constraint / EXCEPTION WHEN duplicate_object.
--   Atomico      — single BEGIN/COMMIT.
--   No destructivo — tabla nueva, cero filas hasta que reminderService.js
--                  empiece a escribir.
--
-- Depends on: public.reminders (migraciones 03/16), businesses/users (schema
--             base), healthcare.patients/healthcare.pets (migracion 14, via
--             resolveHealthcareSubject en healthcareSubjectTranslation.js).
--
-- Backup before running (staging AND production, in that order):
--   docker exec -i [container] pg_dump -U admin -d ankode -n healthcare \
--     -t healthcare.reminders \
--     -F c -f /backups/pre-migration-51-$(date +%Y%m%d%H%M%S).dump
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/51-healthcare-reminders.sql
--
-- Production:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/51-healthcare-reminders.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: verify dependencies exist
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.schemata WHERE schema_name = 'healthcare'
  ) THEN
    RAISE EXCEPTION 'healthcare schema does not exist. Run migration 14 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'reminders'
  ) THEN
    RAISE EXCEPTION 'public.reminders does not exist.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reminders' AND column_name = 'category'
  ) THEN
    RAISE EXCEPTION 'public.reminders.category does not exist. Run migration 16 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS healthcare.reminders (
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
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'healthcare_reminders_status_check'
      AND conrelid = 'healthcare.reminders'::regclass
  ) THEN
    ALTER TABLE healthcare.reminders DROP CONSTRAINT healthcare_reminders_status_check;
  END IF;
END $$;

ALTER TABLE healthcare.reminders
ADD CONSTRAINT healthcare_reminders_status_check
CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'healthcare_reminders_subject_check'
      AND conrelid = 'healthcare.reminders'::regclass
  ) THEN
    ALTER TABLE healthcare.reminders DROP CONSTRAINT healthcare_reminders_subject_check;
  END IF;
END $$;

-- Unlike healthcare.prescriptions/appointments (subject always required),
-- a clinical reminder may have no patient at all (patient_id nullable on
-- public.reminders) — so the "no subject" case is a first-class, valid state
-- here, not just an unresolved/legacy gap.
ALTER TABLE healthcare.reminders
ADD CONSTRAINT healthcare_reminders_subject_check
CHECK (
  (subject_type IS NULL AND patient_id IS NULL AND pet_id IS NULL)
  OR
  (subject_type = 'human' AND patient_id IS NOT NULL AND pet_id IS NULL)
  OR
  (subject_type = 'pet' AND pet_id IS NOT NULL AND patient_id IS NULL)
);

-- ---------------------------------------------------------------------------
-- 2. Foreign keys
-- ---------------------------------------------------------------------------
DO $$
BEGIN
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
END $$;

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------
-- Plain index, not UNIQUE — same convention as idx_hc_prescriptions_source_
-- prescription_id (migration 40): the idempotent INSERT ... WHERE NOT EXISTS
-- in application code (healthcareSubjectTranslation.js) is what guarantees
-- one mirror row per source reminder, not a DB-level uniqueness guarantee.
CREATE INDEX IF NOT EXISTS idx_hc_reminders_source_reminder_id
  ON healthcare.reminders (source_reminder_id, business_id);
CREATE INDEX IF NOT EXISTS idx_hc_reminders_business_status_due_date
  ON healthcare.reminders (business_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_hc_reminders_patient_id
  ON healthcare.reminders (patient_id);
CREATE INDEX IF NOT EXISTS idx_hc_reminders_pet_id
  ON healthcare.reminders (pet_id);

-- ---------------------------------------------------------------------------
-- 4. Verification
-- ---------------------------------------------------------------------------
SELECT
  table_name, column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_schema = 'healthcare' AND table_name = 'reminders'
ORDER BY ordinal_position;

SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'healthcare.reminders'::regclass;

COMMIT;
