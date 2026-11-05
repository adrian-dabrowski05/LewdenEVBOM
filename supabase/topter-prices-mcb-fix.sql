-- TopTer: corrected costs for 22 BG06 B-curve MCBs (Adrian, 5 Nov 2026)
-- The price sheet had these at a tenth of their real cost.
-- Run once in Supabase: SQL Editor, New query, paste all of it, Run. Safe to run again.
-- EV parts with the same part number follow, through the shared-part trigger.

update public.products p
set factory_cost = v.cost
from (values
  ('BG06-2B16', 1.99), ('BG06-2B20', 1.99), ('BG06-2B32', 1.99), ('BG06-2B40', 1.99),
  ('BG06-2B50', 2.00), ('BG06-2B63', 2.00),
  ('BG06-3B06', 2.88), ('BG06-3B10', 2.88), ('BG06-3B16', 2.88), ('BG06-3B20', 2.88), ('BG06-3B32', 2.88), ('BG06-3B40', 2.88),
  ('BG06-3B50', 3.00), ('BG06-3B63', 3.00),
  ('BG06-4B06', 3.84), ('BG06-4B10', 3.84), ('BG06-4B16', 3.84), ('BG06-4B20', 3.84), ('BG06-4B32', 3.84), ('BG06-4B40', 3.84),
  ('BG06-4B50', 4.00), ('BG06-4B63', 4.00)
) as v(part_number, cost)
where p.section = 'topter'
  and p.part_number = v.part_number
  and p.factory_cost is distinct from v.cost;

-- Check: should list all 22 at the new prices
select part_number, factory_cost from public.products
where section = 'topter' and part_number ~ '^BG06-[234]B'
order by part_number;
