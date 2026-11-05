-- TopTer: pictures for Lewden circuit protection
--
-- Run this once in Supabase: SQL Editor, New query, paste all of it, Run.
-- Run supabase/topter-pictures-ranges.sql first (it adds products.image_url).
--
-- The pictures are Lewden's own product photos on lewden.com, linked straight
-- from the website, so nothing needs uploading. Each one is the photo
-- lewden.com shows for that product family, so it goes on the parts that look
-- the same (same family and the same number of poles). Parts lewden.com had no
-- photo for are left blank: add those in Admin, Product catalogue, Picture.
--
-- Only TopTer parts are changed. EV parts are not touched.
-- Parts that already have a picture are left alone, so it is safe to run more
-- than once and never replaces a picture you have uploaded.

update public.products p
set image_url = 'https://www.lewden.com/media/images/cache/' || v.file
from (values
  -- Main switches
  ('^BGMS1002(P|DS)$',              'bgms1002ds-cal_png_400_400_best_70.webp'),
  ('^BEMS-',                        '47060-bems-1254p-cal_png_400_400_best_70.webp'),
  -- RCCBs, 2 pole Type A (6kA)
  ('^B[0-9]+/[0-9]+/2S?A$',         '37483-b25-30-2a-cal_png_400_400_best_70.webp'),
  -- RCCBs, 4 pole (10kA range)
  ('^BRCD10-[0-9]+/[0-9]+/4[AS]$',  'brcd10-100-30-4a-cal_png_400_400_best_70.webp'),
  -- RCBOs
  ('^BRCBO-[BC][0-9]+/30/1PNA$',    '82136-brcbo-c16-30-1pna_png_1200_630_cover_85.jpg'),
  ('^BRCBO-[BC][0-9]+/30/SPA$',     '35016-brcbo-b02-30-spa-cal_png_400_400_best_70.webp'),
  ('^BRCBO-[BC][0-9]+/30/1PNAB$',   '78222-brcbo-b06-30-1pnab-cal_png_400_400_best_70.webp'),
  ('^BP04-',                        '32949-bp04-b06-30-1pna-cal_png_400_400_best_70.webp'),
  ('^BRCBO10-',                     '39248-brcbo10-06-30-1mba-cal_png_400_400_best_70.webp'),
  -- MCBs, single pole
  ('^BG06-1[BC][0-9]+$',            '95944-bg06-1b06-cal_png_400_400_best_70.webp'),
  ('^BE10-1[BCD][0-9]+$',           'be10-1b10-cal_png_400_400_best_70.webp'),
  -- Surge protection and contactors
  ('^BSRGT2B$',                     '75172-bsrgt2b-cal_png_400_400_best_70.webp'),
  ('^BIC20$',                       '96696-bic20-cal-lew_png_400_400_best_70.webp')
) as v(pattern, file)
where p.section = 'topter'
  and p.part_number ~ v.pattern
  and (p.image_url is null or p.image_url = '');

-- Check: Lewden circuit protection with and without a picture
select coalesce(range_name, '(no range)') as range,
       count(*) filter (where image_url like 'https://www.lewden.com/%') as with_lewden_picture,
       count(*) filter (where image_url is null or image_url = '')         as no_picture
from public.products
where section = 'topter' and is_active and category = 'Circuit protection'
group by range_name
order by range_name;
