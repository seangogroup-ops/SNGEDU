// ============================================================
// SNGEDU — Ghi nhận lượt truy cập website (dùng chung cho mọi trang).
// Gửi thẳng vào bảng page_views qua REST API của Supabase (không cần đợi
// supabase-js load xong), không chặn/làm chậm trang, lỗi thì bỏ qua âm thầm.
//
// Cách dùng:
//  - Trang tĩnh: thêm <body data-page="mon-hoc" data-page-label="Chọn chương/đề">
//    rồi include <script src="frontend/track-visit.js"></script> là tự động ghi nhận.
//  - Trang dạng SPA (index.html có nhiều "mục" trong 1 trang): gọi tay
//    window.sngTrackVisit('quiz', 'Trắc nghiệm') mỗi khi chuyển mục.
// ============================================================
(function () {
    var SUPABASE_URL = 'https://sakombvgdobdehbvsfjw.supabase.co';
    var SUPABASE_ANON_KEY = 'sb_publishable_gsXHbhvTTlYPyaa58FkNOQ_IylV8uEU';

    function uuid() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    // visitor_id: bền theo trình duyệt (localStorage) -> đếm "khách duy nhất"
    function getVisitorId() {
        try {
            var id = localStorage.getItem('sng_vid');
            if (!id) { id = uuid(); localStorage.setItem('sng_vid', id); }
            return id;
        } catch (e) { return ''; }
    }
    // session_id: chỉ tồn tại trong 1 tab/phiên (sessionStorage) -> đếm "lượt ghé"
    function getSessionId() {
        try {
            var id = sessionStorage.getItem('sng_sid');
            if (!id) { id = uuid(); sessionStorage.setItem('sng_sid', id); }
            return id;
        } catch (e) { return ''; }
    }

    // Loại thiết bị + trình duyệt: đoán nhanh từ user agent, đủ dùng để thống kê,
    // không cần thư viện ngoài.
    function detectDevice(ua) {
        ua = ua || '';
        if (/iPad|Tablet(?!.*Mobile)|Nexus 7|Nexus 10|SM-T/i.test(ua)) return 'Tablet';
        if (/Mobi|Android(?=.*Mobile)|iPhone|iPod|Windows Phone/i.test(ua)) return 'Mobile';
        return 'Desktop';
    }
    function detectBrowser(ua) {
        ua = ua || '';
        if (/EdgA|Edg\//i.test(ua)) return 'Edge';
        if (/OPR\/|Opera/i.test(ua)) return 'Opera';
        if (/CriOS|Chrome\//i.test(ua) && !/Chromium/i.test(ua)) return 'Chrome';
        if (/FxiOS|Firefox\//i.test(ua)) return 'Firefox';
        if (/Safari\//i.test(ua) && /Version\//i.test(ua)) return 'Safari';
        if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
        return 'Khác';
    }

    // Quốc gia/thành phố: tra cứu 1 lần/phiên qua dịch vụ geo-IP miễn phí (ipwho.is),
    // lưu cache vào sessionStorage để không gọi lại ở mỗi lượt xem trang.
    // Nếu lỗi/không có mạng thì bỏ qua âm thầm, không chặn việc ghi nhận lượt truy cập.
    function getGeoCached() {
        try {
            var raw = sessionStorage.getItem('sng_geo');
            if (raw) return JSON.parse(raw);
        } catch (e) { /* ignore */ }
        return null;
    }
    function fetchGeoThenSend(sendFn) {
        var cached = getGeoCached();
        if (cached) { sendFn(cached); return; }
        try {
            fetch('https://ipwho.is/?fields=success,country,city')
                .then(function (r) { return r.json(); })
                .then(function (g) {
                    var geo = (g && g.success) ? { country: g.country || '', city: g.city || '' } : { country: '', city: '' };
                    try { sessionStorage.setItem('sng_geo', JSON.stringify(geo)); } catch (e) { /* ignore */ }
                    sendFn(geo);
                })
                .catch(function () { sendFn({ country: '', city: '' }); });
        } catch (e) { sendFn({ country: '', city: '' }); }
    }

    window.sngTrackVisit = function (pageKey, pageLabel) {
        try {
            var ua = (navigator && navigator.userAgent) || '';
            fetchGeoThenSend(function (geo) {
                var payload = {
                    path: location.pathname + (location.hash || ''),
                    page_key: pageKey || 'unknown',
                    page_label: pageLabel || '',
                    referrer: document.referrer || '',
                    visitor_id: getVisitorId(),
                    session_id: getSessionId(),
                    user_agent: ua,
                    language: (navigator && (navigator.language || (navigator.languages && navigator.languages[0]))) || '',
                    device_type: detectDevice(ua),
                    browser: detectBrowser(ua),
                    country: geo.country || '',
                    city: geo.city || ''
                };
                fetch(SUPABASE_URL + '/rest/v1/page_views', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
                        'Prefer': 'return=minimal'
                    },
                    body: JSON.stringify(payload),
                    keepalive: true
                }).catch(function () { /* im lặng bỏ qua, không ảnh hưởng trải nghiệm người dùng */ });
            });
        } catch (e) { /* không để lỗi ghi nhận làm hỏng trang */ }
    };

    // Tự động ghi nhận với các trang tĩnh có gắn sẵn data-page trên thẻ <body>.
    // Trang SPA (index.html) không gắn data-page — sẽ tự gọi sngTrackVisit() theo từng mục.
    document.addEventListener('DOMContentLoaded', function () {
        var key = document.body.getAttribute('data-page');
        if (key) window.sngTrackVisit(key, document.body.getAttribute('data-page-label') || '');
    });
})();
