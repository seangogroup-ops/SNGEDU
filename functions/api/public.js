// ============================================================
// SNGEDU — Cloudflare Pages Function: lấy dữ liệu CÔNG KHAI từ Supabase 1 lần, cache ở rìa mạng 5 phút.
// Mọi người truy cập trang chủ đều đọc bản cache này -> Supabase chỉ bị gọi vài lần mỗi giờ thay vì mỗi lượt xem.
// Biến môi trường (Pages -> Settings -> Variables): SUPABASE_URL, SUPABASE_ANON_KEY (khoá "publishable" đã công khai sẵn).
// Sau khi admin sửa nội dung, bản cache tự hết hạn sau tối đa 5 phút.
// ============================================================
const DEFAULT_URL = 'https://jdqqvvrqfjbptzdvycai.supabase.co';
const DEFAULT_KEY = 'sb_publishable_GhJtZpaPII3EzcQnw1pprg_p73Kn8Rx';
const EXAM_GROUP = 'Đề thi thử';
const CALC_GROUP = 'Bài tập tính toán';
const TTL = 300;

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/public', request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const base = (env.SUPABASE_URL || DEFAULT_URL).replace(/\/$/, '');
  const key = env.SUPABASE_ANON_KEY || DEFAULT_KEY;
  const headers = { apikey: key, Authorization: 'Bearer ' + key };
  const get = async (path) => {
    const r = await fetch(`${base}/rest/v1/${path}`, { headers });
    if (!r.ok) throw new Error('Supabase ' + r.status);
    return r.json();
  };
  // Đếm số câu hỏi: 1 request nhẹ (chỉ lấy header content-range) cho mỗi môn.
  const countQuestions = async (subjectId, chapters) => {
    if (!chapters.length) return 0;
    const inList = chapters.map(c => '"' + String(c).replace(/"/g, '\\"') + '"').join(',');
    const r = await fetch(`${base}/rest/v1/questions?select=id&subject_id=eq.${encodeURIComponent(subjectId)}&chapter=in.(${encodeURIComponent(inList)})`,
      { headers: { ...headers, Prefer: 'count=exact', Range: '0-0' } });
    const m = /\/(\d+)$/.exec(r.headers.get('content-range') || '');
    return m ? parseInt(m[1], 10) : 0;
  };

  try {
    const [site_settings, subjects, chapters, quick_links, pro_packages] = await Promise.all([
      get('site_settings?select=key,payload,updated_at'),
      get('subjects?select=*&order=order_no.asc.nullslast,id.asc'),
      get('chapters?select=*'),
      get('quick_links?select=*&order=order_no.asc.nullslast,id.asc'),
      get('pro_packages?select=*&active=eq.true&order=order_no.asc.nullslast,price.asc'),
    ]);
    const subject_counts = {};
    await Promise.all(subjects.map(async (s) => {
      const codes = chapters.filter(c => c.subject_id === s.id)
        .filter(c => { const g = c.group_name || 'Nội dung chính'; return g !== EXAM_GROUP && g !== CALC_GROUP; })
        .map(c => c.chapter);
      subject_counts[s.id] = await countQuestions(s.id, codes);
    }));
    const res = new Response(JSON.stringify({ site_settings, subjects, chapters, quick_links, pro_packages, subject_counts, generated_at: new Date().toISOString() }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=60, s-maxage=${TTL}` },
    });
    waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (e) {
    // Lỗi thì KHÔNG cache; trình duyệt sẽ tự gọi Supabase trực tiếp như cũ (xem public-cache.js).
    return new Response(JSON.stringify({ error: 'upstream' }), { status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
}
