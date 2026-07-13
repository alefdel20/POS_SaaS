-- =============================================================================
-- Migration 56: soporte para recordatorios internos de ankode-agent (WhatsApp)
-- =============================================================================
-- Contexto: ankode-agent (repo separado, LangChain/LangGraph) va a consumir
-- este backend via API REST interna (ver backend/src/routes/internalReminderRoutes.js)
-- para enviar recordatorios automaticos de vacunacion/desparasitacion por
-- WhatsApp y reagendar citas cuando el dueno responde.
--
-- Cambios:
--   1. healthcare.preventive_events.reminder_7d_sent_at / reminder_0d_sent_at
--      (TIMESTAMPTZ NULL) — marca cuando se envio cada etapa del recordatorio.
--   2. healthcare.preventive_events.appointment_id (INTEGER NULL, FK a
--      public.appointments(id)) — vincula el evento preventivo con la cita real
--      creada/movida al reagendar via el endpoint interno. FK simple (no
--      compuesta con business_id) porque public.appointments.business_id es
--      nullable en filas legacy (ver infra/postgres/12-clinical-vertical.sql) y
--      no tiene un indice unico (id, business_id) del que colgar una FK compuesta.
--   3. healthcare.pet_owners.whatsapp_opt_in (BOOLEAN NOT NULL DEFAULT false)
--      — opt-in explicito para contactar por WhatsApp. Default false: un
--      pet_owner existente no fue nunca pedido su consentimiento, no se asume.
--
-- Deliberadamente NO se agrega constraint de formato E.164 sobre
-- healthcare.pet_owners.phone en esta migracion — la normalizacion de telefono
-- se hace en capa de aplicacion (Node, ver internalReminderService.js) para no
-- romper datos existentes sin auditar primero cuantos registros fallarian un
-- CHECK de formato.
--
-- Safety properties (mismo patron que 34-55):
--   Idempotente    — todo ADD COLUMN usa IF NOT EXISTS; el guard de FK usa
--                    pg_constraint (mismo patron DO $$ que 33/42).
--   Atomico        — BEGIN/COMMIT unico.
--   No destructivo — cero escrituras a filas existentes salvo el DEFAULT de
--                    whatsapp_opt_in (false para todo pet_owner ya existente).
--
-- Depends on: migraciones 14, 33 (healthcare.preventive_events / pet_owners
--             deben existir), 12 (public.appointments debe existir).
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/56-internal-reminders-ankode.sql
--
-- Produccion:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/56-internal-reminders-ankode.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: verifica que las tablas objetivo existan
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'preventive_events'
  ) THEN
    RAISE EXCEPTION 'healthcare.preventive_events does not exist. Run migrations 14 and 33 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'pet_owners'
  ) THEN
    RAISE EXCEPTION 'healthcare.pet_owners does not exist. Run migration 14 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'appointments'
  ) THEN
    RAISE EXCEPTION 'public.appointments does not exist. Run migration 12 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. healthcare.preventive_events — columnas de tracking de recordatorio y
--    vinculo con la cita real de reagendado
-- ---------------------------------------------------------------------------
ALTER TABLE healthcare.preventive_events
  ADD COLUMN IF NOT EXISTS reminder_7d_sent_at TIMESTAMPTZ;

ALTER TABLE healthcare.preventive_events
  ADD COLUMN IF NOT EXISTS reminder_0d_sent_at TIMESTAMPTZ;

ALTER TABLE healthcare.preventive_events
  ADD COLUMN IF NOT EXISTS appointment_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_healthcare_preventive_events_appointment
  ON healthcare.preventive_events (appointment_id);

-- Indice de soporte para el endpoint GET /internal/reminders/due: localizar
-- eventos pendientes de recordatorio por fecha sin escanear la tabla completa.
CREATE INDEX IF NOT EXISTS idx_healthcare_preventive_events_reminder_pending
  ON healthcare.preventive_events (business_id, next_due_date)
  WHERE status <> 'cancelled' AND is_active = TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_healthcare_preventive_events_appointment'
      AND conrelid = 'healthcare.preventive_events'::regclass
  ) THEN
    ALTER TABLE healthcare.preventive_events
      ADD CONSTRAINT fk_healthcare_preventive_events_appointment
      FOREIGN KEY (appointment_id)
      REFERENCES public.appointments (id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. healthcare.pet_owners — opt-in de WhatsApp
-- ---------------------------------------------------------------------------
ALTER TABLE healthcare.pet_owners
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 3. Verificacion
-- ---------------------------------------------------------------------------
SELECT
  table_schema,
  table_name,
  column_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE (table_schema = 'healthcare' AND table_name = 'preventive_events'
       AND column_name IN ('reminder_7d_sent_at', 'reminder_0d_sent_at', 'appointment_id'))
   OR (table_schema = 'healthcare' AND table_name = 'pet_owners'
       AND column_name = 'whatsapp_opt_in')
ORDER BY table_name, column_name;

COMMIT;
