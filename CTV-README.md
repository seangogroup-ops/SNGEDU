# Tính năng Cộng tác viên (CTV) — hướng dẫn triển khai

## 1. Chạy migration
Vào Supabase SQL Editor, chạy file:
`supabase/migrations/0013_ctv_affiliate.sql`

Tạo 3 bảng mới (`ctv_accounts`, `ctv_clicks`, `ctv_commissions`), thêm cột
`ctv_code` vào `sepay_orders`, thêm loại `'commission'` vào
`balance_transactions`, và hàm `ctv_credit_commission()` dùng để tự cộng
hoa hồng.

## 2. Deploy 2 Edge Function
- **`admin-ctv`** (mới) — `supabase/functions/admin-ctv/index.ts`
  Dùng cho trang `admin/ctv.html`: tạo CTV theo email, sửa hoa hồng,
  khoá/mở, xem số liệu tổng quan. Không cần biến môi trường mới (dùng
  chung `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` có sẵn).
- **`sepay-create-checkout`** và **`sepay-ipn`** (đã sửa) — deploy đè lại
  2 hàm này để chúng nhận `ctv_code` và tự gọi `ctv_credit_commission()`
  khi đơn hàng thanh toán thành công (cả 2 trường hợp: trả bằng số dư ví
  và trả qua cổng SePay).

## 3. Các file frontend mới/đã sửa
- `frontend/ctv-track.js` (mới) — đọc `?ctv=MA` trên URL, lưu 30 ngày vào
  localStorage, ghi 1 dòng vào `ctv_clicks`. Đã tự động include vào **tất
  cả** trang tĩnh hiện có (cạnh `track-visit.js`).
- `frontend/sepay-checkout.js` (đã sửa) — tự đính `ctv_code` (nếu có) vào
  mọi đơn hàng khi khách bấm thanh toán.
- `ctv/index.html` (mới) — trang thống kê dành cho CTV: link giới thiệu
  riêng, biểu đồ click 14 ngày, tổng đơn/hoa hồng, lịch sử hoa hồng.
  Đăng nhập bằng tài khoản đã được admin cấp quyền CTV.
- `admin/ctv.html` (mới) — trang quản lý CTV cho admin: thêm CTV theo
  email, chỉnh % hoặc số tiền hoa hồng cố định/đơn, khoá/mở, xem doanh
  thu + hoa hồng từng CTV. Đã thêm 1 mục "🤝 Cộng tác viên (CTV)" vào
  sidebar `admin/index.html`.

## 4. Cách hoạt động
1. Admin vào `admin/ctv.html` → nhập email tài khoản → cấp quyền CTV +
   đặt mức hoa hồng (VD: 10% mỗi đơn, hoặc 20.000đ cố định/đơn).
2. CTV vào `ctv/index.html` → thấy link dạng
   `https://domain-cua-ban/?ctv=MA_CTV` → chia sẻ cho người khác.
3. Khách bấm vào link → `ctv-track.js` ghi nhận + nhớ 30 ngày.
4. Khách đăng nhập và thanh toán (gói Pro/khoá học/tài liệu/sản phẩm) →
   đơn hàng tự gắn `ctv_code`.
5. Khi đơn **thanh toán thành công**, hệ thống tự tính hoa hồng và cộng
   thẳng vào **số dư ví** (`profiles.balance`) của CTV — CTV có thể dùng
   số dư đó như user thường (mua gói Pro, tài liệu...). Lưu ý: đơn "nạp
   tiền vào ví" (wallet_topup) KHÔNG tính hoa hồng, tránh CTV tự nạp tiền
   ảo để lấy hoa hồng.

## 5. Rút tiền hoa hồng (mới)
- Trong `ctv/index.html`, CTV bấm **"Yêu cầu rút tiền"** → nhập số tiền + thông
  tin ngân hàng → hệ thống **giữ tiền ngay** (trừ khỏi số dư ví, gọi hàm
  `ctv_request_withdrawal`) để tránh rút vượt số dư hoặc tạo nhiều yêu cầu
  chồng nhau.
- Admin vào `admin/ctv.html` → mục **"Yêu cầu rút tiền hoa hồng"** → Duyệt /
  Từ chối / Đánh dấu đã chuyển khoản.
  - **Từ chối** → tự động hoàn tiền lại vào ví CTV.
  - **Duyệt → Đã chuyển khoản** → không hoàn tiền (admin tự chuyển khoản thủ
    công ở app ngân hàng, hệ thống chỉ ghi nhận trạng thái).

## 6. CTV đăng tài liệu bán (mới)
- Trong `ctv/index.html`, mục **"Đăng tài liệu để bán"**: CTV nhập tên, mô tả,
  giá đề xuất, upload file (PDF/Word/ảnh, tối đa 20MB) → file lưu vào Storage
  bucket **`ctv-documents`** (mỗi CTV chỉ ghi được vào đúng thư mục
  `<user_id>/...` của mình) → tạo 1 dòng `ctv_document_submissions` trạng thái
  `pending`.
- Admin vào `admin/ctv.html` → mục **"Tài liệu CTV nộp — chờ duyệt"** → xem
  file, chốt **giá bán cuối cùng** + **% hoa hồng tác giả** (CTV nhận mỗi lượt
  bán) → **Duyệt**: tài liệu được tự động thêm vào catalogue công khai
  (`site_settings.doc_content.paid`) và xuất hiện ngay trên trang "Tài liệu"
  của site như tài liệu do admin đăng bình thường. **Từ chối**: CTV thấy lý do
  từ chối trong trang của họ, tài liệu không được công khai.
- Mỗi khi tài liệu đó bán được, hệ thống tự trích % đã đặt cộng vào ví CTV
  (hàm `ctv_credit_document_royalty`, tách riêng khỏi hoa hồng giới thiệu —
  cột `source` trong `ctv_commissions` phân biệt `'referral'` vs
  `'document_sale'`).

## 7. Cần deploy thêm
- Migration mới: `supabase/migrations/0014_ctv_withdrawals_and_documents.sql`
  (chạy sau 0013).
- Edge Function mới: **`ctv-portal`** (CTV tự yêu cầu rút tiền / nộp tài
  liệu) — deploy như các function khác.
- Deploy đè lại **`admin-ctv`** (đã thêm action xử lý rút tiền + duyệt tài
  liệu) và **`sepay-create-checkout`**, **`sepay-ipn`** (đã thêm gọi tính hoa
  hồng tác giả tài liệu).

## 8. Có thể mở rộng thêm (chưa làm)
- Multi-level CTV (nhiều cấp).
- Trang giới thiệu chương trình CTV công khai để tự đăng ký (hiện admin cấp
  quyền thủ công theo email).
- Thông báo qua email/app khi yêu cầu rút tiền hoặc tài liệu được xử lý (hiện
  CTV phải tự vào trang `ctv/index.html` để xem trạng thái).
