-- Clean up parts that were removed from the catalogue but are still listed
-- in presets, prerequisites or incompatibility rules (they showed up as
-- "Unknown product" in the quote builder).
-- Run once in Supabase -> SQL Editor. Safe to run again.
--
-- Removing a product only hides it (is_active = false) so saved quotes keep
-- their lines. Nothing here touches products or quotes.

delete from preset_items
where product_id in (select id from products where is_active = false);

delete from preset_configuration_items
where product_id in (select id from products where is_active = false);

delete from product_prerequisites
where product_id in (select id from products where is_active = false)
   or prerequisite_product_id in (select id from products where is_active = false);

delete from product_incompatibilities
where product_id in (select id from products where is_active = false)
   or incompatible_product_id in (select id from products where is_active = false);

-- Extras are left alone (removing a line can change what an extra does).
-- This lists any extra line that still uses a removed part, so you can fix it
-- in Admin > Extras. The builder already skips these lines.
select e.number, e.name, ei.action, p.part_number, p.description
from extra_items ei
join extras e on e.id = ei.extra_id
join products p on p.id = ei.product_id
where p.is_active = false
order by e.number;
