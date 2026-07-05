-- =============================================================================
-- Migration 52: medical_prescription_items.product_id / healthcare.prescription_items.product_id -> NULLABLE
-- =============================================================================
-- Contexto: la veterinaria a veces necesita recetar un medicamento que no
-- tiene en su catalogo interno (el paciente lo compra en otro lado). Hoy
-- product_id es NOT NULL en ambas tablas, asi que un item de receta SIEMPRE
-- debe ligarse a un producto existente — no hay forma de representar un
-- "medicamento libre" (solo texto: nombre, dosis, frecuencia, duracion, via).
--
-- Mismo patron ya usado cuatro veces (migraciones 44/46/48/50): un dato que
-- no se puede resolver (aqui, porque deliberadamente no existe un producto)
-- se deja NULL en vez de bloquear el registro completo.
--
-- Investigacion realizada antes de escribir esta migracion (mismo patron que
-- 33/44/46/48/50): revisadas todas las CONSTRAINT sobre ambas tablas.
--   - medical_prescription_items (01-schema.sql / init.js ensureSchema): sin
--     ningun CHECK. El unico objeto que referencia product_id es el FK plano
--     fk_medical_prescription_items_product (FOREIGN KEY (product_id)
--     REFERENCES products(id)) — Postgres nunca evalua un FK cuando la
--     columna referenciante es NULL.
--   - healthcare.prescription_items (14-healthcare-modular-expansion.sql):
--     tres CHECK — prescription_items_type_check (item_type),
--     prescription_items_status_check (status), prescription_items_qty_check
--     (prescribed_quantity/dispensed_quantity) — ninguno menciona product_id.
--     El unico objeto que lo referencia es el FK plano
--     fk_healthcare_prescription_items_product (FOREIGN KEY (product_id,
--     business_id) REFERENCES public.products (id, business_id)), mismo
--     razonamiento: no se evalua con NULL.
--
-- Un item libre nunca puede dispensarse por venta (saleService.js exige que
-- sale_item.product_id coincida exactamente con prescription_item.product_id;
-- sin producto no hay nada que vender) — esperado, no requiere cambios ahi.
-- El export de PDF (clinicalService.js exportPrescriptionPdf) solo lee los
-- campos de snapshot de texto del item, nunca product_id — no requiere
-- cambios.
--
-- Safety properties (mismo patron que 33/44/46/48/50):
--   Idempotente     — DROP NOT NULL en una columna ya nullable es un no-op.
--   Atomico         — single BEGIN/COMMIT.
--   No destructivo  — ninguna fila existente se borra ni reescribe; todo
--                     item ya recetado con product_id resuelto sigue igual.
--
-- Depends on: medical_prescription_items siempre existio (01-schema.sql);
--             healthcare.prescription_items depende de migracion 14.
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/52-prescription-items-product-optional.sql
--
-- Produccion:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/52-prescription-items-product-optional.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: verifica que las tablas objetivo existan
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'medical_prescription_items'
  ) THEN
    RAISE EXCEPTION 'public.medical_prescription_items does not exist.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'prescription_items'
  ) THEN
    RAISE EXCEPTION 'healthcare.prescription_items does not exist. Run migration 14 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. DROP NOT NULL — public.medical_prescription_items.product_id
-- ---------------------------------------------------------------------------
ALTER TABLE medical_prescription_items
  ALTER COLUMN product_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. DROP NOT NULL — healthcare.prescription_items.product_id
-- ---------------------------------------------------------------------------
ALTER TABLE healthcare.prescription_items
  ALTER COLUMN product_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Verification — confirma que ambas columnas quedaron nullable y que los
--    FKs siguen vivos (no se tocan, solo se documentan aqui para revision)
-- ---------------------------------------------------------------------------
SELECT
  table_schema, table_name, column_name, is_nullable
FROM information_schema.columns
WHERE (table_schema = 'public' AND table_name = 'medical_prescription_items' AND column_name = 'product_id')
   OR (table_schema = 'healthcare' AND table_name = 'prescription_items' AND column_name = 'product_id');

SELECT conname, conrelid::regclass AS table_name, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname IN ('fk_medical_prescription_items_product', 'fk_healthcare_prescription_items_product');

COMMIT;
