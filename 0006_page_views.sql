-- ============================================================
-- SNGEDU — Thống kê lượt truy cập website (bảng page_views)
-- Ghi lại mỗi lượt xem trang / lượt chuyển tab trên toàn site (trang chủ,
-- trắc nghiệm, tài liệu, công cụ, sản phẩm, hỗ trợ, trang đăng nhập,
-- trang làm đề...) để admin xem "Lượt vào web" + "Truy cập mục nào nhiều".
-- Chạy SAU 0001-0005 trong Supabase SQL Editor (hoặc `supabase db push`).
-- File viết idempotent — chạy lại nhiều lần không lỗi.
-- ============================================================

create table if not exists public.page_views (
  id uuid primary key default gen_random_uuid(),
  path text not null,                 -- vd: "/", "/mon-hoc.html", "/#quiz"
  page_key text not null,             -- vd: "home", "quiz", "doc", "mon-hoc", "login"...
  page_label text,                    -- tên hiển thị, vd: "Trắc nghiệm"
  referrer text,
  visitor_id text,                    -- id ẩn danh lưu ở localStorage, đại diện 1 thiết bị/trình duyệt
  session_id text,                    -- id ẩn danh lưu ở sessionStorage, đại diện 1 lượt ghé (1 tab)
  user_id uuid references auth.users(id) on delete set null, -- nếu người dùng đã đăng nhập lúc xem
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_page_views_created_at on public.page_views(created_at desc);
create index if not exists idx_page_views_page_key on public.page_views(page_key, created_at desc);
create index if not exists idx_page_views_visitor on public.page_views(visitor_id);

-- ----------------------------------------------------------------
-- RLS: bất kỳ ai (kể cả khách chưa đăng nhập) đều được PHÉP GHI (insert) lượt
-- xem của chính họ để phục vụ đếm lượt truy cập — không được sửa/xoá/đọc.
-- Chỉ admin (profiles.role = 'admin') mới được xem (select) và xoá (delete)
-- toàn bộ dữ liệu, dùng đúng pattern đã áp dụng cho các bảng khác (0004, 0005).
-- ----------------------------------------------------------------
alter table public.page_views enable row level security;

drop policy if exists "page_views_insert_public" on public.page_views;
create policy "page_views_insert_public" on public.page_views
  for insert
  with check (true);

drop policy if exists "page_views_admin_select" on public.page_views;
create policy "page_views_admin_select" on public.page_views
  for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "page_views_admin_delete" on public.page_views;
create policy "page_views_admin_delete" on public.page_views
  for delete
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
