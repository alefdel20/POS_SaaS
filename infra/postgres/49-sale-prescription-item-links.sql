-- =============================================================================
-- Migration 49: sale_prescription_item_links (Fase 5, Parte B — dispensacion)
-- =============================================================================
-- Contexto: sale_prescription_links (migracion 16) solo vincula una venta
-- completa a una receta completa (business_id, prescription_id, sale_id) — no
-- registra que producto, que cantidad, ni contra que item de la receta se
-- dispenso. migracion 41 documento esto explicitamente como el motivo por el
-- que healthcare.dispensing_logs se quedo vacio: no hay forma de reconstruir
-- "producto X, cantidad Y, contra prescription_item W" desde esa tabla.
--
-- sale_prescription_item_links cierra ese hueco a nivel de linea: vincula un
-- sale_item concreto a un medical_prescription_item concreto, con la cantidad
-- dispensada en esa linea. No reemplaza sale_prescription_links (ese vinculo
-- venta-completa<->receta-completa sigue existiendo y sigue siendo opcional e
-- independiente) — coexisten, mismo principio que appointments/consultations
-- coexistiendo con sus propios mirrors healthcare.*.
--
-- Decision — referencia a medical_prescription_items (public), NO a
-- healthcare.prescription_items: sale_prescription_links.prescription_id ya
-- referencia medical_prescriptions(id) (public), no healthcare.prescriptions
-- — public.* sigue siendo el maestro de escritura para todo lo relacionado a
-- ventas (saleService.js nunca ha escrito directo a healthcare.*). Esta tabla
-- sigue el mismo patron por consistencia: es la contraparte publica del
-- vinculo, escrita por saleService.js en la misma transaccion que sale_items.
-- La traduccion hacia healthcare.dispensing_logs.prescription_item_id (que SI
-- referencia healthcare.prescription_items, ver migracion 14) ocurre en
-- tiempo de escritura via source_prescription_item_id — mismo patron de
-- traduccion que healthcareSubjectTranslation.js ya usa en todos lados.
--
-- Opt-in por linea: esta tabla solo recibe una fila cuando el sale_item del
-- payload de venta trae prescription_item_id explicito. Una venta normal sin
-- ese campo nunca la toca — ver saleService.js.
--
-- Safety properties:
--   Idempotente  — CREATE TABLE IF NOT EXISTS + ADD CONSTRAINT guardado con
--                  pg_constraint / EXCEPTION WHEN duplicate_object.
--   Atomico      — single BEGIN/COMMIT.
--   No destructivo — tabla nueva, cero filas hasta que saleService.js empiece
--                  a escribir (ver Parte B del codigo, sin backfill historico
--                  — mismo principio que migracion 41).
--
-- Depends on: medical_prescription_items (migracion 15), sale_items (schema
--             base), businesses/users (schema base).
--
-- Backup before running (staging AND production, in that order):
--   docker exec -i [container] pg_dump -U admin -d ankode -n public \
--     -t sale_prescription_item_links \
--     -F c -f /backups/pre-migration-49-$(date +%Y%m%d%H%M%S).dump
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/49-sale-prescription-item-links.sql
--
-- Production:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/49-sale-prescription-item-links.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: verify dependencies exist
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'medical_prescription_items'
  ) THEN
    RAISE EXCEPTION 'medical_prescription_items does not exist. Run migration 15 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sale_items'
  ) THEN
    RAISE EXCEPTION 'sale_items does not exist.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_prescription_item_links (
  id BIGSERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sale_item_id INTEGER NOT NULL,
  prescription_item_id BIGINT NOT NULL,
  quantity_dispensed NUMERIC(12, 3) NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sale_prescription_item_links_qty_check'
      AND conrelid = 'sale_prescription_item_links'::regclass
  ) THEN
    ALTER TABLE sale_prescription_item_links DROP CONSTRAINT sale_prescription_item_links_qty_check;
  END IF;
END $$;

ALTER TABLE sale_prescription_item_links
ADD CONSTRAINT sale_prescription_item_links_qty_check
CHECK (quantity_dispensed > 0);

-- ---------------------------------------------------------------------------
-- 2. Foreign keys
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_sale_prescription_item_links_sale_item'
      AND conrelid = 'sale_prescription_item_links'::regclass
  ) THEN
    ALTER TABLE sale_prescription_item_links
    ADD CONSTRAINT fk_sale_prescription_item_links_sale_item
    FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_sale_prescription_item_links_prescription_item'
      AND conrelid = 'sale_prescription_item_links'::regclass
  ) THEN
    ALTER TABLE sale_prescription_item_links
    ADD CONSTRAINT fk_sale_prescription_item_links_prescription_item
    FOREIGN KEY (prescription_item_id) REFERENCES medical_prescription_items(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sale_prescription_item_links_sale_item_id
  ON sale_prescription_item_links(sale_item_id);
CREATE INDEX IF NOT EXISTS idx_sale_prescription_item_links_prescription_item_id
  ON sale_prescription_item_links(prescription_item_id);

-- ---------------------------------------------------------------------------
-- 4. Verification
-- ---------------------------------------------------------------------------
SELECT
  table_name, column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'sale_prescription_item_links'
ORDER BY ordinal_position;

SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'sale_prescription_item_links'::regclass;

COMMIT;
