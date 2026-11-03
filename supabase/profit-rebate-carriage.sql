-- ============================================================
-- Carriage moved below the rebate (no profit or rebate on carriage)
-- Optional tidy-up: run once in Supabase -> SQL Editor. Safe to run more than once.
-- Needs profit-rebate.sql to have been run first.
-- ============================================================

-- The app works these out itself, so this only corrects the stored
-- quote_price / total_quote columns for quotes saved before this change.
-- grand_total still = factory cost + carriage, so factory cost = grand_total - carriage.
-- (Margin formula, matching GP_MODE = 'margin' in src/utils/pricing.ts.)
update quotes set
  quote_price = (grand_total - coalesce(carriage, 0)) / (1 - least(gross_profit_pct, 99.9) / 100),
  total_quote = (grand_total - coalesce(carriage, 0)) / (1 - least(gross_profit_pct, 99.9) / 100)
                * (1 - least(rebate_pct, 100) / 100)
                + coalesce(carriage, 0);
