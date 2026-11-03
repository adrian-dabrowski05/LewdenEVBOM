-- ============================================================
-- Rep-entered cost on extras (10. Non-standard colour, 11. Brushed stainless finish)
-- Run once in Supabase -> SQL Editor BEFORE deploying the code.
-- Safe to run more than once.
-- ============================================================

-- true = when a rep ticks this extra they type in its cost (£).
-- That cost is added to the quote at face value: no hardware uplift, no labour.
-- The cost itself is saved inside the quote (quotes.extras and quotes.build),
-- so the quotes table needs no new column.
alter table extras add column if not exists rep_priced boolean not null default false;

-- Non-standard colour (10) and brushed stainless finish (11): rep enters the cost,
-- and make them tickable (both were greyed out)
update extras set rep_priced = true, is_enabled = true where number in (10, 11);

-- Check: should show extras 10 and 11 with rep_priced = true and is_enabled = true
select number, name, is_enabled, rep_priced, labour_minutes, allowed_materials from extras where number in (10, 11);
