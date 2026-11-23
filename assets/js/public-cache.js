// ============================================================
// SNGEDU — Bọc supabase-js: các bảng CÔNG KHAI (môn, chương, gói Pro, cài đặt, liên kết) đọc từ /api/public
// (1 request, cache Cloudflare + sessionStorage 2 phút) thay vì mỗi chỗ gọi Supabase riêng.
// Mọi thứ khác (đăng nhập, dữ liệu cá nhân, ghi) vẫn đi thẳng Supabase như cũ.
// Nếu /api/public lỗi -> tự động quay về gọi Supabase trực tiếp, web không hỏng.
// Trang admin cần dữ liệu mới nhất: KHÔNG dùng file này.
// ============================================================
(function () {
    'use strict';
    var KEY = 'sng_pub', TTL = 120000, TABLES = { site_settings: 1, subjects: 1, chapters: 1, quick_links: 1, pro_packages: 1 };
    var pending = null;

    function getSnapshot() {
        if (pending) return pending;
        try { var c = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (c && Date.now() - c.t < TTL) return (pending = Promise.resolve(c.d)); } catch (e) {}
        pending = fetch('/api/public').then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (d) {
            try { sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), d: d })); } catch (e) {}
            setTimeout(function () { pending = null; }, TTL);
            return d;
        }).catch(function () { pending = null; return null; });
        return pending;
    }
    window.sngPublic = getSnapshot;

    function cmp(a, b) { return a === b ? 0 : (a < b ? -1 : 1); }
    function Q(table, real) { this.t = table; this.real = real; this.cols = '*'; this.f = []; this.o = []; this.lim = null; this.mode = null; this.cnt = false; this.head = false; }
    ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is'].forEach(function (op) { Q.prototype[op] = function (c, v) { this.f.push([c, op, v]); return this; }; });
    Q.prototype.select = function (cols, o) { o = o || {}; this.cols = cols || '*'; if (o.count) this.cnt = true; if (o.head) this.head = true; return this; };
    Q.prototype.order = function (c, o) { o = o || {}; this.o.push({ col: c, asc: o.ascending !== false, nullsFirst: o.nullsFirst }); return this; };
    Q.prototype.limit = function (n) { this.lim = n; return this; };
    Q.prototype.single = function () { this.mode = 'single'; return this; };
    Q.prototype.maybeSingle = function () { this.mode = 'maybe'; return this; };
    ['update', 'insert', 'delete', 'upsert'].forEach(function (m) { Q.prototype[m] = function () { return this.real.from(this.t)[m].apply(this.real.from(this.t), arguments); }; });
    Q.prototype.then = function (a, b) { return this.run().then(a, b); };

    Q.prototype.fallback = function () { // gọi Supabase thật với đúng các điều kiện đã ghi lại
        var q = this.real.from(this.t).select(this.cols, { count: this.cnt ? 'exact' : undefined, head: this.head });
        this.f.forEach(function (x) { q = q[x[1]](x[0], x[2]); });
        this.o.forEach(function (o) { q = q.order(o.col, { ascending: o.asc, nullsFirst: o.nullsFirst }); });
        if (this.lim) q = q.limit(this.lim);
        if (this.mode === 'single') q = q.single(); else if (this.mode === 'maybe') q = q.maybeSingle();
        return q;
    };
    Q.prototype.run = function () {
        var self = this;
        return getSnapshot().then(function (snap) {
            if (!snap || !snap[self.t]) return self.fallback();
            var rows = snap[self.t].slice();
            self.f.forEach(function (x) {
                var c = x[0], op = x[1], v = x[2];
                rows = rows.filter(function (r) {
                    var a = r[c];
                    return op === 'eq' ? a === v : op === 'neq' ? a !== v : op === 'gt' ? a > v : op === 'gte' ? a >= v : op === 'lt' ? a < v : op === 'lte' ? a <= v : op === 'in' ? v.indexOf(a) >= 0 : op === 'is' ? (a === null || a === undefined) : true;
                });
            });
            var count = rows.length;
            if (self.o.length) rows.sort(function (r1, r2) {
                for (var i = 0; i < self.o.length; i++) {
                    var o = self.o[i], a = r1[o.col], b = r2[o.col], an = a == null, bn = b == null;
                    var nf = typeof o.nullsFirst === 'boolean' ? o.nullsFirst : !o.asc;
                    var c = an || bn ? (an && bn ? 0 : (an ? (nf ? -1 : 1) : (nf ? 1 : -1))) : (o.asc ? cmp(a, b) : cmp(b, a));
                    if (c) return c;
                }
                return 0;
            });
            if (self.lim) rows = rows.slice(0, self.lim);
            if (self.cols !== '*') { var keep = self.cols.split(',').map(function (s) { return s.trim(); }); rows = rows.map(function (r) { var o = {}; keep.forEach(function (k) { if (k in r) o[k] = r[k]; }); return o; }); }
            if (self.head) return { data: null, count: count, error: null };
            if (self.mode === 'single') return rows.length === 1 ? { data: rows[0], count: count, error: null } : { data: null, count: count, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
            if (self.mode === 'maybe') return { data: rows[0] || null, count: count, error: null };
            return { data: rows, count: count, error: null };
        });
    };

    window.sngWrapSupabase = function (real) {
        return new Proxy(real, { get: function (t, p) {
            if (p === 'from') return function (name) { return TABLES[name] ? new Q(name, real) : real.from(name); };
            var v = t[p]; return typeof v === 'function' ? v.bind(t) : v;
        } });
    };
})();
