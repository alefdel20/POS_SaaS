-- =============================================================================
-- Migration 48: healthcare.veterinary_encounters.owner_id becomes nullable
-- =============================================================================
-- Contexto: Fase 4's consultation sync (healthcareSubjectTranslation.js,
-- syncConsultationToHealthcare/OnUpdate) mirrors a pet consultation into
-- healthcare.veterinary_encounters. owner_id is resolved from the
-- consultation's client_id via healthcare.pet_owners — but client_id is
-- optional (migration 47), and even when present the client may not have a
-- healthcare.pet_owners mirror yet. Until this migration, owner_id NOT NULL
-- forced insertVeterinaryEncounterMirror to SKIP the mirror insert entirely
-- whenever owner_id could not be resolved, leaving the consultation with no
-- healthcare.* mirror until a later edit supplied a resolvable client_id.
--
-- This is intentionally the same shape as migration 44
-- (healthcare.pets.owner_id -> nullable) and migration 33
-- (healthcare.appointments.owner_id, nullable from the start): a responsible
-- party that isn't fixed at record-creation time is resolved later, per visit
-- — not an error state.
--
-- Investigation performed before writing this migration (requested
-- explicitly, same as the appointments_subject_fk_check check done for
-- migration 33/39): reviewed every CONSTRAINT on
-- healthcare.veterinary_encounters (infra/postgres/14-healthcare-modular-
-- expansion.sql, CREATE TABLE + the DO $$ FK block later in the same file).
-- Result — no CHECK constraint anywhere references owner_id (the four
-- CHECKs on this table are veterinary_encounters_type_check,
-- _status_check, _row_status_check, none of which mention owner_id; unlike
-- healthcare.appointments' appointments_subject_fk_check, which DOES
-- reference owner_id and had to be considered when appointments.owner_id
-- was made nullable). The only object referencing owner_id at all is the
-- plain FK fk_healthcare_veterinary_encounters_owner
-- (FOREIGN KEY (owner_id, business_id) REFERENCES healthcare.pet_owners
-- (id, business_id)) — Postgres never evaluates a FK when the referencing
-- column is NULL, so it keeps validating normally whenever owner_id does
-- carry a value, same as migrations 33/44/46 already documented. No trigger
-- on this table reads or writes owner_id either (only the generic
-- healthcare.touch_updated_at() housekeeping trigger applies here, same as
-- every other healthcare.* table). Conclusion: DROP NOT NULL is sufficient,
-- no other object needs to change.
--
-- Safety properties (same pattern as 33/34/44/46):
--   Idempotent      — DROP NOT NULL on an already-nullable column is a no-op.
--   Atomic          — single BEGIN/COMMIT.
--   Non-destructive — no data deleted or rewritten; every existing row keeps
--                     its current owner_id (resolved or NULL).
--
-- Depends on: migration 14 (healthcare.veterinary_encounters itself).
--
-- Backup before running (staging AND production, in that order):
--   docker exec -i [container] pg_dump -U admin -d ankode -n healthcare \
--     -t healthcare.veterinary_encounters \
--     -F c -f /backups/pre-migration-48-$(date +%Y%m%d%H%M%S).dump
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/48-healthcare-veterinary-encounters-owner-nullable.sql
--
-- Production:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/48-healthcare-veterinary-encounters-owner-nullable.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: verify target table exists
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'veterinary_encounters'
  ) THEN
    RAISE EXCEPTION 'healthcare.veterinary_encounters does not exist. Run migration 14 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. DROP NOT NULL
-- ---------------------------------------------------------------------------
ALTER TABLE healthcare.veterinary_encounters
  ALTER COLUMN owner_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Verification — confirms the column is nullable, and that no CHECK
--    constraint referencing owner_id was ever added (documented above as
--    absent, re-confirmed here at run time) and the FK is still alive
-- ---------------------------------------------------------------------------
SELECT
  table_schema,
  table_name,
  column_name,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'healthcare'
  AND table_name = 'veterinary_encounters'
  AND column_name = 'owner_id';

SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'healthcare.veterinary_encounters'::regclass
  AND (pg_get_constraintdef(oid) ILIKE '%owner_id%');

COMMIT;
