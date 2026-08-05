/* ============================================================
   SNGEDU — Giới hạn sử dụng cho tài khoản Free
   Dùng chung cho: index.html (tải tài liệu free), quiz-dynamic.html,
   quiz-exam.html, quiz-tinhtoan.html (làm trắc nghiệm).

   Cách hoạt động:
   - Tài khoản Pro (user_metadata.plan === 'premium' còn hạn) -> KHÔNG giới hạn.
   - Tài khoản Free -> giới hạn theo site_settings.key = 'usage_limits'
     (payload: { quiz_per_day, doc_download_per_day }), admin chỉnh trong tab admin.
   - Đếm số lượt trong "ngày" theo giờ Việt Nam (00:00 -> 23:59 Asia/Ho_Chi_Minh),
     dựa trên bảng usage_logs (mỗi lượt = 1 dòng, user tự ghi được nhờ RLS insert_own).

   Yêu cầu: biến toàn cục `sb` (Supabase client) đã được khởi tạo trước khi include file này.
   ============================================================ */

const SNG_USAGE = (function () {
    const DEFAULT_LIMITS = { quiz_per_day: 3, doc_download_per_day: 2 };
    let cachedLimits = null;

    // Mốc 00:00 hôm nay theo giờ Việt Nam (UTC+7), trả về Date (mốc UTC tương ứng).
    function startOfTodayVN() {
        const now = new Date();
        // Giờ hiện tại tại VN = UTC + 7h
        const vnMs = now.getTime() + 7 * 60 * 60 * 1000;
        const vnDate = new Date(vnMs);
        vnDate.setUTCHours(0, 0, 0, 0);
        // Đưa mốc 00:00 (VN) về lại thời điểm UTC thực tế tương ứng
        return new Date(vnDate.getTime() - 7 * 60 * 60 * 1000);
    }

    async function fetchLimits() {
        if (cachedLimits) return cachedLimits;
        try {
            const { data, error } = await sb.from('site_settings').select('*').eq('key', 'usage_limits').single();
            if (error || !data || !data.payload) {
                cachedLimits = { ...DEFAULT_LIMITS };
            } else {
                cachedLimits = {
                    quiz_per_day: Number.isFinite(+data.payload.quiz_per_day) ? +data.payload.quiz_per_day : DEFAULT_LIMITS.quiz_per_day,
                    doc_download_per_day: Number.isFinite(+data.payload.doc_download_per_day) ? +data.payload.doc_download_per_day : DEFAULT_LIMITS.doc_download_per_day,
                };
            }
        } catch (e) {
            cachedLimits = { ...DEFAULT_LIMITS };
        }
        return cachedLimits;
    }

    function isProActive(user) {
        if (!user) return false;
        const meta = user.user_metadata || {};
        const premiumUntil = meta.premium_until ? new Date(meta.premium_until) : null;
        return meta.plan === 'premium' && (!premiumUntil || premiumUntil > new Date());
    }

    async function countToday(userId, actionType) {
        const since = startOfTodayVN().toISOString();
        const { count, error } = await sb
            .from('usage_logs')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('action_type', actionType)
            .gte('created_at', since);
        if (error) return 0; // lỗi mạng/khác -> không chặn nhầm người dùng
        return count || 0;
    }

    /**
     * Kiểm tra xem user có được phép thực hiện hành động hay không.
     * @param {object} user - đối tượng user từ sb.auth.getUser()/getSession()
     * @param {'quiz_attempt'|'doc_download'} actionType
     * @returns {Promise<{allowed:boolean, isPro:boolean, used:number, limit:number|null}>}
     */
    async function checkLimit(user, actionType) {
        if (isProActive(user)) {
            return { allowed: true, isPro: true, used: 0, limit: null };
        }
        const limits = await fetchLimits();
        const limit = actionType === 'quiz_attempt' ? limits.quiz_per_day : limits.doc_download_per_day;
        // limit <= 0 hoặc không phải số hợp lệ -> coi như không giới hạn (admin có thể tắt giới hạn bằng cách để 0)
        if (!Number.isFinite(limit) || limit <= 0) {
            return { allowed: true, isPro: false, used: 0, limit: null };
        }
        const used = await countToday(user.id, actionType);
        return { allowed: used < limit, isPro: false, used, limit };
    }

    /** Ghi nhận 1 lượt sử dụng (gọi SAU KHI hành động đã thực sự diễn ra thành công). */
    async function logUsage(userId, actionType, refId) {
        try {
            await sb.from('usage_logs').insert({ user_id: userId, action_type: actionType, ref_id: refId ? String(refId) : null });
        } catch (e) { /* không chặn UI nếu ghi log lỗi */ }
    }

    function actionLabel(actionType) {
        return actionType === 'quiz_attempt' ? 'làm trắc nghiệm' : 'tải tài liệu miễn phí';
    }

    /**
     * Cảnh báo "sắp hết lượt free" — gọi SAU khi checkLimit() cho phép (allowed:true) nhưng
     * TRƯỚC khi thực hiện hành động, để người dùng biết còn bao nhiêu lượt trước khi bị chặn hẳn.
     * Không hiển thị gì với tài khoản Pro hoặc khi còn nhiều lượt (mặc định: còn <= 1 lượt mới cảnh báo).
     * @param {{allowed:boolean,isPro:boolean,used:number,limit:number|null}} result - kết quả từ checkLimit()
     * @param {'quiz_attempt'|'doc_download'} actionType
     * @param {number} [warnAtRemaining=1] - hiện cảnh báo khi số lượt còn lại (sau lượt này) <= giá trị này
     */
    function maybeShowLowQuotaBanner(result, actionType, warnAtRemaining) {
        if (!result || result.isPro || !Number.isFinite(result.limit)) return;
        const threshold = Number.isFinite(warnAtRemaining) ? warnAtRemaining : 1;
        const remainingAfterThis = result.limit - result.used - 1; // lượt hiện tại rồi sẽ được dùng ngay sau đó
        if (remainingAfterThis > threshold) return;

        const id = 'sng-low-quota-banner';
        if (document.getElementById(id)) return; // tránh chèn trùng nếu gọi nhiều lần trong 1 trang
        const label = actionLabel(actionType);
        const text = remainingAfterThis <= 0
            ? `Đây là lượt ${label} MIỄN PHÍ CUỐI CÙNG hôm nay của bạn. Nâng cấp Pro để không bị giới hạn.`
            : `Bạn chỉ còn ${remainingAfterThis} lượt ${label} miễn phí hôm nay. Nâng cấp Pro để không bị giới hạn.`;

        const banner = document.createElement('div');
        banner.id = id;
        banner.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:99999;'
            + 'background:#fff3d6;color:#7a4b00;border:1px solid #f5c563;border-radius:12px;'
            + 'padding:10px 16px;font-family:sans-serif;font-size:.86rem;font-weight:600;'
            + 'box-shadow:0 8px 24px -8px rgba(0,0,0,.25);display:flex;align-items:center;gap:10px;'
            + 'max-width:92vw;';
        banner.innerHTML = `<span>⏳ ${text}</span>`
            + `<a href="/index.html?openPro=1" style="background:#f5a524;color:#fff;padding:5px 12px;border-radius:8px;text-decoration:none;white-space:nowrap;">Nâng cấp Pro</a>`
            + `<button type="button" aria-label="Đóng" style="background:none;border:none;font-size:1rem;cursor:pointer;color:#7a4b00;line-height:1;">×</button>`;
        banner.querySelector('button').onclick = () => banner.remove();
        document.body.appendChild(banner);
        setTimeout(() => { if (banner.isConnected) banner.remove(); }, 12000);
    }

    return { checkLimit, logUsage, isProActive, actionLabel, maybeShowLowQuotaBanner };
})();
