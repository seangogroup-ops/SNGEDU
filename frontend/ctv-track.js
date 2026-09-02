// ============================================================
// SNGEDU — Ghi nhận click từ link giới thiệu CTV (cộng tác viên).
// Cách hoạt động:
//  - Link giới thiệu dạng: https://domain/?ctv=MA_CTV (thêm vào bất kỳ trang nào).
//  - Khi trang load, nếu có ?ctv=... trên URL: lưu mã vào localStorage
//    (hết hạn sau 30 ngày kể từ lần click gần nhất) + gửi 1 dòng vào bảng
//    ctv_clicks để CTV/admin đếm được số lượt click.
//  - frontend/sepay-checkout.js gọi window.sngGetCtvCode() để đính kèm mã này
//    vào đơn hàng khi khách thanh toán -> tính hoa hồng cho đúng CTV.
//
// Không cần supabase-js, gọi thẳng REST API (giống frontend/track-visit.js)
// để không phụ thuộc thứ tự load script và không chặn/làm chậm trang.
// ============================================================
(function () {
    var SUPABASE_URL = 'https://sakombvgdobdehbvsfjw.supabase.co';
    var SUPABASE_ANON_KEY = 'sb_publishable_gsXHbhvTTlYPyaa58FkNOQ_IylV8uEU';
    var STORAGE_KEY = 'sng_ctv_ref';
    var TTL_DAYS = 30; // thời gian "nhớ" người giới thiệu kể từ lần click gần nhất

    function uuid() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    function getVisitorId() {
        try {
            var id = localStorage.getItem('sng_vid');
            if (!id) { id = uuid(); localStorage.setItem('sng_vid', id); }
            return id;
        } catch (e) { return ''; }
    }

    function saveRef(code) {
        try {
            var payload = { code: String(code).toUpperCase(), expires: Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000 };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch (e) { /* ignore */ }
    }

    // Đọc mã CTV đang "có hiệu lực" (chưa hết hạn 30 ngày), dùng khi tạo đơn thanh toán.
    window.sngGetCtvCode = function () {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return '';
            var data = JSON.parse(raw);
            if (!data || !data.code || !data.expires) return '';
            if (Date.now() > data.expires) { localStorage.removeItem(STORAGE_KEY); return ''; }
            return data.code;
        } catch (e) { return ''; }
    };

    function logClick(code) {
        try {
            var payload = {
                ctv_code: code,
                path: location.pathname + (location.search || '') + (location.hash || ''),
                referrer: document.referrer || '',
                visitor_id: getVisitorId(),
                user_agent: (navigator && navigator.userAgent) || ''
            };
            fetch(SUPABASE_URL + '/rest/v1/ctv_clicks', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify(payload),
                keepalive: true
            }).catch(function () { /* im lặng bỏ qua */ });
        } catch (e) { /* không để lỗi ghi nhận làm hỏng trang */ }
    }

    try {
        var params = new URLSearchParams(location.search);
        var code = params.get('ctv');
        if (code && /^[a-zA-Z0-9_-]{2,32}$/.test(code)) {
            saveRef(code);
            logClick(code.toUpperCase());
        }
    } catch (e) { /* trình duyệt quá cũ không hỗ trợ URLSearchParams -> bỏ qua */ }
})();
