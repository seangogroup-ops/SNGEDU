-- ============================================================
-- SNGEDU — Ví / Số dư (Wallet balance) + thanh toán bằng số dư
-- Chạy file này SAU 0001_sepay_payments.sql trong Supabase SQL Editor
-- (hoặc `supabase db push`). File viết idempotent (chạy lại không lỗi),
-- an toàn kể cả khi một số bảng/cột đã tồn tại sẵn trên DB thật.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. profiles.balance — số dư ví hiện tại của mỗi user
-- ----------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  balance numeric not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.profiles add column if not exists balance numeric not null default 0;
alter table public.profiles add column if not exists updated_at timestamptz default now();

alter table public.profiles enable row level security;
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

-- Tự tạo dòng profiles cho user mới đăng ký (nếu chưa có trigger này)
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, balance) values (new.id, 0)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- ----------------------------------------------------------------
-- 2. balance_transactions — lịch sử biến động số dư (nạp / thanh toán / admin / hoàn tiền)
-- ----------------------------------------------------------------
create table if not exists public.balance_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric not null,              -- dương = cộng tiền, âm = trừ tiền
  balance_after numeric not null,
  type text not null default 'admin_adjust'
    check (type in ('admin_adjust','topup','payment','refund')),
  order_id uuid references public.sepay_orders(id) on delete set null,
  note text,
  created_at timestamptz default now()
);

create index if not exists idx_balance_tx_user on public.balance_transactions(user_id);

alter table public.balance_transactions enable row level security;
drop policy if exists "balance_tx_select_own" on public.balance_transactions;
create policy "balance_tx_select_own" on public.balance_transactions
  for select using (auth.uid() = user_id);

-- ----------------------------------------------------------------
-- 3. Mở rộng sepay_orders: thêm loại đơn 'wallet_topup' (nạp tiền),
--    'document', 'product'; thêm cột document_id/product_id;
--    thêm phương thức thanh toán 'BALANCE' (trả bằng số dư).
-- ----------------------------------------------------------------
alter table public.sepay_orders add column if not exists document_id text;
alter table public.sepay_orders add column if not exists product_id text;

alter table public.sepay_orders drop constraint if exists sepay_orders_order_type_check;
alter table public.sepay_orders add constraint sepay_orders_order_type_check
  check (order_type in ('course','subscription','document','product','wallet_topup'));

-- ----------------------------------------------------------------
-- 4. document_purchases / product_purchases — tài liệu & sản phẩm đã mua
-- ----------------------------------------------------------------
create table if not exists public.document_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id text not null,
  order_id uuid references public.sepay_orders(id) on delete set null,
  created_at timestamptz default now(),
  unique(user_id, document_id)
);
alter table public.document_purchases enable row level security;
drop policy if exists "doc_purchases_select_own" on public.document_purchases;
create policy "doc_purchases_select_own" on public.document_purchases
  for select using (auth.uid() = user_id);

create table if not exists public.product_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  order_id uuid references public.sepay_orders(id) on delete set null,
  created_at timestamptz default now(),
  unique(user_id, product_id)
);
alter table public.product_purchases enable row level security;
drop policy if exists "product_purchases_select_own" on public.product_purchases;
create policy "product_purchases_select_own" on public.product_purchases
  for select using (auth.uid() = user_id);

-- ----------------------------------------------------------------
-- 5. Hàm atomic cộng/trừ số dư — CHỈ gọi từ Edge Function (service_role),
--    KHÔNG cho phép client gọi trực tiếp để tránh tự cộng tiền.
--    Dùng "for update" để khoá dòng, tránh trường hợp 2 giao dịch cùng
--    lúc đọc chung 1 số dư cũ rồi trừ 2 lần (race condition).
-- ----------------------------------------------------------------
create or replace function public.wallet_adjust_balance(
  p_user_id uuid,
  p_amount numeric,        -- dương: cộng tiền (nạp/hoàn tiền), âm: trừ tiền (thanh toán)
  p_type text,              -- 'topup' | 'payment' | 'refund' | 'admin_adjust'
  p_note text default null,
  p_order_id uuid default null
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current numeric;
  v_new numeric;
begin
  insert into public.profiles (id, balance)
  values (p_user_id, 0)
  on conflict (id) do nothing;

  select balance into v_current from public.profiles where id = p_user_id for update;

  v_new := coalesce(v_current, 0) + p_amount;

  if v_new < 0 then
    raise exception 'INSUFFICIENT_BALANCE' using errcode = 'P0001';
  end if;

  update public.profiles set balance = v_new, updated_at = now() where id = p_user_id;

  insert into public.balance_transactions (user_id, amount, balance_after, type, order_id, note)
  values (p_user_id, p_amount, v_new, p_type, p_order_id, p_note);

  return v_new;
end;
$$;

revoke all on function public.wallet_adjust_balance(uuid, numeric, text, text, uuid) from public, anon, authenticated;
grant execute on function public.wallet_adjust_balance(uuid, numeric, text, text, uuid) to service_role;
