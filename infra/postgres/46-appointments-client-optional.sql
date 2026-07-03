-- =============================================================================
-- Migration 46: public.appointments.client_id -> NULLABLE
-- =============================================================================
-- Contexto: decision de producto — un animal rescatado que todavia no tiene
-- dueno/responsable resuelto (esta en proceso de adopcion) igual necesita
-- poder recibir atencion medica y tener citas agendadas. Hoy
-- appointments.client_id es NOT NULL, lo que hace ese caso irrepresentable.
--
-- Esto es intencionalmente el mismo tipo de cambio que la migracion 44
-- (healthcare.pets.owner_id -> NULLABLE): un responsable de pago/tutor que no
-- esta fijo al momento de crear el registro, se resuelve despues. La
-- investigacion previa (Fase 3, appointments.client_id opcional) confirmo:
--   - El FK fk_appointments_client (client_id) REFERENCES clients(id) no
--     necesita tocarse — Postgres no evalua un FK simple cuando la columna es
--     NULL, asi que la FK sigue validando normalmente cuando client_id SI
--     trae valor.
--   - No hay ningun CHECK ni indice unico sobre appointments.client_id.
--   - Ningun reporte/factura depende de appointments.client_id (facturacion
--     cuelga de sales, no de appointments) — sin riesgo fiscal.
--   - dashboardService.js y reminderService.js no hacen JOIN a clients para
--     appointments — no requieren cambios de esquema ni de codigo.
--
-- El habilitador de aplicacion para este cambio es el LEFT JOIN (en vez de
-- INNER JOIN) contra clients en getOwnedAppointment/listAppointments
-- (clinicalService.js) mas el guard resuelto-o-null (antes resuelto-o-400) en
-- lo que antes era resolveAppointmentClientId — ver ese archivo.
--
-- NOTA para codigo futuro: cualquier query que muestre "responsable de esta
-- cita" debe usar LEFT JOIN contra clients, nunca INNER JOIN — un INNER JOIN
-- oculta silenciosamente cualquier cita con client_id NULL (mismo bug ya
-- identificado dos veces: migracion 36 para pets sin cliente migrado, y la
-- migracion 44 para pets sin owner_id resuelto).
--
-- Safety properties (mismo patron que 34-45):
--   Idempotente    — DROP NOT NULL sobre una columna ya nullable es un no-op,
--                    no lanza error en un re-run.
--   Atomico        — BEGIN/COMMIT unico.
--   No destructivo — no borra datos, no afecta filas existentes (toda fila
--                    con client_id ya resuelto sigue exactamente igual).
--
-- Depends on: ninguna (public.appointments siempre existio).
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/46-appointments-client-optional.sql
--
-- Produccion:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/46-appointments-client-optional.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: verifica que la tabla objetivo exista
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'appointments'
  ) THEN
    RAISE EXCEPTION 'public.appointments does not exist.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. DROP NOT NULL
-- ---------------------------------------------------------------------------
ALTER TABLE appointments
  ALTER COLUMN client_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Verificacion — confirma que la columna quedo nullable y que la FK sigue
--    viva (no se toca, solo se documenta aqui para revision)
-- ---------------------------------------------------------------------------
SELECT
  table_schema,
  table_name,
  column_name,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'appointments'
  AND column_name = 'client_id';

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname = 'fk_appointments_client'
  AND conrelid = 'appointments'::regclass;

COMMIT;
