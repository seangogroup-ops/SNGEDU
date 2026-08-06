-- ============================================================
-- SNGEDU — Nâng cấp bảng "feedback" (góp ý / báo lỗi câu hỏi)
-- Chạy SAU 0001, 0002, 0003 trong Supabase SQL Editor (hoặc `supabase db push`).
-- File viết idempotent — chạy lại nhiều lần không lỗi, an toàn dù bảng
-- feedback đã tồn tại sẵn trên DB thật (bảng này được tạo thủ công trước đó,
-- không có trong các file migration cũ) hoặc chưa tồn tại (môi trường mới).
-- ============================================================

-- ----------------------------------------------------------------
-- 1. Đảm bảo bảng feedback tồn tại với đúng các cột cũ đang dùng
--    (id, user_id, email, full_name, message, page_url, status, admin_note, created_at, updated_at)
-- ----------------------------------------------------------------
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text,
  full_name text,
  message text,
  page_url text,
  status text not null default 'new',
  admin_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ----------------------------------------------------------------
-- 2. Thêm các trường mới cho form góp ý đầy đủ (trang gop-y.html):
--    loại góp ý, môn học, chương/đề, câu hỏi liên quan, ảnh minh hoạ.
-- ----------------------------------------------------------------
alter table public.feedback add column if not exists type text not null default 'other';
alter table public.feedback drop constraint if exists feedback_type_check;
alter table public.feedback add constraint feedback_type_check
  check (type in ('wrong_question','feature_request','payment_issue','other'));

alter table public.feedback add column if not exists subject_id text;      -- vd: 'KTCT'
alter table public.feedback add column if not exists subject_name text;    -- vd: 'Kinh tế chính trị'
alter table public.feedback add column if not exists chapter text;         -- vd: '1-40' hoặc tên đề
alter table public.feedback add column if not exists question_ref text;    -- câu hỏi / số câu bị báo lỗi
alter table public.feedback add column if not exists image_url text;       -- ảnh chụp minh hoạ (nếu có)

alter table public.feedback drop constraint if exists feedback_status_check;
alter table public.feedback add constraint feedback_status_check
  check (status in ('new','read','resolved'));

create index if not exists idx_feedback_user on public.feedback(user_id);
create index if not exists idx_feedback_status on public.feedback(status);

-- ----------------------------------------------------------------
-- 3. RLS: ai cũng gửi được (kể cả khách chưa đăng nhập — form không bắt buộc
--    đăng nhập), người dùng chỉ xem lại được góp ý của chính mình, admin xem/sửa/xoá toàn bộ.
-- ----------------------------------------------------------------
alter table public.feedback enable row level security;

drop policy if exists "feedback_insert_any" on public.feedback;
create policy "feedback_insert_any" on public.feedback
  for insert
  with check (user_id is null or auth.uid() = user_id);

drop policy if exists "feedback_select_own" on public.feedback;
create policy "feedback_select_own" on public.feedback
  for select using (auth.uid() = user_id);

drop policy if exists "feedback_admin_all" on public.feedback;
create policy "feedback_admin_all" on public.feedback
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ----------------------------------------------------------------
-- 4. Bucket lưu ảnh chụp minh hoạ (public để admin xem trực tiếp qua URL,
--    không cần tạo signed URL). Ai cũng upload được (kể cả khách gửi góp ý),
--    giới hạn dung lượng/loại file được kiểm ở phía client (ảnh, tối đa ~5MB).
-- ----------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('feedback-images', 'feedback-images', true)
on conflict (id) do nothing;

drop policy if exists "feedback_images_insert" on storage.objects;
create policy "feedback_images_insert" on storage.objects
  for insert
  with check (bucket_id = 'feedback-images');

drop policy if exists "feedback_images_read" on storage.objects;
create policy "feedback_images_read" on storage.objects
  for select
  using (bucket_id = 'feedback-images');

-- ----------------------------------------------------------------
-- 5. Cập nhật thẻ "Gửi biểu mẫu góp ý" (support_content.contacts, id='c2')
--    đang trỏ ra Google Form -> trỏ vào trang góp ý nội bộ gop-y.html + đổi chữ.
--    Chỉ chạy nếu site_settings đã có sẵn dòng 'support_content' với phần tử id='c2'
--    (nếu chưa có, trang chủ sẽ tự dùng giá trị mặc định mới trong code — không cần bước này).
-- ----------------------------------------------------------------
update public.site_settings
set payload = jsonb_set(
  payload,
  '{contacts}',
  (
    select jsonb_agg(
      case when elem->>'id' = 'c2'
        then elem
          || jsonb_build_object(
               'title', 'Gửi form góp ý',
               'desc', 'Điền ngay trên web, không cần rời trang',
               'status_label', 'Kèm ảnh, chọn đúng môn & câu',
               'link', 'gop-y.html'
             )
        else elem
      end
    )
    from jsonb_array_elements(payload->'contacts') elem
  ),
  false
)
where key = 'support_content'
  and payload ? 'contacts'
  and exists (
    select 1 from jsonb_array_elements(payload->'contacts') e where e->>'id' = 'c2'
  );
