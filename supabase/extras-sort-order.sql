-- Lets the admin reorder extras in both quote builders.
-- Run once in Supabase -> SQL Editor. Safe to run again.
-- (Parts need no SQL: products.sort_order already exists.)

alter table extras add column if not exists sort_order integer;

-- Start from the current order (by extra number)
update extras set sort_order = number * 10 where sort_order is null;
