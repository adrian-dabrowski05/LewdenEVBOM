-- TopTer: DIN blanks take up DIN space, and can be quoted in quarters
--
-- Run this once in Supabase: SQL Editor, New query, paste all of it, Run.
-- Safe to run more than once.
--
-- 1. Adds products.qty_step: the smallest amount a part can be quoted in.
--    Blank means whole units (every EV part, and every TopTer part unless set).
--    0.5 means halves and 0.25 means quarters. Set it in Admin, Product
--    catalogue, Capacity, "Can be quoted in".
-- 2. Lets saved quotes hold a quantity like 0.25 or 1.5. Whole numbers are kept
--    exactly as they are, so nothing changes for existing quotes.
-- 3. P579904 module covers (DIN blanks): each one fills 2 DIN modules and can
--    be cut into 4, so it can be quoted in quarters. A quarter fills half a
--    module. A capacity you have already set for it is not replaced.

-- 1
alter table public.products add column if not exists qty_step numeric;

-- 2
alter table public.quote_items alter column quantity type numeric(10,2);

-- 3
update public.products
set capacity = '{"uses":{"din":2}}'::jsonb
where section = 'topter' and part_number = 'P579904'
  and (capacity is null or capacity = 'null'::jsonb or capacity = '{}'::jsonb);

update public.products
set qty_step = 0.25,
    notes = 'Palazzoli pack of 20. Each cover fills 2 DIN modules and can be cut into 4, so it can be quoted in quarters (0.25 fills half a module).'
where section = 'topter' and part_number = 'P579904' and qty_step is null;

-- Check
select part_number, description, capacity, qty_step
from public.products
where section = 'topter' and part_number = 'P579904';
