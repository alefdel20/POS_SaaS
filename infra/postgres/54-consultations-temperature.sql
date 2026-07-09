-- =============================================================================
-- Migration 54: public.consultations.temperature (nueva columna, NULLABLE)
-- =============================================================================
-- Contexto: rediseno de la plantilla "Clasica" de receta medica (parecido a
-- una receta veterinaria real) agrega un campo de temperatura al momento de
-- capturar una consulta. Es un dato propio de CADA consulta (varia por
-- visita), no un dato del paciente en general como peso/especie/raza, por eso
-- vive en consultations y no en patients.
--
-- Opcional: NUNCA se exige. Un negocio que no toma temperatura, o consultas
-- historicas ya guardadas, se quedan con NULL sin bloquear nada.
--
-- Safety properties (mismo patron que 22-finance-calendar-base-date y demas
-- migraciones aditivas de esta lista):
--   Idempotente    — ADD COLUMN IF NOT EXISTS es un no-op en una segunda corrida.
--   Atomico        — BEGIN/COMMIT unico.
--   No destructivo — no borra datos, no afecta filas existentes (quedan NULL).
--
-- Depends on: ninguna (public.consultations siempre existio).
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/54-consultations-temperature.sql
--
-- Produccion:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/54-consultations-temperature.sql
-- =============================================================================

BEGIN;

ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS temperature NUMERIC(4, 1);

COMMIT;
