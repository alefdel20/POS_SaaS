-- =============================================================================
-- Migration 45: public.clients soft-delete unification (deleted_at -> is_active)
-- =============================================================================
-- Contexto: public.clients tenia DOS mecanismos de soft-delete independientes
-- que nunca se sincronizaron entre si:
--   - deleted_at (timestamp, escrito solo por clientService.softDeleteClient,
--     el flujo POS/catalogo) — write-once, sin ningun endpoint que lo revierta
--     a NULL en todo el backend (confirmado por grep completo).
--   - is_active (boolean, escrito solo por el flujo clinico
--     clinicalService.js/clinicalClientController.js) — reversible via
--     PATCH /clients/:id/status.
-- Un cliente borrado por el flujo de catalogo seguia siendo visible/editable
-- por el flujo clinico (que nunca miraba deleted_at), y viceversa un cliente
-- desactivado clinicamente seguia contando para deduplicacion/creditos en el
-- flujo de catalogo (que nunca miraba is_active).
--
-- Decision: is_active pasa a ser la UNICA fuente de verdad operativa para
-- "esta este cliente vivo" en todo el backend. deleted_at se queda como
-- columna historica/de auditoria (cuando se borro por ultima vez via el flujo
-- de catalogo) pero deja de filtrar nada — no se elimina la columna en esta
-- migracion (candidato a retirarse en una fase posterior si aplica).
--
-- Por que la reconciliacion de datos es segura:
--   - No existe, en todo el backend, ningun endpoint que escriba
--     deleted_at = NULL (verificado por grep) — es decir, ningun cliente
--     "restaurado" hoy depende de que deleted_at vuelva a NULL, porque esa
--     ruta no existe.
--   - Ningun otro modulo trata deleted_at IS NOT NULL como un estado terminal
--     de negocio: el unico guard relacionado es el de softDeleteClient mismo
--     (bloquear el borrado si hay deuda de credito activa), que es sobre la
--     transicion HACIA borrado, no sobre su irreversibilidad una vez ahi.
--     creditCollectionService.js (unico otro consumidor de deleted_at fuera de
--     clientService.js) solo lo usaba como filtro de existencia en sugerencias
--     de deudor por nombre/telefono — se migra a is_active en el mismo commit
--     que esta migracion, sin cambio de semantica.
--   - saleService.js nunca leyo deleted_at (ni is_active) al hacer el chequeo
--     de limite de credito — este UPDATE no le cambia el comportamiento.
--
-- Que hace este script:
--   1. UPDATE de reconciliacion: cualquier fila con deleted_at IS NOT NULL que
--      todavia tenga is_active = TRUE (estados inconsistentes de antes de esta
--      unificacion) pasa a is_active = FALSE. No toca deleted_at (ya estaba
--      seteado). No toca filas que ya estan consistentes.
--   2. El indice unico parcial clients_business_name_phone_uq excluia
--      duplicados solo entre filas con deleted_at IS NULL — si se deja asi,
--      reactivar un cliente (nueva capacidad de PUT /catalog-clients/:id, ver
--      clientService.updateClient) podria dejar dos clientes ACTIVOS con el
--      mismo (business_id, nombre, telefono) sin que el indice lo detecte,
--      porque el indice seguiria mirando deleted_at, no is_active. Se recrea
--      el indice con el predicado nuevo (WHERE is_active = TRUE) para que la
--      deduplicacion real (la que usan findOrCreateClient/listClients despues
--      de este mismo cambio) y la que impone la base de datos vuelvan a
--      coincidir.
--
-- Safety properties (mismo patron que 34-44):
--   Idempotente    — el UPDATE de reconciliacion no vuelve a tocar filas ya
--                    consistentes en un re-run; el DROP+CREATE INDEX no falla
--                    en un re-run (IF EXISTS / IF NOT EXISTS).
--   Atomico        — BEGIN/COMMIT unico.
--   No destructivo — no borra la columna deleted_at, no borra filas, no
--                    reactiva a nadie (solo apaga is_active donde ya estaba
--                    logicamente borrado).
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/45-clients-unify-soft-delete.sql
--
-- Produccion:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/45-clients-unify-soft-delete.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: verifica que la tabla objetivo exista
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'clients'
  ) THEN
    RAISE EXCEPTION 'public.clients does not exist.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Diagnostico: cuantas filas estan en estado inconsistente ANTES del fix
--    (deleted_at IS NOT NULL pero is_active todavia TRUE)
-- ---------------------------------------------------------------------------
SELECT
  business_id,
  COUNT(*) AS inconsistent_rows
FROM clients
WHERE deleted_at IS NOT NULL
  AND is_active = TRUE
GROUP BY business_id
ORDER BY business_id;

-- ---------------------------------------------------------------------------
-- 2. Reconciliacion — is_active pasa a coincidir con deleted_at para el
--    historico. No toca filas ya consistentes.
-- ---------------------------------------------------------------------------
UPDATE clients
SET is_active = FALSE
WHERE deleted_at IS NOT NULL
  AND is_active = TRUE;

-- ---------------------------------------------------------------------------
-- 3. Indice unico: predicado pasa de deleted_at IS NULL a is_active = TRUE,
--    para que coincida con la nueva fuente de verdad.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS clients_business_name_phone_uq;

CREATE UNIQUE INDEX IF NOT EXISTS clients_business_name_phone_uq
  ON clients (business_id, LOWER(TRIM(name)), COALESCE(LOWER(TRIM(phone)), ''))
  WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- 4. Verificacion post-cambio — debe dar 0 filas inconsistentes
-- ---------------------------------------------------------------------------
SELECT COUNT(*) AS remaining_inconsistent_rows
FROM clients
WHERE deleted_at IS NOT NULL
  AND is_active = TRUE;

COMMIT;
