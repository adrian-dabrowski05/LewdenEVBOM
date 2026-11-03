-- ============================================================
-- Carriage cost on quotes
-- Run once in Supabase -> SQL Editor BEFORE deploying the code.
-- Safe to run more than once.
-- ============================================================

-- Carriage in £, charged at face value: no hardware uplift, no labour.
-- It is added to grand_total after everything else. Old quotes get 0.
alter table quotes add column if not exists carriage numeric not null default 0;
