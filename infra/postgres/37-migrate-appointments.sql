-- =============================================================================
-- Migration 37: public.appointments → healthcare.appointments
-- =============================================================================
-- Migrates every appointment (human + pet, discriminated by patients.species)
-- into the typed healthcare.appointments table.
--
-- resulting_encounter_id is left NULL by this script. There is no FK between
-- public.appointments and public.consultations in the source schema, so the
-- link is reconstructed later by migration 39's heuristic reconciliation step
-- (patient_id + same date, only when the match is unique). Rows resolved that
-- way are tagged metadata.linked_via = 'heuristic_patient_date'.
--
-- Column decisions:
--   subject_type    — 'human' when patients.species IS NULL, 'pet' otherwise
--                      (same criterion as clinicalService.js normalizeNullableText,
--                      reused unchanged from migrations 35/36)
--   patient_id/pet_id/owner_id — resolved via source_patient_id / client_id
--                      traceability links added in migrations 34/35/36
--   practitioner_user_id — direct copy of doctor_user_id (same public.users row,
--                      users table was not duplicated into healthcare)
--   area            — LOWER(a.area): source stores 'CLINICA'/'ESTETICA',
--                      destination CHECK requires 'clinica'/'estetica'
--   specialty       — direct copy
--   reason          — '' (no equivalent; public.appointments only has "notes",
--                      no separate reason/motivo field)
--   notes           — direct copy
--   resulting_encounter_id — NULL (see above; filled by migration 39)
--   metadata.source_client_id — original public.appointments.client_id
--   metadata.pet_owner_ref_id — healthcare.pet_owners.id (pet path only)
--
-- Skip strategy (INNER JOIN, no placeholders):
--   A row is skipped when its patient/pet was not migrated in 35/36, or
--   (pet path only) when its client was not migrated in 34. Skipped rows are
--   reported in the diagnostic SELECTs below, run BEFORE the INSERT.
--
-- Safety properties:
--   Idempotent   — re-running never creates duplicates (keyed on source_appointment_id)
--   Atomic       — single BEGIN/COMMIT
--   Multi-tenant — business_id preserved per row
--   Non-destructive — zero writes to public.appointments
--
-- Depends on: migrations 14, 33 (healthcare schema), 34 (pet_owners), 35 (patients human),
--             36 (pets)
--
-- Backup before running (staging AND production, in that order):
--   docker exec -i [container] pg_dump -U admin -d ankode -n healthcare -n public \
--     -t healthcare.appointments -t public.appointments -t public.patients -t public.clients \
--     -F c -f /backups/pre-migration-37-$(date +%Y%m%d%H%M%S).dump
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/37-migrate-appointments.sql
--
-- Production:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/37-migrate-appointments.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: verify target tables exist
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'appointments'
  ) THEN
    RAISE EXCEPTION 'healthcare.appointments does not exist. Run migrations 14 and 33 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'patients'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'healthcare' AND table_name = 'patients' AND column_name = 'source_patient_id'
  ) THEN
    RAISE EXCEPTION 'healthcare.patients.source_patient_id missing. Run migration 35 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'healthcare' AND table_name = 'pets' AND column_name = 'source_patient_id'
  ) THEN
    RAISE EXCEPTION 'healthcare.pets.source_patient_id missing. Run migration 36 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Traceability column + index
-- ---------------------------------------------------------------------------
ALTER TABLE healthcare.appointments
  ADD COLUMN IF NOT EXISTS source_appointment_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_hc_appointments_source_appointment_id
  ON healthcare.appointments (source_appointment_id, business_id);

-- ---------------------------------------------------------------------------
-- 2. Diagnostics — run BEFORE the INSERT, review before proceeding
-- ---------------------------------------------------------------------------

-- 2a. Structural NULLs / orphan patient FK in source (should be ~0; appointments.*
--     is NOT NULL at the DB level, this just confirms no pre-constraint legacy rows)
SELECT
  'appointments: structural NULL/orphan check' AS diagnostic,
  COUNT(*) FILTER (WHERE a.patient_id IS NULL)   AS null_patient_id,
  COUNT(*) FILTER (WHERE a.client_id IS NULL)    AS null_client_id,
  COUNT(*) FILTER (WHERE a.business_id IS NULL)  AS null_business_id,
  COUNT(*) FILTER (WHERE p.id IS NULL)           AS orphan_patient_fk
FROM public.appointments a
LEFT JOIN public.patients p ON p.id = a.patient_id AND p.business_id = a.business_id;

-- 2b. Rows that WILL BE SKIPPED — patient/pet not yet migrated (35/36 gap)
SELECT
  'SKIPPED — patient/pet not migrated' AS migration_status,
  a.id AS public_appointment_id,
  a.business_id,
  a.patient_id,
  p.species,
  CASE
    WHEN p.id IS NULL THEN 'patient not found in public.patients (orphan FK)'
    WHEN (p.species IS NULL OR TRIM(p.species) = '') THEN 'human patient missing in healthcare.patients — run migration 35'
    ELSE 'pet missing in healthcare.pets — run migration 36 (owner may not have migrated)'
  END AS reason
FROM public.appointments a
LEFT JOIN public.patients p ON p.id = a.patient_id AND p.business_id = a.business_id
LEFT JOIN healthcare.patients hp ON hp.source_patient_id = p.id AND hp.business_id = p.business_id
  AND (p.species IS NULL OR TRIM(p.species) = '')
LEFT JOIN healthcare.pets hpet ON hpet.source_patient_id = p.id AND hpet.business_id = p.business_id
  AND (p.species IS NOT NULL AND TRIM(p.species) != '')
WHERE a.business_id IS NOT NULL
  AND hp.id IS NULL AND hpet.id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM healthcare.appointments ha
    WHERE ha.source_appointment_id = a.id AND ha.business_id = a.business_id
  )
ORDER BY a.business_id, a.id;

-- 2c. Pet-path rows that WILL BE SKIPPED — owner not migrated (34 gap)
SELECT
  'SKIPPED — pet owner not migrated' AS migration_status,
  a.id AS public_appointment_id,
  a.business_id,
  a.client_id AS public_client_id
FROM public.appointments a
INNER JOIN public.patients p ON p.id = a.patient_id AND p.business_id = a.business_id
  AND p.species IS NOT NULL AND TRIM(p.species) != ''
INNER JOIN healthcare.pets hpet ON hpet.source_patient_id = p.id AND hpet.business_id = p.business_id
LEFT JOIN healthcare.pet_owners po ON po.client_id = a.client_id AND po.business_id = a.business_id
WHERE a.business_id IS NOT NULL
  AND po.id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM healthcare.appointments ha
    WHERE ha.source_appointment_id = a.id AND ha.business_id = a.business_id
  )
ORDER BY a.business_id, a.id;

-- ---------------------------------------------------------------------------
-- 3. Main INSERT — human path
-- ---------------------------------------------------------------------------
INSERT INTO healthcare.appointments (
  business_id, source_appointment_id, subject_type, patient_id, pet_id, owner_id,
  practitioner_user_id, area, specialty, appointment_date, start_time, end_time,
  status, reason, notes, resulting_encounter_id, metadata, is_active,
  created_by, updated_by, created_at, updated_at
)
SELECT
  a.business_id,
  a.id                                                              AS source_appointment_id,
  'human'                                                           AS subject_type,
  hp.id                                                             AS patient_id,
  NULL::BIGINT                                                      AS pet_id,
  NULL::BIGINT                                                      AS owner_id,
  a.doctor_user_id                                                  AS practitioner_user_id,
  LOWER(a.area)                                                     AS area,
  a.specialty,
  a.appointment_date,
  a.start_time,
  a.end_time,
  a.status,
  ''                                                                 AS reason,
  COALESCE(a.notes, '')                                             AS notes,
  NULL::BIGINT                                                      AS resulting_encounter_id,
  (
    COALESCE(a.metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
         'migrated_from',     'public.appointments',
         'migrated_at',       NOW()::text,
         'source_client_id',  a.client_id
       ))
  )                                                                  AS metadata,
  a.is_active,
  a.created_by,
  a.updated_by,
  a.created_at,
  a.updated_at
FROM public.appointments a
INNER JOIN public.patients p ON p.id = a.patient_id AND p.business_id = a.business_id
  AND (p.species IS NULL OR TRIM(p.species) = '')
INNER JOIN healthcare.patients hp ON hp.source_patient_id = p.id AND hp.business_id = p.business_id
WHERE a.business_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM healthcare.appointments ha
    WHERE ha.source_appointment_id = a.id AND ha.business_id = a.business_id
  );

-- ---------------------------------------------------------------------------
-- 4. Main INSERT — pet path
-- ---------------------------------------------------------------------------
INSERT INTO healthcare.appointments (
  business_id, source_appointment_id, subject_type, patient_id, pet_id, owner_id,
  practitioner_user_id, area, specialty, appointment_date, start_time, end_time,
  status, reason, notes, resulting_encounter_id, metadata, is_active,
  created_by, updated_by, created_at, updated_at
)
SELECT
  a.business_id,
  a.id                                                              AS source_appointment_id,
  'pet'                                                             AS subject_type,
  NULL::BIGINT                                                      AS patient_id,
  hpet.id                                                           AS pet_id,
  po.id                                                             AS owner_id,
  a.doctor_user_id                                                  AS practitioner_user_id,
  LOWER(a.area)                                                     AS area,
  a.specialty,
  a.appointment_date,
  a.start_time,
  a.end_time,
  a.status,
  ''                                                                 AS reason,
  COALESCE(a.notes, '')                                             AS notes,
  NULL::BIGINT                                                      AS resulting_encounter_id,
  (
    COALESCE(a.metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
         'migrated_from',      'public.appointments',
         'migrated_at',        NOW()::text,
         'source_client_id',   a.client_id,
         'pet_owner_ref_id',   po.id
       ))
  )                                                                  AS metadata,
  a.is_active,
  a.created_by,
  a.updated_by,
  a.created_at,
  a.updated_at
FROM public.appointments a
INNER JOIN public.patients p ON p.id = a.patient_id AND p.business_id = a.business_id
  AND p.species IS NOT NULL AND TRIM(p.species) != ''
INNER JOIN healthcare.pets hpet ON hpet.source_patient_id = p.id AND hpet.business_id = p.business_id
INNER JOIN healthcare.pet_owners po ON po.client_id = a.client_id AND po.business_id = a.business_id
WHERE a.business_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM healthcare.appointments ha
    WHERE ha.source_appointment_id = a.id AND ha.business_id = a.business_id
  );

-- ---------------------------------------------------------------------------
-- 5. Post-insert verification — per-business breakdown + global totals
-- ---------------------------------------------------------------------------
SELECT
  source,
  business_id,
  SUM(total)::INT AS total
FROM (
  SELECT 'eligible_public_appointments'::TEXT AS source, a.business_id, COUNT(*) AS total
  FROM public.appointments a
  WHERE a.business_id IS NOT NULL
  GROUP BY a.business_id

  UNION ALL

  SELECT 'migrated_healthcare_appointments'::TEXT, ha.business_id, COUNT(*)
  FROM healthcare.appointments ha
  WHERE ha.source_appointment_id IS NOT NULL
  GROUP BY ha.business_id
) counts
GROUP BY source, business_id
ORDER BY business_id, source;

SELECT 'TOTAL eligible_public_appointments' AS description, COUNT(*)::INT AS rows
FROM public.appointments WHERE business_id IS NOT NULL

UNION ALL

SELECT 'TOTAL migrated_healthcare_appointments', COUNT(*)::INT
FROM healthcare.appointments WHERE source_appointment_id IS NOT NULL

UNION ALL

SELECT 'TOTAL migrated (human)', COUNT(*)::INT
FROM healthcare.appointments WHERE source_appointment_id IS NOT NULL AND subject_type = 'human'

UNION ALL

SELECT 'TOTAL migrated (pet)', COUNT(*)::INT
FROM healthcare.appointments WHERE source_appointment_id IS NOT NULL AND subject_type = 'pet';

COMMIT;
