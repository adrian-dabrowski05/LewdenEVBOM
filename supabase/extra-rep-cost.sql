-- ============================================================
-- Rep-entered cost on extras (e.g. 10. Non-standard colour)
-- Run once in Supabase -> SQL Editor BEFORE deploying the code.
-- Safe to run more than once.
-- ============================================================

-- true = when a rep ticks this extra they type in its cost (£).
-- That cost is added to the quote at face value: no hardware uplift, no labour.
-- The cost itself is saved inside the quote (quotes.extras and quotes.build),
-- so the quotes table needs no new column.
alter table extras add column if not exists rep_priced boolean not null default false;

-- Non-standard colour: rep enters the cost, and make it tickable (it was greyed out)
update extras set rep_priced = true, is_enabled = true where number = 10;

-- Check: should show extra 10 with rep_priced = true and is_enabled = true
select number, name, is_enabled, rep_priced, labour_minutes from extras where number = 10;
