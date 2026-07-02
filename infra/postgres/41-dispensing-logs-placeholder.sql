-- =============================================================================
-- Migration 41: healthcare.dispensing_logs — deliberately no historical backfill
-- =============================================================================
-- This file is documentation-only. It contains no DML and inserts zero rows.
-- healthcare.dispensing_logs already exists (created empty in migration 14) and
-- stays empty until the application starts writing to it going forward.
--
-- Why there is no backfill (compliance decision, not a technical shortcut):
--
-- 1. healthcare.dispensing_logs.batch_id is NOT NULL with a composite FK to
--    healthcare.inventory_batches (id, business_id). There is no historical
--    batch/lot ledger to satisfy it: public.products.lot_number (added in
--    migration 25) is a single free-text field per product — one value, no
--    quantity, no expiry, no received-date, no per-sale attribution. It cannot
--    be expanded into inventory_batches rows without fabricating data
--    (quantities and dates that were never recorded).
--
-- 2. public.sale_prescription_links (added in migration 16) only links a whole
--    sale to a whole prescription (business_id, prescription_id, sale_id). It
--    does not link individual sale_items to individual
--    medical_prescription_items, and does not record a dispensed quantity per
--    medication. A sale linked to a prescription may also contain unrelated
--    products. There is no reliable way to reconstruct "product X, quantity Y,
--    from batch Z was dispensed against prescription_item W" from this table.
--
-- 3. healthcare.dispensing_logs feeds healthcare.view_libro_antibioticos (the
--    antibiotics regulatory book, see migration 14). Fabricating historical
--    entries — synthetic batches, guessed quantities inferred from sale
--    totals — into a table that backs a compliance report is a materially
--    different risk than backfilling patients/appointments/prescriptions. A
--    wrong historical patient name is a data quality issue; a wrong entry in
--    the antibiotics book is a regulatory one.
--
-- Conclusion: healthcare.dispensing_logs starts empty. Historical sales that
-- were linked to prescriptions via public.sale_prescription_links remain
-- queryable in their original form (public.sales + public.sale_prescription_links
-- + public.medical_prescriptions) for any retrospective/audit need — that data
-- is not lost, just not migrated into the new typed ledger.
--
-- What this migration does NOT do:
--   - Does not create healthcare.dispensing_logs (already exists, migration 14)
--   - Does not backfill any row into it
--   - Does not touch public.sale_prescription_links, public.sales, or
--     public.medical_prescriptions
--
-- Follow-up work (separate, not part of this migration):
--   Wiring healthcare.dispensing_logs into the live write path (saleService.js /
--   a new healthcareService.js) so that dispensing is recorded going forward,
--   including batch selection against healthcare.inventory_batches, is tracked
--   as its own piece of work — it requires product/inventory decisions
--   (how batches get created for existing stock with no lot history) that are
--   out of scope for a data migration script.
--
-- Depends on: migration 14 (healthcare.dispensing_logs already exists)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'healthcare' AND table_name = 'dispensing_logs'
  ) THEN
    RAISE EXCEPTION 'healthcare.dispensing_logs does not exist. Run migration 14 first.';
  END IF;
END $$;

-- Informational only — confirms the empty-by-design state, no rows are written.
SELECT
  'healthcare.dispensing_logs row count (expected: 0 until forward-write is implemented)' AS note,
  COUNT(*) AS current_rows
FROM healthcare.dispensing_logs;
