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

    return { checkLimit, logUsage, isProActive, actionLabel };
})();
