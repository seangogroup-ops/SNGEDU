(function () {
    // Đăng ký Service Worker (bắt buộc HTTPS, trừ localhost lúc dev).
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('/sw.js').catch(function () { /* im lặng bỏ qua, không chặn trang */ });
        });
    }

    // Gợi ý "Cài đặt ứng dụng": Chrome/Edge/Android sẽ bắn sự kiện beforeinstallprompt
    // khi đủ điều kiện (có manifest + service worker + HTTPS). Nếu trang có sẵn phần tử
    // #pwaInstallBtn thì hiện nó ra; nếu không có phần tử này thì bỏ qua, không ảnh hưởng gì.
    var deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredPrompt = e;
        var btn = document.getElementById('pwaInstallBtn');
        if (!btn) return;
        btn.style.display = 'inline-flex';
        btn.addEventListener('click', function onClick() {
            btn.removeEventListener('click', onClick);
            btn.style.display = 'none';
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            deferredPrompt.userChoice.finally(function () { deferredPrompt = null; });
        });
    });

    window.addEventListener('appinstalled', function () {
        var btn = document.getElementById('pwaInstallBtn');
        if (btn) btn.style.display = 'none';
        deferredPrompt = null;
    });
})();
