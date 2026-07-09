-- =============================================================================
-- Migration 55: medical_prescription_items — item_category, quantity,
-- deducts_stock, stock_deducted (todas nuevas, aditivas)
-- =============================================================================
-- Contexto: feedback directo de un veterinario que usa el sistema (Sprint 2.7,
-- redistribucion del flujo de medicamentos en "Nueva consulta"). Un item de
-- receta ahora se clasifica en una de dos categorias:
--   - 'administered' — medicamento usado por el veterinario en el consultorio
--     durante la consulta (ej. una inyeccion).
--   - 'dispensed'    — medicamento entregado/emitido, lo que el dueno se lleva.
-- Y declara explicitamente cuanto se receta (quantity, antes inexistente — el
-- unico numero que existia era stock_snapshot, una FOTO del stock del producto
-- al recetar, no una cantidad recetada) y si esa cantidad debe descontarse del
-- inventario (deducts_stock) o no (medicamento que el dueno compra aparte / no
-- disponible en este negocio, aunque este ligado a un producto del catalogo).
--
-- stock_deducted es un campo de bookkeeping interno (nunca lo manda el
-- cliente): marca si ESTA fila ya disparo su descuento de inventario, para que
-- updatePrescription (que borra y reinserta TODOS los items en cada edicion —
-- ver Fase 5 Parte B) no vuelva a descontar stock de un item que ya se
-- desconto en un guardado anterior. clinicalService.js hace el emparejamiento
-- viejo/nuevo (mismo patron que assertNoDispensedPrescriptionItemsRemoved) antes
-- de decidir si un item "sobrevive" sin re-descontar o es genuinamente nuevo.
--
-- Todas las columnas son aditivas con DEFAULT — ninguna fila existente cambia
-- de significado: quantity=1/deducts_stock=TRUE asumen el caso mas comun
-- (un item de catalogo, cantidad no rastreada hasta ahora); stock_deducted=
-- FALSE es exacto para filas historicas (nunca dispararon un descuento
-- inmediato bajo el flujo viejo, solo el flujo de dispensacion por venta POS,
-- que no se toca aqui).
--
-- dose/frequency/duration/route_of_administration NO se tocan — siguen
-- existiendo, nullable, para no romper recetas historicas que si las tienen.
-- El formulario nuevo simplemente deja de poblarlas (quedan NULL en items
-- nuevos); ver clinicalService.js buildPrescriptionPayload.
--
-- Safety properties (mismo patron que 22/53/54):
--   Idempotente    — ADD COLUMN IF NOT EXISTS es un no-op en una segunda corrida.
--   Atomico        — BEGIN/COMMIT unico.
--   No destructivo — no borra datos, no afecta filas existentes salvo asignarles
--                    el DEFAULT documentado arriba.
--
-- Depends on: ninguna (medical_prescription_items siempre existio).
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/55-prescription-items-category-and-stock.sql
--
-- Produccion:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/55-prescription-items-category-and-stock.sql
-- =============================================================================

BEGIN;

ALTER TABLE medical_prescription_items
  ADD COLUMN IF NOT EXISTS item_category VARCHAR(20) NOT NULL DEFAULT 'dispensed';

ALTER TABLE medical_prescription_items
  ADD COLUMN IF NOT EXISTS quantity NUMERIC(12, 3) NOT NULL DEFAULT 1;

ALTER TABLE medical_prescription_items
  ADD COLUMN IF NOT EXISTS deducts_stock BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE medical_prescription_items
  ADD COLUMN IF NOT EXISTS stock_deducted BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'medical_prescription_items_category_check'
  ) THEN
    ALTER TABLE medical_prescription_items
      ADD CONSTRAINT medical_prescription_items_category_check
      CHECK (item_category IN ('administered', 'dispensed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'medical_prescription_items_quantity_check'
  ) THEN
    ALTER TABLE medical_prescription_items
      ADD CONSTRAINT medical_prescription_items_quantity_check
      CHECK (quantity > 0);
  END IF;
END $$;

COMMIT;
