// ============================================================
// SNG EDU — Service Worker
// Mục tiêu: cho phép "Cài đặt ứng dụng" (PWA) + mở lại được các
// trang/tài liệu tĩnh đã từng ghé khi mất mạng.
//
// LƯU Ý QUAN TRỌNG: mọi request sang Supabase (api...supabase.co) và
// các CDN ngoài (font, KaTeX, FontAwesome...) đều bị bỏ qua (không cache),
// để không bao giờ phục vụ dữ liệu tài khoản/điểm số/thanh toán cũ khi
// offline — những phần đó LUÔN cần mạng, đúng bản chất dữ liệu động.
// Tăng CACHE_VERSION mỗi khi đổi asset tĩnh quan trọng để buộc cập nhật cache.
// ============================================================

const CACHE_VERSION = 'sngedu-shell-v1';

const CORE_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/offline.html',
    '/assets/icon-192.png',
    '/assets/icon-512.png',
    '/assets/favicon-32.png',
    '/assets/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then((cache) => cache.addAll(CORE_ASSETS))
            .catch(() => { /* thiếu mạng lúc cài cũng không sao, sẽ cache dần khi duyệt */ })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return; // không đụng vào POST/PUT (ghi bài làm, thanh toán...)

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return; // bỏ qua Supabase/CDN ngoài — luôn lấy từ mạng

    const isNavigation = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

    if (isNavigation) {
        // Trang HTML: ưu tiên mạng (luôn mới nhất), lỡ mất mạng thì lấy bản đã cache,
        // không có nốt thì hiện trang "đang offline".
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
                    return res;
                })
                .catch(() => caches.match(req).then((cached) => cached || caches.match('/offline.html')))
        );
        return;
    }

    // Tài nguyên tĩnh cùng domain (css/js/ảnh nội bộ): trả cache ngay cho nhanh,
    // đồng thời âm thầm tải bản mới về cache cho lần sau (stale-while-revalidate).
    event.respondWith(
        caches.match(req).then((cached) => {
            const network = fetch(req)
                .then((res) => {
                    if (res && res.ok) {
                        const copy = res.clone();
                        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
                    }
                    return res;
                })
                .catch(() => cached);
            return cached || network;
        })
    );
});
