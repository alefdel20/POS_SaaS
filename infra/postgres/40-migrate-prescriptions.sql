-- =============================================================================
-- Migration 40: public.medical_prescriptions + medical_prescription_items →
--                healthcare.prescriptions + healthcare.prescription_items
-- =============================================================================
-- Depends on migration 39 for clinical_encounter_id / veterinary_encounter_id
-- resolution (via consultations.source_consultation_id).
--
-- ---------------------------------------------------------------------------
-- Schema gap fixed by this migration — healthcare.prescription_items has no
-- metadata column
-- ---------------------------------------------------------------------------
-- Every other healthcare.* table (patients, pets, appointments, prescriptions,
-- preventive_events, clinical_encounters, veterinary_encounters, ...) has a
-- `metadata JSONB NOT NULL DEFAULT '{}'::jsonb` column. prescription_items is
-- the one outlier (see migration 14) — it was not given one. The agreed
-- design for this migration requires per-item migration provenance
-- (metadata.assumed = true for the fabricated prescribed_quantity, and
-- metadata.original_<field> when a dose/route/frequency/duration value is
-- truncated from 160 to 120 chars), which is impossible without a metadata
-- column. Fix: add it, consistent with every sibling table. Low risk — a
-- single nullable-with-default JSONB column, no existing constraint touched.
--
-- Column decisions — healthcare.prescriptions:
--   subject_type / patient_id / pet_id — derived from patients.species, same
--                        criterion as migrations 35/36/37/38/39
--   clinical_encounter_id / veterinary_encounter_id — resolved via
--                        consultation_id -> source_consultation_id (LEFT JOIN;
--                        stays NULL when consultation_id is NULL, or when the
--                        consultation exists but was skipped by migration 39
--                        for its own reasons — this is an optional link, not
--                        a hard dependency for the prescription row itself)
--   prescriber_user_id — direct copy of doctor_user_id
--   document_folio_id  — NULL (no folio system existed historically)
--   prescription_date  — created_at (no dedicated prescription_date column in
--                        source; created_at is the closest faithful proxy)
--   valid_until         — NULL (no equivalent)
--   indications_general / diagnosis_summary — indications / diagnosis, direct
--   issue_status        — direct copy; source CHECK (draft/issued/cancelled)
--                        is a strict subset of destination CHECK, no invalid
--                        value risk
--   regulatory_scope    — 'standard' (schema default; not cross-referencing
--                        medication_catalog.is_antibiotic/is_controlled_substance
--                        per item — out of scope for this pass, can be
--                        enriched later without touching subject/patient links)
--   status (row status) — 'active' (schema default)
--   is_active            — TRUE always (source has no is_active column on
--                        medical_prescriptions; issue_status = 'cancelled'
--                        already captures the "not usable" case, so is_active
--                        is not overloaded to mean the same thing)
--
-- Column decisions — healthcare.prescription_items:
--   prescription_id     — resolved via source_prescription_id
--   medication_catalog_id — LEFT JOIN on product_id + business_id (optional
--                        enrichment; NULL when the product has no catalog entry)
--   line_number          — ROW_NUMBER() OVER (PARTITION BY prescription_id
--                        ORDER BY item id) — source has no explicit ordering
--                        column, item insertion order (id ASC) is the best
--                        available proxy
--   item_type             — 'medication' (schema default; the legacy prescription
--                        flow only ever prescribed medications, no supply/service
--                        line items existed)
--   prescribed_quantity   — 1 (DECISION: no quantity was ever captured in the
--                        source schema; see buildPrescriptionPayload in
--                        clinicalService.js — items only ever had dose/frequency/
--                        duration/route/notes, never a numeric quantity).
--                        metadata.assumed = true marks every row created this way.
--   dispensed_quantity    — 0 (schema default; consistent with migration 41
--                        leaving dispensing_logs empty — there is no historical
--                        dispensing ledger to derive a non-zero value from)
--   dose/route/frequency/duration — LEFT(..., 120); when the original exceeds
--                        120 chars the full original is preserved in
--                        metadata.original_<field>
--   instructions          — notes (direct; source item-level free-text field)
--   substitution_allowed / requires_batch_tracking — FALSE (schema defaults;
--                        no equivalent flags in source)
--   status                — 'cancelled' when the parent prescription's status
--                        is 'cancelled', otherwise 'active' (direct echo of
--                        the parent's issue_status, not a new inference)
--   created_by/updated_by/created_at/updated_at — source
--                        medical_prescription_items has ONLY created_at (no
--                        created_by/updated_by/updated_at at all — items were
--                        never independently audited). Inherited from the
--                        parent prescription's created_by/updated_by;
--                        updated_at = created_at (items are never modified
--                        independently in the legacy schema)
--
-- Safety properties:
--   Idempotent   — re-running never creates duplicates (keyed on
--                  source_prescription_id / source_prescription_item_id)
--   Atomic       — single BEGIN/COMMIT
--   Multi-tenant — business_id preserved per row
--   Non-destructive — zero writes to public.medical_prescriptions or
--                  public.medical_prescription_items
--
-- Depends on: migrations 14, 33 (healthcare schema), 34 (pet_owners), 35 (patients
--             human), 36 (pets), 39 (clinical_encounters / veterinary_encounters +
--             source_consultation_id)
--
-- Backup before running (staging AND production, in that order):
--   docker exec -i [container] pg_dump -U admin -d ankode -n healthcare -n public \
--     -t healthcare.prescriptions -t healthcare.prescription_items \
--     -t public.medical_prescriptions -t public.medical_prescription_items \
--     -F c -f /backups/pre-migration-40-$(date +%Y%m%d%H%M%S).dump
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/40-migrate-prescriptions.sql
--
-- Production:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/40-migrate-prescriptions.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: verify target tables exist
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'prescriptions'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'prescription_items'
  ) THEN
    RAISE EXCEPTION 'healthcare prescription tables do not exist. Run migrations 14 and 33 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'healthcare' AND table_name = 'clinical_encounters' AND column_name = 'source_consultation_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'healthcare' AND table_name = 'veterinary_encounters' AND column_name = 'source_consultation_id'
  ) THEN
    RAISE EXCEPTION 'source_consultation_id missing on encounter tables. Run migration 39 first.';
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
-- 1. Traceability columns + indexes
-- ---------------------------------------------------------------------------
ALTER TABLE healthcare.prescriptions
  ADD COLUMN IF NOT EXISTS source_prescription_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_hc_prescriptions_source_prescription_id
  ON healthcare.prescriptions (source_prescription_id, business_id);

-- ---------------------------------------------------------------------------
-- 1b. Fix missing metadata column on healthcare.prescription_items
--     (schema gap — see header comment above)
-- ---------------------------------------------------------------------------
ALTER TABLE healthcare.prescription_items
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE healthcare.prescription_items
  ADD COLUMN IF NOT EXISTS source_prescription_item_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_hc_prescription_items_source_prescription_item_id
  ON healthcare.prescription_items (source_prescription_item_id, business_id);

-- ---------------------------------------------------------------------------
-- 2. Diagnostics — run BEFORE the INSERT, review before proceeding
-- ---------------------------------------------------------------------------

-- 2a. Structural NULLs / orphan patient FK / orphan consultation FK
SELECT
  'medical_prescriptions: structural NULL/orphan check' AS diagnostic,
  COUNT(*) FILTER (WHERE mp.patient_id IS NULL)                              AS null_patient_id,
  COUNT(*) FILTER (WHERE mp.business_id IS NULL)                             AS null_business_id,
  COUNT(*) FILTER (WHERE p.id IS NULL)                                       AS orphan_patient_fk,
  COUNT(*) FILTER (WHERE mp.consultation_id IS NOT NULL AND cons.id IS NULL) AS orphan_consultation_fk,
  COUNT(*) FILTER (WHERE mp.doctor_user_id IS NOT NULL)                      AS has_doctor
FROM public.medical_prescriptions mp
LEFT JOIN public.patients p ON p.id = mp.patient_id AND p.business_id = mp.business_id
LEFT JOIN public.consultations cons ON cons.id = mp.consultation_id AND cons.business_id = mp.business_id;

-- 2b. Rows that WILL BE SKIPPED — patient/pet not yet migrated (35/36 gap)
SELECT
  'SKIPPED — patient/pet not migrated' AS migration_status,
  mp.id AS public_prescription_id,
  mp.business_id,
  mp.patient_id,
  p.species,
  CASE
    WHEN p.id IS NULL THEN 'patient not found in public.patients (orphan FK)'
    WHEN (p.species IS NULL OR TRIM(p.species) = '') THEN 'human patient missing in healthcare.patients — run migration 35'
    ELSE 'pet missing in healthcare.pets — run migration 36'
  END AS reason
FROM public.medical_prescriptions mp
LEFT JOIN public.patients p ON p.id = mp.patient_id AND p.business_id = mp.business_id
LEFT JOIN healthcare.patients hp ON hp.source_patient_id = p.id AND hp.business_id = p.business_id
  AND (p.species IS NULL OR TRIM(p.species) = '')
LEFT JOIN healthcare.pets hpet ON hpet.source_patient_id = p.id AND hpet.business_id = p.business_id
  AND (p.species IS NOT NULL AND TRIM(p.species) != '')
WHERE mp.business_id IS NOT NULL
  AND hp.id IS NULL AND hpet.id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM healthcare.prescriptions hpr
    WHERE hpr.source_prescription_id = mp.id AND hpr.business_id = mp.business_id
  )
ORDER BY mp.business_id, mp.id;

-- 2c. Prescription items — orphan product FK + length overflow (>120) preview
SELECT
  'medical_prescription_items: orphan/length check' AS diagnostic,
  COUNT(*)                                                            AS total,
  COUNT(*) FILTER (WHERE pr.id IS NULL)                               AS orphan_product_fk,
  COUNT(*) FILTER (WHERE LENGTH(mpi.dose) > 120)                      AS dose_over_120,
  COUNT(*) FILTER (WHERE LENGTH(mpi.frequency) > 120)                 AS frequency_over_120,
  COUNT(*) FILTER (WHERE LENGTH(mpi.duration) > 120)                  AS duration_over_120,
  COUNT(*) FILTER (WHERE LENGTH(mpi.route_of_administration) > 120)   AS route_over_120
FROM public.medical_prescription_items mpi
LEFT JOIN public.products pr ON pr.id = mpi.product_id;

-- 2d. Items that WILL BE SKIPPED — orphan product FK (destination product_id is NOT NULL)
SELECT
  'SKIPPED — orphan product FK' AS migration_status,
  mpi.id AS public_prescription_item_id,
  mpi.prescription_id,
  mpi.product_id
FROM public.medical_prescription_items mpi
LEFT JOIN public.products pr ON pr.id = mpi.product_id
WHERE pr.id IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Main INSERT — prescriptions, human path
-- ---------------------------------------------------------------------------
INSERT INTO healthcare.prescriptions (
  business_id, source_prescription_id, subject_type, patient_id, pet_id,
  clinical_encounter_id, veterinary_encounter_id, prescriber_user_id,
  document_folio_id, prescription_date, valid_until,
  indications_general, diagnosis_summary, issue_status, regulatory_scope,
  metadata, status, is_active, created_by, updated_by, created_at, updated_at
)
SELECT
  mp.business_id,
  mp.id                                                              AS source_prescription_id,
  'human'                                                            AS subject_type,
  hp.id                                                               AS patient_id,
  NULL::BIGINT                                                       AS pet_id,
  hce.id                                                              AS clinical_encounter_id,
  NULL::BIGINT                                                       AS veterinary_encounter_id,
  mp.doctor_user_id                                                  AS prescriber_user_id,
  NULL::BIGINT                                                       AS document_folio_id,
  mp.created_at                                                      AS prescription_date,
  NULL::TIMESTAMPTZ                                                  AS valid_until,
  COALESCE(mp.indications, '')                                       AS indications_general,
  COALESCE(mp.diagnosis, '')                                         AS diagnosis_summary,
  mp.status                                                          AS issue_status,
  'standard'                                                         AS regulatory_scope,
  (
    COALESCE(mp.metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
         'migrated_from',        'public.medical_prescriptions',
         'migrated_at',          NOW()::text,
         'source_consultation_id', mp.consultation_id
       ))
  )                                                                   AS metadata,
  'active'                                                           AS status,
  TRUE                                                                AS is_active,
  mp.created_by,
  mp.updated_by,
  mp.created_at,
  mp.updated_at
FROM public.medical_prescriptions mp
INNER JOIN public.patients p ON p.id = mp.patient_id AND p.business_id = mp.business_id
  AND (p.species IS NULL OR TRIM(p.species) = '')
INNER JOIN healthcare.patients hp ON hp.source_patient_id = p.id AND hp.business_id = p.business_id
LEFT JOIN healthcare.clinical_encounters hce
  ON hce.source_consultation_id = mp.consultation_id AND hce.business_id = mp.business_id
WHERE mp.business_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM healthcare.prescriptions hpr
    WHERE hpr.source_prescription_id = mp.id AND hpr.business_id = mp.business_id
  );

-- ---------------------------------------------------------------------------
-- 4. Main INSERT — prescriptions, pet path
-- ---------------------------------------------------------------------------
INSERT INTO healthcare.prescriptions (
  business_id, source_prescription_id, subject_type, patient_id, pet_id,
  clinical_encounter_id, veterinary_encounter_id, prescriber_user_id,
  document_folio_id, prescription_date, valid_until,
  indications_general, diagnosis_summary, issue_status, regulatory_scope,
  metadata, status, is_active, created_by, updated_by, created_at, updated_at
)
SELECT
  mp.business_id,
  mp.id                                                              AS source_prescription_id,
  'pet'                                                              AS subject_type,
  NULL::BIGINT                                                       AS patient_id,
  hpet.id                                                             AS pet_id,
  NULL::BIGINT                                                       AS clinical_encounter_id,
  hve.id                                                              AS veterinary_encounter_id,
  mp.doctor_user_id                                                  AS prescriber_user_id,
  NULL::BIGINT                                                       AS document_folio_id,
  mp.created_at                                                      AS prescription_date,
  NULL::TIMESTAMPTZ                                                  AS valid_until,
  COALESCE(mp.indications, '')                                       AS indications_general,
  COALESCE(mp.diagnosis, '')                                         AS diagnosis_summary,
  mp.status                                                          AS issue_status,
  'standard'                                                         AS regulatory_scope,
  (
    COALESCE(mp.metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
         'migrated_from',          'public.medical_prescriptions',
         'migrated_at',            NOW()::text,
         'source_consultation_id', mp.consultation_id
       ))
  )                                                                   AS metadata,
  'active'                                                           AS status,
  TRUE                                                                AS is_active,
  mp.created_by,
  mp.updated_by,
  mp.created_at,
  mp.updated_at
FROM public.medical_prescriptions mp
INNER JOIN public.patients p ON p.id = mp.patient_id AND p.business_id = mp.business_id
  AND p.species IS NOT NULL AND TRIM(p.species) != ''
INNER JOIN healthcare.pets hpet ON hpet.source_patient_id = p.id AND hpet.business_id = p.business_id
LEFT JOIN healthcare.veterinary_encounters hve
  ON hve.source_consultation_id = mp.consultation_id AND hve.business_id = mp.business_id
WHERE mp.business_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM healthcare.prescriptions hpr
    WHERE hpr.source_prescription_id = mp.id AND hpr.business_id = mp.business_id
  );

-- ---------------------------------------------------------------------------
-- 5. Main INSERT — prescription_items (subject-agnostic: attaches via
--    prescription_id, which already carries the subject_type from step 3/4)
-- ---------------------------------------------------------------------------
INSERT INTO healthcare.prescription_items (
  business_id, source_prescription_item_id, prescription_id, product_id,
  medication_catalog_id, line_number, item_type, prescribed_quantity,
  dispensed_quantity, dose, route, frequency, duration, instructions,
  substitution_allowed, requires_batch_tracking, status, metadata,
  created_by, updated_by, created_at, updated_at
)
SELECT
  mp.business_id,
  mpi.id                                                             AS source_prescription_item_id,
  hpr.id                                                             AS prescription_id,
  mpi.product_id,
  mc.id                                                              AS medication_catalog_id,
  ROW_NUMBER() OVER (PARTITION BY mpi.prescription_id ORDER BY mpi.id) AS line_number,
  'medication'                                                       AS item_type,
  1                                                                   AS prescribed_quantity,
  0                                                                   AS dispensed_quantity,
  LEFT(mpi.dose, 120)                                                AS dose,
  LEFT(mpi.route_of_administration, 120)                             AS route,
  LEFT(mpi.frequency, 120)                                           AS frequency,
  LEFT(mpi.duration, 120)                                            AS duration,
  COALESCE(mpi.notes, '')                                            AS instructions,
  FALSE                                                               AS substitution_allowed,
  FALSE                                                               AS requires_batch_tracking,
  CASE WHEN mp.status = 'cancelled' THEN 'cancelled' ELSE 'active' END AS status,
  jsonb_strip_nulls(jsonb_build_object(
    'migrated_from',              'public.medical_prescription_items',
    'migrated_at',                NOW()::text,
    'assumed',                    true,
    'original_dose',              CASE WHEN LENGTH(mpi.dose) > 120 THEN mpi.dose ELSE NULL END,
    'original_frequency',         CASE WHEN LENGTH(mpi.frequency) > 120 THEN mpi.frequency ELSE NULL END,
    'original_duration',          CASE WHEN LENGTH(mpi.duration) > 120 THEN mpi.duration ELSE NULL END,
    'original_route',             CASE WHEN LENGTH(mpi.route_of_administration) > 120 THEN mpi.route_of_administration ELSE NULL END,
    'medication_name_snapshot',   mpi.medication_name_snapshot,
    'presentation_snapshot',      mpi.presentation_snapshot,
    'stock_snapshot',             mpi.stock_snapshot
  ))                                                                  AS metadata,
  mp.created_by,
  mp.updated_by,
  mpi.created_at,
  mpi.created_at
FROM public.medical_prescription_items mpi
INNER JOIN public.medical_prescriptions mp ON mp.id = mpi.prescription_id
INNER JOIN public.products pr ON pr.id = mpi.product_id
INNER JOIN healthcare.prescriptions hpr
  ON hpr.source_prescription_id = mp.id AND hpr.business_id = mp.business_id
LEFT JOIN healthcare.medication_catalog mc
  ON mc.product_id = mpi.product_id AND mc.business_id = mp.business_id
WHERE mp.business_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM healthcare.prescription_items hpi
    WHERE hpi.source_prescription_item_id = mpi.id AND hpi.business_id = mp.business_id
  );

-- ---------------------------------------------------------------------------
-- 6. Post-insert verification — per-business breakdown + global totals
-- ---------------------------------------------------------------------------
SELECT
  source,
  business_id,
  SUM(total)::INT AS total
FROM (
  SELECT 'eligible_public_medical_prescriptions'::TEXT AS source, mp.business_id, COUNT(*) AS total
  FROM public.medical_prescriptions mp
  WHERE mp.business_id IS NOT NULL
  GROUP BY mp.business_id

  UNION ALL

  SELECT 'migrated_healthcare_prescriptions'::TEXT, hpr.business_id, COUNT(*)
  FROM healthcare.prescriptions hpr
  WHERE hpr.source_prescription_id IS NOT NULL
  GROUP BY hpr.business_id

  UNION ALL

  SELECT 'migrated_healthcare_prescription_items'::TEXT, hpi.business_id, COUNT(*)
  FROM healthcare.prescription_items hpi
  WHERE hpi.source_prescription_item_id IS NOT NULL
  GROUP BY hpi.business_id
) counts
GROUP BY source, business_id
ORDER BY business_id, source;

SELECT 'TOTAL eligible_public_medical_prescriptions' AS description, COUNT(*)::INT AS rows
FROM public.medical_prescriptions WHERE business_id IS NOT NULL

UNION ALL

SELECT 'TOTAL migrated_healthcare_prescriptions (human)', COUNT(*)::INT
FROM healthcare.prescriptions WHERE source_prescription_id IS NOT NULL AND subject_type = 'human'

UNION ALL

SELECT 'TOTAL migrated_healthcare_prescriptions (pet)', COUNT(*)::INT
FROM healthcare.prescriptions WHERE source_prescription_id IS NOT NULL AND subject_type = 'pet'

UNION ALL

SELECT 'TOTAL migrated_healthcare_prescription_items', COUNT(*)::INT
FROM healthcare.prescription_items WHERE source_prescription_item_id IS NOT NULL

UNION ALL

SELECT 'TOTAL prescription_items with truncated text (metadata has original_*)', COUNT(*)::INT
FROM healthcare.prescription_items
WHERE source_prescription_item_id IS NOT NULL
  AND (metadata ? 'original_dose' OR metadata ? 'original_frequency'
       OR metadata ? 'original_duration' OR metadata ? 'original_route')

UNION ALL

SELECT 'TOTAL prescriptions with resolved encounter link', COUNT(*)::INT
FROM healthcare.prescriptions
WHERE source_prescription_id IS NOT NULL
  AND (clinical_encounter_id IS NOT NULL OR veterinary_encounter_id IS NOT NULL);

COMMIT;
