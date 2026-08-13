// ============================================================================
// KIỂM TRA CHẾ ĐỘ BẢO TRÌ — chạy sớm nhất có thể ở đầu <head> của các trang
// thuộc "trang chủ" (index, môn học, chi tiết, trắc nghiệm, góp ý, đăng nhập...).
// Đọc cờ bật/tắt ở site_settings (key 'site_maintenance', quản lý tại Admin > Bảo trì).
// Nếu đang bật bảo trì -> chuyển hướng sang /bao-tri.html.
// LƯU Ý: KHÔNG gắn script này vào admin/index.html và lien-he.html — 2 trang đó
// luôn phải dùng được kể cả khi web đang bảo trì.
// ============================================================================
(function () {
    var MNT_URL = 'https://sakombvgdobdehbvsfjw.supabase.co';
    var MNT_KEY = 'sb_publishable_gsXHbhvTTlYPyaa58FkNOQ_IylV8uEU';

    // Ẩn tạm nội dung trang trong lúc chờ kiểm tra, tránh nháy nội dung rồi mới
    // chuyển hướng. Có timeout dự phòng để không chặn trang quá lâu nếu mạng lỗi.
    document.documentElement.classList.add('mnt-check');
    var style = document.createElement('style');
    style.textContent = 'html.mnt-check{visibility:hidden;}';
    document.head.appendChild(style);

    function reveal() { document.documentElement.classList.remove('mnt-check'); }
    var timer = setTimeout(reveal, 1500);

    fetch(MNT_URL + '/rest/v1/site_settings?key=eq.site_maintenance&select=payload', {
        headers: { apikey: MNT_KEY, Authorization: 'Bearer ' + MNT_KEY }
    })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rows) {
            clearTimeout(timer);
            var payload = rows && rows[0] && rows[0].payload;
            if (payload && payload.enabled) {
                location.replace('/bao-tri.html');
            } else {
                reveal();
            }
        })
        .catch(function () { clearTimeout(timer); reveal(); });
})();
