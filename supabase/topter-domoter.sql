-- TopTer: domoTER modular devices
--
-- Run this once in Supabase: SQL Editor, New query, paste all of it, Run.
-- Run supabase/topter-pictures-ranges.sql first (it adds the picture and
-- range columns). Safe to run more than once.
--
-- domoTER devices (domestic sockets, switches, data/TV/USB sockets, lamps) go on
-- a topTER board inside a domoTER cap: the universal cap P579847 or the
-- watertight cap P579860. Each cap sits in a 65x83 seat and holds 2 modules.
-- The capacity check gets a new space, "domoTER modules": each cap provides 2,
-- and each device uses its own width (1 or 2 modules). Only domoTER devices use
-- that space, so a cap only takes domoTER devices and the check shows red when
-- a cap is overfilled or a device has no cap.
-- The domoTER wall-mounted boxes are not part of TopTer and are not added.
-- Source: Palazzoli General Catalogue 2023-2024, pages 45 and 50-53.

-- 1. The caps provide 2 domoTER modules. A capacity you have changed is left alone.
update public.products
set capacity = '{"provides":{"domo":2},"uses":{"sockets":1,"f65":1}}'::jsonb,
    notes = case part_number
      when 'P579847' then 'Holds 2 modules of domoTER devices. Palazzoli pack of 10.'
      else 'Holds 2 modules of domoTER devices. Recommended cap for topTER distribution boards.' end
where section = 'topter' and part_number in ('P579847', 'P579860')
  and capacity = '{"uses":{"sockets":1,"f65":1}}'::jsonb;

-- 2. The domoTER devices
insert into public.products (section, category, description, part_number, factory_cost, notes, capacity, sort_order, is_active, image_url, range_name, option_label)
select 'topter', 'Domestic sockets', v.description, v.part_number, null, v.notes, v.capacity::jsonb, v.sort_order, true,
       'parts/topter/' || v.picture || '.jpg', v.range_name, v.option_label
from (values
  ('domoTER domestic socket 13A 250V UK BS1363, 2P+E, 2 modules', 'P630056', 'Fits in a domoTER cap (P579847 or P579860). Palazzoli pack of 8.', '{"uses":{"domo":2}}', 400110, 'domoter-uk-13a', 'domoTER domestic socket', '13A 250V UK BS1363, 2 modules'),
  ('domoTER Schuko domestic socket 16A 250V P30, 2P+E, 2 modules', 'P630051', 'Fits in a domoTER cap (P579847 or P579860). Shuttered. Palazzoli pack of 8.', '{"uses":{"domo":2}}', 400120, 'domoter-schuko-p30', 'domoTER domestic socket', '16A 250V Schuko P30, 2 modules'),
  ('domoTER Schuko bivalent domestic socket 10/16A 250V P40, 2P+E, 2 modules', 'P630052', 'Fits in a domoTER cap (P579847 or P579860). Shuttered. Palazzoli pack of 8.', '{"uses":{"domo":2}}', 400130, 'domoter-schuko-p40', 'domoTER domestic socket', '10/16A 250V Schuko bivalent P40, 2 modules'),
  ('domoTER red Schuko domestic socket 16A 250V P30, 2P+E, 2 modules', 'P630053', 'Fits in a domoTER cap (P579847 or P579860). Shuttered. Palazzoli pack of 8.', '{"uses":{"domo":2}}', 400140, 'domoter-red-schuko-p30', 'domoTER domestic socket', '16A 250V red Schuko P30, 2 modules'),
  ('domoTER red Schuko bivalent domestic socket 10/16A 250V P17/P30, 2P+E, 2 modules', 'P630054', 'Fits in a domoTER cap (P579847 or P579860). Shuttered. Palazzoli pack of 8.', '{"uses":{"domo":2}}', 400150, 'domoter-red-schuko-p17-p30', 'domoTER domestic socket', '10/16A 250V red Schuko bivalent P17/P30, 2 modules'),
  ('domoTER domestic socket 16A 250V French standard, 2P+E, 2 modules', 'P630055', 'Fits in a domoTER cap (P579847 or P579860). Palazzoli pack of 8.', '{"uses":{"domo":2}}', 400160, 'domoter-french', 'domoTER domestic socket', '16A 250V French, 2 modules'),
  ('domoTER domestic socket 10/16A 250V Italian bivalent P11/P17, 2P+E, 1 module', 'P630050', 'Fits in a domoTER cap (P579847 or P579860). Shuttered. Palazzoli pack of 16.', '{"uses":{"domo":1}}', 400170, 'domoter-italian-p11-p17', 'domoTER domestic socket', '10/16A 250V Italian bivalent P11/P17, 1 module'),
  ('domoTER domestic socket 15A 127V USA standard, 2P+E, 1 module', 'P630058', 'Fits in a domoTER cap (P579847 or P579860). Palazzoli pack of 16.', '{"uses":{"domo":1}}', 400180, 'domoter-usa', 'domoTER domestic socket', '15A 127V USA, 1 module'),
  ('domoTER multifunction device: 1P or 2P switch, two-way switch, NO or NC button, 16A 250V, 1 module', 'P630030', 'Fits in a domoTER cap (P579847 or P579860). Supplied as a NO button; remove the spring for switch use. Takes warning lamp P630091. Palazzoli pack of 16.', '{"uses":{"domo":1}}', 400210, 'domoter-multifunction', 'domoTER switches and protection', 'Multifunction switch / button 16A, 1 module'),
  ('domoTER line reversing switch 16A 250V, 1 module', 'P630031', 'Fits in a domoTER cap (P579847 or P579860). Palazzoli pack of 16.', '{"uses":{"domo":1}}', 400220, 'domoter-line-reversing', 'domoTER switches and protection', 'Line reversing switch 16A, 1 module'),
  ('domoTER MCB 1P+N C16A, 3kA, 1 module', 'P630036', 'Fits in a domoTER cap (P579847 or P579860). Palazzoli pack of 20.', '{"uses":{"domo":1}}', 400230, 'domoter-mcb', 'domoTER switches and protection', 'MCB 1P+N C16A 3kA, 1 module'),
  ('domoTER fuse holder 5x20mm, 10A max, 1 module', 'P630035', 'Fits in a domoTER cap (P579847 or P579860). Fuses not included. Palazzoli pack of 16.', '{"uses":{"domo":1}}', 400240, 'domoter-fuse-holder', 'domoTER switches and protection', 'Fuse holder 5x20mm 10A, 1 module'),
  ('domoTER TV socket 9.5mm, final, 1 module', 'P630070', 'Fits in a domoTER cap (P579847 or P579860). Palazzoli pack of 16.', '{"uses":{"domo":1}}', 400310, 'domoter-tv', 'domoTER data, TV and USB sockets', 'TV 9.5mm final'),
  ('domoTER TV socket 9.5mm, through/final, 1 module', 'P630071', 'Fits in a domoTER cap (P579847 or P579860). Palazzoli pack of 16.', '{"uses":{"domo":1}}', 400320, 'domoter-tv', 'domoTER data, TV and USB sockets', 'TV 9.5mm through/final'),
  ('domoTER data socket RJ12 6/6 contacts, 1 module', 'P630080', 'Fits in a domoTER cap (P579847 or P579860). Palazzoli pack of 20.', '{"uses":{"domo":1}}', 400330, 'domoter-rj', 'domoTER data, TV and USB sockets', 'RJ12 6/6 contacts'),
  ('domoTER data socket RJ45 category 5E, 1 module', 'P630081', 'Fits in a domoTER cap (P579847 or P579860). Palazzoli pack of 20.', '{"uses":{"domo":1}}', 400340, 'domoter-rj', 'domoTER data, TV and USB sockets', 'RJ45 category 5E'),
  ('domoTER data socket RJ45 category 6, 1 module', 'P630082', 'Fits in a domoTER cap (P579847 or P579860). Palazzoli pack of 20.', '{"uses":{"domo":1}}', 400350, 'domoter-rj', 'domoTER data, TV and USB sockets', 'RJ45 category 6'),
  ('domoTER USB socket, 5V 2.1A power supply, 1 module', 'P630085', 'Fits in a domoTER cap (P579847 or P579860). Palazzoli pack of 4.', '{"uses":{"domo":1}}', 400360, 'domoter-usb', 'domoTER data, TV and USB sockets', 'USB 5V 2.1A'),
  ('domoTER signalling lamp 230V, white diffuser, 1 module', 'P630040', 'Fits in a domoTER cap (P579847 or P579860). Palazzoli pack of 16.', '{"uses":{"domo":1}}', 400410, 'domoter-lamp', 'domoTER lamps and closing cap', 'Signalling lamp 230V, white'),
  ('domoTER signalling lamp 230V, red diffuser, 1 module', 'P630041', 'Fits in a domoTER cap (P579847 or P579860). Palazzoli pack of 16.', '{"uses":{"domo":1}}', 400420, 'domoter-lamp', 'domoTER lamps and closing cap', 'Signalling lamp 230V, red'),
  ('domoTER signalling lamp 230V, green diffuser, 1 module', 'P630042', 'Fits in a domoTER cap (P579847 or P579860). Palazzoli pack of 16.', '{"uses":{"domo":1}}', 400430, 'domoter-lamp', 'domoTER lamps and closing cap', 'Signalling lamp 230V, green'),
  ('domoTER closing cap, 1 module', 'P630090', 'Blanks an unused module in a domoTER cap. Palazzoli pack of 100.', '{"uses":{"domo":1}}', 400440, 'domoter-closing-cap', 'domoTER lamps and closing cap', 'Closing cap, 1 module'),
  ('domoTER 230V warning lamp with 100mm cable', 'P630091', 'Fits inside the multifunction device P630030, or as a spare for the signalling lamps. Takes no module space. Palazzoli pack of 200.', null, 400450, 'domoter-warning-lamp', 'domoTER lamps and closing cap', 'Warning lamp for P630030, 100mm cable')
) as v(description, part_number, notes, capacity, sort_order, picture, range_name, option_label)
where not exists (
  select 1 from public.products p
  where p.section = 'topter' and upper(trim(p.part_number)) = upper(trim(v.part_number))
);

-- Check: the caps and the domoTER devices
select part_number, description, capacity, range_name
from public.products
where section = 'topter' and (part_number in ('P579847', 'P579860') or part_number like 'P630%')
order by sort_order;
