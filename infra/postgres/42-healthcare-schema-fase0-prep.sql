-- =============================================================================
-- Migration 42: Fase 0 prep — cierre de 3 gaps antes del corte public.* -> healthcare.*
-- =============================================================================
-- Contexto: fase de investigacion (Fase 1, sin escritura) encontro 3 gaps antes de
-- poder tocar endpoints en Fase 2 del corte del modulo clinico/veterinario. Ale y
-- Alejandro ya decidieron que hacer con cada uno; este script implementa 2 de los
-- 3 (el tercero se deja explicitamente sin cambios, ver seccion 0 abajo).
--
-- Decision 1 — Cascade de borrado: SIN CAMBIOS.
--   healthcare.preventive_events y healthcare.prescription_items se quedan en
--   NO ACTION tal como estan hoy (fk_healthcare_preventive_events_patient,
--   fk_healthcare_preventive_events_product, fk_healthcare_prescription_items_prescription).
--   No se agrega ON DELETE CASCADE/SET NULL en esta migracion. Documentado aqui
--   solo para dejar registro de que la decision se tomo, no fue un olvido.
--
-- Decision 2 — Responsable de pago del lado humano: columna a NIVEL VISITA.
--   La investigacion de Fase 1 encontro que no existe (ni existio nunca en la
--   practica) un vinculo fijo paciente-humano <-> responsable de pago: se elige
--   por visita. Se agrega owner_id a healthcare.clinical_encounters y a
--   healthcare.prescriptions (lado humano), espejando el patron que ya usan
--   healthcare.appointments.owner_id / healthcare.veterinary_encounters.owner_id
--   para mascotas. FK a healthcare.pet_owners — hay precedente directo de usar
--   pet_owners como tabla generica de "responsable" incluso para el lado humano:
--   healthcare.privacy_consents.owner_id (subject_type='owner') ya referencia
--   healthcare.pet_owners (id, business_id) sin ser especifico de mascotas.
--
--   NOTA para Ale/Alejandro (flag de nombre, no bloqueante): "pet_owners" es un
--   nombre que asume dueno-de-mascota. Estructuralmente la tabla no tiene ninguna
--   columna especifica de mascotas (eso vive en healthcare.pets) — es, de facto,
--   una tabla generica de "parte responsable/pagadora", y ya se usa asi en
--   privacy_consents. Sigue siendo un nombre confuso para el caso 100% humano.
--   No se renombra en esta migracion (fuera de alcance, requiere tocar todos los
--   FKs existentes); si se quiere corregir, es candidato a una migracion propia
--   de solo-renombrado antes de Fase 2.
--
--   Ambas columnas nuevas son NULLABLE — las visitas ya migradas (34-40) quedan
--   con owner_id NULL, es aceptable (dato historico, no se puede reconstruir con
--   certeza cual responsable especifico pago esa visita puntual).
--
--   healthcare.validate_appointment_resulting_encounter() — revisado: solo valida
--   que resulting_encounter_id exista en la tabla de encounter correcta segun
--   subject_type. No lee ni escribe owner_id en ningun punto. NO requiere cambios.
--
-- Decision 3 — credit_limit / credit_days: columnas reales en healthcare.pet_owners.
--   saleService.js y clientController.js leen estas columnas directo de
--   public.clients para CUALQUIER cliente en venta a credito, sin distinguir si
--   es un tutor clinico o un cliente retail. Dejarlas solo en metadata (como hizo
--   la migracion 34) rompe ese flujo en cuanto sales/clientes clinicos dejen de
--   apuntar 1:1 a public.clients. Se agregan columnas reales con el mismo tipo
--   que public.clients (NUMERIC(12,2) / INTEGER) y se hace backfill desde
--   metadata.credit_limit / metadata.credit_days, que la migracion 34 ya guardo
--   ahi. No se vuelve a consultar public.clients.
--
-- Safety properties (mismo patron que 34-41):
--   Idempotente    — todo ADD COLUMN/CREATE INDEX usa IF NOT EXISTS; el backfill
--                    de credit_limit/credit_days marca cada fila procesada en
--                    metadata.credit_backfilled_at para que un re-run no pise
--                    ediciones manuales posteriores.
--   Atomico        — BEGIN/COMMIT unico para la seccion de escritura.
--   No destructivo — cero escrituras a public.*; ninguna columna existente se
--                    modifica ni se elimina.
--
-- Depends on: migraciones 14, 33, 34 (pet_owners), 39 (clinical_encounters ya
--             existe desde 14, pero confirma que la migracion de datos corrio).
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/42-healthcare-schema-fase0-prep.sql
--
-- Produccion:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/42-healthcare-schema-fase0-prep.sql
--
-- IMPORTANTE: el bloque de volumetria (seccion 5, al final de este archivo) es de
-- SOLO LECTURA y no depende de nada de lo que este script escribe. Se puede
-- copiar y correr por separado, ANTES del resto del archivo, para decidir si hace
-- falta re-correr alguna de las migraciones 34-40 antes de aplicar esta.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: verifica que las tablas objetivo existan
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'pet_owners'
  ) THEN
    RAISE EXCEPTION 'healthcare.pet_owners does not exist. Run migrations 14 and 34 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'clinical_encounters'
  ) THEN
    RAISE EXCEPTION 'healthcare.clinical_encounters does not exist. Run migration 14 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'prescriptions'
  ) THEN
    RAISE EXCEPTION 'healthcare.prescriptions does not exist. Run migration 14 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Decision 3 — credit_limit / credit_days reales en healthcare.pet_owners
-- ---------------------------------------------------------------------------
ALTER TABLE healthcare.pet_owners
  ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2) DEFAULT NULL;

ALTER TABLE healthcare.pet_owners
  ADD COLUMN IF NOT EXISTS credit_days INTEGER DEFAULT 30;

-- Backfill desde metadata.credit_limit / metadata.credit_days (guardados ahi por
-- la migracion 34). Marca cada fila con metadata.credit_backfilled_at para que
-- un re-run no vuelva a pisar valores editados manualmente despues de este script.
UPDATE healthcare.pet_owners
SET
  credit_limit = NULLIF(metadata->>'credit_limit', '')::NUMERIC(12,2),
  credit_days  = COALESCE(NULLIF(metadata->>'credit_days', '')::INTEGER, 30),
  metadata     = metadata || jsonb_build_object('credit_backfilled_at', NOW()::text)
WHERE metadata ? 'credit_limit'
  AND NOT (metadata ? 'credit_backfilled_at');

-- ---------------------------------------------------------------------------
-- 2. Decision 2 — owner_id (responsable de pago por visita) en el lado humano
-- ---------------------------------------------------------------------------
ALTER TABLE healthcare.clinical_encounters
  ADD COLUMN IF NOT EXISTS owner_id BIGINT;

ALTER TABLE healthcare.prescriptions
  ADD COLUMN IF NOT EXISTS owner_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_clinical_encounters_owner'
      AND conrelid = 'healthcare.clinical_encounters'::regclass
  ) THEN
    ALTER TABLE healthcare.clinical_encounters
      ADD CONSTRAINT fk_healthcare_clinical_encounters_owner
      FOREIGN KEY (owner_id, business_id)
      REFERENCES healthcare.pet_owners (id, business_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_prescriptions_owner'
      AND conrelid = 'healthcare.prescriptions'::regclass
  ) THEN
    ALTER TABLE healthcare.prescriptions
      ADD CONSTRAINT fk_healthcare_prescriptions_owner
      FOREIGN KEY (owner_id, business_id)
      REFERENCES healthcare.pet_owners (id, business_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_healthcare_clinical_encounters_owner
  ON healthcare.clinical_encounters (business_id, owner_id);

CREATE INDEX IF NOT EXISTS idx_healthcare_prescriptions_owner
  ON healthcare.prescriptions (business_id, owner_id);

-- ---------------------------------------------------------------------------
-- 3. Decision 1 — cascade de borrado: SIN CAMBIOS (documentado, sin DDL)
-- ---------------------------------------------------------------------------
-- fk_healthcare_preventive_events_patient   -> se queda NO ACTION
-- fk_healthcare_preventive_events_product   -> se queda NO ACTION
-- fk_healthcare_prescription_items_prescription -> se queda NO ACTION
-- No hay ALTER TABLE en esta seccion a proposito.

-- ---------------------------------------------------------------------------
-- 4. Post-change verification — columnas nuevas
-- ---------------------------------------------------------------------------
SELECT
  'pet_owners total' AS description, COUNT(*)::INT AS rows
FROM healthcare.pet_owners

UNION ALL

SELECT
  'pet_owners with credit_limit backfilled from metadata', COUNT(*)::INT
FROM healthcare.pet_owners
WHERE metadata ? 'credit_backfilled_at'

UNION ALL

SELECT
  'pet_owners with credit_limit still NULL (no metadata.credit_limit source)', COUNT(*)::INT
FROM healthcare.pet_owners
WHERE credit_limit IS NULL

UNION ALL

SELECT
  'clinical_encounters total', COUNT(*)::INT
FROM healthcare.clinical_encounters

UNION ALL

SELECT
  'clinical_encounters with owner_id set (expected 0 right after this migration)', COUNT(*)::INT
FROM healthcare.clinical_encounters
WHERE owner_id IS NOT NULL

UNION ALL

SELECT
  'prescriptions (human) total', COUNT(*)::INT
FROM healthcare.prescriptions
WHERE subject_type = 'human'

UNION ALL

SELECT
  'prescriptions (human) with owner_id set (expected 0 right after this migration)', COUNT(*)::INT
FROM healthcare.prescriptions
WHERE subject_type = 'human' AND owner_id IS NOT NULL;

COMMIT;

-- =============================================================================
-- 5. VOLUMETRY CHECKS (READ-ONLY, standalone) — corre esto PRIMERO y por separado
-- =============================================================================
-- Cada bloque es exactamente la seccion de verificacion ya incluida al final de
-- las migraciones 34-41 (copiada tal cual, sin CTEs externos ni dependencias
-- entre bloques). No escribe nada. Correlo contra staging y produccion antes de
-- aplicar las secciones 1-4 de este archivo, para decidir si hace falta re-correr
-- alguna de 34-40 primero.
-- =============================================================================

-- --- Migracion 34: public.clients -> healthcare.pet_owners -------------------
SELECT source, business_id, SUM(total)::INT AS total
FROM (
  SELECT 'eligible_public_clients'::TEXT AS source, c.business_id, COUNT(*) AS total
  FROM public.clients c
  WHERE c.business_id IS NOT NULL
  GROUP BY c.business_id

  UNION ALL

  SELECT 'migrated_pet_owners'::TEXT, po.business_id, COUNT(*)
  FROM healthcare.pet_owners po
  WHERE po.client_id IS NOT NULL
  GROUP BY po.business_id
) counts
GROUP BY source, business_id
ORDER BY business_id, source;

SELECT 'TOTAL eligible_public_clients' AS description, COUNT(*)::INT AS rows
FROM public.clients WHERE business_id IS NOT NULL
UNION ALL
SELECT 'TOTAL migrated_pet_owners', COUNT(*)::INT
FROM healthcare.pet_owners WHERE client_id IS NOT NULL;

-- --- Migracion 35: public.patients (humanos) -> healthcare.patients ----------
SELECT source, business_id, SUM(total)::INT AS total
FROM (
  SELECT 'eligible_public_human_patients'::TEXT AS source, p.business_id, COUNT(*) AS total
  FROM public.patients p
  WHERE (p.species IS NULL OR TRIM(p.species) = '') AND p.business_id IS NOT NULL
  GROUP BY p.business_id

  UNION ALL

  SELECT 'migrated_healthcare_patients'::TEXT, hp.business_id, COUNT(*)
  FROM healthcare.patients hp
  WHERE hp.source_patient_id IS NOT NULL
  GROUP BY hp.business_id
) counts
GROUP BY source, business_id
ORDER BY business_id, source;

SELECT 'TOTAL eligible_public_human_patients' AS description, COUNT(*)::INT AS rows
FROM public.patients WHERE (species IS NULL OR TRIM(species) = '') AND business_id IS NOT NULL
UNION ALL
SELECT 'TOTAL migrated_healthcare_patients', COUNT(*)::INT
FROM healthcare.patients WHERE source_patient_id IS NOT NULL;

-- --- Migracion 36: public.patients (mascotas) -> healthcare.pets -------------
SELECT source, business_id, SUM(total)::INT AS total
FROM (
  SELECT 'eligible_public_pets'::TEXT AS source, p.business_id, COUNT(*) AS total
  FROM public.patients p
  WHERE p.species IS NOT NULL AND TRIM(p.species) != '' AND p.business_id IS NOT NULL
  GROUP BY p.business_id

  UNION ALL

  SELECT 'skipped_no_owner'::TEXT, p.business_id, COUNT(*)
  FROM public.patients p
  LEFT JOIN healthcare.pet_owners po
    ON po.client_id = p.client_id AND po.business_id = p.business_id
  WHERE p.species IS NOT NULL AND TRIM(p.species) != '' AND p.business_id IS NOT NULL
    AND po.id IS NULL
  GROUP BY p.business_id

  UNION ALL

  SELECT 'migrated_healthcare_pets'::TEXT, hp.business_id, COUNT(*)
  FROM healthcare.pets hp
  WHERE hp.source_patient_id IS NOT NULL
  GROUP BY hp.business_id
) counts
GROUP BY source, business_id
ORDER BY business_id, source;

SELECT 'TOTAL eligible_public_pets' AS description, COUNT(*)::INT AS rows
FROM public.patients
WHERE species IS NOT NULL AND TRIM(species) != '' AND business_id IS NOT NULL
UNION ALL
SELECT 'TOTAL skipped_no_owner', COUNT(*)::INT
FROM public.patients p
LEFT JOIN healthcare.pet_owners po ON po.client_id = p.client_id AND po.business_id = p.business_id
WHERE p.species IS NOT NULL AND TRIM(p.species) != '' AND p.business_id IS NOT NULL AND po.id IS NULL
UNION ALL
SELECT 'TOTAL migrated_healthcare_pets', COUNT(*)::INT
FROM healthcare.pets WHERE source_patient_id IS NOT NULL;

-- --- Migracion 37: public.appointments -> healthcare.appointments ------------
SELECT source, business_id, SUM(total)::INT AS total
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

-- --- Migracion 38: public.medical_preventive_events -> healthcare.preventive_events
SELECT source, business_id, SUM(total)::INT AS total
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

-- --- Migracion 39: public.consultations -> clinical_encounters / veterinary_encounters
SELECT source, business_id, SUM(total)::INT AS total
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

-- --- Migracion 40: public.medical_prescriptions/_items -> healthcare.prescriptions/_items
SELECT source, business_id, SUM(total)::INT AS total
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

-- --- Migracion 41: healthcare.dispensing_logs (placeholder, sin backfill) ----
SELECT
  'healthcare.dispensing_logs row count (expected: 0 until forward-write is implemented)' AS note,
  COUNT(*) AS current_rows
FROM healthcare.dispensing_logs;
