-- ============================================================
-- Lewden EV BOM — Quote Extras (1–13)
-- Run once in Supabase → SQL Editor BEFORE deploying the code.
-- Safe to re-run: it skips anything that already exists.
-- ============================================================

-- ── 1. Allow the new "Extras" product category ──────────────
-- Drops any CHECK constraint on products.category and re-adds it
-- with "Extras" included (does nothing if there is no constraint).
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
      'Outgoing','Ancillary Equipment','Extras'));
  end if;
end $$;

-- ── 2. Tables ───────────────────────────────────────────────
create table if not exists extras (
  id                uuid primary key default gen_random_uuid(),
  number            integer not null unique,
  name              text not null,
  description       text,
  is_enabled        boolean not null default true,     -- false = greyed out
  labour_minutes    numeric not null default 0,
  allowed_ratings   integer[],                         -- e.g. {100,125}; null = any rating
  allowed_materials text[],                            -- e.g. {mild_steel}; null = any cabinet
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create table if not exists extra_items (
  id               uuid primary key default gen_random_uuid(),
  extra_id         uuid not null references extras(id) on delete cascade,
  product_id       uuid not null references products(id) on delete cascade,
  action           text not null default 'add' check (action in ('add','remove')),
  quantity         numeric not null default 1 check (quantity > 0),
  condition_rating integer,           -- only applies at this current rating (e.g. 125)
  condition_size   integer,           -- only applies to this cabinet size (1, 2 or 3)
  only_if_removed  boolean not null default false,  -- add only if this extra's removals found something
  sort_order       integer not null default 0,
  created_at       timestamptz default now()
);
create index if not exists idx_extra_items_extra on extra_items(extra_id);

-- Ticked extras saved on each quote: [{ "number": 2, "name": "...", "labour_minutes": 0 }]
alter table quotes add column if not exists extras jsonb not null default '[]'::jsonb;

drop trigger if exists extras_updated_at on extras;
create trigger extras_updated_at before update on extras
  for each row execute function update_updated_at();

-- ── 3. Security (same pattern as products: everyone reads, admin writes) ──
alter table extras enable row level security;
alter table extra_items enable row level security;

drop policy if exists "Anyone can read extras" on extras;
create policy "Anyone can read extras" on extras for select using (true);
drop policy if exists "Admin can do everything on extras" on extras;
create policy "Admin can do everything on extras" on extras for all
  to authenticated using (true) with check (true);

drop policy if exists "Anyone can read extra items" on extra_items;
create policy "Anyone can read extra items" on extra_items for select using (true);
drop policy if exists "Admin can do everything on extra items" on extra_items;
create policy "Admin can do everything on extra items" on extra_items for all
  to authenticated using (true) with check (true);

-- ── 4. Parts used by extras ─────────────────────────────────
-- Added to the "Extras" category only if that part number isn't already in
-- the catalogue. Existing parts keep their category; their price is only
-- filled in if it is currently blank. Rename descriptions in Admin later.
with new_parts(part_number, description, factory_cost) as (values
  ('SRG3123',            'Type 1 surge protection device',         61.41),
  ('BFD22581',           'Fuse (BFD22581)',                         3.54),
  ('BF063A',             'BF063A (description to follow)',          0.92),
  ('LCR1703',            'Open PEN fault protection (LCR1703)',   320.00),
  ('LCR1727',            'LCR1727',                                19.92),
  ('LCR1728',            'LCR1728',                                 4.40),
  ('E10-3C06',           'E10-3C06',                                6.13),
  ('LCR1704',            'LCR1704',                               150.00),
  ('B100/30/2B',         'RCCB Type B 100A 30mA 2P (B100/30/2B)',  28.82),
  ('BRCBO10-16/30/1MBA', 'RCBO 16A 30mA (BRCBO10-16/30/1MBA)',     12.60),
  ('P579831',            '13A socket (P579831)',                    6.40),
  ('BE10-1B06',          'BE10-1B06',                               1.45),
  ('LCR1770',            'Internal cabinet light (LCR1770)',       49.61),
  ('LCR1771',            'LCR1771',                                 8.28),
  ('BIC63/4',            'BIC63/4',                                 5.98),
  ('LCR0342',            'Photocell (LCR0342)',                    10.80),
  ('BE10-3B06',          'BE10-3B06',                               6.13),
  ('LCR0973',            'MID meter (LCR0973)',                    38.41),
  ('LCR0678',            'LCR0678',                                 0.87),
  ('LCR0651',            'LCR0651',                                 1.47),
  ('LCR1797',            'LCR1797',                                89.31)
)
insert into products (category, description, part_number, factory_cost, sort_order, is_active)
select 'Extras', np.description, np.part_number, np.factory_cost,
       9000 + row_number() over (), true
from new_parts np
where not exists (
  select 1 from products p
  where p.is_active and upper(trim(p.part_number)) = upper(np.part_number)
);

update products p set factory_cost = v.cost
from (values ('SRG3123',61.41),('BFD22581',3.54),('BF063A',0.92),('LCR1703',320.00),
             ('LCR1727',19.92),('LCR1728',4.40),('E10-3C06',6.13),('LCR1704',150.00),
             ('B100/30/2B',28.82),('BRCBO10-16/30/1MBA',12.60),('P579831',6.40),
             ('BE10-1B06',1.45),('LCR1770',49.61),('LCR1771',8.28),('BIC63/4',5.98),
             ('LCR0342',10.80),('BE10-3B06',6.13),('LCR0973',38.41),('LCR0678',0.87),
             ('LCR0651',1.47),('LCR1797',89.31)) as v(pn, cost)
where p.is_active and p.factory_cost is null and upper(trim(p.part_number)) = v.pn;

-- Zinc rich base coat primer: one line per cabinet size, no part number
insert into products (category, description, part_number, factory_cost, sort_order, is_active)
select 'Extras', v.description, null, v.cost, v.sort_order, true
from (values ('Zinc rich base coat primer — size 1 cabinet', 178.00, 9101),
             ('Zinc rich base coat primer — size 2 cabinet', 229.00, 9102),
             ('Zinc rich base coat primer — size 3 cabinet', 485.00, 9103)) as v(description, cost, sort_order)
where not exists (select 1 from products p where p.is_active and p.description = v.description);

-- ── 5. The 13 extras ────────────────────────────────────────
insert into extras (number, name, is_enabled, labour_minutes, allowed_ratings, allowed_materials) values
  ( 1, 'Number and mix of outgoing circuits', false,  0, null, null),
  ( 2, 'Type 1 surge protection',             true,   0, null, null),
  ( 3, 'MCCB incomer',                        false,  0, null, null),
  ( 4, 'Open PEN fault protection',           true,   0, '{100,125}', null),
  ( 5, 'Type B RCD',                          true,   0, null, null),
  ( 6, '13A RCBO socket',                     true,   0, null, null),
  ( 7, 'Internal cabinet light',              true,  30, null, null),
  ( 8, 'Photocell external lighting circuit', true,  60, null, null),
  ( 9, 'MID meter',                           true,  60, null, null),
  (10, 'Non-standard colour',                 false,  0, null, null),
  (11, 'Brushed stainless finish',            false,  0, null, null),
  (12, 'Future proofing',                     false,  0, null, null),
  (13, 'Zinc rich base coat primer',          true,   0, null, '{mild_steel}')
on conflict (number) do nothing;

-- ── 6. What each extra does ─────────────────────────────────
-- Only seeded for extras that have no items yet, so re-running won't duplicate.
with pid as (
  select distinct on (upper(trim(part_number))) upper(trim(part_number)) as pn, id
  from products where is_active and part_number is not null
  order by upper(trim(part_number)), sort_order
),
lines(extra_no, pn, action, qty, cond_rating, cond_size, only_if_removed, sort_order) as (values
  -- 2: Type 1 surge — swap the type 2 surge and the RCCB
  (2,  'SRG3V1G',            'remove', 1, null::int, null::int, false, 10),
  (2,  'B100/30/2A',         'remove', 1, null, null, false, 20),
  (2,  'B100/30/2B',         'remove', 1, null, null, false, 30),
  (2,  'SRG3123',            'add',    1, null, null, false, 40),
  (2,  'BFD22581',           'add',    3, null, null, false, 50),
  (2,  'BF063A',             'add',    1, null, null, false, 60),
  -- 4: Open PEN fault protection (100A / 125A only)
  (4,  'LCR1703',            'add',    1, null, null, false, 10),
  (4,  'LCR1727',            'add',    1, null, null, false, 20),
  (4,  'LCR1728',            'add',    1, null, null, false, 30),
  (4,  'E10-3C06',           'add',    1, null, null, false, 40),
  (4,  'LCR1704',            'add',    1, 100,  null, false, 50),
  (4,  'LCR1704',            'add',    2, 125,  null, false, 60),
  -- 5: Type B RCD — swap 2A RCCB for 2B
  (5,  'B100/30/2A',         'remove', 1, null, null, false, 10),
  (5,  'B100/30/2B',         'add',    1, null, null, true,  20),
  -- 6: 13A RCBO socket
  (6,  'BRCBO10-16/30/1MBA', 'add',    1, null, null, false, 10),
  (6,  'P579831',            'add',    1, null, null, false, 20),
  -- 7: Internal cabinet light
  (7,  'BE10-1B06',          'add',    1, null, null, false, 10),
  (7,  'LCR1770',            'add',    1, null, null, false, 20),
  (7,  'LCR1771',            'add',    1, null, null, false, 30),
  -- 8: Photocell external lighting circuit
  (8,  'BIC63/4',            'add',    1, null, null, false, 10),
  (8,  'BRCBO10-16/30/1MBA', 'add',    1, null, null, false, 20),
  (8,  'LCR0342',            'add',    1, null, null, false, 30),
  -- 9: MID meter
  (9,  'BE10-3B06',          'add',    1, null, null, false, 10),
  (9,  'LCR0973',            'add',    1, null, null, false, 20),
  (9,  'LCR0678',            'add',    1, null, null, false, 30),
  (9,  'LCR0651',            'add',    1, null, null, false, 40),
  (9,  'LCR1797',            'add',    1, null, null, false, 50)
)
insert into extra_items (extra_id, product_id, action, quantity, condition_rating, condition_size, only_if_removed, sort_order)
select e.id, pid.id, l.action, l.qty, l.cond_rating, l.cond_size, l.only_if_removed, l.sort_order
from lines l
join extras e on e.number = l.extra_no
join pid on pid.pn = l.pn
where not exists (select 1 from extra_items ei where ei.extra_id = e.id);

-- 13: Zinc primer, priced by cabinet size
insert into extra_items (extra_id, product_id, action, quantity, condition_size, sort_order)
select e.id, p.id, 'add', 1, v.size, v.size * 10
from extras e
join (values (1, 'Zinc rich base coat primer — size 1 cabinet'),
             (2, 'Zinc rich base coat primer — size 2 cabinet'),
             (3, 'Zinc rich base coat primer — size 3 cabinet')) as v(size, description) on true
join products p on p.description = v.description and p.is_active
where e.number = 13
  and not exists (select 1 from extra_items ei where ei.extra_id = e.id);

-- ── 7. Check: any part numbers the extras needed but couldn't find ──
-- Should return no rows. If SRG3V1G or B100/30/2A show up, add them in
-- Admin → Product catalogue and then add them to Extra 2 / 5 in Admin → Extras.
select pn as missing_part_number
from unnest(array['SRG3V1G','B100/30/2A']) as pn
where not exists (select 1 from products p where p.is_active and upper(trim(p.part_number)) = pn);
