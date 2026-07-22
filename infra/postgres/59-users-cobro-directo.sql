-- =============================================================================
-- Migration 59: users.cobro_directo
-- =============================================================================
-- Toggle "Modo de cobro: Directo/Enviar a caja" para usuarios role = 'clinico'
-- (flujo "Pasar a cobro" veterinario). Editable solo por admin/superusuario
-- via PUT /users/:id (userService.js updateUser).
--
-- Safety properties:
--   Idempotent — ADD COLUMN IF NOT EXISTS
--   Non-destructive — default FALSE, no afecta usuarios existentes
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/59-users-cobro-directo.sql
--
-- Production:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/59-users-cobro-directo.sql
-- =============================================================================

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS cobro_directo BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
