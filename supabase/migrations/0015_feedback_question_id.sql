-- ============================================================
-- SNGEDU — Thêm cột question_id vào bảng feedback
-- Mục đích: khi học viên bấm "Báo lỗi câu này" trong lúc làm đề, lưu thẳng
-- ID thật của câu hỏi trong bảng questions (thay vì chỉ lưu số thứ tự hiển thị
-- + đoạn trích văn bản như trước). Nhờ vậy trang quản trị có thể nhảy thẳng
-- và mở sẵn form sửa đúng câu học viên báo lỗi, không cần admin tự dò tìm.
--
-- An toàn khi chạy lại nhiều lần (idempotent). Các góp ý cũ gửi trước khi có
-- cột này sẽ có question_id = null — trang quản trị sẽ tự dò theo đoạn trích
-- văn bản trong question_ref như cơ chế dự phòng.
-- ============================================================

alter table public.feedback add column if not exists question_id bigint;

create index if not exists idx_feedback_question_id on public.feedback(question_id);
