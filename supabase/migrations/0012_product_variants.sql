-- ============================================================
-- SNGEDU — Biến thể sản phẩm (VD: "1 tháng", "3 tháng", "6 tháng"...)
-- Mỗi biến thể có giá riêng và kho tài khoản riêng.
-- Sản phẩm KHÔNG dùng biến thể vẫn hoạt động y như cũ — cột "variant"
-- mặc định là chuỗi rỗng '' cho mọi dòng cũ / sản phẩm không chia biến thể.
-- Chạy sau 0001..0011 đã có sẵn.
-- ============================================================

-- ------------------------------------------------------------
-- 1) product_stock: thêm cột variant — khớp với item.variants[].id
--    lưu trong site_settings.product_content.items[].variants
--    '' (rỗng) = sản phẩm không chia biến thể (hành vi cũ).
-- ------------------------------------------------------------
alter table public.product_stock add column if not exists variant text not null default '';

drop index if exists idx_product_stock_lookup;
create index if not exists idx_product_stock_lookup
  on public.product_stock (product_id, variant, status, created_at);

-- ------------------------------------------------------------
-- 2) product_purchases: 1 khách có thể mua nhiều biến thể khác nhau
--    của cùng 1 sản phẩm (vd mua "1 tháng" xong sau đó mua thêm "6 tháng").
-- ------------------------------------------------------------
alter table public.product_purchases add column if not exists variant text not null default '';

alter table public.product_purchases drop constraint if exists product_purchases_user_id_product_id_key;
drop index if exists product_purchases_user_id_product_id_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'product_purchases_user_product_variant_key'
  ) then
    alter table public.product_purchases
      add constraint product_purchases_user_product_variant_key unique (user_id, product_id, variant);
  end if;
end $$;

-- ------------------------------------------------------------
-- 3) sepay_orders: lưu lại biến thể đã chọn khi tạo đơn (để đối chiếu giá & giao đúng kho)
-- ------------------------------------------------------------
alter table public.sepay_orders add column if not exists variant_id text not null default '';

-- ------------------------------------------------------------
-- 4) claim_product_stock: thêm tham số p_variant, mặc định '' (không đổi hành vi cũ)
-- ------------------------------------------------------------
create or replace function public.claim_product_stock(
  p_product_id text,
  p_user_id uuid,
  p_order_id uuid default null,
  p_variant text default ''
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
  where product_id = p_product_id and variant = coalesce(p_variant, '') and status = 'available'
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

revoke all on function public.claim_product_stock(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_product_stock(text, uuid, uuid, text) to service_role;

-- Hàm cũ (3 tham số) không còn được Edge Function nào gọi nữa sau khi cập nhật code,
-- xoá đi để tránh nhầm overload khi PostgREST/Deno tra cứu hàm.
drop function if exists public.claim_product_stock(text, uuid, uuid);

-- ------------------------------------------------------------
-- 5) get_product_stock_info: thêm tham số p_variant, mặc định '' (không đổi hành vi cũ)
-- ------------------------------------------------------------
create or replace function public.get_product_stock_info(p_product_id text, p_variant text default '')
returns table(available_count bigint, total_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    count(*) filter (where status = 'available') as available_count,
    count(*) as total_count
  from public.product_stock
  where product_id = p_product_id and variant = coalesce(p_variant, '');
$$;

revoke all on function public.get_product_stock_info(text, text) from public;
grant execute on function public.get_product_stock_info(text, text) to anon, authenticated;

drop function if exists public.get_product_stock_info(text);

-- ------------------------------------------------------------
-- 6) Hàm mới: lấy số lượng kho của TẤT CẢ biến thể của 1 sản phẩm trong 1 lần gọi
--    (dùng cho trang chi tiết sản phẩm khi sản phẩm có nhiều biến thể, tránh gọi lặp lại).
-- ------------------------------------------------------------
create or replace function public.get_product_variants_stock_info(p_product_id text)
returns table(variant text, available_count bigint, total_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    variant,
    count(*) filter (where status = 'available') as available_count,
    count(*) as total_count
  from public.product_stock
  where product_id = p_product_id
  group by variant;
$$;

revoke all on function public.get_product_variants_stock_info(text) from public;
grant execute on function public.get_product_variants_stock_info(text) to anon, authenticated;
