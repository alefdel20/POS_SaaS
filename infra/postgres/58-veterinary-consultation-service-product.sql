-- =============================================================================
-- Migration 58: Producto-servicio "Consulta veterinaria" para negocios
-- Veterinaria ya existentes
-- =============================================================================
-- Backfill para el nuevo flujo "Pasar a cobro": todo negocio pos_type =
-- 'Veterinaria' necesita un producto-servicio "Consulta veterinaria" con SKU
-- fijo 'SERV-CONSULTA' (precio libre por linea via unit_price al vender,
-- sin cambios en saleService.js). Los negocios creados a partir de este
-- commit ya lo reciben automaticamente via
-- initialCatalogSeedService.seedVeterinaryConsultationProduct(); esta
-- migracion cubre a los que ya existian antes de ese cambio.
--
-- Safety properties:
--   Idempotent   — re-running never duplicates (keyed on business_id + sku,
--                  mismo patron WHERE NOT EXISTS usado en migraciones 34-36)
--   Atomic       — single BEGIN/COMMIT
--   Multi-tenant — un producto por business_id, sku unico por negocio
--                  (uq_products_business_sku, indice parcial en init.js)
--   Non-destructive — solo INSERT, no toca productos existentes
--
-- catalog_type se siembra NULL a proposito (no debe aparecer en los
-- catalogos Alimentos/Accesorios/Medicamentos e insumos del sidebar). El
-- backfill de enum en init.js (bloque "Cleaning controlled enum values")
-- excluye explicitamente sku = 'SERV-CONSULTA' de su normalizacion para que
-- este NULL no se sobreescriba a 'accessories' en el siguiente arranque —
-- ver el ALTER correspondiente en init.js, espejado en el mismo commit.
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/58-veterinary-consultation-service-product.sql
--
-- Production:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/58-veterinary-consultation-service-product.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Main INSERT — idempotent via NOT EXISTS on (business_id, UPPER(sku))
-- ---------------------------------------------------------------------------
INSERT INTO products (
  name,
  sku,
  category,
  description,
  price,
  cost_price,
  unidad_de_venta,
  stock,
  stock_minimo,
  stock_maximo,
  status,
  catalog_type,
  is_active,
  business_id
)
SELECT
  'Consulta veterinaria',
  'SERV-CONSULTA',
  'Servicios',
  '',
  0,
  0,
  'pieza',
  999999,
  0,
  0,
  'activo',
  NULL,
  TRUE,
  b.id
FROM businesses b
WHERE b.pos_type = 'Veterinaria'
  AND NOT EXISTS (
    SELECT 1
    FROM products p
    WHERE p.business_id = b.id
      AND UPPER(p.sku) = 'SERV-CONSULTA'
  );

-- ---------------------------------------------------------------------------
-- 2. Post-insert verification
--    Un backfill perfecto tiene veterinaria_businesses = con_producto.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM businesses WHERE pos_type = 'Veterinaria')::INT
    AS veterinaria_businesses,
  (
    SELECT COUNT(DISTINCT p.business_id)
    FROM products p
    INNER JOIN businesses b ON b.id = p.business_id
    WHERE b.pos_type = 'Veterinaria'
      AND UPPER(p.sku) = 'SERV-CONSULTA'
  )::INT AS con_producto;

COMMIT;
