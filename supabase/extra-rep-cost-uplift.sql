-- ============================================================
-- Let a rep-entered extra cost get the hardware uplift (e.g. the earth bar extra)
-- Run once in Supabase -> SQL Editor BEFORE deploying the code.
-- Safe to run more than once.
-- ============================================================

-- true = the cost the rep types in counts as hardware: it is added to the
-- materials subtotal, so the hardware uplift % applies to it.
-- false (default) = added at face value, no uplift (non-standard colour, brushed stainless).
alter table extras add column if not exists rep_cost_uplift boolean not null default false;

-- The earth bar extra gets the uplift
update extras set rep_cost_uplift = true where name ilike '%earth bar%';

-- Check: the earth bar extra should show rep_cost_uplift = true.
-- If rep_priced is false here, the earth bar extra has no cost box at all,
-- so its cost comes from its parts (which already get the uplift).
select number, name, rep_priced, rep_cost_uplift from extras order by number;
