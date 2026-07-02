-- =============================================================================
-- Migration 35: public.patients (humans) → healthcare.patients
-- =============================================================================
-- Migrates only human patients (species IS NULL) from the shared public.patients
-- table into the typed healthcare.patients table.
--
-- Human vs. pet discrimination:
--   clinicalService.js uses normalizeNullableText(payload.species), which
--   converts any blank/empty value to NULL. Therefore, human patients always
--   have species IS NULL in the database. This script uses the same criterion.
--
-- Safety properties:
--   Idempotent   — re-running never creates duplicates (keyed on source_patient_id)
--   Atomic       — single BEGIN/COMMIT
--   Multi-tenant — business_id preserved per row
--   Non-destructive — zero writes to public.patients
--
-- Depends on: migrations 14, 33, 34 (healthcare schema + pet_owners migration)
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/35-migrate-patients-human.sql
--
-- Production:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/35-migrate-patients-human.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: verify target table exists
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare'
      AND table_name   = 'patients'
  ) THEN
    RAISE EXCEPTION
      'healthcare.patients does not exist. Run migrations 14 and 33 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare'
      AND table_name   = 'pet_owners'
  ) THEN
    RAISE EXCEPTION
      'healthcare.pet_owners does not exist. Run migration 34 (clients migration) first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Add traceability column if it does not exist
--    source_patient_id: links the healthcare row back to public.patients.id
--    This is the idempotency key for re-runs.
-- ---------------------------------------------------------------------------
ALTER TABLE healthcare.patients
  ADD COLUMN IF NOT EXISTS source_patient_id INTEGER;

-- ---------------------------------------------------------------------------
-- 2. Index for fast idempotency checks and dual-write lookups
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_hc_patients_source_patient_id
  ON healthcare.patients (source_patient_id, business_id);

-- ---------------------------------------------------------------------------
-- 3. Main INSERT — human patients only, idempotent
--
-- Discrimination criterion (exact same logic as clinicalService.js):
--   public.patients.species IS NULL  →  human patient
--
-- Column decisions:
--   first_name      — text before first space in public.patients.name
--   last_name       — text from first space onward ('' when single-word name)
--   second_last_name— '' (no equivalent in public schema)
--   sex             — normalized from free-text to the CHECK-constrained enum;
--                     unrecognized values → NULL (safer than 'unspecified')
--   allergies_summary — mapped directly from public.patients.allergies
--   chronic_conditions_summary — '' (no equivalent; no data to migrate)
--   address, email  — '' / NULL (no equivalent in public.patients)
--   blood_type, occupation, emergency_contact_* — NULL (no equivalent)
--   patient_code    — NULL (no equivalent; application assigns codes later)
--   privacy_level   — 'standard' (schema default; no equivalent in public)
--   notes           — no direct column; stored in metadata.notes_snapshot
--   weight          — no direct column; stored in metadata.weight_kg
--   breed           — no direct column; stored in metadata.breed_snapshot
--                     (human patients should not have breed, but we preserve
--                      any accidental data rather than silently discard it)
--   metadata.source_client_id  — original public.patients.client_id
--   metadata.pet_owner_ref_id  — healthcare.pet_owners.id for that client,
--                                 obtained via JOIN on migration-34 link.
--                                 NULL if the client was not migrated.
--                                 healthcare.patients has no owner_id column
--                                 (humans are not pets); this ref is stored in
--                                 metadata to support the dual-write phase.
-- ---------------------------------------------------------------------------
INSERT INTO healthcare.patients (
  business_id,
  source_patient_id,
  patient_code,
  first_name,
  last_name,
  second_last_name,
  sex,
  birth_date,
  blood_type,
  phone,
  email,
  address,
  occupation,
  emergency_contact_name,
  emergency_contact_phone,
  allergies_summary,
  chronic_conditions_summary,
  privacy_level,
  metadata,
  status,
  is_active,
  created_by,
  updated_by,
  created_at,
  updated_at
)
SELECT
  p.business_id,

  -- traceability
  p.id                                                             AS source_patient_id,

  -- no patient_code equivalent in public schema; assigned later by application
  NULL::VARCHAR(60)                                                AS patient_code,

  -- name split: everything before the first space
  TRIM(SPLIT_PART(TRIM(p.name), ' ', 1))                          AS first_name,

  -- name split: everything after the first space ('' when single-word)
  CASE
    WHEN TRIM(p.name) LIKE '% %'
      THEN TRIM(SUBSTRING(TRIM(p.name) FROM POSITION(' ' IN TRIM(p.name)) + 1))
    ELSE ''
  END                                                              AS last_name,

  ''                                                               AS second_last_name,

  -- sex: normalize free-text to the CHECK-constrained enum values
  CASE
    WHEN LOWER(TRIM(p.sex)) IN ('female', 'femenino', 'f', 'mujer')   THEN 'female'
    WHEN LOWER(TRIM(p.sex)) IN ('male', 'masculino', 'm', 'hombre')   THEN 'male'
    WHEN LOWER(TRIM(p.sex)) IN ('intersex', 'intersexual')            THEN 'intersex'
    WHEN p.sex IS NULL OR TRIM(p.sex) = ''                            THEN NULL
    ELSE NULL  -- unrecognized values → NULL (conservative; avoids constraint errors)
  END                                                              AS sex,

  p.birth_date,

  -- no blood_type in public.patients
  NULL::VARCHAR(5)                                                 AS blood_type,

  p.phone,

  -- no email in public.patients
  NULL::VARCHAR(120)                                               AS email,

  -- no address in public.patients
  ''                                                               AS address,

  -- no occupation in public.patients
  NULL::VARCHAR(120)                                               AS occupation,

  -- no emergency contact in public.patients
  NULL::VARCHAR(180)                                               AS emergency_contact_name,
  NULL::VARCHAR(40)                                                AS emergency_contact_phone,

  -- allergies maps directly
  COALESCE(TRIM(p.allergies), '')                                  AS allergies_summary,

  -- no chronic conditions in public.patients
  ''                                                               AS chronic_conditions_summary,

  'standard'                                                       AS privacy_level,

  -- metadata: merge original + fields that have no direct healthcare column
  (
    COALESCE(p.metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
         'migrated_from',     'public.patients',
         'migrated_at',       NOW()::text,
         'notes_snapshot',    NULLIF(TRIM(COALESCE(p.notes, '')), ''),
         'weight_kg',         p.weight,
         'breed_snapshot',    NULLIF(TRIM(COALESCE(p.breed, '')), ''),
         'source_client_id',  p.client_id,
         'pet_owner_ref_id',  po.id
       ))
  )                                                                AS metadata,

  -- status
  CASE WHEN p.is_active = FALSE THEN 'inactive' ELSE 'active' END AS status,

  p.is_active,
  p.created_by,
  p.updated_by,
  p.created_at,
  p.updated_at

FROM public.patients p

-- Join to get the healthcare.pet_owners.id for this patient's responsible client.
-- po.client_id = p.client_id links via the traceability column added in migration 34.
-- LEFT JOIN: if the client was not migrated (or client_id IS NULL), po.id = NULL.
LEFT JOIN healthcare.pet_owners po
  ON  po.client_id   = p.client_id
  AND po.business_id = p.business_id

WHERE
  -- Human patients only — same criterion as clinicalService.js normalizeNullableText
  (p.species IS NULL OR TRIM(p.species) = '')

  -- skip orphaned rows that predate the multi-tenant migration
  AND p.business_id IS NOT NULL

  -- idempotency: skip any patient already present in healthcare.patients
  AND NOT EXISTS (
    SELECT 1
    FROM healthcare.patients hp
    WHERE hp.source_patient_id = p.id
      AND hp.business_id       = p.business_id
  );

-- ---------------------------------------------------------------------------
-- 4. Post-insert verification — per-business breakdown + global totals
-- ---------------------------------------------------------------------------
SELECT
  source,
  business_id,
  SUM(total)::INT AS total
FROM (
  -- eligible human patients in public schema
  SELECT
    'eligible_public_human_patients'::TEXT AS source,
    p.business_id,
    COUNT(*)                               AS total
  FROM public.patients p
  WHERE (p.species IS NULL OR TRIM(p.species) = '')
    AND p.business_id IS NOT NULL
  GROUP BY p.business_id

  UNION ALL

  -- rows actually present in healthcare.patients with a source link
  SELECT
    'migrated_healthcare_patients'::TEXT,
    hp.business_id,
    COUNT(*)
  FROM healthcare.patients hp
  WHERE hp.source_patient_id IS NOT NULL
  GROUP BY hp.business_id
) counts
GROUP BY source, business_id
ORDER BY business_id, source;

-- Global summary
SELECT
  'TOTAL eligible_public_human_patients' AS description,
  COUNT(*)::INT                          AS rows
FROM public.patients
WHERE (species IS NULL OR TRIM(species) = '')
  AND business_id IS NOT NULL

UNION ALL

SELECT
  'TOTAL migrated_healthcare_patients',
  COUNT(*)::INT
FROM healthcare.patients
WHERE source_patient_id IS NOT NULL;

COMMIT;
