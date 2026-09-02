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
            '#pwaAutoBackdrop{position:fixed;inset:0;z-index:99998;background:rgba(8,9,16,.55);' +
            'opacity:0;animation:pwaBackdropIn .25s ease forwards;}' +
            '@keyframes pwaBackdropIn{to{opacity:1}}' +

            '#pwaAutoBanner{position:fixed;left:0;right:0;bottom:0;z-index:99999;' +
            'background:#181926;color:#fff;border:1px solid rgba(255,255,255,.08);border-bottom:none;' +
            'border-radius:22px 22px 0 0;padding:10px 20px calc(env(safe-area-inset-bottom,0px) + 18px);' +
            'box-shadow:0 -16px 48px -8px rgba(0,0,0,.55);' +
            'font-family:inherit;max-width:460px;margin:0 auto;' +
            'animation:pwaAutoBannerIn .3s cubic-bezier(.2,.9,.3,1);}' +
            '@keyframes pwaAutoBannerIn{from{transform:translateY(100%)}to{transform:translateY(0)}}' +

            '#pwaAutoBanner .pab-handle{width:36px;height:4px;border-radius:99px;background:rgba(255,255,255,.16);' +
            'margin:0 auto 16px;}' +

            '#pwaAutoBanner .pab-close-x{position:absolute;top:14px;right:14px;width:28px;height:28px;' +
            'border-radius:50%;background:rgba(255,255,255,.08);border:none;color:#9a9bb0;' +
            'display:flex;align-items:center;justify-content:center;font-size:.85rem;cursor:pointer;padding:0;}' +
            '#pwaAutoBanner .pab-close-x:hover{background:rgba(255,255,255,.14);color:#fff;}' +

            '#pwaAutoBanner .pab-top{display:flex;align-items:center;gap:13px;margin-bottom:4px;}' +
            '#pwaAutoBanner .pab-ico{width:46px;height:46px;border-radius:14px;flex-shrink:0;' +
            'background:linear-gradient(135deg,#6c5cf6,#4f6bff);display:flex;align-items:center;' +
            'justify-content:center;font-size:1.35rem;box-shadow:0 6px 16px -4px rgba(79,107,255,.5);}' +
            '#pwaAutoBanner .pab-title{font-weight:800;font-size:1.02rem;line-height:1.3;margin:0;}' +
            '#pwaAutoBanner .pab-desc{font-size:.82rem;color:#9a9bb0;line-height:1.4;margin-top:3px;}' +

            '#pwaAutoBanner .pab-steps{margin:16px 0 4px;display:flex;flex-direction:column;gap:10px;}' +
            '#pwaAutoBanner .pab-step{display:flex;align-items:center;gap:11px;background:rgba(255,255,255,.05);' +
            'border-radius:12px;padding:10px 12px;}' +
            '#pwaAutoBanner .pab-step-num{width:22px;height:22px;border-radius:50%;background:rgba(108,92,246,.25);' +
            'color:#b9aeff;font-size:.74rem;font-weight:800;display:flex;align-items:center;justify-content:center;' +
            'flex-shrink:0;}' +
            '#pwaAutoBanner .pab-step-text{font-size:.82rem;color:#dcdcea;line-height:1.4;}' +
            '#pwaAutoBanner .pab-step-text b{color:#fff;}' +
            '#pwaAutoBanner .pab-step-ico{flex-shrink:0;font-size:1rem;}' +

            '#pwaAutoBanner .pab-actions{display:flex;gap:10px;margin-top:18px;}' +
            '#pwaAutoBanner button.pab-btn{flex:1;border:none;border-radius:13px;padding:13px 14px;' +
            'font-weight:700;font-size:.86rem;cursor:pointer;font-family:inherit;}' +
            '#pwaAutoBanner .pab-ok{background:linear-gradient(135deg,#6c5cf6,#4f6bff);color:#fff;' +
            'box-shadow:0 8px 20px -6px rgba(79,107,255,.55);}' +
            '#pwaAutoBanner .pab-close{background:rgba(255,255,255,.06);color:#c7c9da;}' +
            '#pwaAutoBanner .pab-single .pab-close{flex:none;width:100%;}';
        document.head.appendChild(st);
    }

    function removeBanner(){
        var el = document.getElementById('pwaAutoBanner');
        var bg = document.getElementById('pwaAutoBackdrop');
        if (el) el.remove();
        if (bg) bg.remove();
    }

    function addBackdrop(onDismiss){
        if (document.getElementById('pwaAutoBackdrop')) return;
        var bg = document.createElement('div');
        bg.id = 'pwaAutoBackdrop';
        bg.addEventListener('click', onDismiss);
        document.body.appendChild(bg);
    }

    // Banner cho iOS: chỉ hướng dẫn thao tác thủ công (Apple không cho web tự bật hộp thoại cài đặt).
    function showIOSInstallBanner(){
        injectBannerStyle();
        if (document.getElementById('pwaAutoBanner')) return;

        function dismiss(){ removeBanner(); snooze(SNOOZE_DAYS_AFTER_DISMISS); }
        addBackdrop(dismiss);

        var el = document.createElement('div');
        el.id = 'pwaAutoBanner';
        el.innerHTML =
            '<div class="pab-handle"></div>' +
            '<button type="button" class="pab-close-x" id="pwaAutoBannerCloseX">&times;</button>' +
            '<div class="pab-top">' +
                '<div class="pab-ico">📲</div>' +
                '<div><p class="pab-title">Cài SNG EDU vào máy</p>' +
                '<p class="pab-desc">Mở nhanh hơn, học được cả khi mạng chậm</p></div>' +
            '</div>' +
            '<div class="pab-steps">' +
                '<div class="pab-step"><span class="pab-step-num">1</span>' +
                '<span class="pab-step-text">Bấm biểu tượng <b>Chia sẻ</b> ở thanh dưới Safari</span>' +
                '<span class="pab-step-ico">⬆️</span></div>' +
                '<div class="pab-step"><span class="pab-step-num">2</span>' +
                '<span class="pab-step-text">Chọn <b>"Thêm vào Màn hình chính"</b></span>' +
                '<span class="pab-step-ico">➕</span></div>' +
            '</div>' +
            '<div class="pab-actions pab-single"><button type="button" class="pab-btn pab-close" id="pwaAutoBannerClose">Để sau</button></div>';
        document.body.appendChild(el);
        document.getElementById('pwaAutoBannerCloseX').addEventListener('click', dismiss);
        document.getElementById('pwaAutoBannerClose').addEventListener('click', dismiss);
    }

    // Banner cho Android/Chrome: có nút "Cài ngay" bật thẳng hộp thoại cài đặt gốc của trình duyệt.
    function showAndroidInstallBanner(deferredPrompt){
        injectBannerStyle();
        if (document.getElementById('pwaAutoBanner')) return;

        function dismiss(){ removeBanner(); snooze(SNOOZE_DAYS_AFTER_DISMISS); }
        addBackdrop(dismiss);

        var el = document.createElement('div');
        el.id = 'pwaAutoBanner';
        el.innerHTML =
            '<div class="pab-handle"></div>' +
            '<button type="button" class="pab-close-x" id="pwaAutoBannerCloseX">&times;</button>' +
            '<div class="pab-top">' +
                '<div class="pab-ico">📲</div>' +
                '<div><p class="pab-title">Cài SNG EDU vào máy?</p>' +
                '<p class="pab-desc">Mở nhanh hơn, học được cả khi mạng chậm</p></div>' +
            '</div>' +
            '<div class="pab-actions">' +
                '<button type="button" class="pab-btn pab-close" id="pwaAutoBannerClose">Để sau</button>' +
                '<button type="button" class="pab-btn pab-ok" id="pwaAutoBannerOk">Cài ngay</button>' +
            '</div>';
        document.body.appendChild(el);
        document.getElementById('pwaAutoBannerCloseX').addEventListener('click', dismiss);
        document.getElementById('pwaAutoBannerClose').addEventListener('click', dismiss);
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
