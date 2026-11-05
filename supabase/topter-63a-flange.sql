-- TopTer: the 63A flange takes ONE switched-socket seat
--
-- Run this once in Supabase: SQL Editor, New query, paste all of it, Run.
-- Safe to run more than once.
--
-- A 63A fixed socket fits any switched (interlocked) socket board on the
-- 103x230 flange P579717. The flange fills one whole switch interlock hole and
-- holds one 63A socket (Adrian, 5 Nov 2026). The neighbouring hole stays free
-- for another flange, such as one that seats 2 sockets.
--
-- The first version of this file (PR #33) set it to 2 seats, which wrongly
-- blocked the next hole. This puts it back to 1 seat. A capacity you have
-- changed by hand to something else is left alone.

update public.products
set capacity = '{"provides":{"sockets":1,"f100":1},"uses":{"switched":1}}'::jsonb,
    notes = 'Fills one switched-socket seat and holds one 63A fixed socket (100x100 socket flange).'
where section = 'topter' and part_number = 'P579717'
  and capacity in ('{"provides":{"sockets":1,"f100":1},"uses":{"switched":2}}'::jsonb,
                   '{"provides":{"sockets":1,"f100":1},"uses":{"switched":1}}'::jsonb);

-- Check
select part_number, description, capacity, notes
from public.products
where section = 'topter' and part_number = 'P579717';
