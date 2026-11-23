# Trang chủ (index.html) — bản kết hợp Supabase + Cloudflare

Giữ nguyên Supabase cho đăng nhập, đơn hàng, ví, thanh toán. Cloudflare chỉ làm 1 việc: lưu cache dữ liệu công khai.

## Chép đè vào project (cùng đường dẫn)
- `functions/api/public.js`  (MỚI) — lấy môn/chương/gói Pro/cài đặt/số câu hỏi từ Supabase, cache 5 phút
- `assets/js/public-cache.js` (MỚI) — trình duyệt đọc dữ liệu công khai từ `/api/public`; lỗi thì tự gọi Supabase như cũ
- `index.html`, `assets/js/index.js` — thêm 1 thẻ script, đổi 2 chỗ nhỏ
- `frontend/maintenance-check.js` — dùng chung cache
- `frontend/track-visit.js` — TẮT ghi từng lượt xem trang

## Triển khai
Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git (chọn repo, build command để trống, output directory `.`).
Muốn dùng project Supabase khác thì thêm biến SUPABASE_URL, SUPABASE_ANON_KEY (không bắt buộc, mặc định dùng khoá hiện tại).

## Cần biết
- Chỉ chạy được khi web được host trên Cloudflare Pages (thư mục `functions/` chỉ có tác dụng ở đó). Nếu vẫn ở Vercel thì không có `/api/public` và web tự chạy như cũ (không giảm lượt gọi).
- Admin sửa nội dung xong, người dùng thấy sau tối đa ~5 phút.
- Chưa đụng: login, mon-hoc, chi-tiet, quiz-*, admin (vẫn gọi Supabase như cũ).
