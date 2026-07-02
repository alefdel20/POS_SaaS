-- =============================================================================
-- Migration 36: public.patients (pets) → healthcare.pets
-- =============================================================================
-- Migrates only animal patients (species IS NOT NULL) from the shared
-- public.patients table into the typed healthcare.pets table.
--
-- Pet vs. human discrimination:
--   clinicalService.js uses normalizeNullableText(payload.species) which
--   converts any blank to NULL. Therefore, pets always have species IS NOT NULL
--   in the database. This script uses the exact same criterion.
--
-- Critical constraint — owner_id NOT NULL:
--   healthcare.pets.owner_id has a NOT NULL + composite FK:
--     FOREIGN KEY (owner_id, business_id) REFERENCES healthcare.pet_owners (id, business_id)
--   Pets whose client was not migrated in step 34 CANNOT be inserted.
--   Strategy: INNER JOIN healthcare.pet_owners so only pets with a valid owner
--   are inserted. Orphaned pets (no migrated owner) are reported in a
--   diagnostic SELECT at the end of the transaction — no placeholder is used.
--
-- Safety properties:
--   Idempotent   — re-running never creates duplicates (keyed on source_patient_id)
--   Atomic       — single BEGIN/COMMIT
--   Multi-tenant — business_id preserved per row
--   Non-destructive — zero writes to public.patients or public.clients
--
-- Depends on: migrations 14, 33, 34 (pet_owners migration), 35 (patients migration)
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/36-migrate-patients-pets.sql
--
-- Production:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/36-migrate-patients-pets.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guards: verify dependencies exist
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'pets'
  ) THEN
    RAISE EXCEPTION 'healthcare.pets does not exist. Run migrations 14 and 33 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'pet_owners'
  ) THEN
    RAISE EXCEPTION
      'healthcare.pet_owners does not exist. Run migration 34 (clients migration) first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Add traceability column if it does not exist
--    source_patient_id links the healthcare row back to public.patients.id.
--    This is the idempotency key for re-runs.
-- ---------------------------------------------------------------------------
ALTER TABLE healthcare.pets
  ADD COLUMN IF NOT EXISTS source_patient_id INTEGER;

-- ---------------------------------------------------------------------------
-- 2. Index for fast idempotency checks and dual-write lookups
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_hc_pets_source_patient_id
  ON healthcare.pets (source_patient_id, business_id);

-- ---------------------------------------------------------------------------
-- 3. Diagnostic: report pets that WILL BE SKIPPED due to missing owner
--    Run before the INSERT so you can see what will be excluded.
--    If this SELECT returns rows, check whether migration 34 ran cleanly
--    or whether those patients genuinely have no client_id in public.
-- ---------------------------------------------------------------------------
SELECT
  'SKIPPED — no migrated owner'  AS migration_status,
  p.id                           AS public_patient_id,
  p.business_id,
  p.name,
  p.species,
  p.client_id                    AS public_client_id,
  CASE
    WHEN p.client_id IS NULL THEN 'client_id IS NULL in public.patients'
    ELSE 'client not found in healthcare.pet_owners (may not have been migrated)'
  END                            AS reason
FROM public.patients p
LEFT JOIN healthcare.pet_owners po
  ON  po.client_id   = p.client_id
  AND po.business_id = p.business_id
WHERE
  (p.species IS NOT NULL AND TRIM(p.species) != '')
  AND p.business_id IS NOT NULL
  AND po.id IS NULL   -- no matching owner in healthcare
  AND NOT EXISTS (
    SELECT 1 FROM healthcare.pets hp
    WHERE hp.source_patient_id = p.id AND hp.business_id = p.business_id
  )
ORDER BY p.business_id, p.id;

-- ---------------------------------------------------------------------------
-- 4. Main INSERT — animal patients only, idempotent
--    INNER JOIN ensures owner_id is always non-NULL (FK constraint satisfied).
--    Pets without a migrated owner are excluded (reported above in step 3).
--
-- Column decisions:
--   name            — direct (VARCHAR in both schemas)
--   species         — direct (no CHECK in healthcare.pets; NOT NULL guaranteed
--                     by WHERE filter)
--   breed           — direct
--   sex             — normalized from free-text to the CHECK-constrained enum;
--                     unrecognized values → NULL (conservative, avoids errors)
--   weight_kg       — mapped from public.patients.weight NUMERIC(10,3);
--                     NUMERIC(8,3) in healthcare covers all practical pet weights
--   allergies_summary — mapped from public.patients.allergies
--   notes           — direct
--   sterilized      — FALSE (no equivalent in public.patients; schema default)
--   microchip_number— NULL (no equivalent in public.patients)
--   color_markings  — NULL (no equivalent in public.patients)
--   pet_code        — NULL (no equivalent; application assigns codes later;
--                     UNIQUE constraint on (business_id, pet_code) only fires
--                     when pet_code IS NOT NULL)
--   phone           — no column in healthcare.pets (belongs to the owner);
--                     preserved in metadata.owner_phone_snapshot for reference
--   metadata.source_client_id  — original public.patients.client_id
--   metadata.pet_owner_ref_id  — healthcare.pet_owners.id (the resolved owner)
-- ---------------------------------------------------------------------------
INSERT INTO healthcare.pets (
  business_id,
  owner_id,
  source_patient_id,
  pet_code,
  name,
  species,
  breed,
  sex,
  color_markings,
  birth_date,
  weight_kg,
  sterilized,
  microchip_number,
  allergies_summary,
  notes,
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

  -- owner_id: resolved via migration-34 traceability link (INNER JOIN guarantees non-NULL)
  po.id                                                            AS owner_id,

  -- traceability
  p.id                                                             AS source_patient_id,

  -- no pet_code equivalent in public schema; assigned later by application
  NULL::VARCHAR(60)                                                AS pet_code,

  TRIM(p.name)                                                     AS name,

  -- species: direct (no CHECK constraint in healthcare.pets; NOT NULL
  -- guaranteed by the WHERE filter: species IS NOT NULL AND TRIM != '')
  TRIM(p.species)                                                  AS species,

  NULLIF(TRIM(COALESCE(p.breed, '')), '')                          AS breed,

  -- sex: normalize free-text to the CHECK-constrained enum
  -- CHECK (sex IS NULL OR sex IN ('female', 'male', 'intersex', 'unspecified'))
  CASE
    WHEN LOWER(TRIM(p.sex)) IN ('female', 'femenino', 'f', 'hembra', 'mujer') THEN 'female'
    WHEN LOWER(TRIM(p.sex)) IN ('male', 'masculino', 'm', 'macho', 'hombre')  THEN 'male'
    WHEN LOWER(TRIM(p.sex)) IN ('intersex', 'intersexual')                    THEN 'intersex'
    WHEN p.sex IS NULL OR TRIM(p.sex) = ''                                    THEN NULL
    ELSE NULL  -- unrecognized value → NULL (conservative; no constraint errors)
  END                                                              AS sex,

  -- no color_markings in public.patients
  NULL::VARCHAR(120)                                               AS color_markings,

  p.birth_date,

  -- weight: NUMERIC(10,3) → NUMERIC(8,3); practical pet weights fit within range
  p.weight                                                         AS weight_kg,

  -- no sterilization data in public.patients; schema default FALSE
  FALSE                                                            AS sterilized,

  -- no microchip in public.patients
  NULL::VARCHAR(80)                                                AS microchip_number,

  -- allergies maps directly
  COALESCE(TRIM(p.allergies), '')                                  AS allergies_summary,

  COALESCE(p.notes, '')                                            AS notes,

  -- metadata: merge original + fields without a direct healthcare column
  (
    COALESCE(p.metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
         'migrated_from',      'public.patients',
         'migrated_at',        NOW()::text,
         'owner_phone_snapshot', NULLIF(TRIM(COALESCE(p.phone, '')), ''),
         'source_client_id',   p.client_id,
         'pet_owner_ref_id',   po.id
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

-- INNER JOIN: only pets with a valid migrated owner get inserted.
-- Pets without a match are excluded and were reported in step 3.
-- po.client_id = p.client_id is the traceability link added in migration 34.
INNER JOIN healthcare.pet_owners po
  ON  po.client_id   = p.client_id
  AND po.business_id = p.business_id

WHERE
  -- Animal patients only — same criterion as clinicalService.js normalizeNullableText
  p.species IS NOT NULL
  AND TRIM(p.species) != ''

  -- skip orphaned rows that predate the multi-tenant migration
  AND p.business_id IS NOT NULL

  -- idempotency: skip any pet already present in healthcare.pets
  AND NOT EXISTS (
    SELECT 1
    FROM healthcare.pets hp
    WHERE hp.source_patient_id = p.id
      AND hp.business_id       = p.business_id
  );

-- ---------------------------------------------------------------------------
-- 5. Post-insert verification — per-business breakdown + global totals
-- ---------------------------------------------------------------------------
SELECT
  source,
  business_id,
  SUM(total)::INT AS total
FROM (
  -- all eligible pets in public schema (regardless of owner status)
  SELECT
    'eligible_public_pets'::TEXT AS source,
    p.business_id,
    COUNT(*)                     AS total
  FROM public.patients p
  WHERE p.species IS NOT NULL
    AND TRIM(p.species) != ''
    AND p.business_id IS NOT NULL
  GROUP BY p.business_id

  UNION ALL

  -- pets with no migrated owner (excluded from INSERT)
  SELECT
    'skipped_no_owner'::TEXT,
    p.business_id,
    COUNT(*)
  FROM public.patients p
  LEFT JOIN healthcare.pet_owners po
    ON  po.client_id   = p.client_id
    AND po.business_id = p.business_id
  WHERE p.species IS NOT NULL
    AND TRIM(p.species) != ''
    AND p.business_id IS NOT NULL
    AND po.id IS NULL
  GROUP BY p.business_id

  UNION ALL

  -- rows actually present in healthcare.pets with a source link
  SELECT
    'migrated_healthcare_pets'::TEXT,
    hp.business_id,
    COUNT(*)
  FROM healthcare.pets hp
  WHERE hp.source_patient_id IS NOT NULL
  GROUP BY hp.business_id
) counts
GROUP BY source, business_id
ORDER BY business_id, source;

-- Global summary
SELECT
  'TOTAL eligible_public_pets'        AS description,
  COUNT(*)::INT                        AS rows
FROM public.patients
WHERE species IS NOT NULL AND TRIM(species) != '' AND business_id IS NOT NULL

UNION ALL

SELECT
  'TOTAL skipped_no_owner',
  COUNT(*)::INT
FROM public.patients p
LEFT JOIN healthcare.pet_owners po
  ON po.client_id = p.client_id AND po.business_id = p.business_id
WHERE p.species IS NOT NULL AND TRIM(p.species) != ''
  AND p.business_id IS NOT NULL AND po.id IS NULL

UNION ALL

SELECT
  'TOTAL migrated_healthcare_pets',
  COUNT(*)::INT
FROM healthcare.pets
WHERE source_patient_id IS NOT NULL;

COMMIT;
