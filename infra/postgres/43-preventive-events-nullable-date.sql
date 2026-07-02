-- =============================================================================
-- Migration 43: healthcare.preventive_events.date_administered -> NULLABLE
-- =============================================================================
-- Contexto: Fase 2 del corte de medical_preventive_events (piloto). Migracion 33
-- declaro date_administered NOT NULL asumiendo que todo evento preventivo ya
-- tiene fecha de aplicacion. Eso es cierto para backfill (migracion 38 excluye
-- explicitamente filas con date_administered NULL), pero NO para eventos nuevos
-- creados por la app: un evento status='scheduled' (ej. "vacuna programada para
-- el 15 de agosto") solo tiene next_due_date — date_administered se llena hasta
-- que el evento se aplique de verdad. La constraint NOT NULL bloqueaba ese caso.
--
-- Cambio: DROP NOT NULL. No se toca next_due_date (ya era nullable). No se toca
-- ninguna otra columna ni constraint.
--
-- Safety properties (mismo patron que 34-42):
--   Idempotente    — DROP NOT NULL sobre una columna ya nullable es un no-op,
--                    no lanza error en un re-run.
--   Atomico        — BEGIN/COMMIT unico.
--   No destructivo — no borra datos, no afecta filas existentes (todas las filas
--                    migradas por 38 ya tienen date_administered NOT NULL de
--                    todas formas, por construccion del propio script 38).
--
-- Depends on: migraciones 14, 33 (healthcare.preventive_events debe existir).
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/43-preventive-events-nullable-date.sql
--
-- Produccion:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/43-preventive-events-nullable-date.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: verifica que la tabla objetivo exista
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'preventive_events'
  ) THEN
    RAISE EXCEPTION 'healthcare.preventive_events does not exist. Run migrations 14 and 33 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. DROP NOT NULL
-- ---------------------------------------------------------------------------
ALTER TABLE healthcare.preventive_events
  ALTER COLUMN date_administered DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Verificacion — confirma que la columna quedo nullable
-- ---------------------------------------------------------------------------
SELECT
  table_schema,
  table_name,
  column_name,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'healthcare'
  AND table_name = 'preventive_events'
  AND column_name = 'date_administered';

COMMIT;
