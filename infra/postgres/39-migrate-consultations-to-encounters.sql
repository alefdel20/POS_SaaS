-- =============================================================================
-- Migration 39: public.consultations → healthcare.clinical_encounters /
--                                       healthcare.veterinary_encounters
-- =============================================================================
-- Migrates every consultation (human + pet, discriminated by patients.species)
-- into the typed encounter tables, then reconciles appointment <-> encounter
-- links using a heuristic (same patient + same calendar date) because the
-- source schema has no real FK between public.appointments and
-- public.consultations, and public.consultations has no doctor/clinician column
-- at all.
--
-- Column decisions (both encounter tables):
--   encounter_type    — 'consultation' (schema default; source has no type field)
--   encounter_status  — 'completed' (schema default; source has no status field —
--                        a row existing in public.consultations always represents
--                        a completed visit)
--   clinician_user_id / veterinarian_user_id — NULL from the main INSERT (source
--                        has no doctor column on consultations); resolved in
--                        step 5 ONLY when the heuristic finds a unique matching
--                        appointment with a non-NULL doctor_user_id
--   started_at        — consultation_date (TIMESTAMP -> TIMESTAMPTZ implicit cast,
--                        same behavior already used in migrations 34-36)
--   ended_at           — NULL (no equivalent)
--   reason_for_visit / chief_complaint — motivo_consulta
--   assessment_summary / assessment    — diagnostico
--   plan_summary / plan                — tratamiento
--   notas              — no direct column in either destination table; stored in
--                        metadata.notes_snapshot (same conservative approach as
--                        migrations 35/36 for fields without a home)
--   triage_summary / subjective_summary / objective_summary / follow_up_instructions
--                      — '' (no equivalent)
--   anamnesis / physical_exam / weight_kg / temperature_c (vet only) — '' / NULL
--                        (no equivalent; vitals were not captured per-consultation
--                        in the legacy schema)
--
-- ---------------------------------------------------------------------------
-- Step 5 — heuristic appointment <-> encounter reconciliation
-- ---------------------------------------------------------------------------
-- Match key: same source patient_id (via public.patients.id, before translation)
--            + same calendar date (public.appointments.appointment_date =
--            public.consultations.consultation_date::date).
-- Ambiguity rule: if a patient has MORE THAN ONE appointment on that date, or
--            MORE THAN ONE consultation on that date, no match is written for
--            ANY of those candidates — we do not guess which pairs with which.
--            Ambiguous groups are reported by the diagnostic in step 5a and
--            simply left NULL (both resulting_encounter_id and
--            clinician_user_id/veterinarian_user_id stay NULL, matching the
--            existing default from steps 3/4).
-- Every row resolved by this heuristic is tagged
--            metadata.linked_via = 'heuristic_patient_date' on BOTH sides
--            (the appointment row and the encounter row) so it can be audited
--            or filtered out later. No new columns are introduced for this —
--            reusing the real, already-nullable columns as instructed.
--
-- ---------------------------------------------------------------------------
-- Schema gap fixed by this migration — resulting_encounter_id FK
-- ---------------------------------------------------------------------------
-- healthcare.appointments.resulting_encounter_id was given a single FK in
-- migration 33, pointing ONLY at healthcare.veterinary_encounters:
--   FOREIGN KEY (resulting_encounter_id, business_id)
--   REFERENCES healthcare.veterinary_encounters (id, business_id)
-- Postgres cannot express "FK to table A or table B depending on
-- subject_type" natively, and the human path was apparently never wired up
-- (healthcare.prescriptions got this right with two separate columns
-- clinical_encounter_id / veterinary_encounter_id, but appointments only has
-- one). Left as-is, step 5b below would raise a FK violation for the first
-- unique human heuristic match.
-- Fix (explicit sign-off obtained before writing this): drop the
-- single-table FK and replace it with a BEFORE INSERT OR UPDATE trigger that
-- validates resulting_encounter_id against clinical_encounters when
-- subject_type = 'human' and against veterinary_encounters when
-- subject_type = 'pet'. This also fixes forward-flow inserts from the
-- application, not just this backfill.
--
-- Safety properties:
--   Idempotent   — main INSERT keyed on source_consultation_id; step 5 UPDATEs
--                  are re-run-safe because they only touch rows where
--                  resulting_encounter_id / clinician_user_id / veterinarian_user_id
--                  IS NULL (already-linked rows are never overwritten)
--   Atomic       — single BEGIN/COMMIT
--   Multi-tenant — business_id preserved per row throughout
--   Non-destructive — zero writes to public.consultations or public.appointments
--
-- Depends on: migrations 14, 33 (healthcare schema), 34 (pet_owners), 35 (patients
--             human), 36 (pets), 37 (healthcare.appointments + source_appointment_id)
--
-- Backup before running (staging AND production, in that order):
--   docker exec -i [container] pg_dump -U admin -d ankode -n healthcare -n public \
--     -t healthcare.clinical_encounters -t healthcare.veterinary_encounters \
--     -t healthcare.appointments -t public.consultations -t public.appointments \
--     -F c -f /backups/pre-migration-39-$(date +%Y%m%d%H%M%S).dump
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/39-migrate-consultations-to-encounters.sql
--
-- Production:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/39-migrate-consultations-to-encounters.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: verify target tables exist
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'clinical_encounters'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'veterinary_encounters'
  ) THEN
    RAISE EXCEPTION 'healthcare encounter tables do not exist. Run migrations 14 and 33 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'healthcare' AND table_name = 'appointments' AND column_name = 'source_appointment_id'
  ) THEN
    RAISE EXCEPTION 'healthcare.appointments.source_appointment_id missing. Run migration 37 first.';
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
-- 1. Traceability columns + indexes on both encounter tables
-- ---------------------------------------------------------------------------
ALTER TABLE healthcare.clinical_encounters
  ADD COLUMN IF NOT EXISTS source_consultation_id INTEGER;
ALTER TABLE healthcare.veterinary_encounters
  ADD COLUMN IF NOT EXISTS source_consultation_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_hc_clinical_encounters_source_consultation_id
  ON healthcare.clinical_encounters (source_consultation_id, business_id);
CREATE INDEX IF NOT EXISTS idx_hc_veterinary_encounters_source_consultation_id
  ON healthcare.veterinary_encounters (source_consultation_id, business_id);

-- ---------------------------------------------------------------------------
-- 1b. Fix resulting_encounter_id validation (schema gap from migration 33 —
--     see header comment above). Drop the single-table FK, replace it with a
--     trigger that validates against clinical_encounters or
--     veterinary_encounters depending on subject_type.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_appointments_encounter'
      AND conrelid = 'healthcare.appointments'::regclass
  ) THEN
    ALTER TABLE healthcare.appointments
      DROP CONSTRAINT fk_healthcare_appointments_encounter;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION healthcare.validate_appointment_resulting_encounter()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.resulting_encounter_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.subject_type = 'human' THEN
    IF NOT EXISTS (
      SELECT 1 FROM healthcare.clinical_encounters
      WHERE id = NEW.resulting_encounter_id AND business_id = NEW.business_id
    ) THEN
      RAISE EXCEPTION
        'resulting_encounter_id % not found in healthcare.clinical_encounters for business_id % (appointment subject_type = human)',
        NEW.resulting_encounter_id, NEW.business_id;
    END IF;
  ELSIF NEW.subject_type = 'pet' THEN
    IF NOT EXISTS (
      SELECT 1 FROM healthcare.veterinary_encounters
      WHERE id = NEW.resulting_encounter_id AND business_id = NEW.business_id
    ) THEN
      RAISE EXCEPTION
        'resulting_encounter_id % not found in healthcare.veterinary_encounters for business_id % (appointment subject_type = pet)',
        NEW.resulting_encounter_id, NEW.business_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_appointments_validate_resulting_encounter'
  ) THEN
    CREATE TRIGGER trg_appointments_validate_resulting_encounter
      BEFORE INSERT OR UPDATE OF resulting_encounter_id, subject_type ON healthcare.appointments
      FOR EACH ROW
      EXECUTE FUNCTION healthcare.validate_appointment_resulting_encounter();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Diagnostics — run BEFORE the INSERT, review before proceeding
-- ---------------------------------------------------------------------------

-- 2a. Structural NULLs / orphan patient FK in source
SELECT
  'consultations: structural NULL/orphan check' AS diagnostic,
  COUNT(*) FILTER (WHERE c.patient_id IS NULL)   AS null_patient_id,
  COUNT(*) FILTER (WHERE c.client_id IS NULL)    AS null_client_id,
  COUNT(*) FILTER (WHERE c.business_id IS NULL)  AS null_business_id,
  COUNT(*) FILTER (WHERE p.id IS NULL)           AS orphan_patient_fk
FROM public.consultations c
LEFT JOIN public.patients p ON p.id = c.patient_id AND p.business_id = c.business_id;

-- 2b. Rows that WILL BE SKIPPED — patient/pet not yet migrated (35/36 gap)
SELECT
  'SKIPPED — patient/pet not migrated' AS migration_status,
  c.id AS public_consultation_id,
  c.business_id,
  c.patient_id,
  p.species,
  CASE
    WHEN p.id IS NULL THEN 'patient not found in public.patients (orphan FK)'
    WHEN (p.species IS NULL OR TRIM(p.species) = '') THEN 'human patient missing in healthcare.patients — run migration 35'
    ELSE 'pet missing in healthcare.pets — run migration 36'
  END AS reason
FROM public.consultations c
LEFT JOIN public.patients p ON p.id = c.patient_id AND p.business_id = c.business_id
LEFT JOIN healthcare.patients hp ON hp.source_patient_id = p.id AND hp.business_id = p.business_id
  AND (p.species IS NULL OR TRIM(p.species) = '')
LEFT JOIN healthcare.pets hpet ON hpet.source_patient_id = p.id AND hpet.business_id = p.business_id
  AND (p.species IS NOT NULL AND TRIM(p.species) != '')
WHERE c.business_id IS NOT NULL
  AND hp.id IS NULL AND hpet.id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM healthcare.clinical_encounters hce
    WHERE hce.source_consultation_id = c.id AND hce.business_id = c.business_id
    UNION ALL
    SELECT 1 FROM healthcare.veterinary_encounters hve
    WHERE hve.source_consultation_id = c.id AND hve.business_id = c.business_id
  )
ORDER BY c.business_id, c.id;

-- 2c. Pet-path rows that WILL BE SKIPPED — owner not migrated (34 gap)
SELECT
  'SKIPPED — pet owner not migrated' AS migration_status,
  c.id AS public_consultation_id,
  c.business_id,
  c.client_id AS public_client_id
FROM public.consultations c
INNER JOIN public.patients p ON p.id = c.patient_id AND p.business_id = c.business_id
  AND p.species IS NOT NULL AND TRIM(p.species) != ''
INNER JOIN healthcare.pets hpet ON hpet.source_patient_id = p.id AND hpet.business_id = p.business_id
LEFT JOIN healthcare.pet_owners po ON po.client_id = c.client_id AND po.business_id = c.business_id
WHERE c.business_id IS NOT NULL
  AND po.id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM healthcare.veterinary_encounters hve
    WHERE hve.source_consultation_id = c.id AND hve.business_id = c.business_id
  )
ORDER BY c.business_id, c.id;

-- 2d. Heuristic preview — unique vs ambiguous patient+date matches
--     (informational only; the actual UPDATE in step 5 applies the same rule)
WITH appt_candidates AS (
  SELECT a.business_id, a.patient_id AS public_patient_id, a.appointment_date AS match_date, a.id AS appointment_id
  FROM public.appointments a
  WHERE a.business_id IS NOT NULL
),
cons_candidates AS (
  SELECT c.business_id, c.patient_id AS public_patient_id, c.consultation_date::date AS match_date, c.id AS consultation_id
  FROM public.consultations c
  WHERE c.business_id IS NOT NULL
),
appt_counts AS (
  SELECT business_id, public_patient_id, match_date, COUNT(*) AS n
  FROM appt_candidates GROUP BY business_id, public_patient_id, match_date
),
cons_counts AS (
  SELECT business_id, public_patient_id, match_date, COUNT(*) AS n
  FROM cons_candidates GROUP BY business_id, public_patient_id, match_date
)
SELECT
  'heuristic patient+date match preview' AS diagnostic,
  COUNT(*) FILTER (WHERE ac.n = 1 AND cc.n = 1) AS unique_match_pairs,
  COUNT(*) FILTER (WHERE ac.n > 1 OR cc.n > 1)  AS ambiguous_groups
FROM appt_counts ac
INNER JOIN cons_counts cc
  ON cc.business_id = ac.business_id
 AND cc.public_patient_id = ac.public_patient_id
 AND cc.match_date = ac.match_date;

-- ---------------------------------------------------------------------------
-- 3. Main INSERT — human path → healthcare.clinical_encounters
-- ---------------------------------------------------------------------------
INSERT INTO healthcare.clinical_encounters (
  business_id, source_consultation_id, patient_id, clinician_user_id,
  encounter_type, encounter_status, started_at, ended_at,
  reason_for_visit, triage_summary, subjective_summary, objective_summary,
  assessment_summary, plan_summary, follow_up_instructions, metadata,
  status, is_active, created_by, updated_by, created_at, updated_at
)
SELECT
  c.business_id,
  c.id                                                              AS source_consultation_id,
  hp.id                                                             AS patient_id,
  NULL::INTEGER                                                     AS clinician_user_id,
  'consultation'                                                    AS encounter_type,
  'completed'                                                       AS encounter_status,
  c.consultation_date                                               AS started_at,
  NULL::TIMESTAMPTZ                                                 AS ended_at,
  COALESCE(c.motivo_consulta, '')                                   AS reason_for_visit,
  ''                                                                 AS triage_summary,
  ''                                                                 AS subjective_summary,
  ''                                                                 AS objective_summary,
  COALESCE(c.diagnostico, '')                                       AS assessment_summary,
  COALESCE(c.tratamiento, '')                                       AS plan_summary,
  ''                                                                 AS follow_up_instructions,
  (
    COALESCE(c.metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
         'migrated_from',     'public.consultations',
         'migrated_at',       NOW()::text,
         'notes_snapshot',    NULLIF(TRIM(COALESCE(c.notas, '')), ''),
         'source_client_id',  c.client_id
       ))
  )                                                                  AS metadata,
  'active'                                                          AS status,
  c.is_active,
  c.created_by,
  c.updated_by,
  c.created_at,
  c.updated_at
FROM public.consultations c
INNER JOIN public.patients p ON p.id = c.patient_id AND p.business_id = c.business_id
  AND (p.species IS NULL OR TRIM(p.species) = '')
INNER JOIN healthcare.patients hp ON hp.source_patient_id = p.id AND hp.business_id = p.business_id
WHERE c.business_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM healthcare.clinical_encounters hce
    WHERE hce.source_consultation_id = c.id AND hce.business_id = c.business_id
  );

-- ---------------------------------------------------------------------------
-- 4. Main INSERT — pet path → healthcare.veterinary_encounters
-- ---------------------------------------------------------------------------
INSERT INTO healthcare.veterinary_encounters (
  business_id, source_consultation_id, pet_id, owner_id, veterinarian_user_id,
  encounter_type, encounter_status, encounter_date,
  chief_complaint, anamnesis, physical_exam, assessment, plan,
  weight_kg, temperature_c, metadata,
  status, is_active, created_by, updated_by, created_at, updated_at
)
SELECT
  c.business_id,
  c.id                                                              AS source_consultation_id,
  hpet.id                                                           AS pet_id,
  po.id                                                             AS owner_id,
  NULL::INTEGER                                                     AS veterinarian_user_id,
  'consultation'                                                    AS encounter_type,
  'completed'                                                       AS encounter_status,
  c.consultation_date                                               AS encounter_date,
  COALESCE(c.motivo_consulta, '')                                   AS chief_complaint,
  ''                                                                 AS anamnesis,
  ''                                                                 AS physical_exam,
  COALESCE(c.diagnostico, '')                                       AS assessment,
  COALESCE(c.tratamiento, '')                                       AS plan,
  NULL::NUMERIC                                                     AS weight_kg,
  NULL::NUMERIC                                                     AS temperature_c,
  (
    COALESCE(c.metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
         'migrated_from',      'public.consultations',
         'migrated_at',        NOW()::text,
         'notes_snapshot',     NULLIF(TRIM(COALESCE(c.notas, '')), ''),
         'source_client_id',   c.client_id,
         'pet_owner_ref_id',   po.id
       ))
  )                                                                  AS metadata,
  'active'                                                          AS status,
  c.is_active,
  c.created_by,
  c.updated_by,
  c.created_at,
  c.updated_at
FROM public.consultations c
INNER JOIN public.patients p ON p.id = c.patient_id AND p.business_id = c.business_id
  AND p.species IS NOT NULL AND TRIM(p.species) != ''
INNER JOIN healthcare.pets hpet ON hpet.source_patient_id = p.id AND hpet.business_id = p.business_id
INNER JOIN healthcare.pet_owners po ON po.client_id = c.client_id AND po.business_id = c.business_id
WHERE c.business_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM healthcare.veterinary_encounters hve
    WHERE hve.source_consultation_id = c.id AND hve.business_id = c.business_id
  );

-- ---------------------------------------------------------------------------
-- 5. Heuristic reconciliation — appointment <-> encounter, unique matches only
-- ---------------------------------------------------------------------------
-- 5a. Materialize unique-only candidate pairs (business_id, public_patient_id,
--     match_date, appointment_id, consultation_id) in a temp table so steps
--     5b-5e all read the exact same resolved set.
CREATE TEMP TABLE tmp_heuristic_matches ON COMMIT DROP AS
WITH appt_candidates AS (
  SELECT a.id AS appointment_id, a.business_id, a.patient_id AS public_patient_id, a.appointment_date AS match_date
  FROM public.appointments a
  WHERE a.business_id IS NOT NULL
),
cons_candidates AS (
  SELECT c.id AS consultation_id, c.business_id, c.patient_id AS public_patient_id, c.consultation_date::date AS match_date
  FROM public.consultations c
  WHERE c.business_id IS NOT NULL
),
appt_counts AS (
  SELECT business_id, public_patient_id, match_date, COUNT(*) AS n
  FROM appt_candidates GROUP BY business_id, public_patient_id, match_date
),
cons_counts AS (
  SELECT business_id, public_patient_id, match_date, COUNT(*) AS n
  FROM cons_candidates GROUP BY business_id, public_patient_id, match_date
)
SELECT
  ac.appointment_id,
  cc.consultation_id,
  ac.business_id,
  ac.public_patient_id,
  ac.match_date
FROM appt_candidates ac
INNER JOIN cons_candidates cc
  ON cc.business_id = ac.business_id
 AND cc.public_patient_id = ac.public_patient_id
 AND cc.match_date = ac.match_date
INNER JOIN appt_counts acnt
  ON acnt.business_id = ac.business_id
 AND acnt.public_patient_id = ac.public_patient_id
 AND acnt.match_date = ac.match_date
 AND acnt.n = 1
INNER JOIN cons_counts ccnt
  ON ccnt.business_id = cc.business_id
 AND ccnt.public_patient_id = cc.public_patient_id
 AND ccnt.match_date = cc.match_date
 AND ccnt.n = 1;

-- 5b. appointments.resulting_encounter_id — human side
UPDATE healthcare.appointments ha
SET resulting_encounter_id = hce.id,
    metadata = ha.metadata || jsonb_build_object('linked_via', 'heuristic_patient_date'),
    updated_at = NOW()
FROM tmp_heuristic_matches m
INNER JOIN healthcare.clinical_encounters hce
  ON hce.source_consultation_id = m.consultation_id AND hce.business_id = m.business_id
WHERE ha.source_appointment_id = m.appointment_id
  AND ha.business_id = m.business_id
  AND ha.subject_type = 'human'
  AND ha.resulting_encounter_id IS NULL;

-- 5c. clinical_encounters.clinician_user_id — human side, only when the
--     matched appointment actually has a doctor assigned
UPDATE healthcare.clinical_encounters hce
SET clinician_user_id = ha.practitioner_user_id,
    metadata = hce.metadata || jsonb_build_object('linked_via', 'heuristic_patient_date'),
    updated_at = NOW()
FROM tmp_heuristic_matches m
INNER JOIN healthcare.appointments ha
  ON ha.source_appointment_id = m.appointment_id AND ha.business_id = m.business_id
WHERE hce.source_consultation_id = m.consultation_id
  AND hce.business_id = m.business_id
  AND hce.clinician_user_id IS NULL
  AND ha.practitioner_user_id IS NOT NULL;

-- 5d. appointments.resulting_encounter_id — pet side
--     healthcare.appointments.resulting_encounter_id FK points at
--     healthcare.veterinary_encounters (see migration 33), so this applies to
--     subject_type = 'pet' rows only.
UPDATE healthcare.appointments ha
SET resulting_encounter_id = hve.id,
    metadata = ha.metadata || jsonb_build_object('linked_via', 'heuristic_patient_date'),
    updated_at = NOW()
FROM tmp_heuristic_matches m
INNER JOIN healthcare.veterinary_encounters hve
  ON hve.source_consultation_id = m.consultation_id AND hve.business_id = m.business_id
WHERE ha.source_appointment_id = m.appointment_id
  AND ha.business_id = m.business_id
  AND ha.subject_type = 'pet'
  AND ha.resulting_encounter_id IS NULL;

-- 5e. veterinary_encounters.veterinarian_user_id — pet side
UPDATE healthcare.veterinary_encounters hve
SET veterinarian_user_id = ha.practitioner_user_id,
    metadata = hve.metadata || jsonb_build_object('linked_via', 'heuristic_patient_date'),
    updated_at = NOW()
FROM tmp_heuristic_matches m
INNER JOIN healthcare.appointments ha
  ON ha.source_appointment_id = m.appointment_id AND ha.business_id = m.business_id
WHERE hve.source_consultation_id = m.consultation_id
  AND hve.business_id = m.business_id
  AND hve.veterinarian_user_id IS NULL
  AND ha.practitioner_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Post-insert / post-reconciliation verification
-- ---------------------------------------------------------------------------
SELECT
  source,
  business_id,
  SUM(total)::INT AS total
FROM (
  SELECT 'eligible_public_consultations'::TEXT AS source, c.business_id, COUNT(*) AS total
  FROM public.consultations c
  WHERE c.business_id IS NOT NULL
  GROUP BY c.business_id

  UNION ALL

  SELECT 'migrated_clinical_encounters'::TEXT, hce.business_id, COUNT(*)
  FROM healthcare.clinical_encounters hce
  WHERE hce.source_consultation_id IS NOT NULL
  GROUP BY hce.business_id

  UNION ALL

  SELECT 'migrated_veterinary_encounters'::TEXT, hve.business_id, COUNT(*)
  FROM healthcare.veterinary_encounters hve
  WHERE hve.source_consultation_id IS NOT NULL
  GROUP BY hve.business_id
) counts
GROUP BY source, business_id
ORDER BY business_id, source;

SELECT 'TOTAL eligible_public_consultations' AS description, COUNT(*)::INT AS rows
FROM public.consultations WHERE business_id IS NOT NULL

UNION ALL

SELECT 'TOTAL migrated_clinical_encounters (human)', COUNT(*)::INT
FROM healthcare.clinical_encounters WHERE source_consultation_id IS NOT NULL

UNION ALL

SELECT 'TOTAL migrated_veterinary_encounters (pet)', COUNT(*)::INT
FROM healthcare.veterinary_encounters WHERE source_consultation_id IS NOT NULL

UNION ALL

SELECT 'TOTAL heuristic-linked appointments (either side)', COUNT(*)::INT
FROM healthcare.appointments
WHERE source_appointment_id IS NOT NULL AND metadata->>'linked_via' = 'heuristic_patient_date'

UNION ALL

SELECT 'TOTAL heuristic-linked clinical_encounters', COUNT(*)::INT
FROM healthcare.clinical_encounters
WHERE source_consultation_id IS NOT NULL AND metadata->>'linked_via' = 'heuristic_patient_date'

UNION ALL

SELECT 'TOTAL heuristic-linked veterinary_encounters', COUNT(*)::INT
FROM healthcare.veterinary_encounters
WHERE source_consultation_id IS NOT NULL AND metadata->>'linked_via' = 'heuristic_patient_date'

UNION ALL

SELECT 'TOTAL appointments still unlinked (resulting_encounter_id IS NULL)', COUNT(*)::INT
FROM healthcare.appointments
WHERE source_appointment_id IS NOT NULL AND resulting_encounter_id IS NULL;

COMMIT;
