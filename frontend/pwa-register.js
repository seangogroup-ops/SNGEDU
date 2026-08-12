(function () {
    // ============================================================
    // 1) Đăng ký Service Worker (bắt buộc HTTPS, trừ localhost lúc dev).
    // ============================================================
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('/sw.js').catch(function () { /* im lặng bỏ qua, không chặn trang */ });
        });

        // Khi có bản Service Worker mới được kích hoạt (đổi CACHE_VERSION khi deploy),
        // tự tải lại trang 1 lần để lấy đúng bản mới nhất, không cần người dùng tự xoá cache.
        // Cờ "sngedu_sw_reloaded" chỉ để tránh lặp vô hạn nếu controllerchange bắn nhiều lần.
        var alreadyReloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', function () {
            if (alreadyReloaded) return;
            alreadyReloaded = true;
            location.reload();
        });
    }

    // ============================================================
    // 2) Tự động nhắc cài đặt sau khi dùng web đủ lâu mà chưa cài.
    //    - Đếm số lần ghé trang, lưu ở localStorage (không cần đăng nhập).
    //    - Đủ số lần ghé mà vẫn đang mở bằng trình duyệt (chưa cài) thì:
    //        + Android/Chrome/Edge: tự bật hộp thoại "Cài đặt" của trình duyệt luôn,
    //          không cần người dùng phải bấm nút nhỏ mới thấy.
    //        + iPhone/iPad (Safari): trình duyệt KHÔNG cho web tự bật hộp thoại cài đặt
    //          (giới hạn của Apple, không có cách nào lách qua bằng code), nên hiện
    //          1 banner nhỏ hướng dẫn 2 bước "Chia sẻ -> Thêm vào MH chính".
    //    - Nếu người dùng bỏ qua thì "ngủ" một thời gian rồi mới nhắc lại, tránh làm phiền.
    // ============================================================
    var LS_VISITS      = 'sngedu_pwa_visit_count';
    var LS_SNOOZE_UNTIL = 'sngedu_pwa_snooze_until';
    var VISIT_THRESHOLD = 3;                 // ghé đủ 3 lần mới bắt đầu nhắc
    var SNOOZE_DAYS_AFTER_DISMISS = 10;      // lỡ bấm "Không phải bây giờ" thì 10 ngày sau mới hỏi lại
    var AUTO_PROMPT_DELAY_MS = 3500;         // chờ vài giây cho trang load xong hẳn rồi mới bật hộp thoại, đỡ giật

    function safeGet(key){ try { return localStorage.getItem(key); } catch(e){ return null; } }
    function safeSet(key, val){ try { localStorage.setItem(key, val); } catch(e){ /* ignore (chế độ ẩn danh...) */ } }

    function isStandalone(){
        // Đã cài & đang mở như 1 app riêng (không phải trong tab trình duyệt) thì thôi, khỏi nhắc.
        return window.matchMedia('(display-mode: standalone)').matches ||
               window.matchMedia('(display-mode: window-controls-overlay)').matches ||
               window.navigator.standalone === true; // Safari iOS
    }

    function isSnoozed(){
        var until = parseInt(safeGet(LS_SNOOZE_UNTIL) || '0', 10);
        return Date.now() < until;
    }
    function snooze(days){
        safeSet(LS_SNOOZE_UNTIL, String(Date.now() + days * 24 * 60 * 60 * 1000));
    }

    function bumpVisitCountAndGet(){
        var n = parseInt(safeGet(LS_VISITS) || '0', 10) + 1;
        safeSet(LS_VISITS, String(n));
        return n;
    }

    var visitCount = isStandalone() ? 0 : bumpVisitCountAndGet();

    function isIOS(){
        return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
               (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 13+ giả làm Mac
    }

    // ---------- Banner dùng chung (tự vẽ bằng JS, không cần sửa từng trang HTML) ----------
    function injectBannerStyle(){
        if (document.getElementById('pwaAutoBannerStyle')) return;
        var st = document.createElement('style');
        st.id = 'pwaAutoBannerStyle';
        st.textContent =
            '#pwaAutoBanner{position:fixed;left:12px;right:12px;bottom:14px;z-index:99999;' +
            'background:#1b1c26;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:16px;' +
            'padding:14px 14px 14px 16px;box-shadow:0 12px 32px -8px rgba(0,0,0,.45);' +
            'display:flex;align-items:center;gap:12px;font-family:inherit;' +
            'animation:pwaAutoBannerIn .28s ease;max-width:420px;margin:0 auto;}' +
            '@keyframes pwaAutoBannerIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}' +
            '#pwaAutoBanner .pab-ico{width:40px;height:40px;border-radius:11px;flex-shrink:0;' +
            'background:linear-gradient(135deg,#6c5cf6,#4f6bff);display:flex;align-items:center;justify-content:center;font-size:1.15rem;}' +
            '#pwaAutoBanner .pab-text{flex:1;min-width:0;font-size:.82rem;line-height:1.45;color:#e6e6ef;}' +
            '#pwaAutoBanner .pab-text b{color:#fff;display:block;font-size:.86rem;margin-bottom:2px;}' +
            '#pwaAutoBanner .pab-actions{display:flex;flex-direction:column;gap:6px;flex-shrink:0;}' +
            '#pwaAutoBanner button{border:none;border-radius:9px;padding:8px 12px;font-weight:700;font-size:.76rem;' +
            'cursor:pointer;font-family:inherit;white-space:nowrap;}' +
            '#pwaAutoBanner .pab-ok{background:linear-gradient(135deg,#6c5cf6,#4f6bff);color:#fff;}' +
            '#pwaAutoBanner .pab-close{background:transparent;color:#9a9bb0;padding:8px 6px;}';
        document.head.appendChild(st);
    }

    function removeBanner(){
        var el = document.getElementById('pwaAutoBanner');
        if (el) el.remove();
    }

    // Banner cho iOS: chỉ hướng dẫn thao tác thủ công (Apple không cho web tự bật hộp thoại cài đặt).
    function showIOSInstallBanner(){
        injectBannerStyle();
        if (document.getElementById('pwaAutoBanner')) return;
        var el = document.createElement('div');
        el.id = 'pwaAutoBanner';
        el.innerHTML =
            '<div class="pab-ico">📲</div>' +
            '<div class="pab-text"><b>Cài SNG EDU vào máy cho tiện</b>Bấm nút <b>Chia sẻ</b> ' +
            '<span style="opacity:.85">(hình vuông có mũi tên, ở thanh dưới Safari)</span> rồi chọn ' +
            '<b>"Thêm vào MH chính"</b>.</div>' +
            '<div class="pab-actions"><button type="button" class="pab-close" id="pwaAutoBannerClose">Để sau</button></div>';
        document.body.appendChild(el);
        document.getElementById('pwaAutoBannerClose').addEventListener('click', function(){
            removeBanner();
            snooze(SNOOZE_DAYS_AFTER_DISMISS);
        });
    }

    // Banner cho Android/Chrome: có nút "Cài ngay" bật thẳng hộp thoại cài đặt gốc của trình duyệt.
    function showAndroidInstallBanner(deferredPrompt){
        injectBannerStyle();
        if (document.getElementById('pwaAutoBanner')) return;
        var el = document.createElement('div');
        el.id = 'pwaAutoBanner';
        el.innerHTML =
            '<div class="pab-ico">📲</div>' +
            '<div class="pab-text"><b>Cài SNG EDU vào máy?</b>Mở nhanh hơn, học được cả khi mạng chậm.</div>' +
            '<div class="pab-actions">' +
                '<button type="button" class="pab-ok" id="pwaAutoBannerOk">Cài ngay</button>' +
                '<button type="button" class="pab-close" id="pwaAutoBannerClose">Để sau</button>' +
            '</div>';
        document.body.appendChild(el);
        document.getElementById('pwaAutoBannerClose').addEventListener('click', function(){
            removeBanner();
            snooze(SNOOZE_DAYS_AFTER_DISMISS);
        });
        document.getElementById('pwaAutoBannerOk').addEventListener('click', function(){
            removeBanner();
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            deferredPrompt.userChoice.finally(function(){});
        });
    }

    // ---------- Nút nhỏ trên thanh trên cùng (nếu trang có sẵn #pwaInstallBtn) ----------
    var deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredPrompt = e;

        var btn = document.getElementById('pwaInstallBtn');
        if (btn) {
            btn.style.display = 'inline-flex';
            btn.addEventListener('click', function onClick() {
                btn.removeEventListener('click', onClick);
                btn.style.display = 'none';
                if (!deferredPrompt) return;
                deferredPrompt.prompt();
                deferredPrompt.userChoice.finally(function () { deferredPrompt = null; });
            });
        }

        // Đủ điều kiện tự động nhắc (ghé đủ số lần, chưa cài, chưa "ngủ") -> hiện banner
        // và tự bật thẳng hộp thoại cài đặt gốc của trình duyệt sau vài giây.
        if (!isStandalone() && !isSnoozed() && visitCount >= VISIT_THRESHOLD) {
            setTimeout(function(){
                if (!deferredPrompt) return; // lỡ người dùng đã cài/đóng tab trong lúc chờ
                showAndroidInstallBanner(deferredPrompt);
            }, AUTO_PROMPT_DELAY_MS);
        }
    });

    window.addEventListener('appinstalled', function () {
        var btn = document.getElementById('pwaInstallBtn');
        if (btn) btn.style.display = 'none';
        removeBanner();
        deferredPrompt = null;
    });

    // iOS: không có beforeinstallprompt, tự quyết định hiện banner hướng dẫn thủ công.
    if (isIOS() && !isStandalone() && !isSnoozed() && visitCount >= VISIT_THRESHOLD) {
        window.addEventListener('load', function(){
            setTimeout(showIOSInstallBanner, AUTO_PROMPT_DELAY_MS);
        });
    }
})();
