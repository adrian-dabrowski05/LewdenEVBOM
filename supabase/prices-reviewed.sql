-- "Prices last reviewed" date (Admin > Settings), shown at the top of the quote builder.
-- Adds an empty settings row so the admin can save a date. Safe to run more than once.
insert into settings (key, value)
select 'prices_reviewed_at', ''
where not exists (select 1 from settings where key = 'prices_reviewed_at');
