-- =============================================================================
-- Migration 44: healthcare.pets.owner_id -> NULLABLE
-- =============================================================================
-- Contexto: commit 6db95fc ("replace client link with phone field on
-- patients", 2026-04-23) dejo de capturar patients.client_id al crear un
-- paciente -- el responsable de pago del lado mascota se resuelve por visita,
-- no queda fijo al paciente (misma realidad que ya se documento para el lado
-- humano en la migracion 42: "no existe, ni existio nunca en la practica, un
-- vinculo fijo paciente-humano <-> responsable de pago").
--
-- Como healthcare.pets.owner_id era NOT NULL sin default (migracion 14) y la
-- migracion 36 solo inserta una mascota vía INNER JOIN contra
-- healthcare.pet_owners (requiere un owner_id resuelto), toda mascota creada
-- desde el 23-abril-2026 en adelante nunca pudo tener espejo en
-- healthcare.pets. Consecuencia real en produccion: resolveHealthcareSubject
-- (healthcareSubjectTranslation.js) devuelve 409 "Pet has not been migrated to
-- healthcare.pets yet" para cualquier paciente nuevo, rompiendo el modulo de
-- eventos preventivos (ya en produccion, Fase 1) para todo alta posterior a esa
-- fecha.
--
-- Cambio: DROP NOT NULL sobre owner_id. No se toca la FK compuesta
-- fk_healthcare_pets_owner (owner_id, business_id) REFERENCES
-- healthcare.pet_owners (id, business_id) -- Postgres no evalua una FK
-- compuesta cuando alguna de sus columnas es NULL (MATCH SIMPLE, el default),
-- asi que la FK sigue validando normalmente cuando owner_id SI trae valor.
--
-- Este cambio de DDL es el habilitador de un sync dirigido (ver
-- backend/src/utils/healthcareSubjectTranslation.js:
-- syncPatientToHealthcare/syncClientToHealthcare) que crea el espejo en
-- healthcare.* en la misma transaccion que el INSERT en public.patients /
-- public.clients, para altas nuevas. Ese sync inserta mascotas con
-- owner_id = NULL a proposito (el responsable se resuelve despues, por
-- visita) -- exactamente lo que esta migracion habilita.
--
-- NOTA para codigo futuro: cualquier query que muestre "dueño de esta
-- mascota" debe usar LEFT JOIN contra healthcare.pet_owners, nunca INNER
-- JOIN -- un INNER JOIN oculta silenciosamente cualquier mascota con
-- owner_id NULL, igual que el bug ya identificado en la migracion 36 (pets
-- sin cliente migrado quedaban fuera del backfill sin ningun error visible).
--
-- Safety properties (mismo patron que 34-43):
--   Idempotente    — DROP NOT NULL sobre una columna ya nullable es un no-op,
--                    no lanza error en un re-run.
--   Atomico        — BEGIN/COMMIT unico.
--   No destructivo — no borra datos, no afecta filas existentes (todas las
--                    filas migradas por 36 ya tienen owner_id NOT NULL de
--                    todas formas, por construccion del propio script 36 via
--                    INNER JOIN).
--
-- Depends on: migraciones 14, 33 (healthcare.pets debe existir).
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/44-healthcare-pets-owner-nullable.sql
--
-- Produccion:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/44-healthcare-pets-owner-nullable.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: verifica que la tabla objetivo exista
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'pets'
  ) THEN
    RAISE EXCEPTION 'healthcare.pets does not exist. Run migrations 14 and 33 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. DROP NOT NULL
-- ---------------------------------------------------------------------------
ALTER TABLE healthcare.pets
  ALTER COLUMN owner_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Verificacion — confirma que la columna quedo nullable y que la FK
--    compuesta sigue viva (no se toca, solo se documenta aqui para revision)
-- ---------------------------------------------------------------------------
SELECT
  table_schema,
  table_name,
  column_name,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'healthcare'
  AND table_name = 'pets'
  AND column_name = 'owner_id';

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname = 'fk_healthcare_pets_owner'
  AND conrelid = 'healthcare.pets'::regclass;

COMMIT;
