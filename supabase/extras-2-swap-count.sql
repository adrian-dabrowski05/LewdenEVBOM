-- ============================================================
-- Lewden EV BOM — Extras update: "rep picks how many"
-- Run once in Supabase → SQL Editor BEFORE deploying the code.
-- Safe to re-run.
-- ============================================================

-- When true, ticking the extra shows a − / + count. With Remove lines it starts
-- at every match in the BOM (e.g. all 12 Type A RCDs) and can't go higher.
alter table extras add column if not exists scales_with_bom boolean not null default false;

-- Extra 5 (Type B RCD): swap as many B100/30/2A as the rep chooses for B100/30/2B
update extras set scales_with_bom = true where number = 5;
update extra_items set only_if_removed = false
where extra_id in (select id from extras where number = 5);

-- Check: should show extra 5 with scales_with_bom = true
select number, name, scales_with_bom from extras where number = 5;
