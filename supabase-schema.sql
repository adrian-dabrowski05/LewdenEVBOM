-- ============================================================
-- Lewden EV BOM Calculator — Supabase Schema
-- Run this in your Supabase SQL editor (Dashboard > SQL Editor)
-- ============================================================

-- Enable UUID extension (already enabled by default in Supabase)
create extension if not exists "pgcrypto";

-- ── Products ────────────────────────────────────────────────
create table if not exists products (
  id           uuid primary key default gen_random_uuid(),
  category     text not null,
  description  text not null,
  part_number  text,
  factory_cost numeric(10,2),
  notes        text,
  sort_order   integer default 0,
  is_active    boolean default true,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ── Quotes ──────────────────────────────────────────────────
create table if not exists quotes (
  id             uuid primary key default gen_random_uuid(),
  project_name   text not null,
  customer_name  text,
  notes          text,
  grand_total    numeric(10,2) default 0,
  status         text default 'draft' check (status in ('draft','sent','accepted','declined')),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- ── Quote Items ──────────────────────────────────────────────
create table if not exists quote_items (
  id              uuid primary key default gen_random_uuid(),
  quote_id        uuid references quotes(id) on delete cascade not null,
  product_id      uuid references products(id) on delete set null,
  description     text not null,
  part_number     text,
  factory_cost    numeric(10,2),
  quantity        integer not null check (quantity > 0),
  line_total      numeric(10,2),
  created_at      timestamptz default now()
);

-- ── Indexes ──────────────────────────────────────────────────
create index if not exists idx_products_category on products(category);
create index if not exists idx_products_active on products(is_active);
create index if not exists idx_quote_items_quote on quote_items(quote_id);
create index if not exists idx_quotes_created on quotes(created_at desc);

-- ── Auto-update updated_at ───────────────────────────────────
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace trigger products_updated_at
  before update on products
  for each row execute function update_updated_at();

create or replace trigger quotes_updated_at
  before update on quotes
  for each row execute function update_updated_at();

-- ── RLS Policies ─────────────────────────────────────────────
-- Products: anyone can read active products; only admin (authenticated) can write
alter table products enable row level security;

create policy "Anyone can read active products"
  on products for select
  using (is_active = true);

create policy "Admin can do everything on products"
  on products for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Quotes: anyone can read/create; only admin can delete
alter table quotes enable row level security;

create policy "Anyone can read quotes"
  on quotes for select using (true);

create policy "Anyone can create quotes"
  on quotes for insert with check (true);

create policy "Anyone can update quote status"
  on quotes for update using (true);

create policy "Admin can delete quotes"
  on quotes for delete
  using (auth.role() = 'authenticated');

-- Quote items: follow quote access
alter table quote_items enable row level security;

create policy "Anyone can read quote items"
  on quote_items for select using (true);

create policy "Anyone can create quote items"
  on quote_items for insert with check (true);

create policy "Admin can delete quote items"
  on quote_items for delete
  using (auth.role() = 'authenticated');

-- ── Seed Data ────────────────────────────────────────────────
insert into products (category, description, part_number, factory_cost, sort_order) values
-- Steelworks
('Steelworks', 'EV Pillar Size 1 Mild Steel — 36 Modules — 560mm Wide', '', null, 1),
('Steelworks', 'EV Pillar Size 2 Mild Steel — 75 Modules — 880mm Wide', 'LCR1752', 20.00, 2),
('Steelworks', 'EV Pillar Size 3 Mild Steel — 112 Modules — 1520mm Wide', 'LCR1752', 30.00, 3),
('Steelworks', 'EV Pillar Size 1 Stainless Steel — 36 Modules — 560mm Wide', '', null, 4),
('Steelworks', 'EV Pillar Size 2 Stainless Steel — 75 Modules — 880mm Wide', '', null, 5),
('Steelworks', 'EV Pillar Size 3 Stainless Steel — 112 Modules — 1520mm Wide', '', null, 6),
-- Accessories
('Accessories', 'Size 1 Internals Mild Steel', 'LCR1764', null, 10),
('Accessories', 'EV Pillar Root Size 1 Stainless Steel', 'LCR1759', null, 11),
('Accessories', 'Size 2 Internals Mild Steel', 'LCR1766', null, 12),
('Accessories', 'EV Pillar Root Size 2 Stainless Steel', 'LCR1761', null, 13),
('Accessories', 'Size 3 Internals Mild Steel', 'LCR1768', null, 14),
('Accessories', 'EV Pillar Root Size 3 Stainless Steel', 'LCR1763', null, 15),
-- Incomers
('Incomers', '100A 4P Switch Disconnector Kit', 'LCR1856', null, 20),
('Incomers', '125A 4P Switch Disconnector Kit', 'LCR1857', null, 21),
('Incomers', '200A 4P Switch Disconnector Kit', 'LCR1859', null, 22),
('Incomers', '400A 4P Switch Disconnector Kit', 'LCR1862', null, 23),
('Incomers', '630A 4P Switch Disconnector Kit', 'LCR1863', null, 24),
-- Distribution
('Distribution', '363A Copper Bar', 'LCR0882', null, 30),
('Distribution', '400A Copper Bar', 'LCR1787', null, 31),
('Distribution', '630A Copper Bar', 'LCR1788', null, 32),
('Distribution', 'Insulators 30mm M6', 'LCR0505', null, 33),
('Distribution', 'Insulators 35mm M6', 'LCR0487', null, 34),
('Distribution', 'Insulators 35mm M8 (630A Only)', 'LCR0887', null, 35),
-- PEN Fault Protection
('PEN Fault Protection', 'Matt.e Controller', 'LCR1703', null, 40),
('PEN Fault Protection', 'Matt.e 5 Pole Switch', 'LCR1704', null, 41),
('PEN Fault Protection', 'Matt.e Guardian', 'LCR2009', null, 42),
('PEN Fault Protection', 'Matt.e Contactor Interlock', 'LCR1772', null, 43),
('PEN Fault Protection', '6A MCB 3 Pole Reference', 'BE10-3C06', null, 44),
('PEN Fault Protection', 'Key Switch', 'LCR1727', null, 45),
('PEN Fault Protection', 'Contacts for Key Switch', 'LCR1728', null, 46),
('PEN Fault Protection', 'Single Busbar Support (N and E)', 'LCR0790', null, 47),
('PEN Fault Protection', 'Bar for Busbar Support (N and E)', 'LCR0791', null, 48),
('PEN Fault Protection', 'Clamps 1.5–16mm (N and E)', 'LCR0792', null, 49),
('PEN Fault Protection', 'Clamps 2.5–35mm (N and E)', 'LCR0793', null, 50),
-- Outgoing
('Outgoing', '6A MCB 1P C 10kA', 'BE10-1C06', null, 60),
('Outgoing', '6A MCB 3P C 10kA', 'BE10-3C06', null, 61),
('Outgoing', '16A MCB 1P C 10kA', 'BE10-1C16', null, 62),
('Outgoing', '40A MCB 1P C 10kA', 'BE10-1C40', null, 63),
('Outgoing', '40A MCB 3P C 10kA', 'BE10-3C40', null, 64),
('Outgoing', '63A MCB 3P C 10kA — 54mm Wide', 'BE10-3C63', null, 65),
('Outgoing', '80A MCB 3P C 15kA — 81mm Wide', 'LCR1773', null, 66),
('Outgoing', '63A RCD 2P A 6kA', 'B63/30/2A', null, 67),
('Outgoing', '63A RCD 4P A 10kA — 72mm Wide', 'BRCD10-63/30/4A', null, 68),
('Outgoing', '100A RCD 2P A 6kA', 'B100/30/2A', null, 69),
('Outgoing', '100A RCD 4P A 10kA', 'BRCD10-100/30/4A', null, 70),
('Outgoing', '16A RCBO (Socket)', 'RCBO-16/30/1MCA', null, 71),
-- Ancillary Equipment
('Ancillary Equipment', '3ph Surge Protection Type 1', '', null, 80),
('Ancillary Equipment', '3ph Surge Protection Type 2', '', null, 81),
('Ancillary Equipment', '50W Heater', '', null, 82),
('Ancillary Equipment', 'Thermostat', '', null, 83),
('Ancillary Equipment', '6A MCB 1P C 10kA', '', null, 84)
on conflict do nothing;
