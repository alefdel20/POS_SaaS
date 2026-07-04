-- =============================================================================
-- Migration 47: public.consultations — Fase 4 schema prep
-- =============================================================================
-- Two independent, additive changes to public.consultations, both prerequisites
-- for the Fase 4 sync-on-create/update into healthcare.clinical_encounters /
-- healthcare.veterinary_encounters (see healthcareSubjectTranslation.js):
--
-- (a) client_id -> NULLABLE
--   Same product decision and same mechanics as migration 46
--   (public.appointments.client_id): an animal (or, per the Fase 4
--   investigation, potentially a human patient) attended before a responsible
--   party is resolved is a valid state, not an error. Today consultations.
--   client_id is NOT NULL at both the DB and API validation layer (unlike
--   appointments, migration 46 never touched consultations) — createConsultation
--   currently hard-400s "Client is required" for a patient with no client_id,
--   which is exactly the state a patient created after commit 6db95fc (client
--   link replaced with a phone field) or a rescued-animal-pending-adoption
--   patient is in today.
--   The FK fk_consultations_client is untouched — Postgres never evaluates a
--   simple FK when the column is NULL, same as migration 46's appointments
--   case. No CHECK/unique index exists on this column either.
--
-- (b) appointment_id -> NEW, NULLABLE, FK to appointments(id)
--   Lets a consultation explicitly declare which appointment it resulted from.
--   Deliberately NOT backfilled by heuristic here (see migration 39's
--   same-patient/same-date heuristic, used ONLY as a one-time backfill
--   reconciliation because no FK ever existed between public.appointments and
--   public.consultations at all) — for live writes going forward, an explicit,
--   caller-declared link is the only non-ambiguous option. If not provided at
--   creation, the consultation is a walk-in (or the caller simply didn't
--   declare it) and healthcare.appointments.resulting_encounter_id for any
--   related appointment stays untouched, exactly as it does today.
--
-- Safety properties (same pattern as 34-46):
--   Idempotent    — DROP NOT NULL on an already-nullable column is a no-op;
--                   ADD COLUMN IF NOT EXISTS is a no-op on a second run.
--   Atomic        — single BEGIN/COMMIT.
--   Non-destructive — no data is deleted or rewritten; every existing row
--                   keeps its current client_id, appointment_id starts NULL
--                   for every existing row (there is no way to backfill it
--                   without the same ambiguity migration 39 already flagged
--                   as unresolvable — left NULL on purpose, not migrated).
--
-- Depends on: none beyond public.consultations/public.appointments already
--             existing (migration 12).
--
-- Backup before running (staging AND production, in that order):
--   docker exec -i [container] pg_dump -U admin -d ankode -n public \
--     -t public.consultations -t public.appointments \
--     -F c -f /backups/pre-migration-47-$(date +%Y%m%d%H%M%S).dump
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/47-consultations-schema-fase4-prep.sql
--
-- Production:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/47-consultations-schema-fase4-prep.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: verify target table exists
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'consultations'
  ) THEN
    RAISE EXCEPTION 'public.consultations does not exist.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. (a) DROP NOT NULL on client_id
-- ---------------------------------------------------------------------------
ALTER TABLE consultations
  ALTER COLUMN client_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. (b) ADD appointment_id + index
-- ---------------------------------------------------------------------------
ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS appointment_id INTEGER REFERENCES appointments(id);

CREATE INDEX IF NOT EXISTS idx_consultations_appointment_id
  ON consultations (business_id, appointment_id);

-- ---------------------------------------------------------------------------
-- 3. Verification
-- ---------------------------------------------------------------------------
SELECT
  table_schema,
  table_name,
  column_name,
  is_nullable,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'consultations'
  AND column_name IN ('client_id', 'appointment_id')
ORDER BY column_name;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'consultations'::regclass
  AND conname LIKE '%appointment%';

COMMIT;
