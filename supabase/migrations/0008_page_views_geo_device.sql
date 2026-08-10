-- ============================================================
-- SNGEDU — Mở rộng page_views để làm bảng "Lượt truy cập" trong
-- admin đẹp và chi tiết hơn (kiểu tổng quan như Google Analytics):
-- thêm cột ngôn ngữ trình duyệt, loại thiết bị, tên trình duyệt,
-- quốc gia/thành phố (được front-end gửi kèm khi ghi nhận lượt
-- truy cập — xem frontend/track-visit.js).
-- Chạy SAU 0001-0007 trong Supabase SQL Editor (hoặc `supabase db push`).
-- File viết idempotent — chạy lại nhiều lần không lỗi.
-- ============================================================

alter table public.page_views
  add column if not exists language text,
  add column if not exists device_type text,   -- 'Desktop' | 'Mobile' | 'Tablet'
  add column if not exists browser text,        -- 'Chrome' | 'Safari' | 'Edge' | ...
  add column if not exists country text,
  add column if not exists city text;

create index if not exists idx_page_views_country on public.page_views(country);
create index if not exists idx_page_views_device_type on public.page_views(device_type);
