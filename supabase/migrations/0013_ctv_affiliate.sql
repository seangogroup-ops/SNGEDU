-- ============================================================
-- SNGEDU — Cộng tác viên (CTV) / Affiliate: link giới thiệu riêng + hoa hồng
-- Chạy SAU 0001-0012 trong Supabase SQL Editor (hoặc `supabase db push`).
-- File viết idempotent — chạy lại nhiều lần không lỗi, không đụng dữ liệu cũ.
--
-- Tổng quan cơ chế:
--  1) Admin cấp quyền CTV cho 1 tài khoản (theo email) trong trang quản trị,
--     mỗi CTV có 1 "code" riêng (dùng để tạo link: https://domain/?ctv=CODE)
--     và 1 mức hoa hồng riêng (đặt theo % hoặc số tiền cố định/đơn).
--  2) Khách bấm vào link -> frontend/ctv-track.js lưu code vào localStorage
--     (hết hạn sau 30 ngày) + ghi 1 dòng vào ctv_clicks để đếm lượt click.
--  3) Khi khách thanh toán, sepay-create-checkout đính kèm ctv_code (nếu có)
--     vào đơn hàng (sepay_orders.ctv_code).
--  4) Khi đơn hàng thanh toán THÀNH CÔNG (sepay-ipn hoặc trả thẳng bằng số dư
--     ví), hàm ctv_credit_commission() tính hoa hồng, ghi 1 dòng
--     ctv_commissions và cộng thẳng vào profiles.balance của CTV (dùng lại
--     cơ chế ví/wallet_adjust_balance đã có sẵn — CTV có thể dùng số dư này
--     để mua gói Pro/khoá học... như user thường, không cần xây rút tiền riêng).
-- ============================================================

-- ------------------------------------------------------------
-- 1) CTV ACCOUNTS — danh sách cộng tác viên do admin cấp quyền
-- ------------------------------------------------------------
create table if not exists public.ctv_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references auth.users(id) on delete cascade,
  code text unique not null,                 -- mã dùng trên link, vd "SNG-ABC123", luôn lưu HOA
  commission_type text not null default 'percent' check (commission_type in ('percent','fixed')),
  commission_value numeric not null default 0 check (commission_value >= 0), -- % (vd 10) hoặc VNĐ cố định/đơn (vd 20000)
  active boolean not null default true,      -- admin có thể tạm khoá 1 CTV mà không cần xoá lịch sử
  note text,                                 -- ghi chú nội bộ của admin (vd tên thật, kênh bán...)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ctv_accounts_code on public.ctv_accounts (upper(code));

alter table public.ctv_accounts enable row level security;

drop policy if exists "ctv_accounts_select_own" on public.ctv_accounts;
create policy "ctv_accounts_select_own" on public.ctv_accounts
  for select using (auth.uid() = user_id);

drop policy if exists "ctv_accounts_admin_all" on public.ctv_accounts;
create policy "ctv_accounts_admin_all" on public.ctv_accounts
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ------------------------------------------------------------
-- 2) CTV CLICKS — đếm lượt click vào link giới thiệu (trước khi biết mua hay chưa)
-- ------------------------------------------------------------
create table if not exists public.ctv_clicks (
  id uuid primary key default gen_random_uuid(),
  ctv_code text not null,
  path text,
  referrer text,
  visitor_id text,                           -- tái dùng khái niệm visitor_id như page_views (localStorage)
  ip inet default public.sng_client_ip(),    -- hàm này đã tạo sẵn ở migration 0007
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ctv_clicks_code on public.ctv_clicks (upper(ctv_code), created_at desc);

alter table public.ctv_clicks enable row level security;

-- Cho phép bất kỳ ai (kể cả khách chưa đăng nhập) ghi lượt click — giống page_views.
drop policy if exists "ctv_clicks_insert_public" on public.ctv_clicks;
create policy "ctv_clicks_insert_public" on public.ctv_clicks
  for insert with check (true);

-- CTV chỉ xem được click của chính link mình
drop policy if exists "ctv_clicks_select_own" on public.ctv_clicks;
create policy "ctv_clicks_select_own" on public.ctv_clicks
  for select using (
    exists (
      select 1 from public.ctv_accounts a
      where a.user_id = auth.uid() and upper(a.code) = upper(ctv_clicks.ctv_code)
    )
  );

drop policy if exists "ctv_clicks_admin_select" on public.ctv_clicks;
create policy "ctv_clicks_admin_select" on public.ctv_clicks
  for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ------------------------------------------------------------
-- 3) CTV COMMISSIONS — hoa hồng phát sinh trên từng đơn hàng đã thanh toán
-- ------------------------------------------------------------
create table if not exists public.ctv_commissions (
  id uuid primary key default gen_random_uuid(),
  ctv_id uuid not null references public.ctv_accounts(id) on delete cascade,
  order_id uuid unique not null references public.sepay_orders(id) on delete cascade,
  buyer_id uuid references auth.users(id) on delete set null,
  order_amount numeric not null,
  commission_amount numeric not null,
  status text not null default 'credited' check (status in ('credited','cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists idx_ctv_commissions_ctv on public.ctv_commissions (ctv_id, created_at desc);

alter table public.ctv_commissions enable row level security;

drop policy if exists "ctv_commissions_select_own" on public.ctv_commissions;
create policy "ctv_commissions_select_own" on public.ctv_commissions
  for select using (
    exists (select 1 from public.ctv_accounts a where a.id = ctv_commissions.ctv_id and a.user_id = auth.uid())
  );

drop policy if exists "ctv_commissions_admin_select" on public.ctv_commissions;
create policy "ctv_commissions_admin_select" on public.ctv_commissions
  for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ------------------------------------------------------------
-- 4) Gắn ctv_code lên đơn hàng để biết đơn nào tới từ CTV nào
-- ------------------------------------------------------------
alter table public.sepay_orders add column if not exists ctv_code text;
create index if not exists idx_sepay_orders_ctv_code on public.sepay_orders (upper(ctv_code)) where ctv_code is not null;

-- Cho phép balance_transactions ghi thêm loại 'commission' (hoa hồng CTV)
alter table public.balance_transactions drop constraint if exists balance_transactions_type_check;
alter table public.balance_transactions add constraint balance_transactions_type_check
  check (type in ('admin_adjust','topup','payment','refund','commission'));

-- ------------------------------------------------------------
-- 5) Hàm tính + cộng hoa hồng cho CTV khi 1 đơn hàng thanh toán thành công.
--    Gọi từ Edge Function (service_role) NGAY SAU khi set sepay_orders.status = 'paid'.
--    An toàn khi gọi lại nhiều lần (webhook có thể gửi trùng): nhờ order_id unique
--    trên ctv_commissions, lần gọi thứ 2 sẽ bị chặn bởi on conflict do nothing.
-- ------------------------------------------------------------
create or replace function public.ctv_credit_commission(
  p_order_id uuid,
  p_ctv_code text,
  p_buyer_id uuid,
  p_order_amount numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctv record;
  v_amount numeric;
begin
  if p_ctv_code is null or trim(p_ctv_code) = '' then
    return;
  end if;

  select * into v_ctv from public.ctv_accounts
    where upper(code) = upper(trim(p_ctv_code)) and active = true
    limit 1;

  if not found then
    return; -- code không tồn tại hoặc CTV đang bị khoá -> không tính hoa hồng
  end if;

  if v_ctv.user_id = p_buyer_id then
    return; -- không tự thưởng cho chính mình
  end if;

  if v_ctv.commission_type = 'percent' then
    v_amount := round(p_order_amount * v_ctv.commission_value / 100.0);
  else
    v_amount := v_ctv.commission_value;
  end if;

  if v_amount is null or v_amount <= 0 then
    return;
  end if;

  insert into public.ctv_commissions (ctv_id, order_id, buyer_id, order_amount, commission_amount)
  values (v_ctv.id, p_order_id, p_buyer_id, p_order_amount, v_amount)
  on conflict (order_id) do nothing;

  -- Chỉ cộng tiền nếu dòng commission vừa được tạo thật (tránh cộng trùng khi webhook gọi lại)
  if found then
    perform public.wallet_adjust_balance(
      v_ctv.user_id,
      v_amount,
      'commission',
      'Hoa hồng CTV - đơn ' || p_order_id::text,
      p_order_id
    );
  end if;
end;
$$;

revoke all on function public.ctv_credit_commission(uuid, text, uuid, numeric) from public, anon, authenticated;
grant execute on function public.ctv_credit_commission(uuid, text, uuid, numeric) to service_role;
