-- =============================================================================
-- Migration 50: healthcare.dispensing_logs.batch_id becomes nullable
-- =============================================================================
-- Contexto: Fase 5 Parte B empieza a escribir en healthcare.dispensing_logs
-- desde saleService.js (ver recordPrescriptionItemDispensing) cada vez que una
-- linea de venta declara prescription_item_id. batch_id NOT NULL con FK a
-- healthcare.inventory_batches bloquearia todo ese INSERT porque no existe
-- ningun ledger de lotes hoy — migracion 41 ya documento esto: el unico dato
-- historico de lote es products.lot_number, un campo de texto libre sin
-- cantidad/fecha/expiracion por lote, imposible de convertir en
-- inventory_batches sin fabricar datos.
--
-- Mismo patron ya usado tres veces (migraciones 44/46/48): un dato que no se
-- puede resolver todavia se deja NULL en vez de bloquear el registro completo
-- — batch_id se resuelve mas adelante, cuando exista un ledger de lotes real,
-- no es un error hoy.
--
-- Investigacion realizada antes de escribir esta migracion (mismo patron que
-- 33/44/48): revisadas todas las CONSTRAINT sobre healthcare.dispensing_logs
-- (infra/postgres/14-healthcare-modular-expansion.sql, CREATE TABLE + el
-- bloque DO $$ de FKs mas adelante en el mismo archivo). Resultado — ningun
-- CHECK referencia batch_id (los cuatro CHECKs de esta tabla son
-- dispensing_logs_subject_check, _qty_check (sobre dispensed_quantity, no
-- batch_id), _status_check, _subject_fk_check; ninguno menciona batch_id). El
-- unico objeto que referencia batch_id es el FK plano
-- fk_healthcare_dispensing_logs_batch (FOREIGN KEY (batch_id, business_id)
-- REFERENCES healthcare.inventory_batches (id, business_id)) — Postgres nunca
-- evalua un FK cuando la columna referenciante es NULL. healthcare.
-- view_libro_antibioticos (migracion 14) ya hace LEFT JOIN (no INNER) sobre
-- healthcare.inventory_batches via dl.batch_id, asi que ya tolera batch_id
-- NULL sin cambios: la fila del libro simplemente sale con lote_numero/
-- fecha_caducidad en blanco, nunca con un dato inventado. No se necesita
-- tocar la vista.
--
-- Safety properties (mismo patron que 33/44/46/48):
--   Idempotente     — DROP NOT NULL en una columna ya nullable es un no-op.
--   Atomico         — single BEGIN/COMMIT.
--   No destructivo  — ninguna fila existente se borra ni reescribe (la tabla
--                     esta vacia por diseno desde migracion 41, pero esta
--                     migracion es segura de correr con o sin filas).
--
-- Depends on: migration 14 (healthcare.dispensing_logs).
--
-- Backup before running (staging AND production, in that order):
--   docker exec -i [container] pg_dump -U admin -d ankode -n healthcare \
--     -t healthcare.dispensing_logs \
--     -F c -f /backups/pre-migration-50-$(date +%Y%m%d%H%M%S).dump
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/50-dispensing-logs-batch-nullable.sql
--
-- Production:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/50-dispensing-logs-batch-nullable.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: verify target table exists
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'dispensing_logs'
  ) THEN
    RAISE EXCEPTION 'healthcare.dispensing_logs does not exist. Run migration 14 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. DROP NOT NULL
-- ---------------------------------------------------------------------------
ALTER TABLE healthcare.dispensing_logs
  ALTER COLUMN batch_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Verification — confirms the column is nullable, no CHECK references
--    batch_id, and the FK is still alive
-- ---------------------------------------------------------------------------
SELECT
  table_schema, table_name, column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'healthcare'
  AND table_name = 'dispensing_logs'
  AND column_name = 'batch_id';

SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'healthcare.dispensing_logs'::regclass
  AND (pg_get_constraintdef(oid) ILIKE '%batch_id%');

COMMIT;
