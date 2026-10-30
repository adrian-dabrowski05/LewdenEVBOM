-- ============================================================
-- Lewden EV BOM — Extras update 3
-- Run once in Supabase → SQL Editor BEFORE merging the code.
-- Safe to re-run, and safe whether or not you ran extras-2-swap-count.sql
-- (it includes that change too).
-- ============================================================

-- ── From update 2: rep picks how many (extra 5 RCD swap count) ──
alter table extras add column if not exists scales_with_bom boolean not null default false;
update extras set scales_with_bom = true where number = 5;
update extra_items set only_if_removed = false
where extra_id in (select id from extras where number = 5);

-- ── An Add line can depend on one specific part being removed ──
alter table extra_items add column if not exists if_removed_product_id uuid references products(id) on delete set null;

-- ── B100/30/2B goes into the normal catalogue so reps can pick it ──
-- Moves it into the same category as B100/30/2A (or Distribution if that isn't found)
update products set category = coalesce(
  (select category from products where is_active and upper(trim(part_number)) = 'B100/30/2A' order by sort_order limit 1),
  'Distribution')
where is_active and upper(trim(part_number)) = 'B100/30/2B' and category = 'Extras';

-- ── Extra 2 (Type 1 surge protection), rebuilt ──
-- Swap SRG3V1G for BSRG3123, and if BE10-3C50 is in the BOM swap it for
-- 3 × BFD22581 + 3 × BF063A. It no longer touches the RCCB.
delete from extra_items where extra_id in (select id from extras where number = 2);

with pid as (
  select distinct on (upper(trim(part_number))) upper(trim(part_number)) as pn, id
  from products where is_active and part_number is not null
  order by upper(trim(part_number)), sort_order
),
lines(pn, action, qty, needs_pn, sort_order) as (values
  ('SRG3V1G',   'remove', 1, null,        10),
  ('BE10-3C50', 'remove', 1, null,        20),
  ('BSRG3123',  'add',    1, null,        30),
  ('BFD22581',  'add',    3, 'BE10-3C50', 40),
  ('BF063A',    'add',    3, 'BE10-3C50', 50)
)
insert into extra_items (extra_id, product_id, action, quantity, if_removed_product_id, sort_order)
select e.id, p.id, l.action, l.qty, n.id, l.sort_order
from lines l
join extras e on e.number = 2
join pid p on p.pn = l.pn
left join pid n on n.pn = l.needs_pn;

-- ── Check ──
-- Extra 2 should list 5 lines, with the two fuse lines "only if BE10-3C50".
-- If BE10-3C50 is missing from the catalogue, add it in Admin and re-run this file.
select e.number, p.part_number, i.action, i.quantity, n.part_number as only_if_removed_part
from extra_items i
join extras e on e.id = i.extra_id
join products p on p.id = i.product_id
left join products n on n.id = i.if_removed_product_id
where e.number in (2, 5)
order by e.number, i.sort_order;
