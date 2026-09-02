-- ============================================================
-- SNGEDU — CTV: (1) Yêu cầu rút tiền hoa hồng
--              (2) Upload tài liệu để bán, chờ admin duyệt
-- Chạy SAU 0013_ctv_affiliate.sql.
-- File viết idempotent — chạy lại nhiều lần không lỗi.
-- ============================================================

-- ------------------------------------------------------------
-- 0) Cho phép ctv_commissions phân biệt nguồn hoa hồng:
--    'referral' (giới thiệu link) vs 'document_sale' (tác giả tài liệu được duyệt bán)
--    -> đổi ràng buộc unique từ (order_id) sang (order_id, ctv_id, source) vì 1 đơn hàng
--    có thể vừa trả hoa hồng giới thiệu cho 1 CTV, vừa trả hoa hồng tác giả cho 1 CTV khác.
-- ------------------------------------------------------------
alter table public.ctv_commissions add column if not exists source text not null default 'referral';
alter table public.ctv_commissions drop constraint if exists ctv_commissions_source_check;
alter table public.ctv_commissions add constraint ctv_commissions_source_check
  check (source in ('referral','document_sale'));

alter table public.ctv_commissions drop constraint if exists ctv_commissions_order_id_key;
alter table public.ctv_commissions drop constraint if exists ctv_commissions_order_id_ctv_id_source_key;
alter table public.ctv_commissions add constraint ctv_commissions_order_id_ctv_id_source_key
  unique (order_id, ctv_id, source);

-- Hàm cộng hoa hồng GIỚI THIỆU — viết lại để ghi rõ source + khớp ràng buộc unique mới ở trên.
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
    return;
  end if;

  if v_ctv.user_id = p_buyer_id then
    return;
  end if;

  if v_ctv.commission_type = 'percent' then
    v_amount := round(p_order_amount * v_ctv.commission_value / 100.0);
  else
    v_amount := v_ctv.commission_value;
  end if;

  if v_amount is null or v_amount <= 0 then
    return;
  end if;

  insert into public.ctv_commissions (ctv_id, order_id, buyer_id, order_amount, commission_amount, source)
  values (v_ctv.id, p_order_id, p_buyer_id, p_order_amount, v_amount, 'referral')
  on conflict (order_id, ctv_id, source) do nothing;

  if found then
    perform public.wallet_adjust_balance(
      v_ctv.user_id, v_amount, 'commission', 'Hoa hồng giới thiệu - đơn ' || p_order_id::text, p_order_id
    );
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 1) YÊU CẦU RÚT TIỀN — CTV rút hoa hồng đã tích luỹ trong ví (profiles.balance)
-- ------------------------------------------------------------
alter table public.balance_transactions drop constraint if exists balance_transactions_type_check;
alter table public.balance_transactions add constraint balance_transactions_type_check
  check (type in ('admin_adjust','topup','payment','refund','commission','withdrawal'));

create table if not exists public.ctv_withdrawals (
  id uuid primary key default gen_random_uuid(),
  ctv_id uuid not null references public.ctv_accounts(id) on delete cascade,
  amount numeric not null check (amount > 0),
  bank_name text not null,
  bank_account_number text not null,
  bank_account_holder text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','paid')),
  admin_note text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_ctv_withdrawals_ctv on public.ctv_withdrawals (ctv_id, created_at desc);

alter table public.ctv_withdrawals enable row level security;

drop policy if exists "ctv_withdrawals_select_own" on public.ctv_withdrawals;
create policy "ctv_withdrawals_select_own" on public.ctv_withdrawals
  for select using (
    exists (select 1 from public.ctv_accounts a where a.id = ctv_withdrawals.ctv_id and a.user_id = auth.uid())
  );

drop policy if exists "ctv_withdrawals_admin_all" on public.ctv_withdrawals;
create policy "ctv_withdrawals_admin_all" on public.ctv_withdrawals
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Tạo yêu cầu rút tiền: GIỮ TIỀN NGAY (trừ khỏi số dư khả dụng) để tránh CTV yêu cầu rút vượt quá
-- số dư thực có, hoặc tạo nhiều yêu cầu chồng nhau. Nếu admin từ chối -> hoàn lại (xem hàm dưới).
create or replace function public.ctv_request_withdrawal(
  p_ctv_id uuid,
  p_amount numeric,
  p_bank_name text,
  p_bank_account_number text,
  p_bank_account_holder text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_id uuid;
begin
  select user_id into v_user_id from public.ctv_accounts where id = p_ctv_id and active = true;
  if v_user_id is null then
    raise exception 'CTV_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;

  insert into public.ctv_withdrawals (ctv_id, amount, bank_name, bank_account_number, bank_account_holder)
  values (p_ctv_id, p_amount, p_bank_name, p_bank_account_number, p_bank_account_holder)
  returning id into v_id;

  -- Trừ ngay khỏi số dư (giữ tiền chờ xử lý) — báo lỗi INSUFFICIENT_BALANCE nếu không đủ.
  perform public.wallet_adjust_balance(
    v_user_id, -p_amount, 'withdrawal', 'Yêu cầu rút hoa hồng CTV #' || v_id::text, null
  );

  return v_id;
end;
$$;

revoke all on function public.ctv_request_withdrawal(uuid, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.ctv_request_withdrawal(uuid, numeric, text, text, text) to service_role;

-- Admin xử lý yêu cầu: approved/paid không hoàn tiền (đã giữ từ lúc tạo yêu cầu);
-- rejected -> hoàn lại tiền vào ví CTV.
create or replace function public.ctv_process_withdrawal(
  p_withdrawal_id uuid,
  p_new_status text,
  p_admin_note text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  if p_new_status not in ('approved','rejected','paid') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;

  select w.*, a.user_id as ctv_user_id into v_row
  from public.ctv_withdrawals w
  join public.ctv_accounts a on a.id = w.ctv_id
  where w.id = p_withdrawal_id
  for update of w;

  if not found then
    raise exception 'WITHDRAWAL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_row.status in ('rejected','paid') then
    raise exception 'ALREADY_FINALIZED' using errcode = 'P0001';
  end if;

  if p_new_status = 'rejected' then
    perform public.wallet_adjust_balance(
      v_row.ctv_user_id, v_row.amount, 'refund',
      'Hoàn tiền yêu cầu rút CTV bị từ chối #' || p_withdrawal_id::text, null
    );
  end if;

  update public.ctv_withdrawals
  set status = p_new_status, admin_note = p_admin_note, processed_at = now()
  where id = p_withdrawal_id;
end;
$$;

revoke all on function public.ctv_process_withdrawal(uuid, text, text) from public, anon, authenticated;
grant execute on function public.ctv_process_withdrawal(uuid, text, text) to service_role;

-- ------------------------------------------------------------
-- 2) TÀI LIỆU DO CTV UPLOAD — chờ admin duyệt trước khi lên bán công khai
-- ------------------------------------------------------------
create table if not exists public.ctv_document_submissions (
  id uuid primary key default gen_random_uuid(),
  ctv_id uuid not null references public.ctv_accounts(id) on delete cascade,
  title text not null,
  description text,
  suggested_price numeric not null default 0 check (suggested_price >= 0),
  file_path text not null,          -- đường dẫn trong bucket 'ctv-documents'
  file_name text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reject_reason text,
  approved_price numeric,           -- giá bán cuối cùng do admin chốt khi duyệt
  revenue_share_percent numeric,    -- % doanh thu CTV (tác giả) được nhận mỗi lượt bán, do admin đặt
  doc_content_id text,              -- id của item sau khi được đưa vào site_settings.doc_content.paid
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists idx_ctv_doc_sub_ctv on public.ctv_document_submissions (ctv_id, created_at desc);
create index if not exists idx_ctv_doc_sub_status on public.ctv_document_submissions (status);

alter table public.ctv_document_submissions enable row level security;

drop policy if exists "ctv_doc_sub_select_own" on public.ctv_document_submissions;
create policy "ctv_doc_sub_select_own" on public.ctv_document_submissions
  for select using (
    exists (select 1 from public.ctv_accounts a where a.id = ctv_document_submissions.ctv_id and a.user_id = auth.uid())
  );

drop policy if exists "ctv_doc_sub_admin_all" on public.ctv_document_submissions;
create policy "ctv_doc_sub_admin_all" on public.ctv_document_submissions
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Bucket lưu file tài liệu CTV upload. Public để sau khi duyệt có thể dùng thẳng URL làm
-- link tải (giống cách site_settings.doc_content.*.link đang hoạt động hiện tại — admin cũng
-- đang dán link công khai cho tài liệu, không dùng signed URL). Mỗi CTV chỉ được ghi vào
-- đúng thư mục con mang tên user_id của mình (ép ở policy insert), tránh ghi đè file người khác.
insert into storage.buckets (id, name, public)
values ('ctv-documents', 'ctv-documents', true)
on conflict (id) do nothing;

drop policy if exists "ctv_documents_insert_own_folder" on storage.objects;
create policy "ctv_documents_insert_own_folder" on storage.objects
  for insert
  with check (
    bucket_id = 'ctv-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "ctv_documents_read_public" on storage.objects;
create policy "ctv_documents_read_public" on storage.objects
  for select
  using (bucket_id = 'ctv-documents');

-- Hàm cộng hoa hồng TÁC GIẢ TÀI LIỆU — gọi sau khi 1 đơn hàng mua tài liệu (order_type='document')
-- thanh toán thành công. Tự tra trong site_settings.doc_content.paid xem tài liệu này có phải do
-- 1 CTV đăng bán không (item có ctv_id + ctv_revenue_percent do admin gắn lúc duyệt), nếu có thì
-- trích % doanh thu đó cộng thẳng vào ví CTV đó.
create or replace function public.ctv_credit_document_royalty(
  p_order_id uuid,
  p_document_id text,
  p_buyer_id uuid,
  p_order_amount numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_item jsonb;
  v_ctv_id uuid;
  v_percent numeric;
  v_amount numeric;
  v_ctv_user uuid;
begin
  if p_document_id is null or trim(p_document_id) = '' then
    return;
  end if;

  select payload::jsonb into v_payload from public.site_settings where key = 'doc_content';
  if v_payload is null then
    return;
  end if;

  select elem into v_item
  from jsonb_array_elements(coalesce(v_payload->'paid', '[]'::jsonb)) elem
  where elem->>'id' = p_document_id
  limit 1;

  if v_item is null then
    return;
  end if;

  v_ctv_id := nullif(v_item->>'ctv_id', '')::uuid;
  v_percent := nullif(v_item->>'ctv_revenue_percent', '')::numeric;

  if v_ctv_id is null or v_percent is null or v_percent <= 0 then
    return; -- tài liệu không phải do CTV đăng bán (admin tự đăng) -> không trích hoa hồng
  end if;

  select user_id into v_ctv_user from public.ctv_accounts where id = v_ctv_id and active = true;
  if v_ctv_user is null then
    return;
  end if;
  if v_ctv_user = p_buyer_id then
    return;
  end if;

  v_amount := round(p_order_amount * v_percent / 100.0);
  if v_amount <= 0 then
    return;
  end if;

  insert into public.ctv_commissions (ctv_id, order_id, buyer_id, order_amount, commission_amount, source)
  values (v_ctv_id, p_order_id, p_buyer_id, p_order_amount, v_amount, 'document_sale')
  on conflict (order_id, ctv_id, source) do nothing;

  if found then
    perform public.wallet_adjust_balance(
      v_ctv_user, v_amount, 'commission', 'Doanh thu tài liệu - đơn ' || p_order_id::text, p_order_id
    );
  end if;
end;
$$;

revoke all on function public.ctv_credit_document_royalty(uuid, text, uuid, numeric) from public, anon, authenticated;
grant execute on function public.ctv_credit_document_royalty(uuid, text, uuid, numeric) to service_role;
