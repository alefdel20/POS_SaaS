-- =============================================================================
-- Migration 34: public.clients → healthcare.pet_owners
-- =============================================================================
-- Phase 1 of the dual-schema coexistence plan.
-- Copies every non-orphaned client into healthcare.pet_owners so that the
-- healthcare layer can reference owners without touching the live public tables.
--
-- Safety properties:
--   Idempotent   — re-running never creates duplicates (keyed on client_id)
--   Atomic       — single BEGIN/COMMIT; fails cleanly on any error
--   Multi-tenant — business_id preserved per row
--   Non-destructive — zero writes to public.clients
--
-- Depends on: migrations 14 and 33 (healthcare schema must exist)
-- Run order : staging first, then production
--
-- Staging:
--   docker exec -i [container] psql -U dev -d stagingdev \
--     < infra/postgres/34-migrate-clients-to-pet-owners.sql
--
-- Production:
--   docker exec -i [container] psql -U admin -d ankode \
--     < infra/postgres/34-migrate-clients-to-pet-owners.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guard: verify the target table exists before doing anything
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare'
      AND table_name   = 'pet_owners'
  ) THEN
    RAISE EXCEPTION
      'healthcare.pet_owners does not exist. Run migrations 14 and 33 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Ensure the traceability index exists on client_id
--    client_id already exists as a column in healthcare.pet_owners (migration 14).
--    We add an index so dual-write lookups ("find the pet_owner for client X")
--    are O(log n) instead of a full scan.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pet_owners_client_id_business
  ON healthcare.pet_owners (client_id, business_id);

-- ---------------------------------------------------------------------------
-- 2. Main INSERT — idempotent via NOT EXISTS on (client_id, business_id)
--
-- Column decisions:
--   first_name  — text before the first space in public.clients.name
--   last_name   — text from the first space onward (empty string if single word)
--   owner_code  — NULL: no equivalent exists in public.clients; application
--                 can assign codes later without conflict (NULLs are not
--                 subject to the UNIQUE constraint on (business_id, owner_code))
--   status      — 'inactive' when deleted_at IS NOT NULL OR is_active = FALSE
--   metadata    — original metadata merged with credit_limit / credit_days so
--                 no financial data is silently discarded
--   record_uuid — fresh UUID per row (gen_random_uuid() default)
-- ---------------------------------------------------------------------------
INSERT INTO healthcare.pet_owners (
  business_id,
  client_id,
  owner_code,
  first_name,
  last_name,
  phone,
  email,
  address,
  tax_id,
  notes,
  metadata,
  status,
  is_active,
  created_by,
  updated_by,
  created_at,
  updated_at
)
SELECT
  c.business_id,

  -- traceability: links this pet_owner back to its source public.clients row
  c.id                                                            AS client_id,

  -- no owner_code equivalent in public.clients; left NULL intentionally
  NULL::VARCHAR(60)                                               AS owner_code,

  -- name split: everything before the first space → first_name
  TRIM(SPLIT_PART(TRIM(c.name), ' ', 1))                         AS first_name,

  -- name split: everything after the first space → last_name ('' if single word)
  CASE
    WHEN TRIM(c.name) LIKE '% %'
      THEN TRIM(SUBSTRING(TRIM(c.name) FROM POSITION(' ' IN TRIM(c.name)) + 1))
    ELSE ''
  END                                                             AS last_name,

  c.phone,
  c.email,
  COALESCE(c.address, '')                                         AS address,
  c.tax_id,
  COALESCE(c.notes, '')                                           AS notes,

  -- preserve credit fields that have no direct column in healthcare schema
  (
    COALESCE(c.metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
         'migrated_from',  'public.clients',
         'migrated_at',    NOW()::text,
         'credit_limit',   c.credit_limit,
         'credit_days',    c.credit_days
       ))
  )                                                               AS metadata,

  -- status: inactive if soft-deleted OR explicitly deactivated
  CASE
    WHEN c.deleted_at IS NOT NULL OR c.is_active = FALSE THEN 'inactive'
    ELSE 'active'
  END                                                             AS status,

  CASE WHEN c.deleted_at IS NOT NULL THEN FALSE ELSE c.is_active END
                                                                  AS is_active,

  c.created_by,
  c.updated_by,
  c.created_at,
  c.updated_at

FROM public.clients c

WHERE
  -- skip orphaned rows that predate the multi-tenant migration
  c.business_id IS NOT NULL

  -- idempotency: skip any client already present in pet_owners
  AND NOT EXISTS (
    SELECT 1
    FROM healthcare.pet_owners po
    WHERE po.client_id   = c.id
      AND po.business_id = c.business_id
  );

-- ---------------------------------------------------------------------------
-- 3. Post-insert verification
--    The query below shows totals by business so you can spot any gaps.
--    A perfect migration has migrated = eligible for every business.
-- ---------------------------------------------------------------------------
SELECT
  source,
  business_id,
  SUM(total)::INT AS total
FROM (
  -- eligible source rows (business_id NOT NULL)
  SELECT
    'eligible_public_clients'::TEXT AS source,
    c.business_id,
    COUNT(*)                        AS total
  FROM public.clients c
  WHERE c.business_id IS NOT NULL
  GROUP BY c.business_id

  UNION ALL

  -- rows actually present in pet_owners with a source link
  SELECT
    'migrated_pet_owners'::TEXT,
    po.business_id,
    COUNT(*)
  FROM healthcare.pet_owners po
  WHERE po.client_id IS NOT NULL
  GROUP BY po.business_id
) counts
GROUP BY source, business_id
ORDER BY business_id, source;

-- Aggregate summary across all businesses
SELECT
  'TOTAL eligible_public_clients' AS description,
  COUNT(*)::INT                   AS rows
FROM public.clients
WHERE business_id IS NOT NULL

UNION ALL

SELECT
  'TOTAL migrated_pet_owners',
  COUNT(*)::INT
FROM healthcare.pet_owners
WHERE client_id IS NOT NULL;

COMMIT;
