// SNGEDU — Đã TẮT ghi nhận từng lượt xem trang vào Supabase (nguồn tốn lượt ghi nhất).
// Giữ hàm rỗng để các trang gọi window.sngTrackVisit(...) không bị lỗi.
// Muốn thống kê truy cập: bật Cloudflare Web Analytics (Dashboard -> Web Analytics), miễn phí.
(function () { window.sngTrackVisit = function () {}; })();
