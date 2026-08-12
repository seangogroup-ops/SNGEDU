-- ============================================================
-- SNGEDU — Cho phép trang chi tiết sản phẩm (client, kể cả khách chưa đăng nhập)
-- xem được SỐ LƯỢNG tài khoản còn lại trong kho, mà KHÔNG lộ nội dung tài khoản
-- (bảng product_stock vẫn khoá RLS chỉ admin mới đọc/ghi trực tiếp được).
-- Chạy sau 0010_product_stock.sql.
-- ============================================================

create or replace function public.get_product_stock_info(p_product_id text)
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
  where product_id = p_product_id;
$$;

-- total_count = 0 nghĩa là sản phẩm này KHÔNG dùng kho tài khoản (chỉ dùng link ngoài như trước đây)
-- -> trang chi tiết coi như không giới hạn số lượng, không hiện badge "Còn lại/Hết hàng".
revoke all on function public.get_product_stock_info(text) from public;
grant execute on function public.get_product_stock_info(text) to anon, authenticated;
