-- ============================================================
-- SNGEDU — Xem trước tài liệu theo trang (kiểu Scribd)
-- Chạy SAU 0015. Vào Supabase SQL Editor và chạy nguyên file này.
-- ============================================================
--
-- Ý tưởng: PDF gốc KHÔNG public nữa. Mỗi trang được tách thành 1 ảnh JPG,
-- lưu ở bucket R2 riêng (KHÔNG bật public access). Đường dẫn lưu trữ thật
-- (bucket + prefix) chỉ được ghi trong bảng `document_sources` dưới đây —
-- bảng này KHÔNG có policy select nào cho client, nên kể cả khách mở thẳng
-- Supabase REST API bằng anon key cũng không đọc được đường dẫn file gốc.
-- Chỉ Edge Function "doc-pages" (chạy bằng service_role, bỏ qua RLS) mới
-- đọc được, và nó tự kiểm tra quyền (free_pages / đã mua / đang Pro) trước
-- khi trả ảnh trang về cho trình duyệt.

-- 1) Đường dẫn lưu trữ thật của từng tài liệu đã tách trang
create table if not exists public.document_sources (
  doc_id         text primary key,              -- khớp với id trong site_settings.doc_content.paid[]/free[]
  storage_bucket text not null default 'tai-lieu-trang',
  storage_prefix text not null,                  -- vd: '<doc_id>'  ->  key ảnh = '<prefix>/page-<n>.jpg'
  pages_total    int not null default 0,
  has_original   boolean not null default false,   -- true nếu PDF gốc cũng đã lưu (original.pdf) trong storage_prefix
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.document_sources enable row level security;

-- Chỉ admin (từ trang quản trị) được thêm/sửa/xoá trực tiếp bằng session của họ.
-- KHÔNG có policy select/insert/update/delete nào cho anon/authenticated thường
-- -> mặc định bị từ chối hết, kể cả đọc. Edge Function dùng service_role nên
-- không bị ảnh hưởng bởi RLS ở đây.
drop policy if exists "document_sources_admin_all" on public.document_sources;
create policy "document_sources_admin_all" on public.document_sources
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- 2) Nhật ký lượt xem từng trang — phục vụ truy vết nếu phát hiện rò rỉ/chia sẻ
--    (đối chiếu với watermark email hiển thị trên ảnh trang).
create table if not exists public.document_view_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null, -- null = khách chưa đăng nhập
  document_id text not null,
  page        int not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_doc_view_logs_doc on public.document_view_logs(document_id, created_at desc);
create index if not exists idx_doc_view_logs_user on public.document_view_logs(user_id, created_at desc);

alter table public.document_view_logs enable row level security;

-- Không cho client đọc/ghi trực tiếp (chỉ Edge Function service_role ghi log).
-- Riêng admin được xem để tra cứu khi cần điều tra rò rỉ.
drop policy if exists "doc_view_logs_admin_select" on public.document_view_logs;
create policy "doc_view_logs_admin_select" on public.document_view_logs
  for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
