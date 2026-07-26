-- =============================================================================
-- Migration 61: medical_prescriptions.historia_clinica / healthcare.prescriptions.historia_clinica
-- =============================================================================
-- Contexto: sprint 2.7 agrego el formato de nota clinica estructurada
-- Dx./Tx./Rp. a la receta (migracion 15). Un veterinario solicito un campo
-- "Hx." (historia clinica / anamnesis) adicional, impreso antes de Dx. en el
-- orden clinico Hx -> Dx -> Tx -> Rp.
--
-- Vive en medical_prescriptions (no en consultations): es un dato propio de
-- CADA receta, mismo criterio ya usado para diagnosis/indications en esa
-- misma tabla, no un dato reusado desde motivo_consulta.
--
-- Opcional: NUNCA se exige. TEXT NOT NULL DEFAULT '' (no NULL) para no romper
-- renders que concatenan texto (mismo patron que diagnosis/indications en
-- medical_prescriptions y diagnosis_summary/indications_general en
-- healthcare.prescriptions).
--
-- Safety properties (mismo patron que 52/54 y demas migraciones aditivas):
--   Idempotente    — ADD COLUMN IF NOT EXISTS es un no-op en una segunda corrida.
--   Atomico        — BEGIN/COMMIT unico.
--   No destructivo — no borra datos, toda fila existente queda con '' (nunca NULL).
--
-- Depends on: medical_prescriptions siempre existio (01-schema.sql);
--             healthcare.prescriptions depende de migracion 14/15 (Fase 5).
--             Si el schema healthcare no existe en esta base (negocio sin el
--             modulo Fase 5 activado), el segundo ALTER se omite via guard.
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/61-prescriptions-historia-clinica.sql
--
-- Produccion:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/61-prescriptions-historia-clinica.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: verifica que la tabla objetivo principal exista
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'medical_prescriptions'
  ) THEN
    RAISE EXCEPTION 'public.medical_prescriptions does not exist.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. public.medical_prescriptions.historia_clinica
-- ---------------------------------------------------------------------------
ALTER TABLE medical_prescriptions
  ADD COLUMN IF NOT EXISTS historia_clinica TEXT NOT NULL DEFAULT '';

-- ---------------------------------------------------------------------------
-- 2. healthcare.prescriptions.historia_clinica (espejo Fase 5) — solo si el
--    schema healthcare ya existe en esta base (negocios sin el modulo
--    healthcare activado no lo tienen, mismo guard usado en
--    ensureHealthcareStructuralSync/init.js para el resto de migraciones
--    37-56 que tocan healthcare.*).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.schemata WHERE schema_name = 'healthcare'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'prescriptions'
  ) THEN
    ALTER TABLE healthcare.prescriptions
      ADD COLUMN IF NOT EXISTS historia_clinica TEXT NOT NULL DEFAULT '';
  ELSE
    RAISE NOTICE 'healthcare.prescriptions does not exist — skipping mirror column (module not active on this business/database).';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Verification — confirma que ambas columnas quedaron creadas donde aplica
-- ---------------------------------------------------------------------------
SELECT
  table_schema, table_name, column_name, is_nullable, column_default
FROM information_schema.columns
WHERE (table_schema = 'public' AND table_name = 'medical_prescriptions' AND column_name = 'historia_clinica')
   OR (table_schema = 'healthcare' AND table_name = 'prescriptions' AND column_name = 'historia_clinica');

COMMIT;
