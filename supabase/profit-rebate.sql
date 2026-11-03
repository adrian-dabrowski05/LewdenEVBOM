-- ============================================================
-- Gross profit % and rebate % on quotes
-- Run once in Supabase -> SQL Editor BEFORE deploying the code.
-- Safe to run more than once.
-- ============================================================

-- grand_total keeps its name in the database but is now shown as "Factory cost".
-- quote price  = factory cost / (1 - gross_profit_pct / 100)   (GP % is margin)
-- total quote  = quote price - (quote price * rebate_pct / 100)
alter table quotes add column if not exists gross_profit_pct numeric not null default 0;
alter table quotes add column if not exists rebate_pct       numeric not null default 0;
alter table quotes add column if not exists quote_price      numeric;
alter table quotes add column if not exists total_quote      numeric;

-- Old quotes had no profit or rebate, so their prices equal the factory cost
update quotes set quote_price = grand_total where quote_price is null;
update quotes set total_quote = grand_total where total_quote is null;
