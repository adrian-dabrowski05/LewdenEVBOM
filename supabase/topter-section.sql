-- ============================================================
-- Lewden Quoting Tool — TopTer section
-- Run once in Supabase → SQL Editor BEFORE deploying the new code.
-- Safe to run again: it skips anything that already exists.
--
-- What it does:
--   1. Marks every product, preset, extra and quote with a section.
--      Everything that exists today becomes 'ev', so the EV feeder
--      pillar quoting keeps working exactly as before.
--   2. Lets products use the TopTer categories.
--   3. Adds products.capacity (what a board provides, what a socket uses)
--      for the TopTer capacity check.
--   4. Keeps shared parts in step: a part number in both sections always
--      has the same price and description (change it in either place).
--   5. Lets each section number its own extras from 1.
--   6. Adds TopTer's own uplift %, labour rate and prices-reviewed date
--      (starting from the current EV values).
--   7. Loads the TopTer range (Palazzoli topTER = P, Lewden circuit
--      protection = B) with no prices, and the pre-assembled units as presets
--      (empty: add their parts in Admin > Presets).
-- ============================================================

-- ── 1. Section column ───────────────────────────────────────
alter table products add column if not exists section text not null default 'ev';
alter table presets  add column if not exists section text not null default 'ev';
alter table extras   add column if not exists section text not null default 'ev';
alter table quotes   add column if not exists section text not null default 'ev';

create index if not exists idx_products_section on products(section);
create index if not exists idx_quotes_section on quotes(section);

-- ── 2. Categories ───────────────────────────────────────────
-- Drops any CHECK constraint on products.category and re-adds it with the
-- EV and TopTer categories (does nothing if there is no constraint).
do $$
declare c record; found_one boolean := false;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.products'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%category%'
  loop
    execute format('alter table public.products drop constraint %I', c.conname);
    found_one := true;
  end loop;
  if found_one then
    alter table public.products add constraint products_category_check check (category in (
      'Steelworks','Accessories','Incomers','Distribution','PEN Fault Protection',
      'Outgoing','Ancillary Equipment','Extras',
      'Enclosures','Fixed sockets','Interlocked sockets','Domestic sockets',
      'Flanges & covers','Circuit protection'));
  end if;
end $$;

-- ── 3. Capacity ─────────────────────────────────────────────
-- {"provides": {"sockets": 4, "f65": 4, "f88": 4, "din": 10}} on a board,
-- {"uses": {"sockets": 1, "f65": 1}} on a socket. Edited in Admin > Products.
alter table products add column if not exists capacity jsonb;

-- ── 4. Shared parts: same price and description in both sections ──
-- When a part is added with a part number that the other section already has,
-- it takes that part's description and price. When the description or price
-- changes, every part with the same part number in the other section follows.
create or replace function sync_shared_part_in()
returns trigger language plpgsql security definer set search_path = public as $$
declare d text; c numeric;
begin
  if new.part_number is null or trim(new.part_number) = '' then return new; end if;
  if tg_op = 'UPDATE' and upper(trim(coalesce(old.part_number, ''))) = upper(trim(new.part_number)) then return new; end if;
  select p.description, p.factory_cost into d, c
  from products p
  where upper(trim(p.part_number)) = upper(trim(new.part_number))
    and p.section <> new.section
    and p.id <> new.id
  order by p.is_active desc, p.updated_at desc nulls last
  limit 1;
  if found then
    new.description := d;
    new.factory_cost := c;
  end if;
  return new;
end $$;

create or replace function sync_shared_part_out()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if new.part_number is null or trim(new.part_number) = '' then return null; end if;
  if new.description is not distinct from old.description and new.factory_cost is not distinct from old.factory_cost then return null; end if;
  update products set description = new.description, factory_cost = new.factory_cost
  where id <> new.id
    and section <> new.section
    and upper(trim(part_number)) = upper(trim(new.part_number))
    and (description is distinct from new.description or factory_cost is distinct from new.factory_cost);
  return null;
end $$;

drop trigger if exists products_shared_part_in on products;
create trigger products_shared_part_in
  before insert or update of part_number on products
  for each row execute function sync_shared_part_in();

drop trigger if exists products_shared_part_out on products;
create trigger products_shared_part_out
  after update of description, factory_cost on products
  for each row execute function sync_shared_part_out();

-- ── 5. Extras numbered per section ──────────────────────────
-- extras.number was unique across the whole table; now it is unique per section.
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
    where con.conrelid = 'public.extras'::regclass
      and con.contype = 'u'
      and array_length(con.conkey, 1) = 1
      and con.conkey[1] = (select attnum from pg_attribute where attrelid = 'public.extras'::regclass and attname = 'number')
  loop
    execute format('alter table public.extras drop constraint %I', c.conname);
  end loop;
end $$;
create unique index if not exists extras_section_number on extras(section, number);

-- ── 6. TopTer settings (separate defaults from EV) ──────────
insert into settings (key, value)
select 'topter_hardware_uplift_pct', coalesce((select value from settings where key = 'hardware_uplift_pct'), '5')
where not exists (select 1 from settings where key = 'topter_hardware_uplift_pct');
insert into settings (key, value)
select 'topter_labour_rate_per_min', coalesce((select value from settings where key = 'labour_rate_per_min'), '0')
where not exists (select 1 from settings where key = 'topter_labour_rate_per_min');
insert into settings (key, value)
select 'topter_prices_reviewed_at', ''
where not exists (select 1 from settings where key = 'topter_prices_reviewed_at');

-- ── 7a. TopTer products (no prices yet) ─────────────────────
-- A part number the EV side already has (e.g. BE10-3C06) takes its EV
-- description and price automatically (step 4).
insert into products (section, category, description, part_number, factory_cost, notes, capacity, sort_order, is_active)
select 'topter', v.category, v.description, v.part_number, null, v.notes, v.capacity, v.sort_order, true
from (values
  ('Enclosures', 'topTER distribution board, transparent window, 2 fixed sockets, 5 DIN modules, IP66', 'P579822', 'Up to 2 sockets: max 2 on 65x83 flanges, max 2 on 88x100 flanges. 22W.', '{"provides":{"sockets":2,"f65":2,"f88":2,"din":5}}'::jsonb, 100010),
  ('Enclosures', 'topTER distribution board, transparent window, 3 fixed sockets, 5 DIN modules, IP66', 'P579823', 'Up to 3 sockets: max 3 on 65x83 flanges, max 1 on 88x100 flanges. 22W.', '{"provides":{"sockets":3,"f65":3,"f88":1,"din":5}}'::jsonb, 100020),
  ('Enclosures', 'topTER distribution board, transparent window, 4 fixed sockets, 10 DIN modules, IP66', 'P579824', 'Up to 4 sockets: max 4 on 65x83 flanges, max 4 on 88x100 flanges. 40W. 16A/32A 3P+N+E sockets only in the lower compartment.', '{"provides":{"sockets":4,"f65":4,"f88":4,"din":10}}'::jsonb, 100030),
  ('Enclosures', 'topTER distribution board, transparent window, 6 fixed sockets, 16 DIN modules, IP66', 'P579826', 'Up to 6 sockets: max 6 on 65x83 flanges, max 6 on 88x100 flanges. 56W. 16A/32A 3P+N+E sockets only in the lower compartment.', '{"provides":{"sockets":6,"f65":6,"f88":6,"din":16}}'::jsonb, 100040),
  ('Enclosures', 'topTER distribution board, transparent window, 8 fixed sockets, 22 DIN modules, IP66', 'P579828', 'Up to 8 sockets: max 8 on 65x83 flanges, max 8 on 88x100 flanges. 70W. 16A/32A 3P+N+E sockets only in the lower compartment.', '{"provides":{"sockets":8,"f65":8,"f88":8,"din":22}}'::jsonb, 100050),
  ('Enclosures', 'topTER distribution board, transparent window, 3 fixed sockets incl. one 63A, 10 DIN modules, IP66', 'P579863', 'Up to 3 sockets: max 2 on 65x83, max 1 on 88x100, max 1 on 100x100 (63A) flanges. 40W.', '{"provides":{"sockets":3,"f65":2,"f88":1,"f100":1,"din":10}}'::jsonb, 100060),
  ('Enclosures', 'topTER distribution board, transparent window, 5 fixed sockets incl. one 63A, 16 DIN modules, IP66', 'P579865', 'Up to 5 sockets: max 4 on 65x83, max 2 on 88x100, max 1 on 100x100 (63A) flanges. 56W.', '{"provides":{"sockets":5,"f65":4,"f88":2,"f100":1,"din":16}}'::jsonb, 100070),
  ('Enclosures', 'topTER distribution board for 1 switched (interlocked) socket, transparent window, 5 DIN modules, IP66', 'P579741', '122x395mm. 22W. Padlockable modular door.', '{"provides":{"switched":1,"din":5}}'::jsonb, 100080),
  ('Enclosures', 'topTER distribution board for 2 switched (interlocked) sockets, transparent window, 10 DIN modules, IP66', 'P579742', '239x456mm. 40W. Padlockable modular door.', '{"provides":{"switched":2,"din":10}}'::jsonb, 100090),
  ('Enclosures', 'topTER distribution board for 3 switched (interlocked) sockets, transparent window, 16 DIN modules, IP66', 'P579743', '350x456mm. 56W. Padlockable modular door.', '{"provides":{"switched":3,"din":16}}'::jsonb, 100100),
  ('Enclosures', 'topTER distribution board for 4 switched (interlocked) sockets, transparent window, 22 DIN modules, IP66', 'P579744', '461x456mm. 70W. Padlockable modular door.', '{"provides":{"switched":4,"din":22}}'::jsonb, 100110),
  ('Enclosures', 'topTER distribution board for 1 switched (interlocked) socket, blind cover, IP66', 'P579721', '122x395mm. 22W. Add a window cover with DIN rail (P579451 / P579452 / P579453) for modular devices.', '{"provides":{"switched":1}}'::jsonb, 100120),
  ('Enclosures', 'topTER distribution board for 2 switched (interlocked) sockets, blind cover, IP66', 'P579722', '250x395mm. 40W. Add a window cover with DIN rail (P579451 / P579452 / P579453) for modular devices.', '{"provides":{"switched":2}}'::jsonb, 100130),
  ('Enclosures', 'topTER distribution board for 3 switched (interlocked) sockets, blind cover, IP66', 'P579723', '380x395mm. 56W. Add a window cover with DIN rail (P579451 / P579452 / P579453) for modular devices.', '{"provides":{"switched":3}}'::jsonb, 100140),
  ('Enclosures', 'Cover with transparent window and DIN rail, 5 DIN modules, IP65 (for board P579721)', 'P579451', 'For topTER distribution boards with blind cover. Padlockable modular door.', '{"provides":{"din":5}}'::jsonb, 100150),
  ('Enclosures', 'Cover with transparent window and DIN rail, 12 DIN modules, IP55 (for board P579722)', 'P579452', 'For topTER distribution boards with blind cover. Padlockable modular door.', '{"provides":{"din":12}}'::jsonb, 100160),
  ('Enclosures', 'Cover with transparent window and DIN rail, 18 DIN modules, IP55 (for board P579723)', 'P579453', 'For topTER distribution boards with blind cover. Padlockable modular door.', '{"provides":{"din":18}}'::jsonb, 100170),
  ('Enclosures', 'Distribution board for 1 switched socket (63A series), blind cover, IP65', 'P579421', '122x452mm. 22W. Seats are 115x290: take 63A interlocked sockets, or flanges/adapters for 16A-32A.', '{"provides":{"seat115":1}}'::jsonb, 100180),
  ('Enclosures', 'Distribution board for 2 switched sockets (63A series), blind cover, IP55', 'P579422', '250x452mm. 40W. Seats are 115x290: take 63A interlocked sockets, or flanges/adapters for 16A-32A.', '{"provides":{"seat115":2}}'::jsonb, 100190),
  ('Enclosures', 'Distribution board for 3 switched sockets (63A series), blind cover, IP55', 'P579423', '380x452mm. 56W. Seats are 115x290: take 63A interlocked sockets, or flanges/adapters for 16A-32A.', '{"provides":{"seat115":3}}'::jsonb, 100200),
  ('Enclosures', 'Distribution board for 1 switched socket (63A series), transparent window, 5 DIN modules, IP65', 'P579631', '122x452mm. 22W. Seats are 115x290. Padlockable modular door.', '{"provides":{"seat115":1,"din":5}}'::jsonb, 100210),
  ('Enclosures', 'Distribution board for 2 switched sockets (63A series), transparent window, 12 DIN modules, IP55', 'P579622', '250x452mm. 40W. Seats are 115x290. Padlockable modular door.', '{"provides":{"seat115":2,"din":12}}'::jsonb, 100220),
  ('Enclosures', 'Distribution board for 3 switched sockets (63A series), transparent window, 18 DIN modules, IP55', 'P579623', '380x452mm. 56W. Seats are 115x290. Padlockable modular door.', '{"provides":{"seat115":3,"din":18}}'::jsonb, 100230),
  ('Enclosures', 'topTER back box, wall-mounting, for 1 socket on a 65x83 flange, M25, IP66/IP67', 'P579750', '84x100mm. Cable gland included.', '{"provides":{"sockets":1,"f65":1}}'::jsonb, 100240),
  ('Enclosures', 'topTER back box, wall-mounting, for 1 socket on an 88x100 flange, M25, IP66/IP67', 'P579751', '106x128mm. Cable gland included.', '{"provides":{"sockets":1,"f88":1}}'::jsonb, 100250),
  ('Enclosures', 'topTER back box, wall-mounting, for 2 devices, IP55', 'P579702', '103x206mm. Max 2 on 65x83 flanges, max 1 on 88x100.', '{"provides":{"sockets":2,"f65":2,"f88":1}}'::jsonb, 100260),
  ('Enclosures', 'topTER back box, wall-mounting, for 3 devices, IP55', 'P579703', '116x291mm. Max 3 on 65x83 flanges, max 1 on 88x100.', '{"provides":{"sockets":3,"f65":3,"f88":1}}'::jsonb, 100270),
  ('Enclosures', 'Wall-mounted bottom box for topTER with lock switch, IP66/IP67', 'P579710', '108x260mm.', '{"provides":{"switched":1}}'::jsonb, 100280),
  ('Enclosures', 'Flush-mounted bottom box for topTER with lock switch, IP55', 'P579712', '131x258mm.', '{"provides":{"switched":1}}'::jsonb, 100290),
  ('Enclosures', 'Bottom box for panel flush-mounting, topTER with lock switch, IP66/IP67', 'P579711', '115x270mm. For steel sheet or insulating panels.', '{"provides":{"switched":1}}'::jsonb, 100300),
  ('Enclosures', 'Wall-mounted bottom box for 1 63A interlocked socket, IP55', 'P579400', '115x290mm.', '{"provides":{"seat115":1}}'::jsonb, 100310),
  ('Enclosures', 'Bottom box for panel flush-mounting, 1 63A socket (with or without fuse base), IP55', 'P575502', '150x300mm.', '{"provides":{"seat115":1}}'::jsonb, 100320),
  ('Enclosures', 'Wall-mounted control unit for modular devices, 5 DIN modules, padlockable door, IP65', 'P579708', '122x158mm. 20W.', '{"provides":{"din":5}}'::jsonb, 100330),
  ('Enclosures', 'Wall-mounted control unit for modular devices, 12 DIN modules, padlockable door, IP55', 'P579709', '250x158mm. 40W.', '{"provides":{"din":12}}'::jsonb, 100340),
  ('Enclosures', 'Control unit for panel-mounting, 12 DIN modules, IP56', 'P575506', '284x172mm. 40W.', '{"provides":{"din":12}}'::jsonb, 100350),
  ('Enclosures', 'Box with cover for flush-mounting, IP56', 'P575505', '284x172mm outer, 236x145x76mm inner.', null::jsonb, 100360),
  ('Fixed sockets', 'topTER fixed socket 16A 110V 2P+E 4h, IP44, flange 65x83', 'P488124', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f65":1}}'::jsonb, 200010),
  ('Fixed sockets', 'topTER fixed socket 16A 110V 3P+E 4h, IP44, flange 65x83', 'P488134', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f65":1}}'::jsonb, 200020),
  ('Fixed sockets', 'topTER fixed socket 16A 110V 3P+N+E 4h, IP44, flange 88x100', 'P488144', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200030),
  ('Fixed sockets', 'topTER fixed socket 16A 230V 2P+E 6h, IP44, flange 65x83', 'P488126', '15° angled, flush-mounted on a board or back box. Palazzoli pack of 10.', '{"uses":{"sockets":1,"f65":1}}'::jsonb, 200040),
  ('Fixed sockets', 'topTER fixed socket 16A 230V 3P+E 9h, IP44, flange 65x83', 'P488139', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f65":1}}'::jsonb, 200050),
  ('Fixed sockets', 'topTER fixed socket 16A 230V 3P+N+E 9h, IP44, flange 88x100', 'P488149', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200060),
  ('Fixed sockets', 'topTER fixed socket 16A 400V 2P+E 9h, IP44, flange 65x83', 'P488129', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f65":1}}'::jsonb, 200070),
  ('Fixed sockets', 'topTER fixed socket 16A 400V 3P+E 6h, IP44, flange 65x83', 'P488136', '15° angled, flush-mounted on a board or back box. Palazzoli pack of 10.', '{"uses":{"sockets":1,"f65":1}}'::jsonb, 200080),
  ('Fixed sockets', 'topTER fixed socket 16A 400V 3P+N+E 6h, IP44, flange 88x100', 'P488146', '15° angled, flush-mounted on a board or back box. Palazzoli pack of 10.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200090),
  ('Fixed sockets', 'topTER fixed socket 32A 110V 2P+E 4h, IP44, flange 88x100', 'P488224', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200100),
  ('Fixed sockets', 'topTER fixed socket 32A 110V 3P+E 4h, IP44, flange 88x100', 'P488234', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200110),
  ('Fixed sockets', 'topTER fixed socket 32A 110V 3P+N+E 4h, IP44, flange 88x100', 'P488244', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200120),
  ('Fixed sockets', 'topTER fixed socket 32A 230V 2P+E 6h, IP44, flange 88x100', 'P488226', '15° angled, flush-mounted on a board or back box. Palazzoli pack of 5.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200130),
  ('Fixed sockets', 'topTER fixed socket 32A 230V 3P+E 9h, IP44, flange 88x100', 'P488239', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200140),
  ('Fixed sockets', 'topTER fixed socket 32A 230V 3P+N+E 9h, IP44, flange 88x100', 'P488249', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200150),
  ('Fixed sockets', 'topTER fixed socket 32A 400V 2P+E 9h, IP44, flange 88x100', 'P488229', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200160),
  ('Fixed sockets', 'topTER fixed socket 32A 400V 3P+E 6h, IP44, flange 88x100', 'P488236', '15° angled, flush-mounted on a board or back box. Palazzoli pack of 5.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200170),
  ('Fixed sockets', 'topTER fixed socket 32A 400V 3P+N+E 6h, IP44, flange 88x100', 'P488246', '15° angled, flush-mounted on a board or back box. Palazzoli pack of 5.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200180),
  ('Fixed sockets', 'topTER fixed socket 16A 110V 2P+E 4h, IP66/IP67, flange 65x83', 'P489124', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f65":1}}'::jsonb, 200190),
  ('Fixed sockets', 'topTER fixed socket 16A 110V 3P+E 4h, IP66/IP67, flange 65x83', 'P489134', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f65":1}}'::jsonb, 200200),
  ('Fixed sockets', 'topTER fixed socket 16A 110V 3P+N+E 4h, IP66/IP67, flange 88x100', 'P489144', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200210),
  ('Fixed sockets', 'topTER fixed socket 16A 230V 2P+E 6h, IP66/IP67, flange 65x83', 'P489126', '15° angled, flush-mounted on a board or back box. Palazzoli pack of 10.', '{"uses":{"sockets":1,"f65":1}}'::jsonb, 200220),
  ('Fixed sockets', 'topTER fixed socket 16A 230V 3P+E 9h, IP66/IP67, flange 65x83', 'P489139', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f65":1}}'::jsonb, 200230),
  ('Fixed sockets', 'topTER fixed socket 16A 230V 3P+N+E 9h, IP66/IP67, flange 88x100', 'P489149', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200240),
  ('Fixed sockets', 'topTER fixed socket 16A 400V 2P+E 9h, IP66/IP67, flange 65x83', 'P489129', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f65":1}}'::jsonb, 200250),
  ('Fixed sockets', 'topTER fixed socket 16A 400V 3P+E 6h, IP66/IP67, flange 65x83', 'P489136', '15° angled, flush-mounted on a board or back box. Palazzoli pack of 10.', '{"uses":{"sockets":1,"f65":1}}'::jsonb, 200260),
  ('Fixed sockets', 'topTER fixed socket 16A 400V 3P+N+E 6h, IP66/IP67, flange 88x100', 'P489146', '15° angled, flush-mounted on a board or back box. Palazzoli pack of 10.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200270),
  ('Fixed sockets', 'topTER fixed socket 32A 110V 2P+E 4h, IP66/IP67, flange 88x100', 'P489224', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200280),
  ('Fixed sockets', 'topTER fixed socket 32A 110V 3P+E 4h, IP66/IP67, flange 88x100', 'P489234', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200290),
  ('Fixed sockets', 'topTER fixed socket 32A 110V 3P+N+E 4h, IP66/IP67, flange 88x100', 'P489244', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200300),
  ('Fixed sockets', 'topTER fixed socket 32A 230V 2P+E 6h, IP66/IP67, flange 88x100', 'P489226', '15° angled, flush-mounted on a board or back box. Palazzoli pack of 5.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200310),
  ('Fixed sockets', 'topTER fixed socket 32A 230V 3P+E 9h, IP66/IP67, flange 88x100', 'P489239', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200320),
  ('Fixed sockets', 'topTER fixed socket 32A 230V 3P+N+E 9h, IP66/IP67, flange 88x100', 'P489249', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200330),
  ('Fixed sockets', 'topTER fixed socket 32A 400V 2P+E 9h, IP66/IP67, flange 88x100', 'P489229', '15° angled, flush-mounted on a board or back box.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200340),
  ('Fixed sockets', 'topTER fixed socket 32A 400V 3P+E 6h, IP66/IP67, flange 88x100', 'P489236', '15° angled, flush-mounted on a board or back box. Palazzoli pack of 5.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200350),
  ('Fixed sockets', 'topTER fixed socket 32A 400V 3P+N+E 6h, IP66/IP67, flange 88x100', 'P489246', '15° angled, flush-mounted on a board or back box. Palazzoli pack of 5.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200360),
  ('Fixed sockets', 'topTER fixed socket 32A 380/440V 3P+E 3h, IP66/IP67, flange 88x100', 'P489233', '15° angled, flush-mounted. Reefer container socket.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 200370),
  ('Fixed sockets', 'topTER fixed socket 63A 230V 2P+E 6h, IP66/IP67, flange 100x100', 'P489326', '15° angled, flush-mounted. Palazzoli pack of 2.', '{"uses":{"sockets":1,"f100":1}}'::jsonb, 200380),
  ('Fixed sockets', 'topTER fixed socket 63A 400V 3P+E 6h, IP66/IP67, flange 100x100', 'P489336', '15° angled, flush-mounted. Palazzoli pack of 2.', '{"uses":{"sockets":1,"f100":1}}'::jsonb, 200390),
  ('Fixed sockets', 'topTER fixed socket 63A 400V 3P+N+E 6h, IP66/IP67, flange 100x100', 'P489346', '15° angled, flush-mounted. Palazzoli pack of 2.', '{"uses":{"sockets":1,"f100":1}}'::jsonb, 200400),
  ('Fixed sockets', 'topTER compact panel socket 16A 110V 2P+E 4h, IP44, mini flange 60x60', 'P488114', '15° angled. Palazzoli pack of 10.', null::jsonb, 200410),
  ('Fixed sockets', 'topTER compact panel socket 16A 230V 2P+E 6h, IP44, mini flange 60x60', 'P488116', '15° angled. Palazzoli pack of 10.', null::jsonb, 200420),
  ('Fixed sockets', 'topTER wall-mounted socket 16A 110V 2P+E 4h, 15° angled, IP44', 'P438124', 'Stand-alone wall socket. M25 entry, stepped gland.', null::jsonb, 200430),
  ('Fixed sockets', 'topTER wall-mounted socket 16A 230V 2P+E 6h, 15° angled, IP44', 'P438126', 'Stand-alone wall socket. M25 entry, stepped gland.', null::jsonb, 200440),
  ('Fixed sockets', 'topTER wall-mounted socket 16A 400V 3P+E 6h, 15° angled, IP44', 'P438136', 'Stand-alone wall socket. M25 entry, stepped gland.', null::jsonb, 200450),
  ('Fixed sockets', 'topTER wall-mounted socket 16A 400V 3P+N+E 6h, 15° angled, IP44', 'P438146', 'Stand-alone wall socket. M25 entry, stepped gland.', null::jsonb, 200460),
  ('Fixed sockets', 'topTER wall-mounted socket 32A 110V 2P+E 4h, 15° angled, IP44', 'P438224', 'Stand-alone wall socket. M25 entry, stepped gland.', null::jsonb, 200470),
  ('Fixed sockets', 'topTER wall-mounted socket 32A 230V 2P+E 6h, 15° angled, IP44', 'P438226', 'Stand-alone wall socket. M25 entry, stepped gland.', null::jsonb, 200480),
  ('Fixed sockets', 'topTER wall-mounted socket 32A 400V 3P+E 6h, 15° angled, IP44', 'P438236', 'Stand-alone wall socket. M25 entry, stepped gland.', null::jsonb, 200490),
  ('Fixed sockets', 'topTER wall-mounted socket 32A 400V 3P+N+E 6h, 15° angled, IP44', 'P438246', 'Stand-alone wall socket. M25 entry, stepped gland.', null::jsonb, 200500),
  ('Fixed sockets', 'topTER wall-mounted socket 16A 110V 2P+E 4h, 90° angled, IP44', 'P508124', 'Stand-alone wall socket. M25 entry (M20 on 508124/508126), stepped gland.', null::jsonb, 200510),
  ('Fixed sockets', 'topTER wall-mounted socket 16A 230V 2P+E 6h, 90° angled, IP44', 'P508126', 'Stand-alone wall socket. M25 entry (M20 on 508124/508126), stepped gland.', null::jsonb, 200520),
  ('Fixed sockets', 'topTER wall-mounted socket 16A 400V 3P+E 6h, 90° angled, IP44', 'P508136', 'Stand-alone wall socket. M25 entry (M20 on 508124/508126), stepped gland.', null::jsonb, 200530),
  ('Fixed sockets', 'topTER wall-mounted socket 16A 400V 3P+N+E 6h, 90° angled, IP44', 'P508146', 'Stand-alone wall socket. M25 entry (M20 on 508124/508126), stepped gland.', null::jsonb, 200540),
  ('Fixed sockets', 'topTER wall-mounted socket 32A 110V 2P+E 4h, 90° angled, IP44', 'P508224', 'Stand-alone wall socket. M25 entry (M20 on 508124/508126), stepped gland.', null::jsonb, 200550),
  ('Fixed sockets', 'topTER wall-mounted socket 32A 230V 2P+E 6h, 90° angled, IP44', 'P508226', 'Stand-alone wall socket. M25 entry (M20 on 508124/508126), stepped gland.', null::jsonb, 200560),
  ('Fixed sockets', 'topTER wall-mounted socket 32A 400V 3P+E 6h, 90° angled, IP44', 'P508236', 'Stand-alone wall socket. M25 entry (M20 on 508124/508126), stepped gland.', null::jsonb, 200570),
  ('Fixed sockets', 'topTER wall-mounted socket 32A 400V 3P+N+E 6h, 90° angled, IP44', 'P508246', 'Stand-alone wall socket. M25 entry (M20 on 508124/508126), stepped gland.', null::jsonb, 200580),
  ('Fixed sockets', 'topTER wall-mounted socket 16A 110V 2P+E 4h, 15° angled, IP66/IP67', 'P439124', 'Stand-alone wall socket. M25 entry, cable gland.', null::jsonb, 200590),
  ('Fixed sockets', 'topTER wall-mounted socket 16A 230V 2P+E 6h, 15° angled, IP66/IP67', 'P439126', 'Stand-alone wall socket. M25 entry, cable gland.', null::jsonb, 200600),
  ('Fixed sockets', 'topTER wall-mounted socket 16A 400V 3P+E 6h, 15° angled, IP66/IP67', 'P439136', 'Stand-alone wall socket. M25 entry, cable gland.', null::jsonb, 200610),
  ('Fixed sockets', 'topTER wall-mounted socket 16A 400V 3P+N+E 6h, 15° angled, IP66/IP67', 'P439146', 'Stand-alone wall socket. M25 entry, cable gland.', null::jsonb, 200620),
  ('Fixed sockets', 'topTER wall-mounted socket 32A 110V 2P+E 4h, 15° angled, IP66/IP67', 'P439224', 'Stand-alone wall socket. M25 entry, cable gland.', null::jsonb, 200630),
  ('Fixed sockets', 'topTER wall-mounted socket 32A 230V 2P+E 6h, 15° angled, IP66/IP67', 'P439226', 'Stand-alone wall socket. M25 entry, cable gland.', null::jsonb, 200640),
  ('Fixed sockets', 'topTER wall-mounted socket 32A 400V 3P+E 6h, 15° angled, IP66/IP67', 'P439236', 'Stand-alone wall socket. M25 entry, cable gland.', null::jsonb, 200650),
  ('Fixed sockets', 'topTER wall-mounted socket 32A 400V 3P+N+E 6h, 15° angled, IP66/IP67', 'P439246', 'Stand-alone wall socket. M25 entry, cable gland.', null::jsonb, 200660),
  ('Fixed sockets', 'topTER wall-mounted socket 32A 380/440V 3P+E 3h, 15° angled, IP66/IP67', 'P439233', 'Stand-alone wall socket. M25 entry, cable gland.', null::jsonb, 200670),
  ('Fixed sockets', 'topTER wall-mounted socket 16A 110V 2P+E 4h, 90° angled, IP67', 'P509124', 'Stand-alone wall socket. M25 entry, cable gland.', null::jsonb, 200680),
  ('Fixed sockets', 'topTER wall-mounted socket 16A 230V 2P+E 6h, 90° angled, IP67', 'P509126', 'Stand-alone wall socket. M25 entry, cable gland.', null::jsonb, 200690),
  ('Fixed sockets', 'topTER wall-mounted socket 16A 400V 3P+E 6h, 90° angled, IP67', 'P509136', 'Stand-alone wall socket. M25 entry, cable gland.', null::jsonb, 200700),
  ('Fixed sockets', 'topTER wall-mounted socket 16A 400V 3P+N+E 6h, 90° angled, IP67', 'P509146', 'Stand-alone wall socket. M25 entry, cable gland.', null::jsonb, 200710),
  ('Fixed sockets', 'topTER wall-mounted socket 32A 110V 2P+E 4h, 90° angled, IP67', 'P509224', 'Stand-alone wall socket. M25 entry, cable gland.', null::jsonb, 200720),
  ('Fixed sockets', 'topTER wall-mounted socket 32A 230V 2P+E 6h, 90° angled, IP67', 'P509226', 'Stand-alone wall socket. M25 entry, cable gland.', null::jsonb, 200730),
  ('Fixed sockets', 'topTER wall-mounted socket 32A 400V 3P+E 6h, 90° angled, IP67', 'P509236', 'Stand-alone wall socket. M25 entry, cable gland.', null::jsonb, 200740),
  ('Fixed sockets', 'topTER wall-mounted socket 32A 400V 3P+N+E 6h, 90° angled, IP67', 'P509246', 'Stand-alone wall socket. M25 entry, cable gland.', null::jsonb, 200750),
  ('Fixed sockets', 'topTER wall-mounted socket 32A 380/440V 3P+E 3h, 90° angled, IP67', 'P509233', 'Stand-alone wall socket. M25 entry, cable gland.', null::jsonb, 200760),
  ('Fixed sockets', 'topTER wall-mounted socket 63A 230V 2P+E 6h, 90° angled, IP67', 'P509326', 'Stand-alone wall socket. M40 entry plus 2x M32 bottom entries, cable gland.', null::jsonb, 200770),
  ('Fixed sockets', 'topTER wall-mounted socket 63A 400V 3P+E 6h, 90° angled, IP67', 'P509336', 'Stand-alone wall socket. M40 entry plus 2x M32 bottom entries, cable gland.', null::jsonb, 200780),
  ('Fixed sockets', 'topTER wall-mounted socket 63A 400V 3P+N+E 6h, 90° angled, IP67', 'P509346', 'Stand-alone wall socket. M40 entry plus 2x M32 bottom entries, cable gland.', null::jsonb, 200790),
  ('Interlocked sockets', 'topTER interlocked socket 16A 110V 2P+E 4h, IP44', 'P492124', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300010),
  ('Interlocked sockets', 'topTER interlocked socket 16A 230V 2P+E 6h, IP44', 'P492126', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300020),
  ('Interlocked sockets', 'topTER interlocked socket 16A 400V 3P+E 6h, IP44', 'P492136', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300030),
  ('Interlocked sockets', 'topTER interlocked socket 16A 400V 3P+N+E 6h, IP44', 'P492146', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300040),
  ('Interlocked sockets', 'topTER interlocked socket 32A 230V 2P+E 6h, IP44', 'P492226', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300050),
  ('Interlocked sockets', 'topTER interlocked socket 32A 400V 3P+E 6h, IP44', 'P492236', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300060),
  ('Interlocked sockets', 'topTER interlocked socket 32A 400V 3P+N+E 6h, IP44', 'P492246', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300070),
  ('Interlocked sockets', 'topTER interlocked socket 16A 110V 2P+E 4h, IP44, with fuse holder base', 'P190124', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300080),
  ('Interlocked sockets', 'topTER interlocked socket 16A 230V 2P+E 6h, IP44, with fuse holder base', 'P190126', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300090),
  ('Interlocked sockets', 'topTER interlocked socket 16A 400V 3P+E 6h, IP44, with fuse holder base', 'P190136', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300100),
  ('Interlocked sockets', 'topTER interlocked socket 16A 400V 3P+N+E 6h, IP44, with fuse holder base', 'P190146', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300110),
  ('Interlocked sockets', 'topTER interlocked socket 32A 230V 2P+E 6h, IP44, with fuse holder base', 'P190226', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300120),
  ('Interlocked sockets', 'topTER interlocked socket 32A 400V 3P+E 6h, IP44, with fuse holder base', 'P190236', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300130),
  ('Interlocked sockets', 'topTER interlocked socket 32A 400V 3P+N+E 6h, IP44, with fuse holder base', 'P190246', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300140),
  ('Interlocked sockets', 'topTER interlocked socket 16A 110V 2P+E 4h, IP66/IP67', 'P491124', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300150),
  ('Interlocked sockets', 'topTER interlocked socket 16A 110V 3P+E 4h, IP66/IP67', 'P491134', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300160),
  ('Interlocked sockets', 'topTER interlocked socket 16A 110V 3P+N+E 4h, IP66/IP67', 'P491144', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300170),
  ('Interlocked sockets', 'topTER interlocked socket 16A 230V 2P+E 6h, IP66/IP67', 'P491126', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300180),
  ('Interlocked sockets', 'topTER interlocked socket 16A 230V 3P+E 9h, IP66/IP67', 'P491139', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300190),
  ('Interlocked sockets', 'topTER interlocked socket 16A 230V 3P+N+E 9h, IP66/IP67', 'P491149', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300200),
  ('Interlocked sockets', 'topTER interlocked socket 16A 400V 2P+E 9h, IP66/IP67', 'P491129', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300210),
  ('Interlocked sockets', 'topTER interlocked socket 16A 400V 3P+E 6h, IP66/IP67', 'P491136', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300220),
  ('Interlocked sockets', 'topTER interlocked socket 16A 400V 3P+N+E 6h, IP66/IP67', 'P491146', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300230),
  ('Interlocked sockets', 'topTER interlocked socket 32A 110V 2P+E 4h, IP66/IP67', 'P491224', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300240),
  ('Interlocked sockets', 'topTER interlocked socket 32A 110V 3P+E 4h, IP66/IP67', 'P491234', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300250),
  ('Interlocked sockets', 'topTER interlocked socket 32A 110V 3P+N+E 4h, IP66/IP67', 'P491244', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300260),
  ('Interlocked sockets', 'topTER interlocked socket 32A 230V 2P+E 6h, IP66/IP67', 'P491226', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300270),
  ('Interlocked sockets', 'topTER interlocked socket 32A 230V 3P+E 9h, IP66/IP67', 'P491239', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300280),
  ('Interlocked sockets', 'topTER interlocked socket 32A 230V 3P+N+E 9h, IP66/IP67', 'P491249', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300290),
  ('Interlocked sockets', 'topTER interlocked socket 32A 400V 2P+E 9h, IP66/IP67', 'P491229', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300300),
  ('Interlocked sockets', 'topTER interlocked socket 32A 400V 3P+E 6h, IP66/IP67', 'P491236', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300310),
  ('Interlocked sockets', 'topTER interlocked socket 32A 400V 3P+N+E 6h, IP66/IP67', 'P491246', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts.', '{"uses":{"switched":1}}'::jsonb, 300320),
  ('Interlocked sockets', 'topTER interlocked socket 32A 380/440V 3P+E 3h, IP66/IP67', 'P491233', 'For distribution boards. Reefer container socket.', '{"uses":{"switched":1}}'::jsonb, 300330),
  ('Interlocked sockets', 'topTER interlocked socket 16A 110V 2P+E 4h, IP66/IP67, with fuse holder base', 'P490124', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300340),
  ('Interlocked sockets', 'topTER interlocked socket 16A 110V 3P+E 4h, IP66/IP67, with fuse holder base', 'P490134', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300350),
  ('Interlocked sockets', 'topTER interlocked socket 16A 110V 3P+N+E 4h, IP66/IP67, with fuse holder base', 'P490144', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300360),
  ('Interlocked sockets', 'topTER interlocked socket 16A 230V 2P+E 6h, IP66/IP67, with fuse holder base', 'P490126', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300370),
  ('Interlocked sockets', 'topTER interlocked socket 16A 230V 3P+E 9h, IP66/IP67, with fuse holder base', 'P490139', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300380),
  ('Interlocked sockets', 'topTER interlocked socket 16A 230V 3P+N+E 9h, IP66/IP67, with fuse holder base', 'P490149', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300390),
  ('Interlocked sockets', 'topTER interlocked socket 16A 400V 2P+E 9h, IP66/IP67, with fuse holder base', 'P490129', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300400),
  ('Interlocked sockets', 'topTER interlocked socket 16A 400V 3P+E 6h, IP66/IP67, with fuse holder base', 'P490136', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300410),
  ('Interlocked sockets', 'topTER interlocked socket 16A 400V 3P+N+E 6h, IP66/IP67, with fuse holder base', 'P490146', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300420),
  ('Interlocked sockets', 'topTER interlocked socket 32A 110V 2P+E 4h, IP66/IP67, with fuse holder base', 'P490224', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300430),
  ('Interlocked sockets', 'topTER interlocked socket 32A 110V 3P+E 4h, IP66/IP67, with fuse holder base', 'P490234', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300440),
  ('Interlocked sockets', 'topTER interlocked socket 32A 110V 3P+N+E 4h, IP66/IP67, with fuse holder base', 'P490244', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300450),
  ('Interlocked sockets', 'topTER interlocked socket 32A 230V 2P+E 6h, IP66/IP67, with fuse holder base', 'P490226', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300460),
  ('Interlocked sockets', 'topTER interlocked socket 32A 230V 3P+E 9h, IP66/IP67, with fuse holder base', 'P490239', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300470),
  ('Interlocked sockets', 'topTER interlocked socket 32A 230V 3P+N+E 9h, IP66/IP67, with fuse holder base', 'P490249', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300480),
  ('Interlocked sockets', 'topTER interlocked socket 32A 400V 2P+E 9h, IP66/IP67, with fuse holder base', 'P490229', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300490),
  ('Interlocked sockets', 'topTER interlocked socket 32A 400V 3P+E 6h, IP66/IP67, with fuse holder base', 'P490236', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300500),
  ('Interlocked sockets', 'topTER interlocked socket 32A 400V 3P+N+E 6h, IP66/IP67, with fuse holder base', 'P490246', 'For distribution boards. Padlockable handle, takes 2 auxiliary contacts. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300510),
  ('Interlocked sockets', 'topTER interlocked socket 32A 380/440V 3P+E 3h, IP66/IP67, with fuse holder base', 'P490233', 'For distribution boards. Reefer container socket. 10.3x38 fuses, not included.', '{"uses":{"switched":1}}'::jsonb, 300520),
  ('Interlocked sockets', 'topTER socket with safety transformer (SELV) 16A 230/24V 2P, 150VA, IP66/IP67', 'P490024', 'For distribution boards. Transformer with thermal protection.', '{"uses":{"switched":1}}'::jsonb, 300530),
  ('Interlocked sockets', 'topTER interlocked socket 63A 110V 2P+E 4h, IP65', 'P481324', 'For 63A series distribution boards (115x290 seat). Padlockable handle.', '{"uses":{"seat115":1}}'::jsonb, 300540),
  ('Interlocked sockets', 'topTER interlocked socket 63A 110V 3P+E 4h, IP65', 'P481334', 'For 63A series distribution boards (115x290 seat). Padlockable handle.', '{"uses":{"seat115":1}}'::jsonb, 300550),
  ('Interlocked sockets', 'topTER interlocked socket 63A 110V 3P+N+E 4h, IP65', 'P481344', 'For 63A series distribution boards (115x290 seat). Padlockable handle.', '{"uses":{"seat115":1}}'::jsonb, 300560),
  ('Interlocked sockets', 'topTER interlocked socket 63A 230V 2P+E 6h, IP65', 'P481326', 'For 63A series distribution boards (115x290 seat). Padlockable handle.', '{"uses":{"seat115":1}}'::jsonb, 300570),
  ('Interlocked sockets', 'topTER interlocked socket 63A 230V 3P+E 9h, IP65', 'P481339', 'For 63A series distribution boards (115x290 seat). Padlockable handle.', '{"uses":{"seat115":1}}'::jsonb, 300580),
  ('Interlocked sockets', 'topTER interlocked socket 63A 230V 3P+N+E 9h, IP65', 'P481349', 'For 63A series distribution boards (115x290 seat). Padlockable handle.', '{"uses":{"seat115":1}}'::jsonb, 300590),
  ('Interlocked sockets', 'topTER interlocked socket 63A 400V 2P+E 9h, IP65', 'P481329', 'For 63A series distribution boards (115x290 seat). Padlockable handle.', '{"uses":{"seat115":1}}'::jsonb, 300600),
  ('Interlocked sockets', 'topTER interlocked socket 63A 400V 3P+E 6h, IP65', 'P481336', 'For 63A series distribution boards (115x290 seat). Padlockable handle.', '{"uses":{"seat115":1}}'::jsonb, 300610),
  ('Interlocked sockets', 'topTER interlocked socket 63A 400V 3P+N+E 6h, IP65', 'P481346', 'For 63A series distribution boards (115x290 seat). Padlockable handle.', '{"uses":{"seat115":1}}'::jsonb, 300620),
  ('Interlocked sockets', 'topTER interlocked socket 63A 110V 2P+E 4h, IP65, with fuse holder base', 'P480324', 'For 63A series distribution boards (115x290 seat). Padlockable handle. D02 fuses, not included.', '{"uses":{"seat115":1}}'::jsonb, 300630),
  ('Interlocked sockets', 'topTER interlocked socket 63A 110V 3P+E 4h, IP65, with fuse holder base', 'P480334', 'For 63A series distribution boards (115x290 seat). Padlockable handle. D02 fuses, not included.', '{"uses":{"seat115":1}}'::jsonb, 300640),
  ('Interlocked sockets', 'topTER interlocked socket 63A 110V 3P+N+E 4h, IP65, with fuse holder base', 'P480344', 'For 63A series distribution boards (115x290 seat). Padlockable handle. D02 fuses, not included.', '{"uses":{"seat115":1}}'::jsonb, 300650),
  ('Interlocked sockets', 'topTER interlocked socket 63A 230V 2P+E 6h, IP65, with fuse holder base', 'P480326', 'For 63A series distribution boards (115x290 seat). Padlockable handle. D02 fuses, not included.', '{"uses":{"seat115":1}}'::jsonb, 300660),
  ('Interlocked sockets', 'topTER interlocked socket 63A 230V 3P+E 9h, IP65, with fuse holder base', 'P480339', 'For 63A series distribution boards (115x290 seat). Padlockable handle. D02 fuses, not included.', '{"uses":{"seat115":1}}'::jsonb, 300670),
  ('Interlocked sockets', 'topTER interlocked socket 63A 230V 3P+N+E 9h, IP65, with fuse holder base', 'P480349', 'For 63A series distribution boards (115x290 seat). Padlockable handle. D02 fuses, not included.', '{"uses":{"seat115":1}}'::jsonb, 300680),
  ('Interlocked sockets', 'topTER interlocked socket 63A 400V 2P+E 9h, IP65, with fuse holder base', 'P480329', 'For 63A series distribution boards (115x290 seat). Padlockable handle. D02 fuses, not included.', '{"uses":{"seat115":1}}'::jsonb, 300690),
  ('Interlocked sockets', 'topTER interlocked socket 63A 400V 3P+E 6h, IP65, with fuse holder base', 'P480336', 'For 63A series distribution boards (115x290 seat). Padlockable handle. D02 fuses, not included.', '{"uses":{"seat115":1}}'::jsonb, 300700),
  ('Interlocked sockets', 'topTER interlocked socket 63A 400V 3P+N+E 6h, IP65, with fuse holder base', 'P480346', 'For 63A series distribution boards (115x290 seat). Padlockable handle. D02 fuses, not included.', '{"uses":{"seat115":1}}'::jsonb, 300710),
  ('Domestic sockets', 'Schuko P17/P30 bivalent domestic socket with watertight cap, on 103x230 flange, IP66', 'P579715', 'Fits a switched-socket seat. 10/16A 230V.', '{"uses":{"switched":1}}'::jsonb, 400010),
  ('Domestic sockets', 'Schuko P17/P30 bivalent domestic socket with cap, on 65x83 flange, IP66', 'P579840', '10/16A 230V. Palazzoli pack of 5.', '{"uses":{"sockets":1,"f65":1}}'::jsonb, 400020),
  ('Domestic sockets', 'Universal cap for mounting domoTER domestic sockets, 65x83, 2 modules, IP66', 'P579847', 'Palazzoli pack of 10.', '{"uses":{"sockets":1,"f65":1}}'::jsonb, 400030),
  ('Domestic sockets', 'Watertight cap for plugged-in plug, domoTER domestic sockets, 65x83, 2 modules, IP66', 'P579860', 'Recommended cap for topTER distribution boards.', '{"uses":{"sockets":1,"f65":1}}'::jsonb, 400040),
  ('Domestic sockets', 'International domestic socket 16A 250V DIN49440 (Germany), 50x50, IP54', 'P579845', 'Mounts on flange P579848 or P579716. Palazzoli pack of 10.', '{"uses":{"int50":1}}'::jsonb, 400050),
  ('Domestic sockets', 'International domestic socket 16A 250V DIN49440 (Italy/Poland/Hungary), 50x50, IP54', 'P579830', 'Protected receptacles. Mounts on flange P579848 or P579716. Palazzoli pack of 10.', '{"uses":{"int50":1}}'::jsonb, 400060),
  ('Domestic sockets', 'International domestic socket 13A 250V BS1363 (UK), 50x50, IP54', 'P579831', 'Mounts on flange P579848 or P579716. Palazzoli pack of 10.', '{"uses":{"int50":1}}'::jsonb, 400070),
  ('Domestic sockets', 'International domestic socket 16A 250V CEE 7/V (BE/FR/CZ), 50x50, IP54', 'P579832', 'Mounts on flange P579848 or P579716. Palazzoli pack of 10.', '{"uses":{"int50":1}}'::jsonb, 400080),
  ('Flanges & covers', 'Flange for 1 international 50x50 domestic socket, 65x83, IP54', 'P579848', 'Screws included.', '{"provides":{"int50":1},"uses":{"sockets":1,"f65":1}}'::jsonb, 500010),
  ('Flanges & covers', 'Flange for 3 international 50x50 domestic sockets, 103x230, for switched-socket boards, IP65', 'P579716', 'Fits a switched-socket seat.', '{"provides":{"int50":3},"uses":{"switched":1}}'::jsonb, 500020),
  ('Flanges & covers', 'Flange for 1 extra low voltage CEE socket, 88x100, IP66/IP67', 'P579849', 'Screws included.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 500030),
  ('Flanges & covers', 'Flange for 2 fixed sockets or 2 caps, 103x230, for switched-socket boards, IP66/IP67', 'P579714', 'Fits a switched-socket seat. Max 2 on 65x83, max 1 on 88x100. Includes 1 blind 65x83 flange.', '{"provides":{"sockets":2,"f65":2,"f88":1},"uses":{"switched":1}}'::jsonb, 500040),
  ('Flanges & covers', 'Flange for 1 63A fixed socket, 103x230, for switched-socket boards, IP66/IP67', 'P579717', 'Fits a switched-socket seat. 100x100 socket flange.', '{"provides":{"sockets":1,"f100":1},"uses":{"switched":1}}'::jsonb, 500050),
  ('Flanges & covers', 'Closing flange for switched-socket boards, 103x230, IP66/IP67', 'P579713', 'Closes an unused switched-socket seat.', '{"uses":{"switched":1}}'::jsonb, 500060),
  ('Flanges & covers', 'Flange for 2 topTER fixed sockets or domoTER caps, 115x290, IP55', 'P579719', 'For 63A series boards (115x290 seat). Max 2 on 65x83 or 88x100 flanges.', '{"provides":{"sockets":2,"f65":2,"f88":2},"uses":{"seat115":1}}'::jsonb, 500070),
  ('Flanges & covers', 'Flange for 1 CEE 63A socket or fixed plug, 115x290, IP55', 'P579910', 'For 63A series boards (115x290 seat).', '{"provides":{"sockets":1,"f100":1},"uses":{"seat115":1}}'::jsonb, 500080),
  ('Flanges & covers', 'Adapter flange for 16A/32A topTER interlocked socket, 115x290, IP65', 'P579920', 'Fits a 16A or 32A interlocked socket into a 63A series board seat.', '{"provides":{"switched":1},"uses":{"seat115":1}}'::jsonb, 500090),
  ('Flanges & covers', 'Closing flange 115x290 (interlock with fuse holder base), IP55', 'P579902', 'Closes an unused 115x290 seat.', '{"uses":{"seat115":1}}'::jsonb, 500100),
  ('Flanges & covers', 'Closing flange for topTER boards, 65x83, IP66/IP67', 'P579843', 'Closes an unused socket seat.', '{"uses":{"sockets":1,"f65":1}}'::jsonb, 500110),
  ('Flanges & covers', 'Closing flange for topTER boards, 88x100, IP66/IP67', 'P579842', 'Closes an unused socket seat.', '{"uses":{"sockets":1,"f88":1}}'::jsonb, 500120),
  ('Flanges & covers', 'Aesthetic frame for topTER sockets, reduces an 88x100 hole to 65x83', 'P579846', 'Spare part.', null::jsonb, 500130),
  ('Accessories', 'DIN rail kit for topTER boards, 10 modules (P579742 / P579824)', 'P579852', 'Adjustable supports, 2 cable holders, screws. Lets DIN devices sit behind the socket compartments.', null::jsonb, 700010),
  ('Accessories', 'DIN rail kit for topTER boards, 16 modules (P579743 / P579826)', 'P579853', 'Adjustable supports, 2 cable holders, screws.', null::jsonb, 700020),
  ('Accessories', 'DIN rail kit for topTER boards, 22 modules (P579744 / P579828)', 'P579854', 'Adjustable supports, 2 cable holders, screws.', null::jsonb, 700030),
  ('Accessories', 'NO+NC auxiliary contact for plug-inserted signalling', 'P579850', 'For topTER fixed and interlocked sockets. Interlocked sockets take up to 2.', null::jsonb, 700040),
  ('Accessories', 'Equipotential earth bar, 4 holes, M5', 'P579013', 'For wire ends up to 25mm². For boards 239x456 and above.', null::jsonb, 700050),
  ('Accessories', 'Equipotential earth bar, 10 holes, M5', 'P579014', 'For wire ends up to 25mm². For boards 239x456 and above.', null::jsonb, 700060),
  ('Accessories', 'Transportation handles for distribution boards', 'P579011', null, null::jsonb, 700070),
  ('Accessories', 'Pair of stainless steel plates for wall mounting topTER / PRIMA boards', 'P579012', 'Palazzoli pack of 10.', null::jsonb, 700080),
  ('Accessories', 'Module covers, 2 DIN modules (blanks to IP40)', 'P579904', 'Palazzoli pack of 20.', null::jsonb, 700090),
  ('Accessories', 'Coupling fitting with Pg21 thread for topTER boards, IP66', 'P580250', 'Mounting hole 29mm, cable Ø21mm.', null::jsonb, 700100),
  ('Accessories', 'Universal support (floor stand) for topTER / PRIMA boards, width 239mm and above', 'P570010', null, null::jsonb, 700110),
  ('Circuit protection', 'Main switch 100A double pole (2 module), bi-directional', 'BGMS1002P', 'Lewden 6kA range. Terminals 35mm².', '{"uses":{"din":2}}'::jsonb, 600010),
  ('Circuit protection', 'Main switch 100A double pole, dual screw terminals (2 module)', 'BGMS1002DS', 'Lewden. AC22A.', '{"uses":{"din":2}}'::jsonb, 600020),
  ('Circuit protection', 'Main switch 100A 3 pole (10kA range)', 'BEMS-1003P', 'Lewden. AC22B, terminals 50mm². Module width assumed = poles.', '{"uses":{"din":3}}'::jsonb, 600030),
  ('Circuit protection', 'Main switch 100A 4 pole (10kA range)', 'BEMS-1004P', 'Lewden. AC22B, terminals 50mm². Module width assumed = poles.', '{"uses":{"din":4}}'::jsonb, 600040),
  ('Circuit protection', 'Main switch 125A 3 pole (10kA range)', 'BEMS-1253P', 'Lewden. AC22B, terminals 50mm². Module width assumed = poles.', '{"uses":{"din":3}}'::jsonb, 600050),
  ('Circuit protection', 'Main switch 125A 4 pole (10kA range)', 'BEMS-1254P', 'Lewden. AC22B, terminals 50mm². Module width assumed = poles.', '{"uses":{"din":4}}'::jsonb, 600060),
  ('Circuit protection', 'RCCB 25A 2 pole 30mA Type A', 'B25/30/2A', 'Lewden 6kA range. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 600070),
  ('Circuit protection', 'RCCB 40A 2 pole 30mA Type A', 'B40/30/2A', 'Lewden 6kA range. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 600080),
  ('Circuit protection', 'RCCB 63A 2 pole 30mA Type A', 'B63/30/2A', 'Lewden 6kA range. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 600090),
  ('Circuit protection', 'RCCB 80A 2 pole 30mA Type A', 'B80/30/2A', 'Lewden 6kA range. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 600100),
  ('Circuit protection', 'RCCB 100A 2 pole 30mA Type A', 'B100/30/2A', 'Lewden 6kA range. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 600110),
  ('Circuit protection', 'RCCB 100A 2 pole 100mA S type (time delayed) Type A', 'B100/100/2SA', 'Lewden 6kA range.', '{"uses":{"din":2}}'::jsonb, 600120),
  ('Circuit protection', 'RCCB 25A 4 pole 30mA Type A', 'B25/30/4A', 'Lewden 6kA range.', '{"uses":{"din":4}}'::jsonb, 600130),
  ('Circuit protection', 'RCCB 40A 4 pole 30mA Type A', 'B40/30/4A', 'Lewden 6kA range.', '{"uses":{"din":4}}'::jsonb, 600140),
  ('Circuit protection', 'RCCB 63A 4 pole 30mA Type A', 'B63/30/4A', 'Lewden 6kA range.', '{"uses":{"din":4}}'::jsonb, 600150),
  ('Circuit protection', 'RCCB 80A 4 pole 30mA Type A', 'B80/30/4A', 'Lewden 6kA range. Catalogue lists the 80A 4P as 100mA time delayed: check.', '{"uses":{"din":4}}'::jsonb, 600160),
  ('Circuit protection', 'RCCB 63A 2 pole 30mA Type B', 'B63/30/2B', 'Lewden. 4 module width.', '{"uses":{"din":4}}'::jsonb, 600170),
  ('Circuit protection', 'RCCB 63A 4 pole 30mA Type B', 'B63/30/4B', 'Lewden. 4 module width.', '{"uses":{"din":4}}'::jsonb, 600180),
  ('Circuit protection', 'RCCB 100A 4 pole 30mA Type A (10kA range)', 'BRCD10-100/30/4A', 'Lewden. Bi-directional. Module width assumed 4.', '{"uses":{"din":4}}'::jsonb, 600190),
  ('Circuit protection', 'RCCB 100A 4 pole 100mA Type A (10kA range)', 'BRCD10-100/100/4A', 'Lewden. Bi-directional. Module width assumed 4.', '{"uses":{"din":4}}'::jsonb, 600200),
  ('Circuit protection', 'RCCB 100A 4 pole 100mA time delayed Type A[s] (10kA range)', 'BRCD10-100/100/4S', 'Lewden. Bi-directional. Module width assumed 4.', '{"uses":{"din":4}}'::jsonb, 600210),
  ('Circuit protection', 'RCCB 100A 4 pole 300mA Type A (10kA range)', 'BRCD10-100/300/4A', 'Lewden. Bi-directional. Module width assumed 4.', '{"uses":{"din":4}}'::jsonb, 600220),
  ('Circuit protection', 'RCCB 63A 4 pole 30mA Type A, 400-415V (10kA range)', 'BRCD10-63/30/4A', 'Lewden. Bi-directional. Module width assumed 4.', '{"uses":{"din":4}}'::jsonb, 600230),
  ('Circuit protection', 'RCCB 63A 2 pole 30mA Type A, 110V (10kA range)', 'BRCD10-63/30/2ALV', 'Lewden. For 110V circuits. Module width assumed 2.', '{"uses":{"din":2}}'::jsonb, 600240),
  ('Circuit protection', 'RCBO 6A B curve 30mA Type A, switched neutral, 6kA (compact)', 'BRCBO-B06/30/1PNA', 'Lewden. Uni-directional, 1 module.', '{"uses":{"din":1}}'::jsonb, 600250),
  ('Circuit protection', 'RCBO 10A B curve 30mA Type A, switched neutral, 6kA (compact)', 'BRCBO-B10/30/1PNA', 'Lewden. Uni-directional, 1 module.', '{"uses":{"din":1}}'::jsonb, 600260),
  ('Circuit protection', 'RCBO 16A B curve 30mA Type A, switched neutral, 6kA (compact)', 'BRCBO-B16/30/1PNA', 'Lewden. Uni-directional, 1 module.', '{"uses":{"din":1}}'::jsonb, 600270),
  ('Circuit protection', 'RCBO 20A B curve 30mA Type A, switched neutral, 6kA (compact)', 'BRCBO-B20/30/1PNA', 'Lewden. Uni-directional, 1 module.', '{"uses":{"din":1}}'::jsonb, 600280),
  ('Circuit protection', 'RCBO 25A B curve 30mA Type A, switched neutral, 6kA (compact)', 'BRCBO-B25/30/1PNA', 'Lewden. Uni-directional, 1 module.', '{"uses":{"din":1}}'::jsonb, 600290),
  ('Circuit protection', 'RCBO 32A B curve 30mA Type A, switched neutral, 6kA (compact)', 'BRCBO-B32/30/1PNA', 'Lewden. Uni-directional, 1 module.', '{"uses":{"din":1}}'::jsonb, 600300),
  ('Circuit protection', 'RCBO 40A B curve 30mA Type A, switched neutral, 6kA (compact)', 'BRCBO-B40/30/1PNA', 'Lewden. Uni-directional, 1 module.', '{"uses":{"din":1}}'::jsonb, 600310),
  ('Circuit protection', 'RCBO 6A C curve 30mA Type A, switched neutral, 6kA (compact)', 'BRCBO-C06/30/1PNA', 'Lewden. Uni-directional, 1 module.', '{"uses":{"din":1}}'::jsonb, 600320),
  ('Circuit protection', 'RCBO 10A C curve 30mA Type A, switched neutral, 6kA (compact)', 'BRCBO-C10/30/1PNA', 'Lewden. Uni-directional, 1 module.', '{"uses":{"din":1}}'::jsonb, 600330),
  ('Circuit protection', 'RCBO 16A C curve 30mA Type A, switched neutral, 6kA (compact)', 'BRCBO-C16/30/1PNA', 'Lewden. Uni-directional, 1 module.', '{"uses":{"din":1}}'::jsonb, 600340),
  ('Circuit protection', 'RCBO 20A C curve 30mA Type A, switched neutral, 6kA (compact)', 'BRCBO-C20/30/1PNA', 'Lewden. Uni-directional, 1 module.', '{"uses":{"din":1}}'::jsonb, 600350),
  ('Circuit protection', 'RCBO 25A C curve 30mA Type A, switched neutral, 6kA (compact)', 'BRCBO-C25/30/1PNA', 'Lewden. Uni-directional, 1 module.', '{"uses":{"din":1}}'::jsonb, 600360),
  ('Circuit protection', 'RCBO 32A C curve 30mA Type A, switched neutral, 6kA (compact)', 'BRCBO-C32/30/1PNA', 'Lewden. Uni-directional, 1 module.', '{"uses":{"din":1}}'::jsonb, 600370),
  ('Circuit protection', 'RCBO 40A C curve 30mA Type A, switched neutral, 6kA (compact)', 'BRCBO-C40/30/1PNA', 'Lewden. Uni-directional, 1 module.', '{"uses":{"din":1}}'::jsonb, 600380),
  ('Circuit protection', 'RCBO 6A B curve 30mA Type A, single pole (unswitched neutral), 6kA', 'BRCBO-B06/30/SPA', 'Lewden. 1 module.', '{"uses":{"din":1}}'::jsonb, 600390),
  ('Circuit protection', 'RCBO 10A B curve 30mA Type A, single pole (unswitched neutral), 6kA', 'BRCBO-B10/30/SPA', 'Lewden. 1 module.', '{"uses":{"din":1}}'::jsonb, 600400),
  ('Circuit protection', 'RCBO 16A B curve 30mA Type A, single pole (unswitched neutral), 6kA', 'BRCBO-B16/30/SPA', 'Lewden. 1 module.', '{"uses":{"din":1}}'::jsonb, 600410),
  ('Circuit protection', 'RCBO 20A B curve 30mA Type A, single pole (unswitched neutral), 6kA', 'BRCBO-B20/30/SPA', 'Lewden. 1 module.', '{"uses":{"din":1}}'::jsonb, 600420),
  ('Circuit protection', 'RCBO 25A B curve 30mA Type A, single pole (unswitched neutral), 6kA', 'BRCBO-B25/30/SPA', 'Lewden. 1 module.', '{"uses":{"din":1}}'::jsonb, 600430),
  ('Circuit protection', 'RCBO 32A B curve 30mA Type A, single pole (unswitched neutral), 6kA', 'BRCBO-B32/30/SPA', 'Lewden. 1 module.', '{"uses":{"din":1}}'::jsonb, 600440),
  ('Circuit protection', 'RCBO 40A B curve 30mA Type A, single pole (unswitched neutral), 6kA', 'BRCBO-B40/30/SPA', 'Lewden. 1 module.', '{"uses":{"din":1}}'::jsonb, 600450),
  ('Circuit protection', 'RCBO 50A B curve 30mA Type A, single pole (unswitched neutral), 6kA', 'BRCBO-B50/30/SPA', 'Lewden. 1 module.', '{"uses":{"din":1}}'::jsonb, 600460),
  ('Circuit protection', 'RCBO 6A C curve 30mA Type A, single pole (unswitched neutral), 6kA', 'BRCBO-C06/30/SPA', 'Lewden. 1 module.', '{"uses":{"din":1}}'::jsonb, 600470),
  ('Circuit protection', 'RCBO 10A C curve 30mA Type A, single pole (unswitched neutral), 6kA', 'BRCBO-C10/30/SPA', 'Lewden. 1 module.', '{"uses":{"din":1}}'::jsonb, 600480),
  ('Circuit protection', 'RCBO 16A C curve 30mA Type A, single pole (unswitched neutral), 6kA', 'BRCBO-C16/30/SPA', 'Lewden. 1 module.', '{"uses":{"din":1}}'::jsonb, 600490),
  ('Circuit protection', 'RCBO 20A C curve 30mA Type A, single pole (unswitched neutral), 6kA', 'BRCBO-C20/30/SPA', 'Lewden. 1 module.', '{"uses":{"din":1}}'::jsonb, 600500),
  ('Circuit protection', 'RCBO 25A C curve 30mA Type A, single pole (unswitched neutral), 6kA', 'BRCBO-C25/30/SPA', 'Lewden. 1 module.', '{"uses":{"din":1}}'::jsonb, 600510),
  ('Circuit protection', 'RCBO 32A C curve 30mA Type A, single pole (unswitched neutral), 6kA', 'BRCBO-C32/30/SPA', 'Lewden. 1 module.', '{"uses":{"din":1}}'::jsonb, 600520),
  ('Circuit protection', 'RCBO 40A C curve 30mA Type A, single pole (unswitched neutral), 6kA', 'BRCBO-C40/30/SPA', 'Lewden. 1 module.', '{"uses":{"din":1}}'::jsonb, 600530),
  ('Circuit protection', 'RCBO 50A C curve 30mA Type A, single pole (unswitched neutral), 6kA', 'BRCBO-C50/30/SPA', 'Lewden. 1 module.', '{"uses":{"din":1}}'::jsonb, 600540),
  ('Circuit protection', 'RCBO 6A B curve 30mA Type A, switched neutral, bi-directional, 6kA', 'BRCBO-B06/30/1PNAB', 'Lewden. Suits V2G / micro generation. 1 module.', '{"uses":{"din":1}}'::jsonb, 600550),
  ('Circuit protection', 'RCBO 10A B curve 30mA Type A, switched neutral, bi-directional, 6kA', 'BRCBO-B10/30/1PNAB', 'Lewden. Suits V2G / micro generation. 1 module.', '{"uses":{"din":1}}'::jsonb, 600560),
  ('Circuit protection', 'RCBO 16A B curve 30mA Type A, switched neutral, bi-directional, 6kA', 'BRCBO-B16/30/1PNAB', 'Lewden. Suits V2G / micro generation. 1 module.', '{"uses":{"din":1}}'::jsonb, 600570),
  ('Circuit protection', 'RCBO 20A B curve 30mA Type A, switched neutral, bi-directional, 6kA', 'BRCBO-B20/30/1PNAB', 'Lewden. Suits V2G / micro generation. 1 module.', '{"uses":{"din":1}}'::jsonb, 600580),
  ('Circuit protection', 'RCBO 25A B curve 30mA Type A, switched neutral, bi-directional, 6kA', 'BRCBO-B25/30/1PNAB', 'Lewden. Suits V2G / micro generation. 1 module.', '{"uses":{"din":1}}'::jsonb, 600590),
  ('Circuit protection', 'RCBO 32A B curve 30mA Type A, switched neutral, bi-directional, 6kA', 'BRCBO-B32/30/1PNAB', 'Lewden. Suits V2G / micro generation. 1 module.', '{"uses":{"din":1}}'::jsonb, 600600),
  ('Circuit protection', 'RCBO 40A B curve 30mA Type A, switched neutral, bi-directional, 6kA', 'BRCBO-B40/30/1PNAB', 'Lewden. Suits V2G / micro generation. 1 module.', '{"uses":{"din":1}}'::jsonb, 600610),
  ('Circuit protection', 'AFDD RCBO 6A B curve 30mA Type A, switched neutral, 6kA', 'BP04-B06/30/1PNA', 'Lewden. Arc fault + RCBO in 1 module.', '{"uses":{"din":1}}'::jsonb, 600620),
  ('Circuit protection', 'AFDD RCBO 10A B curve 30mA Type A, switched neutral, 6kA', 'BP04-B10/30/1PNA', 'Lewden. Arc fault + RCBO in 1 module.', '{"uses":{"din":1}}'::jsonb, 600630),
  ('Circuit protection', 'AFDD RCBO 16A B curve 30mA Type A, switched neutral, 6kA', 'BP04-B16/30/1PNA', 'Lewden. Arc fault + RCBO in 1 module.', '{"uses":{"din":1}}'::jsonb, 600640),
  ('Circuit protection', 'AFDD RCBO 20A B curve 30mA Type A, switched neutral, 6kA', 'BP04-B20/30/1PNA', 'Lewden. Arc fault + RCBO in 1 module.', '{"uses":{"din":1}}'::jsonb, 600650),
  ('Circuit protection', 'AFDD RCBO 32A B curve 30mA Type A, switched neutral, 6kA', 'BP04-B32/30/1PNA', 'Lewden. Arc fault + RCBO in 1 module.', '{"uses":{"din":1}}'::jsonb, 600660),
  ('Circuit protection', 'AFDD RCBO 40A B curve 30mA Type A, switched neutral, 6kA', 'BP04-B40/30/1PNA', 'Lewden. Arc fault + RCBO in 1 module.', '{"uses":{"din":1}}'::jsonb, 600670),
  ('Circuit protection', 'RCBO 6A B curve 30mA Type A, 1P + unswitched neutral, 10kA', 'BRCBO10-06/30/1MBA', 'Lewden. Neutral lead 600mm. Module width assumed 1.', '{"uses":{"din":1}}'::jsonb, 600680),
  ('Circuit protection', 'RCBO 10A B curve 30mA Type A, 1P + unswitched neutral, 10kA', 'BRCBO10-10/30/1MBA', 'Lewden. Neutral lead 600mm. Module width assumed 1.', '{"uses":{"din":1}}'::jsonb, 600690),
  ('Circuit protection', 'RCBO 13A B curve 30mA Type A, 1P + unswitched neutral, 10kA', 'BRCBO10-13/30/1MBA', 'Lewden. Neutral lead 600mm. Module width assumed 1.', '{"uses":{"din":1}}'::jsonb, 600700),
  ('Circuit protection', 'RCBO 16A B curve 30mA Type A, 1P + unswitched neutral, 10kA', 'BRCBO10-16/30/1MBA', 'Lewden. Neutral lead 600mm. Module width assumed 1.', '{"uses":{"din":1}}'::jsonb, 600710),
  ('Circuit protection', 'RCBO 20A B curve 30mA Type A, 1P + unswitched neutral, 10kA', 'BRCBO10-20/30/1MBA', 'Lewden. Neutral lead 600mm. Module width assumed 1.', '{"uses":{"din":1}}'::jsonb, 600720),
  ('Circuit protection', 'RCBO 25A B curve 30mA Type A, 1P + unswitched neutral, 10kA', 'BRCBO10-25/30/1MBA', 'Lewden. Neutral lead 600mm. Module width assumed 1.', '{"uses":{"din":1}}'::jsonb, 600730),
  ('Circuit protection', 'RCBO 32A B curve 30mA Type A, 1P + unswitched neutral, 10kA', 'BRCBO10-32/30/1MBA', 'Lewden. Neutral lead 600mm. Module width assumed 1.', '{"uses":{"din":1}}'::jsonb, 600740),
  ('Circuit protection', 'RCBO 40A B curve 30mA Type A, 1P + unswitched neutral, 10kA', 'BRCBO10-40/30/1MBA', 'Lewden. Neutral lead 600mm. Module width assumed 1.', '{"uses":{"din":1}}'::jsonb, 600750),
  ('Circuit protection', 'RCBO 45A B curve 30mA Type A, 1P + unswitched neutral, 10kA', 'BRCBO10-45/30/1MBA', 'Lewden. Neutral lead 600mm. Module width assumed 1.', '{"uses":{"din":1}}'::jsonb, 600760),
  ('Circuit protection', 'RCBO 6A C curve 30mA Type A, 1P + unswitched neutral, 10kA', 'BRCBO10-06/30/1MCA', 'Lewden. Neutral lead 600mm. Module width assumed 1.', '{"uses":{"din":1}}'::jsonb, 600770),
  ('Circuit protection', 'RCBO 10A C curve 30mA Type A, 1P + unswitched neutral, 10kA', 'BRCBO10-10/30/1MCA', 'Lewden. Neutral lead 600mm. Module width assumed 1.', '{"uses":{"din":1}}'::jsonb, 600780),
  ('Circuit protection', 'RCBO 13A C curve 30mA Type A, 1P + unswitched neutral, 10kA', 'BRCBO10-13/30/1MCA', 'Lewden. Neutral lead 600mm. Module width assumed 1.', '{"uses":{"din":1}}'::jsonb, 600790),
  ('Circuit protection', 'RCBO 16A C curve 30mA Type A, 1P + unswitched neutral, 10kA', 'BRCBO10-16/30/1MCA', 'Lewden. Neutral lead 600mm. Module width assumed 1.', '{"uses":{"din":1}}'::jsonb, 600800),
  ('Circuit protection', 'RCBO 20A C curve 30mA Type A, 1P + unswitched neutral, 10kA', 'BRCBO10-20/30/1MCA', 'Lewden. Neutral lead 600mm. Module width assumed 1.', '{"uses":{"din":1}}'::jsonb, 600810),
  ('Circuit protection', 'RCBO 25A C curve 30mA Type A, 1P + unswitched neutral, 10kA', 'BRCBO10-25/30/1MCA', 'Lewden. Neutral lead 600mm. Module width assumed 1.', '{"uses":{"din":1}}'::jsonb, 600820),
  ('Circuit protection', 'RCBO 32A C curve 30mA Type A, 1P + unswitched neutral, 10kA', 'BRCBO10-32/30/1MCA', 'Lewden. Neutral lead 600mm. Module width assumed 1.', '{"uses":{"din":1}}'::jsonb, 600830),
  ('Circuit protection', 'RCBO 40A C curve 30mA Type A, 1P + unswitched neutral, 10kA', 'BRCBO10-40/30/1MCA', 'Lewden. Neutral lead 600mm. Module width assumed 1.', '{"uses":{"din":1}}'::jsonb, 600840),
  ('Circuit protection', 'RCBO 45A C curve 30mA Type A, 1P + unswitched neutral, 10kA', 'BRCBO10-45/30/1MCA', 'Lewden. Neutral lead 600mm. Module width assumed 1.', '{"uses":{"din":1}}'::jsonb, 600850),
  ('Circuit protection', 'MCB 6A 1 pole B curve, 6kA', 'BG06-1B06', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 600860),
  ('Circuit protection', 'MCB 10A 1 pole B curve, 6kA', 'BG06-1B10', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 600870),
  ('Circuit protection', 'MCB 16A 1 pole B curve, 6kA', 'BG06-1B16', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 600880),
  ('Circuit protection', 'MCB 20A 1 pole B curve, 6kA', 'BG06-1B20', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 600890),
  ('Circuit protection', 'MCB 25A 1 pole B curve, 6kA', 'BG06-1B25', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 600900),
  ('Circuit protection', 'MCB 32A 1 pole B curve, 6kA', 'BG06-1B32', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 600910),
  ('Circuit protection', 'MCB 40A 1 pole B curve, 6kA', 'BG06-1B40', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 600920),
  ('Circuit protection', 'MCB 50A 1 pole B curve, 6kA', 'BG06-1B50', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 600930),
  ('Circuit protection', 'MCB 63A 1 pole B curve, 6kA', 'BG06-1B63', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 600940),
  ('Circuit protection', 'MCB 6A 1 pole C curve, 6kA', 'BG06-1C06', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 600950),
  ('Circuit protection', 'MCB 10A 1 pole C curve, 6kA', 'BG06-1C10', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 600960),
  ('Circuit protection', 'MCB 16A 1 pole C curve, 6kA', 'BG06-1C16', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 600970),
  ('Circuit protection', 'MCB 20A 1 pole C curve, 6kA', 'BG06-1C20', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 600980),
  ('Circuit protection', 'MCB 25A 1 pole C curve, 6kA', 'BG06-1C25', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 600990),
  ('Circuit protection', 'MCB 32A 1 pole C curve, 6kA', 'BG06-1C32', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601000),
  ('Circuit protection', 'MCB 40A 1 pole C curve, 6kA', 'BG06-1C40', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601010),
  ('Circuit protection', 'MCB 50A 1 pole C curve, 6kA', 'BG06-1C50', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601020),
  ('Circuit protection', 'MCB 63A 1 pole C curve, 6kA', 'BG06-1C63', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601030),
  ('Circuit protection', 'MCB 6A 2 pole B curve, 6kA', 'BG06-2B06', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601040),
  ('Circuit protection', 'MCB 10A 2 pole B curve, 6kA', 'BG06-2B10', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601050),
  ('Circuit protection', 'MCB 16A 2 pole B curve, 6kA', 'BG06-2B16', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601060),
  ('Circuit protection', 'MCB 20A 2 pole B curve, 6kA', 'BG06-2B20', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601070),
  ('Circuit protection', 'MCB 25A 2 pole B curve, 6kA', 'BG06-2B25', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601080),
  ('Circuit protection', 'MCB 32A 2 pole B curve, 6kA', 'BG06-2B32', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601090),
  ('Circuit protection', 'MCB 40A 2 pole B curve, 6kA', 'BG06-2B40', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601100),
  ('Circuit protection', 'MCB 50A 2 pole B curve, 6kA', 'BG06-2B50', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601110),
  ('Circuit protection', 'MCB 63A 2 pole B curve, 6kA', 'BG06-2B63', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601120),
  ('Circuit protection', 'MCB 6A 2 pole C curve, 6kA', 'BG06-2C06', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601130),
  ('Circuit protection', 'MCB 10A 2 pole C curve, 6kA', 'BG06-2C10', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601140),
  ('Circuit protection', 'MCB 16A 2 pole C curve, 6kA', 'BG06-2C16', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601150),
  ('Circuit protection', 'MCB 20A 2 pole C curve, 6kA', 'BG06-2C20', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601160),
  ('Circuit protection', 'MCB 25A 2 pole C curve, 6kA', 'BG06-2C25', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601170),
  ('Circuit protection', 'MCB 32A 2 pole C curve, 6kA', 'BG06-2C32', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601180),
  ('Circuit protection', 'MCB 40A 2 pole C curve, 6kA', 'BG06-2C40', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601190),
  ('Circuit protection', 'MCB 50A 2 pole C curve, 6kA', 'BG06-2C50', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601200),
  ('Circuit protection', 'MCB 63A 2 pole C curve, 6kA', 'BG06-2C63', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601210),
  ('Circuit protection', 'MCB 6A 3 pole B curve, 6kA', 'BG06-3B06', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601220),
  ('Circuit protection', 'MCB 10A 3 pole B curve, 6kA', 'BG06-3B10', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601230),
  ('Circuit protection', 'MCB 16A 3 pole B curve, 6kA', 'BG06-3B16', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601240),
  ('Circuit protection', 'MCB 20A 3 pole B curve, 6kA', 'BG06-3B20', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601250),
  ('Circuit protection', 'MCB 25A 3 pole B curve, 6kA', 'BG06-3B25', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601260),
  ('Circuit protection', 'MCB 32A 3 pole B curve, 6kA', 'BG06-3B32', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601270),
  ('Circuit protection', 'MCB 40A 3 pole B curve, 6kA', 'BG06-3B40', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601280),
  ('Circuit protection', 'MCB 50A 3 pole B curve, 6kA', 'BG06-3B50', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601290),
  ('Circuit protection', 'MCB 63A 3 pole B curve, 6kA', 'BG06-3B63', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601300),
  ('Circuit protection', 'MCB 6A 3 pole C curve, 6kA', 'BG06-3C06', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601310),
  ('Circuit protection', 'MCB 10A 3 pole C curve, 6kA', 'BG06-3C10', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601320),
  ('Circuit protection', 'MCB 16A 3 pole C curve, 6kA', 'BG06-3C16', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601330),
  ('Circuit protection', 'MCB 20A 3 pole C curve, 6kA', 'BG06-3C20', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601340),
  ('Circuit protection', 'MCB 25A 3 pole C curve, 6kA', 'BG06-3C25', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601350),
  ('Circuit protection', 'MCB 32A 3 pole C curve, 6kA', 'BG06-3C32', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601360),
  ('Circuit protection', 'MCB 40A 3 pole C curve, 6kA', 'BG06-3C40', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601370),
  ('Circuit protection', 'MCB 50A 3 pole C curve, 6kA', 'BG06-3C50', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601380),
  ('Circuit protection', 'MCB 63A 3 pole C curve, 6kA', 'BG06-3C63', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601390),
  ('Circuit protection', 'MCB 6A 4 pole B curve, 6kA', 'BG06-4B06', 'Lewden. Bi-directional.', '{"uses":{"din":4}}'::jsonb, 601400),
  ('Circuit protection', 'MCB 10A 4 pole B curve, 6kA', 'BG06-4B10', 'Lewden. Bi-directional.', '{"uses":{"din":4}}'::jsonb, 601410),
  ('Circuit protection', 'MCB 16A 4 pole B curve, 6kA', 'BG06-4B16', 'Lewden. Bi-directional.', '{"uses":{"din":4}}'::jsonb, 601420),
  ('Circuit protection', 'MCB 20A 4 pole B curve, 6kA', 'BG06-4B20', 'Lewden. Bi-directional.', '{"uses":{"din":4}}'::jsonb, 601430),
  ('Circuit protection', 'MCB 25A 4 pole B curve, 6kA', 'BG06-4B25', 'Lewden. Bi-directional.', '{"uses":{"din":4}}'::jsonb, 601440),
  ('Circuit protection', 'MCB 32A 4 pole B curve, 6kA', 'BG06-4B32', 'Lewden. Bi-directional.', '{"uses":{"din":4}}'::jsonb, 601450),
  ('Circuit protection', 'MCB 40A 4 pole B curve, 6kA', 'BG06-4B40', 'Lewden. Bi-directional.', '{"uses":{"din":4}}'::jsonb, 601460),
  ('Circuit protection', 'MCB 50A 4 pole B curve, 6kA', 'BG06-4B50', 'Lewden. Bi-directional.', '{"uses":{"din":4}}'::jsonb, 601470),
  ('Circuit protection', 'MCB 63A 4 pole B curve, 6kA', 'BG06-4B63', 'Lewden. Bi-directional.', '{"uses":{"din":4}}'::jsonb, 601480),
  ('Circuit protection', 'MCB 6A 4 pole C curve, 6kA', 'BG06-4C06', 'Lewden. Bi-directional.', '{"uses":{"din":4}}'::jsonb, 601490),
  ('Circuit protection', 'MCB 10A 4 pole C curve, 6kA', 'BG06-4C10', 'Lewden. Bi-directional.', '{"uses":{"din":4}}'::jsonb, 601500),
  ('Circuit protection', 'MCB 16A 4 pole C curve, 6kA', 'BG06-4C16', 'Lewden. Bi-directional.', '{"uses":{"din":4}}'::jsonb, 601510),
  ('Circuit protection', 'MCB 20A 4 pole C curve, 6kA', 'BG06-4C20', 'Lewden. Bi-directional.', '{"uses":{"din":4}}'::jsonb, 601520),
  ('Circuit protection', 'MCB 25A 4 pole C curve, 6kA', 'BG06-4C25', 'Lewden. Bi-directional.', '{"uses":{"din":4}}'::jsonb, 601530),
  ('Circuit protection', 'MCB 32A 4 pole C curve, 6kA', 'BG06-4C32', 'Lewden. Bi-directional.', '{"uses":{"din":4}}'::jsonb, 601540),
  ('Circuit protection', 'MCB 40A 4 pole C curve, 6kA', 'BG06-4C40', 'Lewden. Bi-directional.', '{"uses":{"din":4}}'::jsonb, 601550),
  ('Circuit protection', 'MCB 50A 4 pole C curve, 6kA', 'BG06-4C50', 'Lewden. Bi-directional.', '{"uses":{"din":4}}'::jsonb, 601560),
  ('Circuit protection', 'MCB 63A 4 pole C curve, 6kA', 'BG06-4C63', 'Lewden. Bi-directional.', '{"uses":{"din":4}}'::jsonb, 601570),
  ('Circuit protection', 'MCB 6A 1 pole B curve, 10kA', 'BE10-1B06', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601580),
  ('Circuit protection', 'MCB 10A 1 pole B curve, 10kA', 'BE10-1B10', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601590),
  ('Circuit protection', 'MCB 16A 1 pole B curve, 10kA', 'BE10-1B16', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601600),
  ('Circuit protection', 'MCB 20A 1 pole B curve, 10kA', 'BE10-1B20', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601610),
  ('Circuit protection', 'MCB 25A 1 pole B curve, 10kA', 'BE10-1B25', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601620),
  ('Circuit protection', 'MCB 32A 1 pole B curve, 10kA', 'BE10-1B32', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601630),
  ('Circuit protection', 'MCB 40A 1 pole B curve, 10kA', 'BE10-1B40', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601640),
  ('Circuit protection', 'MCB 50A 1 pole B curve, 10kA', 'BE10-1B50', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601650),
  ('Circuit protection', 'MCB 63A 1 pole B curve, 10kA', 'BE10-1B63', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601660),
  ('Circuit protection', 'MCB 6A 3 pole B curve, 10kA', 'BE10-3B06', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601670),
  ('Circuit protection', 'MCB 10A 3 pole B curve, 10kA', 'BE10-3B10', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601680),
  ('Circuit protection', 'MCB 16A 3 pole B curve, 10kA', 'BE10-3B16', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601690),
  ('Circuit protection', 'MCB 20A 3 pole B curve, 10kA', 'BE10-3B20', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601700),
  ('Circuit protection', 'MCB 25A 3 pole B curve, 10kA', 'BE10-3B25', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601710),
  ('Circuit protection', 'MCB 32A 3 pole B curve, 10kA', 'BE10-3B32', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601720),
  ('Circuit protection', 'MCB 40A 3 pole B curve, 10kA', 'BE10-3B40', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601730),
  ('Circuit protection', 'MCB 50A 3 pole B curve, 10kA', 'BE10-3B50', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601740),
  ('Circuit protection', 'MCB 63A 3 pole B curve, 10kA', 'BE10-3B63', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601750),
  ('Circuit protection', 'MCB 6A 1 pole C curve, 10kA', 'BE10-1C06', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601760),
  ('Circuit protection', 'MCB 10A 1 pole C curve, 10kA', 'BE10-1C10', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601770),
  ('Circuit protection', 'MCB 16A 1 pole C curve, 10kA', 'BE10-1C16', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601780),
  ('Circuit protection', 'MCB 20A 1 pole C curve, 10kA', 'BE10-1C20', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601790),
  ('Circuit protection', 'MCB 25A 1 pole C curve, 10kA', 'BE10-1C25', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601800),
  ('Circuit protection', 'MCB 32A 1 pole C curve, 10kA', 'BE10-1C32', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601810),
  ('Circuit protection', 'MCB 40A 1 pole C curve, 10kA', 'BE10-1C40', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601820),
  ('Circuit protection', 'MCB 50A 1 pole C curve, 10kA', 'BE10-1C50', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601830),
  ('Circuit protection', 'MCB 63A 1 pole C curve, 10kA', 'BE10-1C63', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 601840),
  ('Circuit protection', 'MCB 6A 2 pole C curve, 10kA', 'BE10-2C06', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601850),
  ('Circuit protection', 'MCB 10A 2 pole C curve, 10kA', 'BE10-2C10', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601860),
  ('Circuit protection', 'MCB 16A 2 pole C curve, 10kA', 'BE10-2C16', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601870),
  ('Circuit protection', 'MCB 20A 2 pole C curve, 10kA', 'BE10-2C20', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601880),
  ('Circuit protection', 'MCB 25A 2 pole C curve, 10kA', 'BE10-2C25', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601890),
  ('Circuit protection', 'MCB 32A 2 pole C curve, 10kA', 'BE10-2C32', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601900),
  ('Circuit protection', 'MCB 40A 2 pole C curve, 10kA', 'BE10-2C40', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601910),
  ('Circuit protection', 'MCB 50A 2 pole C curve, 10kA', 'BE10-2C50', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601920),
  ('Circuit protection', 'MCB 63A 2 pole C curve, 10kA', 'BE10-2C63', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 601930),
  ('Circuit protection', 'MCB 6A 3 pole C curve, 10kA', 'BE10-3C06', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601940),
  ('Circuit protection', 'MCB 10A 3 pole C curve, 10kA', 'BE10-3C10', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601950),
  ('Circuit protection', 'MCB 16A 3 pole C curve, 10kA', 'BE10-3C16', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601960),
  ('Circuit protection', 'MCB 20A 3 pole C curve, 10kA', 'BE10-3C20', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601970),
  ('Circuit protection', 'MCB 25A 3 pole C curve, 10kA', 'BE10-3C25', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601980),
  ('Circuit protection', 'MCB 32A 3 pole C curve, 10kA', 'BE10-3C32', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 601990),
  ('Circuit protection', 'MCB 40A 3 pole C curve, 10kA', 'BE10-3C40', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 602000),
  ('Circuit protection', 'MCB 50A 3 pole C curve, 10kA', 'BE10-3C50', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 602010),
  ('Circuit protection', 'MCB 63A 3 pole C curve, 10kA', 'BE10-3C63', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 602020),
  ('Circuit protection', 'MCB 6A 1 pole D curve, 10kA', 'BE10-1D06', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 602030),
  ('Circuit protection', 'MCB 10A 1 pole D curve, 10kA', 'BE10-1D10', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 602040),
  ('Circuit protection', 'MCB 16A 1 pole D curve, 10kA', 'BE10-1D16', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 602050),
  ('Circuit protection', 'MCB 20A 1 pole D curve, 10kA', 'BE10-1D20', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 602060),
  ('Circuit protection', 'MCB 25A 1 pole D curve, 10kA', 'BE10-1D25', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 602070),
  ('Circuit protection', 'MCB 32A 1 pole D curve, 10kA', 'BE10-1D32', 'Lewden. Bi-directional.', '{"uses":{"din":1}}'::jsonb, 602080),
  ('Circuit protection', 'MCB 6A 2 pole D curve, 10kA', 'BE10-2D06', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 602090),
  ('Circuit protection', 'MCB 10A 2 pole D curve, 10kA', 'BE10-2D10', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 602100),
  ('Circuit protection', 'MCB 16A 2 pole D curve, 10kA', 'BE10-2D16', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 602110),
  ('Circuit protection', 'MCB 20A 2 pole D curve, 10kA', 'BE10-2D20', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 602120),
  ('Circuit protection', 'MCB 25A 2 pole D curve, 10kA', 'BE10-2D25', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 602130),
  ('Circuit protection', 'MCB 32A 2 pole D curve, 10kA', 'BE10-2D32', 'Lewden. Bi-directional.', '{"uses":{"din":2}}'::jsonb, 602140),
  ('Circuit protection', 'MCB 6A 3 pole D curve, 10kA', 'BE10-3D06', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 602150),
  ('Circuit protection', 'MCB 10A 3 pole D curve, 10kA', 'BE10-3D10', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 602160),
  ('Circuit protection', 'MCB 16A 3 pole D curve, 10kA', 'BE10-3D16', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 602170),
  ('Circuit protection', 'MCB 20A 3 pole D curve, 10kA', 'BE10-3D20', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 602180),
  ('Circuit protection', 'MCB 25A 3 pole D curve, 10kA', 'BE10-3D25', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 602190),
  ('Circuit protection', 'MCB 32A 3 pole D curve, 10kA', 'BE10-3D32', 'Lewden. Bi-directional.', '{"uses":{"din":3}}'::jsonb, 602200),
  ('Circuit protection', 'Shunt trip 230V AC/DC for 10kA MCBs (E10 range)', 'BE10-SHT', 'Lewden. Not for MCBs on a TPN busbar.', null::jsonb, 602210),
  ('Circuit protection', 'Auxiliary contact for 10kA MCBs (E10 range)', 'BE10-AUX', 'Lewden. Not for MCBs on a TPN busbar.', null::jsonb, 602220),
  ('Circuit protection', 'Padlock for MCBs, RCCBs and RCBOs (3 keys, yellow hazard indicator)', 'BMCBLOCK', 'Lewden.', null::jsonb, 602230),
  ('Circuit protection', 'Surge protection Type 2, single phase, compact (fits comb busbar)', 'BSRGT2B', 'Lewden. 275VAC, 20/40kA.', '{"uses":{"din":1}}'::jsonb, 602240),
  ('Circuit protection', 'Surge protection Type 2, 230V single phase, with signalling contact', 'BSRG1V1G', 'Lewden. 1.25kV, 20/40kA.', '{"uses":{"din":2}}'::jsonb, 602250),
  ('Circuit protection', 'Surge protection Type 1+2, 230V single phase', 'BSRG1123', 'Lewden. 1.3kV, 20/50kA, Iimp 12.5/25kA.', '{"uses":{"din":2}}'::jsonb, 602260),
  ('Circuit protection', 'Surge protection Type 1+2, 400V three phase', 'BSRG3123', 'Lewden. 4 module (3P+N).', '{"uses":{"din":4}}'::jsonb, 602270),
  ('Circuit protection', 'Surge protection Type 2, 400V three phase', 'BSRG3V1G', 'Lewden. 4 module (3P+N).', '{"uses":{"din":4}}'::jsonb, 602280),
  ('Circuit protection', 'Installation contactor 20A 2 N/O, 230V coil', 'BIC20', 'Lewden. DIN rail.', '{"uses":{"din":1}}'::jsonb, 602290),
  ('Circuit protection', 'Installation contactor 40A 2 N/O, 230V coil', 'BIC40/2', 'Lewden. DIN rail.', '{"uses":{"din":2}}'::jsonb, 602300),
  ('Circuit protection', 'Installation contactor 24A 4 N/O, 230V coil', 'BIC24/4', 'Lewden. DIN rail.', '{"uses":{"din":2}}'::jsonb, 602310),
  ('Circuit protection', 'Installation contactor 63A 4 N/O, 230V coil', 'BIC63/4', 'Lewden. DIN rail.', '{"uses":{"din":3}}'::jsonb, 602320)
) as v(category, description, part_number, notes, capacity, sort_order)
where not exists (
  select 1 from products p
  where p.section = 'topter' and upper(trim(p.part_number)) = upper(trim(v.part_number))
);

-- ── 7b. Pre-assembled units as TopTer presets ───────────────
-- Created empty: open each one in Admin > Presets (TopTer) and add its parts.
insert into presets (section, name, description, default_labour_minutes, default_labour_rate_per_min)
select 'topter', v.name, v.description, null, null
from (values
  ('PM7138TT', 'Pre-wired: 2x 16A 230V sockets, RCD 2P 30mA AC main switch, 2x 16A 1P MCB, IP66 (Lewden code 665201)'),
  ('PM7139TT', 'Pre-wired: 2x 16A 230V + 2x 32A 230V sockets, 100A 2P isolator, 2x 16A 2P 30mA RCBO + 2x 32A 2P 30mA RCBO, IP66 (Lewden code 665401)'),
  ('PM7140TT', 'Pre-wired: 4x 16A 230V sockets, 100A 2P isolator, 4x 16A 2P 30mA RCBO, IP66 (Lewden code 665402)'),
  ('PM7141TT', 'Pre-wired: 2x 16A 400V + 2x 32A 400V sockets, 125A 4P 30mA RCD AC main switch, 2x 16A 3P + 2x 32A 3P Type C MCB, IP66 (Lewden code 665403)'),
  ('PM7142TT', 'Pre-wired: 4x 16A 400V sockets, 63A 4P 30mA RCD AC main switch, 4x 16A 3P Type C MCB, IP66 (Lewden code 665404)'),
  ('PM7143TT', 'Pre-wired: 4x 16A 110V sockets, 100A 2P isolator, 4x 16A 2P MCB, IP66 (Lewden code 665405)'),
  ('PM7144TT', 'Pre-wired: 4x 16A 230V sockets, 63A 2P 30mA RCD AC main switch, 4x 16A 1P MCB, IP66 (Lewden code 665406)'),
  ('PM7145TT', 'Pre-wired: 4x 32A 230V sockets, 125A 2P isolator, 4x 32A 2P 30mA RCBO, IP66 (Lewden code 665407)'),
  ('PM7146TT', 'Pre-wired: 4x 32A 400V sockets, 125A 4P 30mA RCD AC main switch, 4x 32A 3P Type C MCB, IP66 (Lewden code 665408)'),
  ('PM7147TT', 'Pre-wired: 2x 13A BS + 2x 16A 230V sockets, 100A 2P isolator, 4x 16A 2P 30mA RCBO, IP66 (Lewden code 665409)'),
  ('PM7148TT', 'Pre-wired: 3x 16A 230V + 3x 16A 400V sockets, 63A 4P 30mA RCD AC main switch, 3x 16A 1P + 3x 16A 3P MCB, IP66 (Lewden code 665601)'),
  ('PM7149TT', 'Pre-wired: 4x 16A 230V + 1x 16A 400V + 1x 32A 400V sockets, 80A 4P 30mA RCD AC main switch, 4x 16A 1P + 1x 16A 3P + 1x 32A 3P MCB, IP66 (Lewden code 665602)'),
  ('PM7150TT', 'Pre-wired: 2x 32A 230V sockets, 63A 2P 30mA RCD AC main switch, 2x 32A 1P MCB, IP66 (Lewden code 665603)'),
  ('PM7151TT', 'Pre-wired: 2x 32A 400V sockets, 63A 4P 30mA RCD AC main switch, 2x 32A 3P MCB, IP66 (Lewden code 665604)'),
  ('PM16/540/2VW', '2 gang vertical: 2x 16A 110V sockets, IP44 (Lewden code 665501)'),
  ('PM16/541/2VW', '2 gang vertical: 2x 16A 230V sockets, IP44 (Lewden code 665502)'),
  ('PM1316/541/2VW', '2 gang vertical: 1x 13A BS + 1x 16A 230V sockets, IP44 (Lewden code 665503)'),
  ('PM16/548/2VW', '2 gang vertical: 2x 16A 400V sockets, IP44 (Lewden code 665504)'),
  ('PM32/548/2VW', '2 gang vertical: 2x 32A 400V sockets, IP44 (Lewden code 665505)'),
  ('PM1332/548/2VW', '2 gang vertical: 1x 13A BS + 1x 32A 400V sockets, IP44, not pre-wired (Lewden code 665506)'),
  ('PM16/640/2VW', '2 gang vertical: 2x 16A 110V sockets, IP55 (Lewden code 665507)'),
  ('PM16/641/2VW', '2 gang vertical: 2x 16A 230V sockets, IP55 (Lewden code 665508)'),
  ('PM1316/641/2VW', '2 gang vertical: 1x 13A BS + 1x 16A 230V sockets, IP55 (Lewden code 665509)'),
  ('PM16/648/2VW', '2 gang vertical: 2x 16A 400V sockets, IP55 (Lewden code 665510)'),
  ('PM1332/648/2VW', '2 gang vertical: 1x 13A BS + 1x 32A 400V sockets, IP55, not pre-wired (Lewden code 665511)'),
  ('PM16/540/2HW', '2 gang horizontal: 2x 16A 110V sockets, IP44 (Lewden code 665701)'),
  ('PM16/541/2HW', '2 gang horizontal: 2x 16A 230V sockets, IP44 (Lewden code 665702)'),
  ('PM1316/541/2HW', '2 gang horizontal: 1x 13A BS + 1x 16A 230V sockets, IP44 (Lewden code 665703)'),
  ('PM1332/548/2HW', '2 gang horizontal: 1x 13A BS + 1x 32A 400V sockets, IP44, not pre-wired (Lewden code 665705)'),
  ('PM16/640/2HW', '2 gang horizontal: 2x 16A 110V sockets, IP55 (Lewden code 665706)'),
  ('PM16/641/2HW', '2 gang horizontal: 2x 16A 230V sockets, IP55 (Lewden code 665707)'),
  ('PM1316/641/2HW', '2 gang horizontal: 1x 13A BS + 1x 16A 230V sockets, IP55 (Lewden code 665708)'),
  ('PM1332/642/2HW', '2 gang horizontal: 1x 13A BS + 1x 32A 400V sockets, IP55, not pre-wired (Lewden code 665710)'),
  ('PM16/540/3HW', '3 gang horizontal: 3x 16A 110V sockets, IP44 (Lewden code 665901)'),
  ('PM16/541/3HW', '3 gang horizontal: 3x 16A 230V sockets, IP44 (Lewden code 665902)'),
  ('PM131616/541/3HW', '3 gang horizontal: 1x 13A BS + 2x 16A 230V sockets, IP44 (Lewden code 665903)'),
  ('PM16/640/3HW', '3 gang horizontal: 3x 16A 110V sockets, IP55 (Lewden code 665905)'),
  ('PM16/641/3HW', '3 gang horizontal: 3x 16A 230V sockets, IP55 (Lewden code 665906)'),
  ('PM131616/641/3HW', '3 gang horizontal: 1x 13A BS + 2x 16A 230V sockets, IP55 (Lewden code 665907)'),
  ('PMRCD16/300TT', 'RCD protected socket: 1x 16A 110V 3 pin, mains isolation via RCD 30mA 2P AC, IP44 (Lewden code 663124)'),
  ('PMRCD32/300TT', 'RCD protected socket: 1x 32A 110V 3 pin, mains isolation via RCD 30mA 2P AC, IP44 (Lewden code 663224)'),
  ('PMRCD16/301TT', 'RCD protected socket: 1x 16A 230V 3 pin, mains isolation via RCD 30mA 2P AC, IP44 (Lewden code 663126)'),
  ('PMRCD32/301TT', 'RCD protected socket: 1x 32A 230V 3 pin, mains isolation via RCD 30mA 2P AC, IP44 (Lewden code 663226)'),
  ('PMRCD16/305TT', 'RCD protected socket: 1x 16A 400V 4 pin, mains isolation via RCD 30mA 2P AC, IP44 (Lewden code 663136)'),
  ('PMRCD32/305TT', 'RCD protected socket: 1x 32A 400V 4 pin, mains isolation via RCD 30mA 2P AC, IP44 (Lewden code 663236)'),
  ('PMRCD16/308TT', 'RCD protected socket: 1x 16A 400V 5 pin, mains isolation via RCD 30mA 4P AC, IP44 (Lewden code 663146)'),
  ('PMRCD32/308TT', 'RCD protected socket: 1x 32A 400V 5 pin, mains isolation via RCD 30mA 4P AC, IP44 (Lewden code 663246)'),
  ('PMRCD16/400TT', 'RCD protected socket: 1x 16A 110V 3 pin, mains isolation via RCD 30mA 2P AC, IP66 (Lewden code 664124)'),
  ('PMRCD32/400TT', 'RCD protected socket: 1x 32A 110V 3 pin, mains isolation via RCD 30mA 2P AC, IP66 (Lewden code 664224)'),
  ('PMRCD16/401TT', 'RCD protected socket: 1x 16A 230V 3 pin, mains isolation via RCD 30mA 2P AC, IP66 (Lewden code 664126)'),
  ('PMRCD32/401TT', 'RCD protected socket: 1x 32A 230V 3 pin, mains isolation via RCD 30mA 2P AC, IP66 (Lewden code 664226)'),
  ('PMRCD16/405TT', 'RCD protected socket: 1x 16A 400V 4 pin, mains isolation via RCD 30mA 2P AC, IP66 (Lewden code 664136)'),
  ('PMRCD32/405TT', 'RCD protected socket: 1x 32A 400V 4 pin, mains isolation via RCD 30mA 2P AC, IP66 (Lewden code 664236)'),
  ('PMRCD16/408TT', 'RCD protected socket: 1x 16A 400V 5 pin, mains isolation via RCD 30mA 4P AC, IP66 (Lewden code 664146)'),
  ('PMRCD32/408TT', 'RCD protected socket: 1x 32A 400V 5 pin, mains isolation via RCD 30mA 4P AC, IP66 (Lewden code 664246)'),
  ('PMRCD16/300SITT', 'RCD protected interlock: 1x 16A 110V 3 pin, mains isolation via RCD 30mA 2P AC, IP44 (Lewden code 660124)'),
  ('PMRCD32/300SITT', 'RCD protected interlock: 1x 32A 110V 3 pin, mains isolation via RCD 30mA 2P AC, IP44 (Lewden code 660224)'),
  ('PMRCD16/301SITT', 'RCD protected interlock: 1x 16A 230V 3 pin, mains isolation via RCD 30mA 2P AC, IP44 (Lewden code 660126)'),
  ('PMRCD32/301SITT', 'RCD protected interlock: 1x 32A 230V 3 pin, mains isolation via RCD 30mA 2P AC, IP44 (Lewden code 660226)'),
  ('PMRCD16/305SITT', 'RCD protected interlock: 1x 16A 400V 4 pin, mains isolation via RCD 30mA 2P AC, IP44 (Lewden code 660136)'),
  ('PMRCD32/305SITT', 'RCD protected interlock: 1x 32A 400V 4 pin, mains isolation via RCD 30mA 2P AC, IP44 (Lewden code 660236)'),
  ('PMRCD16/308SITT', 'RCD protected interlock: 1x 16A 400V 5 pin, mains isolation via RCD 30mA 4P AC, IP44 (Lewden code 660146)'),
  ('PMRCD32/308SITT', 'RCD protected interlock: 1x 32A 400V 5 pin, mains isolation via RCD 30mA 4P AC, IP44 (Lewden code 660246)'),
  ('PMRCD16/400SITT', 'RCD protected interlock: 1x 16A 110V 3 pin, mains isolation via RCD 30mA 2P AC, IP66 (Lewden code 661124)'),
  ('PMRCD32/400SITT', 'RCD protected interlock: 1x 32A 110V 3 pin, mains isolation via RCD 30mA 2P AC, IP66 (Lewden code 661224)'),
  ('PMRCD16/401SITT', 'RCD protected interlock: 1x 16A 230V 3 pin, mains isolation via RCD 30mA 2P AC, IP66 (Lewden code 661126)'),
  ('PMRCD32/401SITT', 'RCD protected interlock: 1x 32A 230V 3 pin, mains isolation via RCD 30mA 2P AC, IP66 (Lewden code 661226)'),
  ('PMRCD16/405SITT', 'RCD protected interlock: 1x 16A 400V 4 pin, mains isolation via RCD 30mA 2P AC, IP66 (Lewden code 661136)'),
  ('PMRCD32/405SITT', 'RCD protected interlock: 1x 32A 400V 4 pin, mains isolation via RCD 30mA 2P AC, IP66 (Lewden code 661236)'),
  ('PMRCD16/408SITT', 'RCD protected interlock: 1x 16A 400V 5 pin, mains isolation via RCD 30mA 4P AC, IP66 (Lewden code 661146)'),
  ('PMRCD32/408SITT', 'RCD protected interlock: 1x 32A 400V 5 pin, mains isolation via RCD 30mA 4P AC, IP66 (Lewden code 661246)'),
  ('PM7153TT', '3 gang protected: 3x 16A 110V sockets, 1x 16A 2P Type C MCB + 1x 25A 2P 30mA RCD AC, IP66 (Lewden code 665301)'),
  ('PM7154TT', '3 gang protected: 3x 16A 110V sockets, RCD main switch, 1x 25A 2P 30mA RCD AC, IP66 (Lewden code 665302)'),
  ('PM7155TT', '3 gang protected: 3x 16A 230V sockets, 1x 16A 2P 30mA Type C RCBO, IP66 (Lewden code 665303)'),
  ('PM7156TT', '3 gang protected: 3x 16A 230V sockets, 30mA 2P RCD AC main switch, 3x 16A 1P Type C MCB, IP66 (Lewden code 665304)')
) as v(name, description)
where not exists (select 1 from presets p where p.section = 'topter' and p.name = v.name);

-- ── Check ───────────────────────────────────────────────────
-- Should list the TopTer categories with their part counts (450 in total),
-- and shared = how many took their price/description from an EV part.
select category, count(*) as parts,
       count(*) filter (where exists (
         select 1 from products e where e.section = 'ev' and upper(trim(e.part_number)) = upper(trim(products.part_number))
       )) as shared_with_ev
from products
where section = 'topter'
group by category
order by min(sort_order);
