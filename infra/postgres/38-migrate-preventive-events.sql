-- =============================================================================
-- Migration 38: public.medical_preventive_events → healthcare.preventive_events
-- =============================================================================
-- Independent of migration 37 (appointments) — no shared FK, can run in any order
-- relative to it, but still depends on 34/35/36 for owner/patient/pet resolution.
--
-- Column decisions:
--   subject_type      — 'human' when patients.species IS NULL, 'pet' otherwise
--                        (same criterion as migrations 35/36)
--   patient_id/pet_id — resolved via source_patient_id traceability links
--   practitioner_user_id — NULL (no equivalent column in
--                        public.medical_preventive_events; created_by/updated_by
--                        are preserved separately and are not necessarily the
--                        administering practitioner)
--   event_type        — direct copy; source CHECK ('vaccination','deworming') is
--                        a strict subset of destination CHECK (adds
--                        'flea_tick_treatment','other'), so no invalid-value risk
--   product_id/batch_id — product_id direct copy (public.products, not duplicated
--                        into healthcare); batch_id NULL (no batch/lot ledger
--                        existed at the time these events were recorded)
--   date_administered — source column is nullable DATE; destination is NOT NULL.
--                        Rows with NULL date_administered are reported as a
--                        diagnostic and EXCLUDED from the insert (cannot satisfy
--                        the NOT NULL constraint without fabricating a date).
--   dose               — direct copy (VARCHAR(120) in both schemas — no truncation
--                        risk here, unlike prescription_items)
--   status             — direct copy; source CHECK is a subset of destination CHECK
--   metadata.product_name_snapshot — preserved (destination has no dedicated
--                        column for it; product_id + product name live in public.products)
--
-- Safety properties:
--   Idempotent   — re-running never creates duplicates (keyed on source_event_id)
--   Atomic       — single BEGIN/COMMIT
--   Multi-tenant — business_id preserved per row
--   Non-destructive — zero writes to public.medical_preventive_events
--
-- Depends on: migrations 14, 33 (healthcare schema), 34 (pet_owners, transitively
--             via 36), 35 (patients human), 36 (pets)
--
-- Backup before running (staging AND production, in that order):
--   docker exec -i [container] pg_dump -U admin -d ankode -n healthcare -n public \
--     -t healthcare.preventive_events -t public.medical_preventive_events -t public.patients \
--     -F c -f /backups/pre-migration-38-$(date +%Y%m%d%H%M%S).dump
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/38-migrate-preventive-events.sql
--
-- Production:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/38-migrate-preventive-events.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: verify target tables exist
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'preventive_events'
  ) THEN
    RAISE EXCEPTION 'healthcare.preventive_events does not exist. Run migrations 14 and 33 first.';
  END IF;

  IF NOT EXISTS (
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
ALTER TABLE healthcare.preventive_events
  ADD COLUMN IF NOT EXISTS source_event_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_hc_preventive_events_source_event_id
  ON healthcare.preventive_events (source_event_id, business_id);

-- ---------------------------------------------------------------------------
-- 2. Diagnostics — run BEFORE the INSERT, review before proceeding
-- ---------------------------------------------------------------------------

-- 2a. Structural NULLs / orphan patient FK / missing date_administered
SELECT
  'preventive_events: structural NULL/orphan check' AS diagnostic,
  COUNT(*) FILTER (WHERE mpe.patient_id IS NULL)         AS null_patient_id,
  COUNT(*) FILTER (WHERE mpe.business_id IS NULL)        AS null_business_id,
  COUNT(*) FILTER (WHERE mpe.date_administered IS NULL)  AS null_date_administered,
  COUNT(*) FILTER (WHERE p.id IS NULL)                   AS orphan_patient_fk,
  COUNT(*) FILTER (WHERE mpe.product_id IS NOT NULL AND pr.id IS NULL) AS orphan_product_fk
FROM public.medical_preventive_events mpe
LEFT JOIN public.patients p ON p.id = mpe.patient_id AND p.business_id = mpe.business_id
LEFT JOIN public.products pr ON pr.id = mpe.product_id;

-- 2b. Rows that WILL BE SKIPPED — NULL date_administered (destination NOT NULL)
SELECT
  'SKIPPED — date_administered is NULL' AS migration_status,
  mpe.id AS public_event_id,
  mpe.business_id,
  mpe.patient_id,
  mpe.event_type,
  mpe.status
FROM public.medical_preventive_events mpe
WHERE mpe.business_id IS NOT NULL
  AND mpe.date_administered IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM healthcare.preventive_events hpe
    WHERE hpe.source_event_id = mpe.id AND hpe.business_id = mpe.business_id
  )
ORDER BY mpe.business_id, mpe.id;

-- 2c. Rows that WILL BE SKIPPED — patient/pet not yet migrated (35/36 gap)
SELECT
  'SKIPPED — patient/pet not migrated' AS migration_status,
  mpe.id AS public_event_id,
  mpe.business_id,
  mpe.patient_id,
  p.species,
  CASE
    WHEN p.id IS NULL THEN 'patient not found in public.patients (orphan FK)'
    WHEN (p.species IS NULL OR TRIM(p.species) = '') THEN 'human patient missing in healthcare.patients — run migration 35'
    ELSE 'pet missing in healthcare.pets — run migration 36'
  END AS reason
FROM public.medical_preventive_events mpe
LEFT JOIN public.patients p ON p.id = mpe.patient_id AND p.business_id = mpe.business_id
LEFT JOIN healthcare.patients hp ON hp.source_patient_id = p.id AND hp.business_id = p.business_id
  AND (p.species IS NULL OR TRIM(p.species) = '')
LEFT JOIN healthcare.pets hpet ON hpet.source_patient_id = p.id AND hpet.business_id = p.business_id
  AND (p.species IS NOT NULL AND TRIM(p.species) != '')
WHERE mpe.business_id IS NOT NULL
  AND mpe.date_administered IS NOT NULL
  AND hp.id IS NULL AND hpet.id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM healthcare.preventive_events hpe
    WHERE hpe.source_event_id = mpe.id AND hpe.business_id = mpe.business_id
  )
ORDER BY mpe.business_id, mpe.id;

-- ---------------------------------------------------------------------------
-- 3. Main INSERT — human path
-- ---------------------------------------------------------------------------
INSERT INTO healthcare.preventive_events (
  business_id, source_event_id, subject_type, patient_id, pet_id,
  practitioner_user_id, event_type, product_id, batch_id, date_administered,
  next_due_date, dose, notes, status, metadata, is_active,
  created_by, updated_by, created_at, updated_at
)
SELECT
  mpe.business_id,
  mpe.id                                                            AS source_event_id,
  'human'                                                           AS subject_type,
  hp.id                                                             AS patient_id,
  NULL::BIGINT                                                      AS pet_id,
  NULL::INTEGER                                                     AS practitioner_user_id,
  mpe.event_type,
  mpe.product_id,
  NULL::BIGINT                                                      AS batch_id,
  mpe.date_administered,
  mpe.next_due_date,
  mpe.dose,
  COALESCE(mpe.notes, '')                                           AS notes,
  mpe.status,
  (
    COALESCE(mpe.metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
         'migrated_from',            'public.medical_preventive_events',
         'migrated_at',              NOW()::text,
         'product_name_snapshot',    NULLIF(TRIM(COALESCE(mpe.product_name_snapshot, '')), '')
       ))
  )                                                                  AS metadata,
  TRUE                                                               AS is_active,
  mpe.created_by,
  mpe.updated_by,
  mpe.created_at,
  mpe.updated_at
FROM public.medical_preventive_events mpe
INNER JOIN public.patients p ON p.id = mpe.patient_id AND p.business_id = mpe.business_id
  AND (p.species IS NULL OR TRIM(p.species) = '')
INNER JOIN healthcare.patients hp ON hp.source_patient_id = p.id AND hp.business_id = p.business_id
WHERE mpe.business_id IS NOT NULL
  AND mpe.date_administered IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM healthcare.preventive_events hpe
    WHERE hpe.source_event_id = mpe.id AND hpe.business_id = mpe.business_id
  );

-- ---------------------------------------------------------------------------
-- 4. Main INSERT — pet path
-- ---------------------------------------------------------------------------
INSERT INTO healthcare.preventive_events (
  business_id, source_event_id, subject_type, patient_id, pet_id,
  practitioner_user_id, event_type, product_id, batch_id, date_administered,
  next_due_date, dose, notes, status, metadata, is_active,
  created_by, updated_by, created_at, updated_at
)
SELECT
  mpe.business_id,
  mpe.id                                                            AS source_event_id,
  'pet'                                                             AS subject_type,
  NULL::BIGINT                                                      AS patient_id,
  hpet.id                                                           AS pet_id,
  NULL::INTEGER                                                     AS practitioner_user_id,
  mpe.event_type,
  mpe.product_id,
  NULL::BIGINT                                                      AS batch_id,
  mpe.date_administered,
  mpe.next_due_date,
  mpe.dose,
  COALESCE(mpe.notes, '')                                           AS notes,
  mpe.status,
  (
    COALESCE(mpe.metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
         'migrated_from',            'public.medical_preventive_events',
         'migrated_at',              NOW()::text,
         'product_name_snapshot',    NULLIF(TRIM(COALESCE(mpe.product_name_snapshot, '')), '')
       ))
  )                                                                  AS metadata,
  TRUE                                                               AS is_active,
  mpe.created_by,
  mpe.updated_by,
  mpe.created_at,
  mpe.updated_at
FROM public.medical_preventive_events mpe
INNER JOIN public.patients p ON p.id = mpe.patient_id AND p.business_id = mpe.business_id
  AND p.species IS NOT NULL AND TRIM(p.species) != ''
INNER JOIN healthcare.pets hpet ON hpet.source_patient_id = p.id AND hpet.business_id = p.business_id
WHERE mpe.business_id IS NOT NULL
  AND mpe.date_administered IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM healthcare.preventive_events hpe
    WHERE hpe.source_event_id = mpe.id AND hpe.business_id = mpe.business_id
  );

-- ---------------------------------------------------------------------------
-- 5. Post-insert verification — per-business breakdown + global totals
-- ---------------------------------------------------------------------------
SELECT
  source,
  business_id,
  SUM(total)::INT AS total
FROM (
  SELECT 'eligible_public_preventive_events'::TEXT AS source, mpe.business_id, COUNT(*) AS total
  FROM public.medical_preventive_events mpe
  WHERE mpe.business_id IS NOT NULL
  GROUP BY mpe.business_id

  UNION ALL

  SELECT 'migrated_healthcare_preventive_events'::TEXT, hpe.business_id, COUNT(*)
  FROM healthcare.preventive_events hpe
  WHERE hpe.source_event_id IS NOT NULL
  GROUP BY hpe.business_id
) counts
GROUP BY source, business_id
ORDER BY business_id, source;

SELECT 'TOTAL eligible_public_preventive_events' AS description, COUNT(*)::INT AS rows
FROM public.medical_preventive_events WHERE business_id IS NOT NULL

UNION ALL

SELECT 'TOTAL skipped_null_date_administered', COUNT(*)::INT
FROM public.medical_preventive_events WHERE business_id IS NOT NULL AND date_administered IS NULL

UNION ALL

SELECT 'TOTAL migrated_healthcare_preventive_events', COUNT(*)::INT
FROM healthcare.preventive_events WHERE source_event_id IS NOT NULL

UNION ALL

SELECT 'TOTAL migrated (human)', COUNT(*)::INT
FROM healthcare.preventive_events WHERE source_event_id IS NOT NULL AND subject_type = 'human'

UNION ALL

SELECT 'TOTAL migrated (pet)', COUNT(*)::INT
FROM healthcare.preventive_events WHERE source_event_id IS NOT NULL AND subject_type = 'pet';

COMMIT;
