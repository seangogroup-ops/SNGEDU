-- ============================================================
-- SNGEDU — Kho tài khoản cho Sản phẩm (vd: tài khoản YouTube Premium...)
-- Khi khách thanh toán 1 sản phẩm thành công, hệ thống tự động lấy 1 dòng
-- còn trống trong kho (theo product_id), đánh dấu đã bán và gán cho khách.
-- Chạy file này trong Supabase SQL Editor (sau 0001..0009 đã có sẵn).
-- ============================================================

-- ------------------------------------------------------------
-- 1) Bảng kho tài khoản
-- ------------------------------------------------------------
create table if not exists public.product_stock (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,                 -- khớp với id sản phẩm trong site_settings 'product_content'
  content text not null,                     -- 1 dòng tự do, vd: email@gmail.com:matkhau123
  status text not null default 'available' check (status in ('available', 'sold')),
  assigned_user_id uuid references auth.users(id) on delete set null,
  assigned_order_id uuid references public.sepay_orders(id) on delete set null,
  created_at timestamptz not null default now(),
  sold_at timestamptz
);

create index if not exists idx_product_stock_lookup
  on public.product_stock (product_id, status, created_at);

alter table public.product_stock enable row level security;

-- Không cho client đọc trực tiếp (tránh lộ danh sách tài khoản còn trống);
-- việc "lấy 1 tài khoản khi mua" đi qua RPC claim_product_stock chạy bằng service_role.
-- Chỉ admin (profiles.role = 'admin') được xem/thêm/xoá trực tiếp từ trang quản trị.
drop policy if exists "product_stock_admin_all" on public.product_stock;
create policy "product_stock_admin_all" on public.product_stock
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ------------------------------------------------------------
-- 2) Lưu nội dung tài khoản đã giao vào chính dòng product_purchases,
--    để trang chi tiết sản phẩm hiển thị lại cho khách (khỏi phải query thêm bảng product_stock).
-- ------------------------------------------------------------
alter table public.product_purchases add column if not exists account_info text;

-- ------------------------------------------------------------
-- 3) RPC atomic: lấy 1 tài khoản còn trống của product_id, đánh dấu đã bán.
--    Dùng "for update skip locked" để 2 đơn mua cùng lúc không bao giờ lấy trùng 1 dòng.
--    CHỈ gọi từ Edge Function (service_role) — giống pattern wallet_adjust_balance.
-- ------------------------------------------------------------
create or replace function public.claim_product_stock(
  p_product_id text,
  p_user_id uuid,
  p_order_id uuid default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_content text;
begin
  select id, content into v_id, v_content
  from public.product_stock
  where product_id = p_product_id and status = 'available'
  order by created_at asc
  for update skip locked
  limit 1;

  if v_id is null then
    return null; -- hết hàng trong kho -> không có gì để giao, không lỗi
  end if;

  update public.product_stock
  set status = 'sold', assigned_user_id = p_user_id, assigned_order_id = p_order_id, sold_at = now()
  where id = v_id;

  return v_content;
end;
$$;

revoke all on function public.claim_product_stock(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_product_stock(text, uuid, uuid) to service_role;
