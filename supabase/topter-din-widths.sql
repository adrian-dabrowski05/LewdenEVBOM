-- TopTer: DIN widths for the three phase surge protection devices
-- Only needed if you already ran supabase/topter-section.sql before this file existed.
-- Safe to run more than once, and does nothing if the TopTer parts are not there.
--
-- Capacity counts DIN space in standard 18mm modules. SRG3123 (Type 1+2) and
-- SRG3V1G (Type 2) are both 4 module (3P+N) devices.

update public.products
set capacity = '{"uses":{"din":4}}'::jsonb,
    notes = 'Lewden. 4 module (3P+N).'
where section = 'topter'
  and part_number in ('BSRG3123', 'BSRG3V1G')
  and capacity is null;

-- Check: both should show {"uses": {"din": 4}}
select part_number, description, capacity
from public.products
where section = 'topter' and part_number in ('BSRG3123', 'BSRG3V1G');
