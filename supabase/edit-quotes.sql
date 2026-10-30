-- ============================================================
-- Edit saved quotes
-- Run once in Supabase -> SQL Editor BEFORE deploying the code.
-- Safe to run more than once.
-- ============================================================

-- 1. What the rep built (their own quantities, ticked extras, rating/cabinet,
--    labour minutes) so a saved quote can be put back into the builder.
--    quote_items only holds the final quantities after extras.
alter table quotes add column if not exists build jsonb;

-- 2. Reps (not signed in) can update a whole quote, not just its status
drop policy if exists "Anyone can update quote status" on quotes;
drop policy if exists "Anyone can update quotes" on quotes;
create policy "Anyone can update quotes"
  on quotes for update using (true) with check (true);

-- 3. When a quote is updated its old lines are replaced, so reps need to be
--    able to delete quote items (deleting whole quotes stays admin-only)
drop policy if exists "Anyone can delete quote items" on quote_items;
create policy "Anyone can delete quote items"
  on quote_items for delete using (true);
