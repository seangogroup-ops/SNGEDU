/* ============================================================
   SNGEDU — Mở FREE toàn bộ
   Đã gỡ giới hạn lượt làm trắc nghiệm / tải tài liệu theo ngày.
   File này giữ lại dưới dạng "stub" để các trang cũ gọi SNG_USAGE vẫn chạy:
   - checkLimit: luôn cho phép, không giới hạn
   - logUsage: không ghi gì
   - isProActive: luôn true (mọi người dùng như tài khoản Pro -> tài liệu VIP mở sẵn)
   ============================================================ */
const SNG_USAGE = (function () {
    async function checkLimit() { return { allowed: true, isPro: true, used: 0, limit: null }; }
    async function logUsage() { /* không ghi log nữa */ }
    function isProActive() { return true; }
    function actionLabel(actionType) {
        return actionType === 'quiz_attempt' ? 'làm trắc nghiệm' : 'tải tài liệu';
    }
    return { checkLimit, logUsage, isProActive, actionLabel };
})();
