-- =============================================================================
-- Migration 53: public.appointments.end_time -> NULLABLE
-- =============================================================================
-- Contexto: decision de producto (QA staging) — la hora de fin no siempre se
-- conoce al agendar (ej. "pasa cuando pueda", urgencias, o recepcion que solo
-- confirma la hora de inicio). Hoy appointments.end_time es NOT NULL, lo que
-- bloqueaba con "End time is required" incluso cuando el negocio no quiere
-- capturar ese dato todavia.
--
-- Mismo tipo de cambio que la migracion 46 (appointments.client_id ->
-- NULLABLE): un dato que no siempre esta resuelto al crear el registro, se
-- completa despues (editando la cita) sin bloquear la creacion.
--
-- Impacto revisado en clinicalService.js:
--   - buildAppointmentPayload ya no exige end_time; la comparacion
--     "end_time debe ser posterior a start_time" ahora solo corre cuando SI
--     se captura end_time.
--   - ensureAppointmentAvailability / ensureDoctorAppointmentAvailability
--     (deteccion de traslapes) se saltan explicitamente la comparacion de
--     rango de horario cuando la cita (nueva o existente) no tiene end_time
--     — decision de producto: sin hora de fin no hay traslape que detectar,
--     documentado en el codigo. Esto es simetrico: una cita sin end_time no
--     bloquea a otras, y otras tampoco la bloquean a ella por este criterio.
--   - listDoctors / dashboardService.js usan
--     "start_time <= CURRENT_TIME AND end_time >= CURRENT_TIME" para el badge
--     "en_consulta" del doctor — con end_time NULL esa comparacion nunca
--     coincide (NULL en SQL), asi que una cita sin hora de fin simplemente no
--     enciende ese badge. Degradacion cosmetica aceptada, no un error.
--
-- Impacto en el espejo healthcare.appointments (Fase 3): esa tabla SI
-- mantiene end_time NOT NULL + CHECK (end_time > start_time) — no se toca en
-- esta migracion (ver decision en healthcareSubjectTranslation.js:
-- buildAppointmentMirrorFields ahora calcula un end_time de respaldo SOLO
-- para el insert/update del espejo, nunca se persiste de vuelta en
-- public.appointments.end_time). El espejo hoy es infraestructura sin lectura
-- expuesta (Fase 3, paso 2 — ver comentario en APPOINTMENT_MIRROR_JOIN,
-- clinicalService.js), asi que ese valor de respaldo no tiene impacto visible.
--
-- El CHECK appointments_time_check (end_time > start_time) en public.* NO se
-- toca — un CHECK en Postgres pasa automaticamente cuando el resultado es
-- NULL (solo rechaza FALSE explicito), asi que ya admite end_time NULL sin
-- ningun cambio.
--
-- Safety properties (mismo patron que 34-46):
--   Idempotente    — DROP NOT NULL sobre una columna ya nullable es un no-op.
--   Atomico        — BEGIN/COMMIT unico.
--   No destructivo — no borra datos, no afecta filas existentes.
--
-- Depends on: ninguna (public.appointments siempre existio).
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/53-appointments-end-time-optional.sql
--
-- Produccion:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/53-appointments-end-time-optional.sql
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
  ALTER COLUMN end_time DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Verificacion — confirma que la columna quedo nullable y que el CHECK de
--    horario sigue vivo (no se toca, solo se documenta aqui para revision)
-- ---------------------------------------------------------------------------
SELECT
  table_schema,
  table_name,
  column_name,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'appointments'
  AND column_name = 'end_time';

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname = 'appointments_time_check'
  AND conrelid = 'appointments'::regclass;

COMMIT;
