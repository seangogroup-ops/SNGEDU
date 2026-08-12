-- ============================================================
-- SNGEDU — Thông báo riêng cho từng thành viên (bảng user_notifications)
-- Khác với "Thông báo nổi" (site_settings, hiện cho TẤT CẢ mọi người), bảng
-- này dùng để admin gửi 1 thông báo riêng tới ĐÚNG 1 thành viên cụ thể
-- (vd: nhắc gia hạn Pro, phản hồi một yêu cầu riêng, cảnh báo vi phạm...).
-- Chạy SAU 0001-0004 trong Supabase SQL Editor (hoặc `supabase db push`).
-- File viết idempotent — chạy lại nhiều lần không lỗi.
-- ============================================================

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  message text not null,
  created_by uuid references auth.users(id) on delete set null, -- admin đã gửi
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_notifications_user on public.user_notifications(user_id, created_at desc);
create index if not exists idx_user_notifications_unread on public.user_notifications(user_id) where is_read = false;

-- ----------------------------------------------------------------
-- RLS: thành viên chỉ xem/đánh dấu-đã-đọc thông báo của chính mình.
-- Chỉ admin (profiles.role = 'admin') mới được tạo/sửa/xoá thông báo cho
-- người khác — dùng đúng pattern đã áp dụng cho bảng feedback (0004).
-- ----------------------------------------------------------------
alter table public.user_notifications enable row level security;

drop policy if exists "user_notifications_select_own" on public.user_notifications;
create policy "user_notifications_select_own" on public.user_notifications
  for select using (auth.uid() = user_id);

-- Cho phép thành viên tự đánh dấu đã đọc thông báo của mình (chỉ đổi is_read/read_at,
-- không đổi tiêu đề/nội dung — việc giới hạn cột cụ thể do phía client tự tuân thủ).
drop policy if exists "user_notifications_update_own" on public.user_notifications;
create policy "user_notifications_update_own" on public.user_notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user_notifications_admin_all" on public.user_notifications;
create policy "user_notifications_admin_all" on public.user_notifications
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
