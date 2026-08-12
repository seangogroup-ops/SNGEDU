-- ============================================================
-- SNGEDU x SePay Payment Gateway - schema thanh toán
-- Chạy file này trong Supabase SQL Editor (hoặc `supabase db push`)
-- ============================================================

-- Gói thành viên (subscription plans)
create table if not exists public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,          -- vd: 'monthly', 'yearly'
  name text not null,                 -- vd: 'Gói Premium 1 tháng'
  price numeric not null,             -- giá VND
  duration_days int not null,         -- thời hạn tính bằng ngày
  active boolean not null default true,
  created_at timestamptz default now()
);

-- Đơn hàng (dùng chung cho cả mua khoá học và mua gói thành viên)
create table if not exists public.sepay_orders (
  id uuid primary key default gen_random_uuid(),
  invoice_number text unique not null,          -- order_invoice_number gửi cho SePay
  user_id uuid not null references auth.users(id) on delete cascade,
  order_type text not null check (order_type in ('course','subscription')),
  course_id uuid,                                -- nếu order_type = course
  plan_id uuid references public.membership_plans(id), -- nếu order_type = subscription
  amount numeric not null,
  currency text not null default 'VND',
  status text not null default 'pending' check (status in ('pending','paid','failed','cancelled')),
  payment_method text,                           -- BANK_TRANSFER | CARD | NAPAS_BANK_TRANSFER
  sepay_order_id text,                           -- order.id trả về từ SePay IPN
  sepay_transaction_id text,
  created_at timestamptz default now(),
  paid_at timestamptz
);

create index if not exists idx_orders_user on public.sepay_orders(user_id);
create index if not exists idx_orders_invoice on public.sepay_orders(invoice_number);

-- Trạng thái gói thành viên hiện tại của user
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid references public.membership_plans(id),
  status text not null default 'active' check (status in ('active','expired','cancelled')),
  current_period_end timestamptz not null,
  last_order_id uuid references public.sepay_orders(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists idx_subscriptions_user on public.subscriptions(user_id);

-- Khoá học đã mở khoá cho user (mua lẻ)
create table if not exists public.course_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null,
  order_id uuid references public.sepay_orders(id),
  created_at timestamptz default now(),
  unique(user_id, course_id)
);

-- ============================================================
-- Row Level Security
-- Người dùng chỉ được XEM đơn hàng/gói của chính mình.
-- Việc INSERT/UPDATE chỉ do Edge Function thực hiện bằng service_role key
-- (service_role bỏ qua RLS) nên không cần policy insert/update cho client.
-- ============================================================

alter table public.sepay_orders enable row level security;
create policy "orders_select_own" on public.sepay_orders
  for select using (auth.uid() = user_id);

alter table public.subscriptions enable row level security;
create policy "subscriptions_select_own" on public.subscriptions
  for select using (auth.uid() = user_id);

alter table public.course_enrollments enable row level security;
create policy "enrollments_select_own" on public.course_enrollments
  for select using (auth.uid() = user_id);

-- Dữ liệu mẫu (xoá nếu không cần)
insert into public.membership_plans (code, name, price, duration_days) values
  ('monthly', 'Gói Premium 1 tháng', 99000, 30),
  ('yearly', 'Gói Premium 1 năm', 799000, 365)
on conflict (code) do nothing;
