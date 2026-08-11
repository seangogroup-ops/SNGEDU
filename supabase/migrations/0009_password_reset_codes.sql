-- ============================================================
-- SNGEDU — Quên mật khẩu bằng mã OTP gửi qua email
-- Chạy SAU các file trước trong Supabase SQL Editor (hoặc `supabase db push`).
-- File viết idempotent — chạy lại nhiều lần không lỗi.
--
-- Luồng hoạt động:
--   1. User nhập email -> function "send-reset-code" tạo mã 6 số,
--      lưu HASH của mã (không lưu mã gốc) vào bảng dưới, gửi email qua Resend.
--   2. User nhập mã + mật khẩu mới -> function "verify-reset-code" so khớp
--      hash, còn hạn (10 phút), chưa dùng, tối đa 5 lần thử sai -> đổi mật
--      khẩu bằng quyền admin (service role).
--
-- Bảng này CHỈ được truy cập bởi service role (Edge Functions), không có
-- policy nào cho anon/authenticated -> RLS mặc định chặn hết truy cập trực
-- tiếp từ client.
-- ============================================================

create table if not exists public.password_reset_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_password_reset_codes_email
  on public.password_reset_codes (lower(email));

alter table public.password_reset_codes enable row level security;
-- Không tạo policy nào -> chỉ service_role (bypass RLS) mới đọc/ghi được.

-- ----------------------------------------------------------------
-- Hàm tra cứu user id theo email (đọc từ auth.users) — chỉ service_role
-- được gọi, dùng để: (a) kiểm tra email có tồn tại tài khoản không trước
-- khi gửi mã, (b) lấy id để đổi mật khẩu sau khi xác nhận mã đúng.
-- ----------------------------------------------------------------
create or replace function public.get_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.get_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.get_user_id_by_email(text) to service_role;

-- Dọn mã cũ đã hết hạn quá 1 ngày (tuỳ chọn, gọi định kỳ nếu muốn dọn bảng,
-- không bắt buộc vì bảng nhỏ và không ảnh hưởng hiệu năng).
create or replace function public.cleanup_expired_reset_codes()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.password_reset_codes where expires_at < now() - interval '1 day';
$$;

revoke all on function public.cleanup_expired_reset_codes() from public, anon, authenticated;
grant execute on function public.cleanup_expired_reset_codes() to service_role;

-- ----------------------------------------------------------------
-- Cờ đánh dấu đã gửi email chào mừng — để function "send-welcome-email"
-- chỉ gửi được ĐÚNG 1 LẦN cho mỗi user, tránh bị gọi lại nhiều lần để spam.
-- ----------------------------------------------------------------
alter table public.profiles add column if not exists welcome_email_sent boolean not null default false;

