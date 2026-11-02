-- ============================================================
-- Allow part quantities like 0.5 on saved quotes
-- Presets can hold 0.5 (numeric), but quote_items.quantity was a whole-number
-- column, so saving such a quote failed with:
--   invalid input syntax for type integer: "0.5"
-- Run once in Supabase -> SQL Editor. Safe to run more than once.
-- ============================================================

alter table quote_items alter column quantity type numeric using quantity::numeric;

-- Same problem for parts auto-added by a prerequisite
alter table product_prerequisites alter column quantity type numeric using quantity::numeric;
