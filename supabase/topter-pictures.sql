-- ════════════════════════════════════════════════════════════════════
-- TopTer part pictures
-- Run this once in Supabase → SQL Editor → New query → Run.
-- Run it after topter-section.sql. It is safe to run more than once.
--
-- 1. Adds products.image_url (the picture shown next to a part).
-- 2. Creates the 'part-pictures' storage bucket, so admins can upload pictures
--    from Admin → Product catalogue → Picture. Anyone can view them; only a
--    signed-in admin can upload, change or delete them.
-- 3. Fills in pictures for 218 Palazzoli TopTer parts, taken from the
--    Palazzoli General Catalogue 2023-2024. The picture files are in the app
--    itself (public/parts/topter). Parts that already have a picture are left
--    alone, so pictures you have uploaded are never replaced.
--
-- EV parts are not changed, and EV does not show pictures.
-- ════════════════════════════════════════════════════════════════════

-- 1. Picture column
alter table public.products add column if not exists image_url text;

-- 2. Storage bucket for uploaded pictures
insert into storage.buckets (id, name, public)
values ('part-pictures', 'part-pictures', true)
on conflict (id) do update set public = true;

drop policy if exists "Part pictures: anyone can view" on storage.objects;
create policy "Part pictures: anyone can view" on storage.objects
  for select using (bucket_id = 'part-pictures');

drop policy if exists "Part pictures: admin can upload" on storage.objects;
create policy "Part pictures: admin can upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'part-pictures');

drop policy if exists "Part pictures: admin can change" on storage.objects;
create policy "Part pictures: admin can change" on storage.objects
  for update to authenticated using (bucket_id = 'part-pictures');

drop policy if exists "Part pictures: admin can delete" on storage.objects;
create policy "Part pictures: admin can delete" on storage.objects
  for delete to authenticated using (bucket_id = 'part-pictures');

-- 3. Pictures from the Palazzoli catalogue, one per product range
update public.products p
set image_url = v.image_url
from (values
  ('P579822', 'parts/topter/board-2-sockets.jpg'),
  ('P579823', 'parts/topter/board-3-sockets.jpg'),
  ('P579824', 'parts/topter/board-4-sockets.jpg'),
  ('P579826', 'parts/topter/board-6-sockets.jpg'),
  ('P579828', 'parts/topter/board-8-sockets.jpg'),
  ('P579863', 'parts/topter/board-3-sockets-63a.jpg'),
  ('P579865', 'parts/topter/board-5-sockets-63a.jpg'),
  ('P579741', 'parts/topter/board-1-switched-window.jpg'),
  ('P579742', 'parts/topter/board-2-switched-window.jpg'),
  ('P579743', 'parts/topter/board-3-switched-window.jpg'),
  ('P579744', 'parts/topter/board-4-switched-window.jpg'),
  ('P579721', 'parts/topter/board-1-switched-blind.jpg'),
  ('P579722', 'parts/topter/board-2-switched-blind.jpg'),
  ('P579723', 'parts/topter/board-3-switched-blind.jpg'),
  ('P579451', 'parts/topter/window-cover-din.jpg'),
  ('P579452', 'parts/topter/window-cover-din.jpg'),
  ('P579453', 'parts/topter/window-cover-din.jpg'),
  ('P579421', 'parts/topter/board-63a-blind.jpg'),
  ('P579422', 'parts/topter/board-63a-blind.jpg'),
  ('P579423', 'parts/topter/board-63a-blind.jpg'),
  ('P579631', 'parts/topter/board-63a-window.jpg'),
  ('P579622', 'parts/topter/board-63a-window.jpg'),
  ('P579623', 'parts/topter/board-63a-window.jpg'),
  ('P579750', 'parts/topter/back-box-1-socket.jpg'),
  ('P579751', 'parts/topter/back-box-1-socket.jpg'),
  ('P579702', 'parts/topter/back-box-2-devices.jpg'),
  ('P579703', 'parts/topter/back-box-3-devices.jpg'),
  ('P579710', 'parts/topter/bottom-box-wall-lock-switch.jpg'),
  ('P579712', 'parts/topter/bottom-box-flush-lock-switch.jpg'),
  ('P579711', 'parts/topter/bottom-box-panel-lock-switch.jpg'),
  ('P579400', 'parts/topter/bottom-box-wall-63a.jpg'),
  ('P575502', 'parts/topter/bottom-box-panel-63a.jpg'),
  ('P579708', 'parts/topter/control-unit-wall.jpg'),
  ('P579709', 'parts/topter/control-unit-wall.jpg'),
  ('P575506', 'parts/topter/control-unit-panel.jpg'),
  ('P575505', 'parts/topter/box-flush-with-cover.jpg'),
  ('P488124', 'parts/topter/fixed-socket-ip44.jpg'),
  ('P488134', 'parts/topter/fixed-socket-ip44.jpg'),
  ('P488144', 'parts/topter/fixed-socket-ip44.jpg'),
  ('P488126', 'parts/topter/fixed-socket-ip44.jpg'),
  ('P488139', 'parts/topter/fixed-socket-ip44.jpg'),
  ('P488149', 'parts/topter/fixed-socket-ip44.jpg'),
  ('P488129', 'parts/topter/fixed-socket-ip44.jpg'),
  ('P488136', 'parts/topter/fixed-socket-ip44.jpg'),
  ('P488146', 'parts/topter/fixed-socket-ip44.jpg'),
  ('P488224', 'parts/topter/fixed-socket-ip44.jpg'),
  ('P488234', 'parts/topter/fixed-socket-ip44.jpg'),
  ('P488244', 'parts/topter/fixed-socket-ip44.jpg'),
  ('P488226', 'parts/topter/fixed-socket-ip44.jpg'),
  ('P488239', 'parts/topter/fixed-socket-ip44.jpg'),
  ('P488249', 'parts/topter/fixed-socket-ip44.jpg'),
  ('P488229', 'parts/topter/fixed-socket-ip44.jpg'),
  ('P488236', 'parts/topter/fixed-socket-ip44.jpg'),
  ('P488246', 'parts/topter/fixed-socket-ip44.jpg'),
  ('P489124', 'parts/topter/fixed-socket-ip67.jpg'),
  ('P489134', 'parts/topter/fixed-socket-ip67.jpg'),
  ('P489144', 'parts/topter/fixed-socket-ip67.jpg'),
  ('P489126', 'parts/topter/fixed-socket-ip67.jpg'),
  ('P489139', 'parts/topter/fixed-socket-ip67.jpg'),
  ('P489149', 'parts/topter/fixed-socket-ip67.jpg'),
  ('P489129', 'parts/topter/fixed-socket-ip67.jpg'),
  ('P489136', 'parts/topter/fixed-socket-ip67.jpg'),
  ('P489146', 'parts/topter/fixed-socket-ip67.jpg'),
  ('P489224', 'parts/topter/fixed-socket-ip67.jpg'),
  ('P489234', 'parts/topter/fixed-socket-ip67.jpg'),
  ('P489244', 'parts/topter/fixed-socket-ip67.jpg'),
  ('P489226', 'parts/topter/fixed-socket-ip67.jpg'),
  ('P489239', 'parts/topter/fixed-socket-ip67.jpg'),
  ('P489249', 'parts/topter/fixed-socket-ip67.jpg'),
  ('P489229', 'parts/topter/fixed-socket-ip67.jpg'),
  ('P489236', 'parts/topter/fixed-socket-ip67.jpg'),
  ('P489246', 'parts/topter/fixed-socket-ip67.jpg'),
  ('P489233', 'parts/topter/fixed-socket-ip67.jpg'),
  ('P489326', 'parts/topter/fixed-socket-63a-ip67.jpg'),
  ('P489336', 'parts/topter/fixed-socket-63a-ip67.jpg'),
  ('P489346', 'parts/topter/fixed-socket-63a-ip67.jpg'),
  ('P488114', 'parts/topter/compact-panel-socket.jpg'),
  ('P488116', 'parts/topter/compact-panel-socket.jpg'),
  ('P438124', 'parts/topter/wall-socket-15deg-ip44.jpg'),
  ('P438126', 'parts/topter/wall-socket-15deg-ip44.jpg'),
  ('P438136', 'parts/topter/wall-socket-15deg-ip44.jpg'),
  ('P438146', 'parts/topter/wall-socket-15deg-ip44.jpg'),
  ('P438224', 'parts/topter/wall-socket-15deg-ip44.jpg'),
  ('P438226', 'parts/topter/wall-socket-15deg-ip44.jpg'),
  ('P438236', 'parts/topter/wall-socket-15deg-ip44.jpg'),
  ('P438246', 'parts/topter/wall-socket-15deg-ip44.jpg'),
  ('P508124', 'parts/topter/wall-socket-90deg-ip44.jpg'),
  ('P508126', 'parts/topter/wall-socket-90deg-ip44.jpg'),
  ('P508136', 'parts/topter/wall-socket-90deg-ip44.jpg'),
  ('P508146', 'parts/topter/wall-socket-90deg-ip44.jpg'),
  ('P508224', 'parts/topter/wall-socket-90deg-ip44.jpg'),
  ('P508226', 'parts/topter/wall-socket-90deg-ip44.jpg'),
  ('P508236', 'parts/topter/wall-socket-90deg-ip44.jpg'),
  ('P508246', 'parts/topter/wall-socket-90deg-ip44.jpg'),
  ('P439124', 'parts/topter/wall-socket-15deg-ip67.jpg'),
  ('P439126', 'parts/topter/wall-socket-15deg-ip67.jpg'),
  ('P439136', 'parts/topter/wall-socket-15deg-ip67.jpg'),
  ('P439146', 'parts/topter/wall-socket-15deg-ip67.jpg'),
  ('P439224', 'parts/topter/wall-socket-15deg-ip67.jpg'),
  ('P439226', 'parts/topter/wall-socket-15deg-ip67.jpg'),
  ('P439236', 'parts/topter/wall-socket-15deg-ip67.jpg'),
  ('P439246', 'parts/topter/wall-socket-15deg-ip67.jpg'),
  ('P439233', 'parts/topter/wall-socket-15deg-ip67.jpg'),
  ('P509124', 'parts/topter/wall-socket-90deg-ip67.jpg'),
  ('P509126', 'parts/topter/wall-socket-90deg-ip67.jpg'),
  ('P509136', 'parts/topter/wall-socket-90deg-ip67.jpg'),
  ('P509146', 'parts/topter/wall-socket-90deg-ip67.jpg'),
  ('P509224', 'parts/topter/wall-socket-90deg-ip67.jpg'),
  ('P509226', 'parts/topter/wall-socket-90deg-ip67.jpg'),
  ('P509236', 'parts/topter/wall-socket-90deg-ip67.jpg'),
  ('P509246', 'parts/topter/wall-socket-90deg-ip67.jpg'),
  ('P509233', 'parts/topter/wall-socket-90deg-ip67.jpg'),
  ('P509326', 'parts/topter/wall-socket-90deg-ip67.jpg'),
  ('P509336', 'parts/topter/wall-socket-90deg-ip67.jpg'),
  ('P509346', 'parts/topter/wall-socket-90deg-ip67.jpg'),
  ('P492124', 'parts/topter/interlocked-ip44.jpg'),
  ('P492126', 'parts/topter/interlocked-ip44.jpg'),
  ('P492136', 'parts/topter/interlocked-ip44.jpg'),
  ('P492146', 'parts/topter/interlocked-ip44.jpg'),
  ('P492226', 'parts/topter/interlocked-ip44.jpg'),
  ('P492236', 'parts/topter/interlocked-ip44.jpg'),
  ('P492246', 'parts/topter/interlocked-ip44.jpg'),
  ('P190124', 'parts/topter/interlocked-ip44-fuse.jpg'),
  ('P190126', 'parts/topter/interlocked-ip44-fuse.jpg'),
  ('P190136', 'parts/topter/interlocked-ip44-fuse.jpg'),
  ('P190146', 'parts/topter/interlocked-ip44-fuse.jpg'),
  ('P190226', 'parts/topter/interlocked-ip44-fuse.jpg'),
  ('P190236', 'parts/topter/interlocked-ip44-fuse.jpg'),
  ('P190246', 'parts/topter/interlocked-ip44-fuse.jpg'),
  ('P491124', 'parts/topter/interlocked-ip67.jpg'),
  ('P491134', 'parts/topter/interlocked-ip67.jpg'),
  ('P491144', 'parts/topter/interlocked-ip67.jpg'),
  ('P491126', 'parts/topter/interlocked-ip67.jpg'),
  ('P491139', 'parts/topter/interlocked-ip67.jpg'),
  ('P491149', 'parts/topter/interlocked-ip67.jpg'),
  ('P491129', 'parts/topter/interlocked-ip67.jpg'),
  ('P491136', 'parts/topter/interlocked-ip67.jpg'),
  ('P491146', 'parts/topter/interlocked-ip67.jpg'),
  ('P491224', 'parts/topter/interlocked-ip67.jpg'),
  ('P491234', 'parts/topter/interlocked-ip67.jpg'),
  ('P491244', 'parts/topter/interlocked-ip67.jpg'),
  ('P491226', 'parts/topter/interlocked-ip67.jpg'),
  ('P491239', 'parts/topter/interlocked-ip67.jpg'),
  ('P491249', 'parts/topter/interlocked-ip67.jpg'),
  ('P491229', 'parts/topter/interlocked-ip67.jpg'),
  ('P491236', 'parts/topter/interlocked-ip67.jpg'),
  ('P491246', 'parts/topter/interlocked-ip67.jpg'),
  ('P491233', 'parts/topter/interlocked-ip67.jpg'),
  ('P490124', 'parts/topter/interlocked-ip67-fuse.jpg'),
  ('P490134', 'parts/topter/interlocked-ip67-fuse.jpg'),
  ('P490144', 'parts/topter/interlocked-ip67-fuse.jpg'),
  ('P490126', 'parts/topter/interlocked-ip67-fuse.jpg'),
  ('P490139', 'parts/topter/interlocked-ip67-fuse.jpg'),
  ('P490149', 'parts/topter/interlocked-ip67-fuse.jpg'),
  ('P490129', 'parts/topter/interlocked-ip67-fuse.jpg'),
  ('P490136', 'parts/topter/interlocked-ip67-fuse.jpg'),
  ('P490146', 'parts/topter/interlocked-ip67-fuse.jpg'),
  ('P490224', 'parts/topter/interlocked-ip67-fuse.jpg'),
  ('P490234', 'parts/topter/interlocked-ip67-fuse.jpg'),
  ('P490244', 'parts/topter/interlocked-ip67-fuse.jpg'),
  ('P490226', 'parts/topter/interlocked-ip67-fuse.jpg'),
  ('P490239', 'parts/topter/interlocked-ip67-fuse.jpg'),
  ('P490249', 'parts/topter/interlocked-ip67-fuse.jpg'),
  ('P490229', 'parts/topter/interlocked-ip67-fuse.jpg'),
  ('P490236', 'parts/topter/interlocked-ip67-fuse.jpg'),
  ('P490246', 'parts/topter/interlocked-ip67-fuse.jpg'),
  ('P490233', 'parts/topter/interlocked-ip67-fuse.jpg'),
  ('P490024', 'parts/topter/selv-transformer-socket.jpg'),
  ('P481324', 'parts/topter/interlocked-63a.jpg'),
  ('P481334', 'parts/topter/interlocked-63a.jpg'),
  ('P481344', 'parts/topter/interlocked-63a.jpg'),
  ('P481326', 'parts/topter/interlocked-63a.jpg'),
  ('P481339', 'parts/topter/interlocked-63a.jpg'),
  ('P481349', 'parts/topter/interlocked-63a.jpg'),
  ('P481329', 'parts/topter/interlocked-63a.jpg'),
  ('P481336', 'parts/topter/interlocked-63a.jpg'),
  ('P481346', 'parts/topter/interlocked-63a.jpg'),
  ('P480324', 'parts/topter/interlocked-63a-fuse.jpg'),
  ('P480334', 'parts/topter/interlocked-63a-fuse.jpg'),
  ('P480344', 'parts/topter/interlocked-63a-fuse.jpg'),
  ('P480326', 'parts/topter/interlocked-63a-fuse.jpg'),
  ('P480339', 'parts/topter/interlocked-63a-fuse.jpg'),
  ('P480349', 'parts/topter/interlocked-63a-fuse.jpg'),
  ('P480329', 'parts/topter/interlocked-63a-fuse.jpg'),
  ('P480336', 'parts/topter/interlocked-63a-fuse.jpg'),
  ('P480346', 'parts/topter/interlocked-63a-fuse.jpg'),
  ('P579715', 'parts/topter/schuko-on-flange-103x230.jpg'),
  ('P579840', 'parts/topter/schuko-on-flange-65x83.jpg'),
  ('P579847', 'parts/topter/universal-cap.jpg'),
  ('P579860', 'parts/topter/watertight-cap.jpg'),
  ('P579845', 'parts/topter/international-domestic-socket.jpg'),
  ('P579830', 'parts/topter/international-domestic-socket.jpg'),
  ('P579831', 'parts/topter/international-domestic-socket.jpg'),
  ('P579832', 'parts/topter/international-domestic-socket.jpg'),
  ('P579848', 'parts/topter/flange-international-65x83.jpg'),
  ('P579716', 'parts/topter/flange-3-international-103x230.jpg'),
  ('P579849', 'parts/topter/flange-elv-cee-88x100.jpg'),
  ('P579714', 'parts/topter/flange-2-sockets-103x230.jpg'),
  ('P579717', 'parts/topter/flange-63a-103x230.jpg'),
  ('P579713', 'parts/topter/closing-flange-103x230.jpg'),
  ('P579719', 'parts/topter/flange-2-sockets-115x290.jpg'),
  ('P579910', 'parts/topter/flange-cee-63a-115x290.jpg'),
  ('P579920', 'parts/topter/adapter-flange-115x290.jpg'),
  ('P579902', 'parts/topter/closing-flange-115x290.jpg'),
  ('P579843', 'parts/topter/closing-flange.jpg'),
  ('P579842', 'parts/topter/closing-flange.jpg'),
  ('P579846', 'parts/topter/aesthetic-frame.jpg'),
  ('P579852', 'parts/topter/din-rail-kit.jpg'),
  ('P579853', 'parts/topter/din-rail-kit.jpg'),
  ('P579854', 'parts/topter/din-rail-kit.jpg'),
  ('P579850', 'parts/topter/aux-contact.jpg'),
  ('P579013', 'parts/topter/earth-bar.jpg'),
  ('P579014', 'parts/topter/earth-bar.jpg'),
  ('P579011', 'parts/topter/handles.jpg'),
  ('P579012', 'parts/topter/wall-plates.jpg'),
  ('P579904', 'parts/topter/module-covers.jpg'),
  ('P580250', 'parts/topter/coupling-fitting.jpg'),
  ('P570010', 'parts/topter/floor-stand.jpg')
) as v(part_number, image_url)
where p.section = 'topter'
  and p.part_number = v.part_number
  and (p.image_url is null or p.image_url = '');

-- Check: TopTer parts with and without a picture, by category.
-- Circuit protection is Lewden's own range and is not in the Palazzoli
-- catalogue, so it starts with no pictures: add them in Admin.
select category,
       count(*) filter (where image_url is not null and image_url <> '') as with_picture,
       count(*) filter (where image_url is null or image_url = '')       as no_picture
from public.products
where section = 'topter' and is_active
group by category
order by category;
