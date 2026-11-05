-- TopTer: a 63A fixed socket on a switched-socket board takes 2 seats
--
-- Run this once in Supabase: SQL Editor, New query, paste all of it, Run.
-- Safe to run more than once.
--
-- A 63A fixed socket fits any switched (interlocked) socket board on the
-- 103x230 flange P579717. That flange blocks the seat above it (Adrian,
-- 5 Nov 2026), so it now uses 2 switched-socket seats instead of 1.
-- A capacity you have already changed by hand is left alone.

update public.products
set capacity = '{"provides":{"sockets":1,"f100":1},"uses":{"switched":2}}'::jsonb,
    notes = 'Fits any switched-socket board and takes 2 seats: it blocks the seat above it. 100x100 socket flange for one 63A fixed socket.'
where section = 'topter' and part_number = 'P579717'
  and capacity = '{"provides":{"sockets":1,"f100":1},"uses":{"switched":1}}'::jsonb;

-- Check
select part_number, description, capacity, notes
from public.products
where section = 'topter' and part_number = 'P579717';
