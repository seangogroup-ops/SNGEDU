-- ============================================================
-- SNGEDU — Ghi nhận IP thật của khách vào page_views để đếm
-- "lượt truy cập" theo THIẾT BỊ (IP), mỗi IP chỉ tính 1 lượt duy
-- nhất trong suốt lịch sử (thay vì đếm mỗi lượt xem trang).
--
-- Cách hoạt động: khi front-end insert qua REST API (PostgREST),
-- Supabase đưa toàn bộ header của request (bao gồm x-forwarded-for
-- là IP thật của khách, do Supabase/CDN gắn vào) vào GUC
-- `request.headers` dạng JSON. Hàm public.sng_client_ip() đọc GUC
-- đó ra và lấy IP đầu tiên trong x-forwarded-for.
--
-- Chạy SAU 0001-0006 trong Supabase SQL Editor (hoặc `supabase db push`).
-- File viết idempotent — chạy lại nhiều lần không lỗi.
-- ============================================================

-- Hàm lấy IP thật của khách từ header request (an toàn: lỗi/không có
-- header -> trả về NULL, không làm hỏng lượt insert).
create or replace function public.sng_client_ip()
returns inet
language plpgsql
stable
as $$
declare
  headers json;
  xff text;
  ip_text text;
begin
  begin
    headers := current_setting('request.headers', true)::json;
  exception when others then
    return null;
  end;
  if headers is null then
    return null;
  end if;
  xff := headers->>'x-forwarded-for';
  if xff is null or xff = '' then
    -- một số hạ tầng gắn IP trực tiếp qua header khác
    xff := headers->>'cf-connecting-ip';
  end if;
  if xff is null or xff = '' then
    return null;
  end if;
  -- x-forwarded-for có thể là "ip_khach, proxy1, proxy2" -> lấy IP đầu tiên
  ip_text := trim(split_part(xff, ',', 1));
  begin
    return ip_text::inet;
  exception when others then
    return null;
  end;
end;
$$;

-- Thêm cột ip, tự động điền qua hàm trên khi insert từ REST API.
alter table public.page_views
  add column if not exists ip inet default public.sng_client_ip();

create index if not exists idx_page_views_ip on public.page_views(ip);
