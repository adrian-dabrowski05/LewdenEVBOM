-- Item compatibility rules: pairs of parts that can't go on the same quote.
-- Run once in Supabase -> SQL Editor, before the new code deploys. Safe to run again.
--
-- One row per pair. A pair works both ways: if A is incompatible with B, then
-- B is greyed out when A is on the quote, and A is greyed out when B is.
-- The app always saves the pair with the smaller id first, so a pair is only
-- ever stored once.

create table if not exists product_incompatibilities (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  incompatible_product_id uuid not null references products(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint product_incompatibilities_pair unique (product_id, incompatible_product_id),
  constraint product_incompatibilities_not_self check (product_id <> incompatible_product_id)
);

-- Security (same pattern as products: everyone reads, admin writes)
alter table product_incompatibilities enable row level security;

drop policy if exists "Anyone can read incompatibilities" on product_incompatibilities;
create policy "Anyone can read incompatibilities" on product_incompatibilities for select using (true);
drop policy if exists "Admin can do everything on incompatibilities" on product_incompatibilities;
create policy "Admin can do everything on incompatibilities" on product_incompatibilities for all
  to authenticated using (true) with check (true);
