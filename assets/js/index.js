const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toastMsg');
    const toastBtn = document.getElementById('toastBtn');
    let toastTimer;
    let interested = [];
    try{ interested = JSON.parse(localStorage.getItem('sng-interested') || '[]'); }catch(e){ interested = []; }

    function showToast(subjectId, subjectName){
        const label = subjectName ? `“${subjectName}” đang được biên soạn, quay lại sau nhé.` : 'Mục này đang được biên soạn, quay lại sau nhé.';
        toastMsg.textContent = label;

        if(subjectId && interested.includes(subjectId)){
            toastBtn.textContent = 'Đã quan tâm ✓';
            toastBtn.classList.add('done');
        }else{
            toastBtn.textContent = 'Quan tâm';
            toastBtn.classList.remove('done');
        }
        toastBtn.dataset.subject = subjectId || '';

        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(()=> toast.classList.remove('show'), 3600);
    }

    toastBtn.addEventListener('click', ()=>{
        const id = toastBtn.dataset.subject;
        if(!id || toastBtn.classList.contains('done')) return;
        interested.push(id);
        try{ localStorage.setItem('sng-interested', JSON.stringify(interested)); }catch(e){}
        toastBtn.textContent = 'Đã quan tâm ✓';
        toastBtn.classList.add('done');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(()=> toast.classList.remove('show'), 1800);
    });

    // ---------------- Thông báo hệ thống (thanh toán / nâng cấp Pro) ----------------
    const siteToastEl = document.getElementById('siteToast');
    const siteToastIconEl = document.getElementById('siteToastIcon');
    const siteToastTitleEl = document.getElementById('siteToastTitle');
    const siteToastMsgEl = document.getElementById('siteToastMsg');
    const siteToastCloseBtn = document.getElementById('siteToastClose');
    let siteToastTimer;

    function showSiteToast(opts){
        opts = opts || {};
        if (!siteToastEl) return;
        const title = opts.title || 'Thông báo';
        const message = opts.message || '';
        const type = opts.type || 'default'; // 'default' | 'success' | 'error' | 'pro'
        const icon = opts.icon || 'fa-circle-check';
        const duration = opts.duration || 6000;

        siteToastTitleEl.textContent = title;
        siteToastMsgEl.textContent = message;
        siteToastIconEl.innerHTML = `<i class="fa-solid ${icon}"></i>`;
        siteToastEl.className = 'site-toast show' + (type !== 'default' ? (' ' + type) : '');

        clearTimeout(siteToastTimer);
        siteToastTimer = setTimeout(()=> siteToastEl.classList.remove('show'), duration);
    }
    if (siteToastCloseBtn){
        siteToastCloseBtn.addEventListener('click', ()=>{
            siteToastEl.classList.remove('show');
            clearTimeout(siteToastTimer);
        });
    }

    // Chỉ hiện thông báo "Tài khoản Pro đang hoạt động" MỘT LẦN DUY NHẤT cho mỗi lần được nâng cấp
    // (dù nâng cấp bằng cách tự thanh toán hay được admin cộng/nâng cấp thủ công) — dựa vào việc so sánh
    // với trạng thái premium_until đã lưu trong localStorage của trình duyệt.
    function proNoticeStorageKey(userId){ return 'sng-pro-notice-' + userId; }

    function markProNoticeSeen(userId, meta){
        try{
            if (meta && meta.plan === 'premium'){
                localStorage.setItem(proNoticeStorageKey(userId), meta.premium_until || 'unlimited');
            }
        }catch(e){}
    }

    function checkProUpgradeNotice(){
        if (!currentSession) return;
        const user = currentSession.user;
        const meta = user.user_metadata || {};
        const premiumUntil = meta.premium_until ? new Date(meta.premium_until) : null;
        const isPremiumActive = meta.plan === 'premium' && (!premiumUntil || premiumUntil > new Date());
        if (!isPremiumActive) return;

        const stateKey = meta.premium_until || 'unlimited';
        const storageKey = proNoticeStorageKey(user.id);
        let seen = null;
        try{ seen = localStorage.getItem(storageKey); }catch(e){}
        if (seen === stateKey) return; // lần nâng cấp này đã thông báo rồi

        try{ localStorage.setItem(storageKey, stateKey); }catch(e){}
        showSiteToast({
            title: 'Tài khoản Pro đang hoạt động',
            message: premiumUntil
                ? ('Gói Premium của bạn có hiệu lực đến ' + premiumUntil.toLocaleDateString('vi-VN') + '.')
                : 'Bạn đang sử dụng gói Premium.',
            type: 'pro',
            icon: 'fa-crown',
            duration: 7000,
        });
    }

    function bindLockedCards(){
        document.querySelectorAll('[data-locked="true"]:not([data-bound])').forEach(el=>{
            el.dataset.bound = '1';
            el.addEventListener('click', e=>{
                e.preventDefault();
                showToast(el.dataset.subject, el.dataset.subjectName);
            });
        });
    }
    bindLockedCards();

    // ---------------- ĐỒNG BỘ MÔN HỌC VỚI SUPABASE ----------------
    const SUPABASE_URL = 'https://sakombvgdobdehbvsfjw.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_gsXHbhvTTlYPyaa58FkNOQ_IylV8uEU';
    const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // ---------------- ĐĂNG NHẬP / ĐĂNG KÝ — chỉ chặn khi bấm vào Trắc nghiệm, Tài liệu, Công cụ, Sản phẩm ----------------
    // Trang chủ và Hỗ trợ luôn hiện tự do trước, không bị chuyển trang ngay.
    const GATED_TABS = ['quiz', 'doc', 'tool', 'product', 'account', 'history'];
    let currentSession = null;

    function loginUrl(nextKey){
        const next = location.pathname + (nextKey && nextKey !== 'home' ? '#' + nextKey : '');
        return 'account/login.html?next=' + encodeURIComponent(next);
    }

    function updateAccountUI(){
        const sideName = document.querySelector('.side-user .u-name');
        const sideSub = document.querySelector('.side-user .u-sub');
        const sideAvatar = document.querySelector('.side-avatar');
        const topAvatar = document.querySelector('.avatar-btn');
        const sideProBtn = document.getElementById('sideProBtn');
        if (!sideName) return;

        if (currentSession){
            const email = currentSession.user.email || '';
            const initial = (email.trim()[0] || 'U').toUpperCase();
            sideName.textContent = email.split('@')[0];
            sideSub.textContent = 'Nhấn để xem hồ sơ';
            const meta = currentSession.user.user_metadata || {};
            const premiumUntil = meta.premium_until ? new Date(meta.premium_until) : null;
            const isPremiumActive = meta.plan === 'premium' && (!premiumUntil || premiumUntil > new Date());
            [sideAvatar, topAvatar].forEach(el=>{
                if (!el) return;
                el.classList.remove('is-guest');
                el.classList.toggle('is-pro', isPremiumActive);
                const c = el.querySelector('.avt-content');
                if (c) c.textContent = initial;
            });
            if (sideProBtn){
                sideProBtn.style.display = 'flex';
            }
            loadUserNotifications();
        } else {
            sideName.textContent = 'Khách';
            sideSub.textContent = 'Nhấn để đăng nhập';
            [sideAvatar, topAvatar].forEach(el=>{
                if (!el) return;
                el.classList.add('is-guest');
                el.classList.remove('is-pro');
                const c = el.querySelector('.avt-content');
                if (c) c.innerHTML = '<i class="fa-solid fa-user"></i>';
            });
            if (sideProBtn) sideProBtn.style.display = 'flex';
            const bellEl = document.getElementById('notifyBell');
            if (bellEl) bellEl.classList.add('hidden');
        }
    }

    // ---------------- Chuông thông báo riêng (bảng user_notifications) ----------------
    // Khác với "Thông báo nổi" (popup cho mọi người), đây là thông báo admin gửi riêng
    // cho đúng tài khoản đang đăng nhập — nhờ RLS chỉ trả về đúng thông báo của họ.
    let userNotifications = [];
    const notifyBellEl = document.getElementById('notifyBell');
    const notifyDotEl = document.getElementById('notifyDot');
    const notifyDropdownEl = document.getElementById('notifyDropdown');
    const notifyDropdownListEl = document.getElementById('notifyDropdownList');

    async function loadUserNotifications(){
        if (!currentSession || !notifyBellEl) return;
        notifyBellEl.classList.remove('hidden');
        const { data, error } = await sb.from('user_notifications')
            .select('*').eq('user_id', currentSession.user.id)
            .order('created_at', { ascending:false }).limit(30);
        if (error) return;
        userNotifications = data || [];
        renderNotifyDropdown();
    }
    function renderNotifyDropdown(){
        const unread = userNotifications.filter(n => !n.is_read).length;
        if (notifyDotEl){
            notifyDotEl.classList.toggle('hidden', unread === 0);
            notifyDotEl.textContent = unread > 9 ? '9+' : String(unread);
        }
        if (!notifyDropdownListEl) return;
        if (!userNotifications.length){
            notifyDropdownListEl.innerHTML = `<div class="notify-dropdown-empty">Chưa có thông báo nào.</div>`;
            return;
        }
        notifyDropdownListEl.innerHTML = userNotifications.map(n => `
            <div class="notify-item ${n.is_read ? '' : 'unread'}">
                <div class="notify-item-title">${(n.title || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</div>
                <div class="notify-item-msg">${(n.message || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</div>
                <div class="notify-item-time">${new Date(n.created_at).toLocaleString('vi-VN')}</div>
            </div>`).join('');
    }
    async function toggleNotifyDropdown(){
        if (!notifyDropdownEl) return;
        const wasHidden = notifyDropdownEl.classList.contains('hidden');
        notifyDropdownEl.classList.toggle('hidden');
        if (wasHidden){
            const unreadIds = userNotifications.filter(n => !n.is_read).map(n => n.id);
            if (unreadIds.length){
                // Đánh dấu đã đọc ngay khi mở chuông (giống Facebook/Gmail).
                userNotifications.forEach(n => { if (!n.is_read){ n.is_read = true; } });
                renderNotifyDropdown();
                await sb.from('user_notifications').update({ is_read:true, read_at: new Date().toISOString() }).in('id', unreadIds);
            }
        }
    }
    if (notifyBellEl){
        notifyBellEl.addEventListener('click', (e) => { e.stopPropagation(); toggleNotifyDropdown(); });
        document.addEventListener('click', () => { if (notifyDropdownEl) notifyDropdownEl.classList.add('hidden'); });
    }

    function handleAccountClick(){
        if (currentSession){
            openAccountModal();
        } else {
            location.href = loginUrl(currentTabKey);
        }
    }

    // ---------------- Bảng thông tin tài khoản (thông tin / lịch sử / đăng xuất) ----------------
    const accOverlay = document.getElementById('accOverlay');
    const accClose = document.getElementById('accClose');
    const accLogoutBtn = document.getElementById('accLogoutBtn');
    let accHistoryLoaded = false;

    async function openAccountModal(){
        if (!currentSession || !accOverlay) return;
        try{
            const { data, error } = await sb.auth.refreshSession();
            if (!error && data && data.session) currentSession = data.session;
        }catch(e){ /* mạng lỗi thì cứ dùng dữ liệu cũ đang có */ }
        const user = currentSession.user;
        const email = user.email || '';
        const initial = (email.trim()[0] || 'U').toUpperCase();
        const displayName = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || email.split('@')[0];

        document.getElementById('accAvatarInitial').textContent = initial;
        document.getElementById('accName').textContent = displayName;
        document.getElementById('accSub').textContent = email;
        document.getElementById('accInfoEmail').textContent = email || '—';
        document.getElementById('accInfoName').textContent = displayName || '—';

        // ----- Gói sử dụng: đọc từ user_metadata.plan (giá trị 'premium' | để trống/khác = miễn phí) -----
        // premium_until (nếu có) là hạn dùng Premium, dạng ISO date -> hết hạn thì tự về Miễn phí.
        const meta = user.user_metadata || {};
        const premiumUntil = meta.premium_until ? new Date(meta.premium_until) : null;
        const isPremiumActive = meta.plan === 'premium' && (!premiumUntil || premiumUntil > new Date());
        document.getElementById('accAvatar').classList.toggle('is-pro', isPremiumActive);
        const planBadge = document.getElementById('accPlanBadge');
        if (planBadge){
            if (isPremiumActive){
                planBadge.textContent = premiumUntil
                    ? `Premium — hết hạn ${premiumUntil.toLocaleDateString('vi-VN')}`
                    : 'Premium — Đang hoạt động';
                planBadge.className = 'acc-plan-badge premium';
            } else {
                planBadge.textContent = 'Miễn phí';
                planBadge.className = 'acc-plan-badge';
            }
        }
        // ----- Nút "Nâng cấp Pro": chỉ hiện khi tài khoản chưa dùng Premium -----
        const upgradeBtn = document.getElementById('accUpgradeBtn');
        if (upgradeBtn) upgradeBtn.style.display = isPremiumActive ? 'none' : 'flex';
        // ----- Số dư: số dư tiền (VNĐ) của tài khoản, lấy từ bảng profiles -----
        loadAndRenderBalance(user.id, 'accBalanceRow', 'accBalanceValue');
        // ----- Nút "Trang Quản trị": chỉ hiện khi profiles.role = 'admin' -----
        checkAndShowAdminButton(user.id);

        switchAccTab('info');
        accOverlay.classList.add('show');
        accHistoryLoaded = false;
    }

    function closeAccountModal(){
        if (accOverlay) accOverlay.classList.remove('show');
    }

    // ----- Kiểm tra quyền admin (profiles.role = 'admin') để hiện/ẩn nút "Trang Quản trị" -----
    async function checkAndShowAdminButton(userId){
        const btn = document.getElementById('accAdminBtn');
        if (!btn) return;
        btn.style.display = 'none';
        try{
            const { data: profile, error } = await sb.from('profiles').select('role').eq('id', userId).maybeSingle();
            if (!error && profile && profile.role === 'admin'){
                btn.style.display = 'flex';
            }
        }catch(e){ /* im lặng bỏ qua, nút vẫn ẩn */ }
    }

    // ----- Bấm nút "Trang Quản trị": chuyển thẳng sang trang admin (nút này chỉ hiện với tài khoản có quyền admin) -----
    function goToAdminPanel(){
        window.open('admin/index.html', '_blank');
    }

    function switchAccTab(tab){
        document.querySelectorAll('.acc-tab').forEach(b=> b.classList.toggle('active', b.dataset.acctab === tab));
        document.querySelectorAll('.acc-panel').forEach(p=> p.classList.toggle('active', p.id === 'accPanel-' + tab));
        if (tab === 'history' && !accHistoryLoaded){
            loadAccountHistory();
        }
    }

    async function loadAccountHistory(){
        accHistoryLoaded = true;
        const loadingEl = document.getElementById('accHistoryLoading');
        const listEl = document.getElementById('accHistoryList');
        const emptyEl = document.getElementById('accHistoryEmpty');
        loadingEl.style.display = 'block';
        listEl.style.display = 'none';
        emptyEl.style.display = 'none';

        // Gộp mọi nguồn hoạt động của tài khoản (đơn thanh toán + admin cộng/trừ tiền + admin nâng/huỷ Pro),
        // sắp xếp theo thời gian mới nhất. Dùng chung fetchMergedActivity để đồng bộ với các bảng lịch sử khác.
        const items = await fetchMergedActivity(null, 20);

        loadingEl.style.display = 'none';
        if (!items.length){
            emptyEl.style.display = 'flex';
            return;
        }
        listEl.style.display = 'block';
        listEl.innerHTML = items.map(activityItemHtml).join('');
    }

    // ---------------- Lịch sử hoạt động: admin cộng/trừ số dư ----------------
    async function fetchBalanceTransactions(userId, limit){
        try{
            const { data, error } = await sb
                .from('balance_transactions')
                .select('amount, balance_after, note, created_at')
                .eq('user_id', userId)
                .order('created_at', { ascending:false })
                .limit(limit);
            return (!error && Array.isArray(data)) ? data : [];
        }catch(e){ return []; }
    }

    // ---------------- Lịch sử hoạt động: admin nâng cấp / huỷ Pro thủ công ----------------
    async function fetchProGrants(userId, limit){
        try{
            const { data, error } = await sb
                .from('pro_grants')
                .select('action, plan_id, days, premium_until, note, created_at')
                .eq('user_id', userId)
                .order('created_at', { ascending:false })
                .limit(limit);
            return (!error && Array.isArray(data)) ? data : [];
        }catch(e){ return []; }
    }

    // ---------------- Gộp hiển thị 1 dòng trong tab "Lịch sử" (đơn hàng / admin cộng-trừ tiền / admin Pro) ----------------
    function activityItemHtml(item){
        if (item.type === 'order') return orderHistoryItemHtml(item.row);

        const r = item.row;
        const dateText = r.created_at ? new Date(r.created_at).toLocaleString('vi-VN') : '';

        if (item.type === 'balance'){
            const isCredit = Number(r.amount) >= 0;
            const amountText = (isCredit ? '+' : '') + Number(r.amount).toLocaleString('vi-VN') + 'đ';
            return `<div class="acc-history-item">
                <div class="acc-history-icon" style="background:${isCredit ? '#e7f7ee' : '#fdeeee'};color:${isCredit ? '#1a9e5c' : '#e5484d'};">
                    <i class="fa-solid ${isCredit ? 'fa-arrow-up' : 'fa-arrow-down'}"></i>
                </div>
                <div>
                    <div class="acc-history-title">${isCredit ? 'Admin cộng tiền' : 'Admin trừ tiền'} — ${amountText}</div>
                    <div class="acc-history-meta">${escapeHtmlHome(dateText)}${r.note ? (' · ' + escapeHtmlHome(r.note)) : ''}</div>
                </div>
            </div>`;
        }

        if (item.type === 'pro_revoke'){
            return `<div class="acc-history-item">
                <div class="acc-history-icon"><i class="fa-solid fa-crown"></i></div>
                <div>
                    <div class="acc-history-title">Admin huỷ gói Pro</div>
                    <div class="acc-history-meta">${escapeHtmlHome(dateText)}${r.note ? (' · ' + escapeHtmlHome(r.note)) : ''}</div>
                </div>
            </div>`;
        }

        // pro_grant
        const untilText = r.premium_until ? new Date(r.premium_until).toLocaleDateString('vi-VN') : '';
        return `<div class="acc-history-item">
            <div class="acc-history-icon"><i class="fa-solid fa-crown"></i></div>
            <div>
                <div class="acc-history-title">Admin nâng cấp Pro${untilText ? (' — hết hạn ' + untilText) : ''}</div>
                <div class="acc-history-meta">${escapeHtmlHome(dateText)}${r.note ? (' · ' + escapeHtmlHome(r.note)) : ''}</div>
            </div>
        </div>`;
    }

    document.querySelectorAll('.acc-tab').forEach(btn=>{
        btn.addEventListener('click', ()=> switchAccTab(btn.dataset.acctab));
    });
    if (accClose) accClose.addEventListener('click', closeAccountModal);
    if (accOverlay) accOverlay.addEventListener('click', e=>{ if (e.target === accOverlay) closeAccountModal(); });
    document.addEventListener('keydown', e=>{ if (e.key === 'Escape') closeAccountModal(); });
    if (accLogoutBtn) accLogoutBtn.addEventListener('click', async ()=>{
        accLogoutBtn.disabled = true;
        await sb.auth.signOut();
        currentSession = null;
        updateAccountUI();
        closeAccountModal();
        accLogoutBtn.disabled = false;
    });

    // ---------------- Đổi mật khẩu (trong tab Tài khoản, trang đầy đủ) ----------------
    const acctPwOld = document.getElementById('acctPwOld');
    const acctPwNew = document.getElementById('acctPwNew');
    const acctPwConfirm = document.getElementById('acctPwConfirm');
    const acctPwMsg = document.getElementById('acctPwMsg');
    const acctPwSave = document.getElementById('acctPwSave');

    if (acctPwSave) acctPwSave.addEventListener('click', async ()=>{
        const oldPw = acctPwOld.value;
        const pw1 = acctPwNew.value;
        const pw2 = acctPwConfirm.value;
        acctPwMsg.className = 'acctpw-msg';

        if (!oldPw){
            acctPwMsg.textContent = 'Vui lòng nhập mật khẩu hiện tại.';
            acctPwMsg.classList.add('err');
            return;
        }
        if (pw1.length < 6){
            acctPwMsg.textContent = 'Mật khẩu mới phải có ít nhất 6 ký tự.';
            acctPwMsg.classList.add('err');
            return;
        }
        if (pw1 !== pw2){
            acctPwMsg.textContent = 'Mật khẩu mới nhập lại không khớp.';
            acctPwMsg.classList.add('err');
            return;
        }
        if (!currentSession || !currentSession.user || !currentSession.user.email){
            acctPwMsg.textContent = 'Không xác định được tài khoản, vui lòng đăng nhập lại.';
            acctPwMsg.classList.add('err');
            return;
        }

        acctPwSave.disabled = true;
        acctPwSave.textContent = 'Đang kiểm tra mật khẩu hiện tại...';

        // Xác thực lại bằng mật khẩu hiện tại trước khi cho phép đổi, tránh trường hợp
        // ai đó chiếm được phiên đăng nhập (session) rồi tự đổi mật khẩu người dùng.
        const { error: verifyErr } = await sb.auth.signInWithPassword({ email: currentSession.user.email, password: oldPw });
        if (verifyErr){
            acctPwSave.disabled = false;
            acctPwSave.textContent = 'Lưu mật khẩu mới';
            acctPwMsg.textContent = 'Mật khẩu hiện tại không đúng.';
            acctPwMsg.classList.add('err');
            return;
        }

        acctPwSave.textContent = 'Đang lưu...';
        const { error } = await sb.auth.updateUser({ password: pw1 });
        acctPwSave.disabled = false;
        acctPwSave.textContent = 'Lưu mật khẩu mới';

        if (error){
            acctPwMsg.textContent = 'Lỗi: ' + error.message;
            acctPwMsg.classList.add('err');
        } else {
            acctPwMsg.textContent = '✔ Đổi mật khẩu thành công!';
            acctPwMsg.classList.add('ok');
            acctPwOld.value = ''; acctPwNew.value = ''; acctPwConfirm.value = '';
            // Gửi email cảnh báo bảo mật — không chặn UI nếu gửi lỗi.
            fetch(`${SUPABASE_URL}/functions/v1/send-password-changed-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentSession.access_token}` },
            }).catch(()=>{});
        }
    });

    // ---------------- Khối "Đổi mật khẩu" thu gọn — bấm vào tiêu đề mới hiện ra ----------------
    (function initAcctPwToggle(){
        const toggle = document.getElementById('acctPwToggle');
        const card = document.getElementById('acctPwCard');
        const hint = toggle ? toggle.querySelector('.acctpw-toggle-hint') : null;
        if (!toggle || !card) return;
        const setOpen = (open) => {
            toggle.classList.toggle('open', open);
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            card.style.display = open ? 'block' : 'none';
            if (hint) hint.textContent = open ? 'Bấm để đóng' : 'Bấm để mở';
        };
        toggle.addEventListener('click', () => setOpen(card.style.display === 'none'));
        toggle.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); setOpen(card.style.display === 'none'); }
        });
    })();

    // ---------------- Sub-tab "Tổng quan" / "Lịch sử giao dịch" trong trang Tài khoản ----------------
    function switchAcctSubtab(key){
        document.querySelectorAll('.acct-subtab').forEach(btn => btn.classList.toggle('active', btn.dataset.subtab === key));
        const overview = document.getElementById('acctSubOverview');
        const history = document.getElementById('acctSubHistory');
        if (overview) overview.classList.toggle('active', key === 'overview');
        if (overview) overview.style.display = key === 'overview' ? 'block' : 'none';
        if (history) history.classList.toggle('active', key === 'history');
        if (history) history.style.display = key === 'history' ? 'block' : 'none';
        if (key === 'history') loadAcctOrderHistory();
    }
    document.querySelectorAll('.acct-subtab').forEach(btn => {
        btn.addEventListener('click', () => switchAcctSubtab(btn.dataset.subtab));
    });

    let currentTabKey = 'home';


    // Icon/màu riêng cho các mã môn quen thuộc (chỉ để đẹp hơn, KHÔNG bắt buộc phải tồn tại).
    // Môn có mã không nằm trong danh sách này vẫn hiện bình thường, chỉ lấy icon/màu xoay vòng ở PALETTE bên dưới.
    const ICON_BY_ID = {
        PLDC:  { icon:'fa-scale-balanced', color:'#0068ff',      bg:'#e8f3ff' },
        TH:    { icon:'fa-brain',          color:'var(--brand2)',      bg:'#f1ecff' },
        KTCT:  { icon:'fa-coins',          color:'var(--green)', bg:'var(--green-bg)' },
        CNXH:  { icon:'fa-people-group',   color:'#e4572e',      bg:'#fdece3' },
        LSD:   { icon:'fa-landmark',       color:'#946b1f',      bg:'#fbf1de' },
        TTHCM: { icon:'fa-star',           color:'#c2185b',      bg:'#fde8f0' }
    };
    // Bảng màu xoay vòng cho mọi môn khác (bất kể thêm bao nhiêu môn mới ở admin)
    const PALETTE = [
        { icon:'fa-book-open',      color:'#0891b2', bg:'#e3f6fb' },
        { icon:'fa-graduation-cap', color:'#9333ea', bg:'#f4e9fd' },
        { icon:'fa-flask',          color:'#ca8a04', bg:'#fdf3d8' },
        { icon:'fa-bookmark',       color:'#059669', bg:'#e2f7ec' },
        { icon:'fa-lightbulb',      color:'#d97706', bg:'#fef3e0' },
        { icon:'fa-layer-group',    color:'#dc2626', bg:'#fde8e8' }
    ];
    function styleForSubject(subject, idx){
        return ICON_BY_ID[subject.id] || PALETTE[idx % PALETTE.length];
    }

    function escapeHtmlHome(s){
        return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    }
    function readyCardHtml(subject, style, num, pinned){
        return `
            <a class="card${pinned ? ' pinned' : ''}" href="mon-hoc.html?subject=${encodeURIComponent(subject.id)}">
                <div class="card-arrow"><i class="fa-solid fa-arrow-right"></i></div>
                <div class="card-top">
                    <div class="icon-chip" style="background:${style.bg}; color:${style.color}"><i class="fa-solid ${style.icon}"></i></div>
                    <div class="num-tag">${String(num).padStart(2,'0')}</div>
                </div>
                <div class="card-title">${escapeHtmlHome(subject.name)}</div>
                <div class="badge-row" data-count-for="${escapeHtmlHome(subject.id)}"><i class="fa-solid fa-layer-group"></i> Đang tải...</div>
                <div class="status-bar"><i style="width:100%; background:${style.color}"></i></div>
                <div class="status-text" style="color:${style.color}">Sẵn sàng ôn tập</div>
            </a>
        `;
    }
    function maintenanceCardHtml(subject, style, num, pinned){
        return `
            <a class="card locked${pinned ? ' pinned' : ''}" href="#" data-locked="true" data-subject="${subject.id.toLowerCase()}" data-subject-name="${escapeHtmlHome(subject.name)}" data-locked-msg="“${escapeHtmlHome(subject.name)}” đang bảo trì, quay lại sau nhé.">
                <div class="card-arrow"><i class="fa-solid fa-arrow-right"></i></div>
                <div class="card-top">
                    <div class="icon-chip" style="background:${style.bg}; color:${style.color}"><i class="fa-solid ${style.icon}"></i></div>
                    <div class="num-tag">${String(num).padStart(2,'0')}</div>
                </div>
                <div class="card-title">${escapeHtmlHome(subject.name)}</div>
                <div class="badge-row"><i class="fa-solid fa-screwdriver-wrench"></i> Đang bảo trì</div>
                <div class="status-bar"><i style="width:60%; background:var(--amber)"></i></div>
                <div class="status-text" style="color:var(--amber)">Tạm ngừng ôn tập</div>
            </a>
        `;
    }
    function pendingCardHtml(subject, style, num, pinned){
        return `
            <a class="card locked${pinned ? ' pinned' : ''}" href="#" data-locked="true" data-subject="${subject.id.toLowerCase()}" data-subject-name="${escapeHtmlHome(subject.name)}">
                <div class="card-arrow"><i class="fa-solid fa-arrow-right"></i></div>
                <div class="card-top">
                    <div class="icon-chip" style="background:${style.bg}; color:${style.color}"><i class="fa-solid ${style.icon}"></i></div>
                    <div class="num-tag">${String(num).padStart(2,'0')}</div>
                </div>
                <div class="card-title">${escapeHtmlHome(subject.name)}</div>
                <div class="badge-row"><i class="fa-regular fa-clock"></i> Đang biên soạn</div>
                <div class="status-bar"><i style="width:0%; background:var(--ink-mute)"></i></div>
                <div class="status-text" style="color:var(--ink-mute)">Sắp ra mắt</div>
            </a>
        `;
    }

    async function renderSubjectGrids(){
        const homeGrid = document.getElementById('homeSubjectGrid');
        const quizGrid = document.getElementById('quizSubjectGrid');
        const homeCountEl = document.getElementById('homeSubjectCount');
        const quizCountEl = document.getElementById('quizSubjectCount');

        const { data: dbSubjects, error } = await sb.from('subjects').select('*').order('order_no', { ascending: true, nullsFirst: false }).order('id');

        if (error){
            const errHtml = `<div class="empty-state"><div class="empty-icon" style="background:var(--amber-bg); color:var(--amber)"><i class="fa-solid fa-triangle-exclamation"></i></div><div class="empty-title">Không tải được danh sách môn học</div><div class="empty-sub">${escapeHtmlHome(error.message)}</div></div>`;
            homeGrid.innerHTML = errHtml;
            quizGrid.innerHTML = errHtml;
            return;
        }

        if (!dbSubjects || !dbSubjects.length){
            const emptyHtml = `<div class="empty-state"><div class="empty-icon" style="background:var(--brand-bg); color:var(--brand)"><i class="fa-solid fa-book"></i></div><div class="empty-title">Chưa có học phần nào</div><div class="empty-sub">Vào trang admin để thêm môn học đầu tiên.</div></div>`;
            homeGrid.innerHTML = emptyHtml;
            quizGrid.innerHTML = emptyHtml;
            if (homeCountEl) homeCountEl.textContent = '0 học phần';
            if (quizCountEl) quizCountEl.textContent = '0 học phần';
            return;
        }

        // Môn trạng thái "hidden" không hiện trên trang chủ/tab Trắc nghiệm
        let visibleSubjects = dbSubjects.filter(s => (s.status || 'ready') !== 'hidden');

        // Học phần được ghim (Admin > Ghim nổi bật, loại "Học phần") sẽ nổi lên đầu danh sách + có ribbon ★ GHIM
        const pins = await getHomeFeaturedPins();
        const pinnedSubjectIds = pins.filter(p => p.type === 'subject').map(p => String(p.ref_id));
        if (pinnedSubjectIds.length){
            const pinnedSet = new Set(pinnedSubjectIds);
            const pinnedOnes = pinnedSubjectIds
                .map(id => visibleSubjects.find(s => String(s.id) === id))
                .filter(Boolean);
            const restOnes = visibleSubjects.filter(s => !pinnedSet.has(String(s.id)));
            visibleSubjects = pinnedOnes.concat(restOnes);
        }

        if (!visibleSubjects.length){
            const emptyHtml = `<div class="empty-state"><div class="empty-icon" style="background:var(--brand-bg); color:var(--brand)"><i class="fa-solid fa-book"></i></div><div class="empty-title">Chưa có học phần nào</div><div class="empty-sub">Vào trang admin để thêm môn học đầu tiên.</div></div>`;
            homeGrid.innerHTML = emptyHtml;
            quizGrid.innerHTML = emptyHtml;
            if (homeCountEl) homeCountEl.textContent = '0 học phần';
            if (quizCountEl) quizCountEl.textContent = '0 học phần';
            return;
        }

        let html = '';
        const readySubjects = [];
        visibleSubjects.forEach((s, idx) => {
            const style = styleForSubject(s, idx);
            const status = s.status || 'ready';
            const isPinned = pinnedSubjectIds.includes(String(s.id));
            if (status === 'maintenance'){
                html += maintenanceCardHtml(s, style, idx + 1, isPinned);
            } else if (status === 'pending'){
                html += pendingCardHtml(s, style, idx + 1, isPinned);
            } else {
                html += readyCardHtml(s, style, idx + 1, isPinned);
                readySubjects.push(s);
            }
        });

        homeGrid.innerHTML = html;
        quizGrid.innerHTML = html;
        const totalLabel = visibleSubjects.length + ' học phần';
        if (homeCountEl) homeCountEl.textContent = totalLabel;
        if (quizCountEl) quizCountEl.textContent = totalLabel;

        bindLockedCards();
        loadQuestionCounts(readySubjects);
    }

    // Chương thuộc các nhóm này không tính vào tổng số câu hỏi hiển thị trên thẻ môn học
    // (khớp với EXAM_GROUP/CALC_GROUP dùng ở mon-hoc.html)
    const EXAM_GROUP = 'Đề thi thử';
    const CALC_GROUP = 'Bài tập tính toán';
    async function loadQuestionCounts(dbSubjects){
        await Promise.all(dbSubjects.map(async s => {
            // Lấy danh sách chương KHÔNG thuộc nhóm "Đề thi thử" / "Bài tập tính toán" của môn này
            const { data: chaps } = await sb.from('chapters').select('chapter, group_name').eq('subject_id', s.id);
            const nonExamCodes = (chaps || [])
                .filter(c => {
                    const g = c.group_name || 'Nội dung chính';
                    return g !== EXAM_GROUP && g !== CALC_GROUP;
                })
                .map(c => c.chapter);

            let count = 0;
            if (nonExamCodes.length){
                const res = await sb.from('questions').select('*', { count:'exact', head:true })
                    .eq('subject_id', s.id).in('chapter', nonExamCodes);
                count = res.count || 0;
            }

            document.querySelectorAll(`[data-count-for="${s.id}"]`).forEach(el=>{
                el.innerHTML = `<i class="fa-solid fa-layer-group"></i> ${count} câu hỏi`;
            });
        }));
    }

    renderSubjectGrids();

    // ---------------- KHỐI GIỚI THIỆU (hero) — đọc từ Supabase site_settings ----------------
    async function loadHeroSettings(){
        let revealed = false;
        const reveal = () => {
            if (revealed) return;
            revealed = true;
            const el = document.getElementById('heroText');
            if (el) el.style.opacity = '1';
        };
        // Phòng khi mạng chậm/treo lâu -> vẫn hiện chữ mặc định ra sau 2.5s, không để trắng mãi
        const safetyTimer = setTimeout(reveal, 2500);
        try{
            const { data, error } = await sb.from('site_settings').select('*').eq('key', 'home_hero').single();
            if (error || !data || !data.payload) return; // chưa cấu hình -> giữ nội dung tĩnh mặc định
            const hero = data.payload;
            if (hero.pageTitle) document.title = hero.pageTitle;
            if (hero.eyebrow) document.getElementById('heroEyebrow').textContent = hero.eyebrow;
            if (hero.title)   document.getElementById('heroTitle').textContent = hero.title;
        } finally {
            // Chỉ hiện chữ ra SAU KHI đã biết chắc nội dung cuối cùng (mặc định hoặc tuỳ chỉnh)
            // -> tránh hiện tượng nháy chữ mặc định rồi đổi sang chữ tuỳ chỉnh khi tải trang.
            clearTimeout(safetyTimer);
            reveal();
        }
    }
    loadHeroSettings();

    // ---------------- GIAO DIỆN (màu thương hiệu / gradient) — đọc từ Supabase site_settings 'site_theme' ----------------
    // Cho phép admin đổi bộ màu gradient của toàn site mà không cần sửa code, quản lý ở trang admin > Giao diện.
    async function loadThemeSettings(){
        try{
            const { data, error } = await sb.from('site_settings').select('*').eq('key', 'site_theme').single();
            if (error || !data || !data.payload) return; // chưa cấu hình -> giữ bộ màu mặc định trong CSS
            const t = data.payload;
            const root = document.documentElement.style;
            if (t.brand)   root.setProperty('--brand', t.brand);
            if (t.brand2)  root.setProperty('--brand2', t.brand2);
            if (t.accent2) root.setProperty('--accent2', t.accent2);
            if (t.green)   root.setProperty('--green', t.green);
            if (t.amber)   root.setProperty('--amber', t.amber);
            if (t.radius)     root.setProperty('--radius-lg', t.radius + 'px');
            if (t.cardRadius) root.setProperty('--radius-card', t.cardRadius + 'px');

            // ---- các tuỳ chỉnh chi tiết cho riêng trang chủ ----
            const heroCard = document.getElementById('heroCard');
            if (heroCard && t.heroStyle) heroCard.setAttribute('data-hero-style', t.heroStyle);
            document.body.setAttribute('data-hover-style', t.hoverStyle || 'lift');
            document.body.setAttribute('data-show-illustration', t.showIllustration === false ? '0' : '1');

            // ---- khối "đang ôn tập" (avatar nhóm / huy hiệu / ẩn) ----
            const sp = t.socialProof || {};
            const spType = sp.type || 'avatars';
            const avatarGroup = document.getElementById('avatarGroup');
            const badgeAlt = document.getElementById('heroBadgeAlt');
            if (avatarGroup) avatarGroup.classList.toggle('hidden', spType !== 'avatars');
            if (avatarGroup) avatarGroup.style.display = spType === 'avatars' ? '' : 'none';
            if (badgeAlt) badgeAlt.classList.toggle('hidden', spType !== 'badge');
            if (spType === 'avatars' && avatarGroup){
                avatarGroup.setAttribute('data-effect', sp.effect || 'none');
                if (sp.count) document.getElementById('avatarCount').textContent = sp.count;
                if (sp.suffix) document.getElementById('avatarSuffix').textContent = sp.suffix;
                const avts = document.querySelectorAll('#avatarStack .mini-avt');
                (sp.avatars || []).slice(0,4).forEach((a, i) => {
                    if (!avts[i]) return;
                    if (a.letter) avts[i].textContent = a.letter;
                    if (a.color)  avts[i].style.background = a.color;
                });
            } else if (spType === 'badge' && badgeAlt){
                badgeAlt.setAttribute('data-effect', sp.effect || 'none');
                if (sp.badgeIcon) document.getElementById('heroBadgeIcon').className = sp.badgeIcon;
                if (sp.badgeText) document.getElementById('heroBadgeText').textContent = sp.badgeText;
            }
        }catch(e){ /* mạng lỗi -> im lặng giữ mặc định, không chặn trang tải */ }
    }
    loadThemeSettings();

    // ---------------- CHỮ TRANG CHỦ (tiêu đề các khu vực) — đọc từ Supabase site_settings 'home_texts' ----------------
    // Lưu ý: fetchSiteSettingPayload được khai báo bằng "function" (hoisted) ở dưới trong file này,
    // nên gọi được ngay tại đây dù thứ tự đọc code nằm trước phần khai báo.
    async function loadHomeTexts(){
        const payload = await fetchSiteSettingPayload('home_texts', {});
        const map = {
            quickAccessTitle: payload.quickTitle,
            homeSubjectsTitle: payload.homeSubjectsTitle,
            featuredDocFreeTitle: payload.featuredDocFreeTitle,
            featuredDocPaidTitle: payload.featuredDocPaidTitle,
            featuredToolTitle: payload.featuredToolTitle,
            featuredProductTitle: payload.featuredProductTitle,
            quizSectionTitle: payload.quizTitle,
            docSectionTitle: payload.docTitle,
            toolSectionTitle: payload.toolTitle,
            productSectionTitle: payload.productTitle,
        };
        Object.keys(map).forEach(id => {
            const val = map[id];
            if (val){ const el = document.getElementById(id); if (el) el.textContent = val; }
        });
    }
    loadHomeTexts();

    // ---------------- CHÂN TRANG — đọc từ Supabase site_settings, đồng bộ mọi trang ----------------
    async function loadFooterSettings(){
        const el = document.getElementById('siteFooter');
        const { data, error } = await sb.from('site_settings').select('*').eq('key', 'site_footer').single();
        if (error || !data || !data.payload || !data.payload.text){
            if (el) el.textContent = ''; // chưa cấu hình ở admin -> để trống, không dùng chữ mặc định
            return;
        }
        if (el) el.textContent = data.payload.text;
    }
    loadFooterSettings();

    // ---------------- TÀI LIỆU / CÔNG CỤ / SẢN PHẨM — nội dung động, quản lý ở trang admin (site_settings) ----------------
    async function fetchSiteSettingPayload(key, fallback){
        try{
            const { data, error } = await sb.from('site_settings').select('*').eq('key', key).single();
            if (error || !data || !data.payload) return fallback;
            return data.payload;
        }catch(e){ return fallback; }
    }

    const DEFAULT_DOC_CONTENT = { free: [], paid: [] };
    const DEFAULT_TOOL_CONTENT = { items: [
        { id:'t1', icon:'fa-solid fa-shuffle',    color:'green',  title:'Đề thi ngẫu nhiên',  desc:'', status:'soon', link:'' },
        { id:'t2', icon:'fa-solid fa-clone',      color:'indigo', title:'Flashcard ôn nhanh', desc:'', status:'soon', link:'' },
        { id:'t3', icon:'fa-solid fa-chart-line', color:'amber',  title:'Thống kê kết quả',   desc:'', status:'soon', link:'' }
    ]};
    const DEFAULT_PRODUCT_CONTENT = { items: [] };
    const DEFAULT_PRO_CONTENT = { items: [] };

    // ---- Trạng thái mua tài liệu trả phí của người dùng hiện tại ----
    let purchasedDocIds = new Set();
    let DOC_PAID_ITEMS_MAP = {}; // id -> item (title, price, size...) để mở modal xác nhận mua

    async function loadPurchasedDocIds(){
        const next = new Set();
        try{
            const { data: { user } } = await sb.auth.getUser();
            if (user){
                const { data, error } = await sb.from('document_purchases').select('document_id').eq('user_id', user.id);
                if (!error && data) data.forEach(r => next.add(String(r.document_id)));
            }
        }catch(e){ /* chưa đăng nhập hoặc lỗi mạng -> coi như chưa mua gì */ }
        purchasedDocIds = next;
    }

    // ---- Trạng thái mua sản phẩm trả phí của người dùng hiện tại (giống hệt cơ chế tài liệu ở trên) ----
    let purchasedProductIds = new Set();

    async function loadPurchasedProductIds(){
        const next = new Set();
        try{
            const { data: { user } } = await sb.auth.getUser();
            if (user){
                const { data, error } = await sb.from('product_purchases').select('product_id').eq('user_id', user.id);
                if (!error && data) data.forEach(r => next.add(String(r.product_id)));
            }
        }catch(e){ /* chưa đăng nhập hoặc lỗi mạng -> coi như chưa mua gì */ }
        purchasedProductIds = next;
    }

    // ---- Kiểm tra giới hạn tải tài liệu miễn phí (tài khoản Free) trước khi mở link ----
    let freeDocCheckBusy = false;
    function handleFreeDocClick(evt, docId, linkEl){
        if (!currentSession){
            evt.preventDefault();
            location.href = loginUrl('doc');
            return false;
        }
        if (freeDocCheckBusy){ evt.preventDefault(); return false; }

        // Không thể "await" trong onclick đồng bộ và vẫn giữ hành vi mở tab mới của trình duyệt
        // (mở tab mới trong callback bất đồng bộ dễ bị chặn popup), nên chặn mặc định trước,
        // kiểm tra giới hạn, rồi tự mở tab nếu hợp lệ.
        evt.preventDefault();
        freeDocCheckBusy = true;
        const href = linkEl.getAttribute('href');

        // Lấy user mới nhất từ server (getUser()) thay vì currentSession.user đã cache trong máy,
        // để nếu vừa nâng cấp Pro thì được nhận diện ngay, không phải chờ token tự làm mới.
        sb.auth.getUser().then(({ data }) => SNG_USAGE.checkLimit(data.user || currentSession.user, 'doc_download')).then(result => {
            freeDocCheckBusy = false;
            if (!result.allowed){
                alert(`Bạn đã hết ${result.limit} lượt tải tài liệu miễn phí hôm nay.\nNâng cấp Pro để tải không giới hạn.`);
                return;
            }
            SNG_USAGE.logUsage(currentSession.user.id, 'doc_download', docId);
            window.open(href, '_blank', 'noopener');
        }).catch(() => {
            freeDocCheckBusy = false;
            window.open(href, '_blank', 'noopener'); // lỗi mạng -> không chặn nhầm người dùng
        });
        return false;
    }

    function docItemCardHtml(item, isPaid){
        const metaHtml = item.size ? `<div class="doc-meta"><i class="fa-solid fa-file-lines"></i> ${escapeHtmlHome(item.size)}</div>` : '';
        const descHtml = item.desc ? `<div class="doc-desc">${escapeHtmlHome(item.desc)}</div>` : '';
        const topHtml = item.image
            ? `<img class="doc-thumb" src="${escapeHtmlHome(item.image)}" alt="">`
            : '';
        const iconHtml = `<div class="doc-icon"><i class="fa-solid ${isPaid ? 'fa-lock' : 'fa-file-lines'}"></i></div>`;
        const topClass = item.image ? 'doc-card-top' : 'doc-card-top no-thumb';

        // Tài liệu miễn phí: bấm vào thẻ -> mở trang chi tiết riêng (có URL riêng, back được),
        // việc tải xuống thật sự (kiểm tra giới hạn lượt/ngày) diễn ra trên trang đó.
        if (!isPaid){
            const idAttr = escapeHtmlHome(String(item.id || ''));
            const disabled = !item.link;
            return `
                <a class="doc-card is-free${disabled ? ' is-disabled' : ''}" data-cat="free" href="${disabled ? '#' : `chi-tiet.html?type=doc&id=${idAttr}`}" ${disabled ? 'onclick="return false;"' : ''}>
                    <div class="${topClass}">
                        ${topHtml || iconHtml}
                        <span class="doc-tag free"><i class="fa-solid fa-unlock"></i> Miễn phí</span>
                    </div>
                    <div class="doc-title">${escapeHtmlHome(item.title || '')}</div>
                    ${metaHtml}
                    ${descHtml}
                    <div class="doc-cta"><i class="fa-solid ${disabled ? 'fa-hourglass-half' : 'fa-arrow-right'}"></i> ${disabled ? 'Sắp ra mắt' : 'Xem chi tiết'}</div>
                </a>`;
        }

        // Tài liệu trả phí: bấm vào thẻ -> mở trang chi tiết riêng để mua/tải, chỉ lộ link tải sau khi đã thanh toán thành công.
        const docId = String(item.id);
        DOC_PAID_ITEMS_MAP[docId] = item;
        const owned = purchasedDocIds.has(docId);
        const priceLabel = Number(item.price) > 0 ? Number(item.price).toLocaleString('vi-VN') + 'đ' : '';
        const idAttr = escapeHtmlHome(docId);

        if (owned){
            return `
                <a class="doc-card is-owned" data-cat="paid" href="chi-tiet.html?type=doc&id=${idAttr}">
                    <div class="${topClass}">
                        ${topHtml || iconHtml}
                        <span class="doc-tag owned"><i class="fa-solid fa-circle-check"></i> Đã mua</span>
                    </div>
                    <div class="doc-title">${escapeHtmlHome(item.title || '')}</div>
                    ${metaHtml}
                    ${descHtml}
                    <div class="doc-cta"><i class="fa-solid fa-download"></i> Tải xuống</div>
                </a>`;
        }

        return `
            <a class="doc-card is-paid" data-cat="paid" href="chi-tiet.html?type=doc&id=${idAttr}">
                <div class="${topClass}">
                    ${topHtml || iconHtml}
                    <span class="doc-tag paid"><i class="fa-solid fa-lock"></i> Trả phí</span>
                </div>
                <div class="doc-title">${escapeHtmlHome(item.title || '')}</div>
                ${metaHtml}
                ${descHtml}
                <div class="doc-cta"><i class="fa-solid fa-cart-shopping"></i> ${priceLabel ? 'Mua ngay · ' + priceLabel : 'Mua ngay'}</div>
            </a>`;
    }

    async function renderDocContent(){
        const payload = await fetchSiteSettingPayload('doc_content', DEFAULT_DOC_CONTENT);
        // Tài liệu bị ẩn (item.hidden) không hiện trong danh sách công khai.
        // Ngoại lệ: tài liệu trả phí khách đã mua rồi vẫn hiện để họ tải lại được, dù admin đã ẩn khỏi trang chủ.
        const free = (Array.isArray(payload.free) ? payload.free : []).filter(it => !it.hidden);
        const paid = (Array.isArray(payload.paid) ? payload.paid : []).filter(it => !it.hidden || purchasedDocIds.has(String(it.id)));
        DOC_PAID_ITEMS_MAP = {};

        const allGrid = document.getElementById('docAllGrid');
        const allCount = document.getElementById('docAllCount');
        const total = free.length + paid.length;
        if (allCount) allCount.textContent = total + ' tài liệu';

        const cardsHtml = free.map(it => docItemCardHtml(it, false)).join('')
            + paid.map(it => docItemCardHtml(it, true)).join('');

        allGrid.innerHTML = total
            ? `<div class="doc-grid">${cardsHtml}</div>`
            : `<div class="empty-state small"><div class="empty-icon" style="background:var(--green-bg); color:var(--green)"><i class="fa-solid fa-folder-open"></i></div><div class="empty-title">Chưa có tài liệu nào</div></div>`;

        applyDocFilter();
        loadDocOrderHistory();
        renderFeaturedExtras();
    }

    function applyDocFilter(){
        const activePill = document.querySelector('.filter-pill.active');
        const f = activePill ? activePill.dataset.filter : 'all';
        document.querySelectorAll('#docAllGrid .doc-card').forEach(card=>{
            card.style.display = (f === 'all' || card.dataset.cat === f) ? '' : 'none';
        });
    }

    // ---- Modal xác nhận mua tài liệu ----
    let docConfirmSelectedId = null;

    function openDocPurchase(id){
        if (!currentSession){ location.href = loginUrl('doc'); return; }
        const item = DOC_PAID_ITEMS_MAP[id];
        if (!item) return;
        docConfirmSelectedId = id;
        document.getElementById('docConfirmName').textContent = item.title || '';
        document.getElementById('docConfirmMeta').textContent = item.size || 'Tài liệu trả phí';
        document.getElementById('docConfirmPrice').textContent = Number(item.price || 0).toLocaleString('vi-VN') + 'đ';
        document.getElementById('docConfirmOverlay').classList.remove('hidden');
        apDungCauHinhSepayLenNut('docConfirmOkBtn', '<i class="fa-solid fa-lock"></i> Xác nhận thanh toán');
        capNhatOptionSoDu('docConfirmBalancePayWrap', 'docConfirmBalanceText', Number(item.price || 0));
    }

    function closeDocConfirm(){
        document.getElementById('docConfirmOverlay').classList.add('hidden');
        const okBtn = document.getElementById('docConfirmOkBtn');
        if (okBtn){ okBtn.disabled = false; okBtn.innerHTML = '<i class="fa-solid fa-lock"></i> Xác nhận thanh toán'; }
        resetNutSoDu('docConfirmBalanceBtn', 'docConfirmBalanceText');
    }

    async function confirmDocPurchase(useBalance){
        if (!docConfirmSelectedId) return;
        if (useBalance){
            await xuLyThanhToanBangSoDu({
                orderPayload: { order_type: 'document', document_id: docConfirmSelectedId },
                balanceBtnId: 'docConfirmBalanceBtn',
                onSuccess: () => { closeDocConfirm(); renderDocContent(); }
            });
            return;
        }
        const okBtn = document.getElementById('docConfirmOkBtn');
        if (okBtn){ okBtn.disabled = true; okBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang chuyển tới cổng thanh toán...'; }
        thanhToanTaiLieu(docConfirmSelectedId); // hàm có sẵn trong frontend/sepay-checkout.js
    }

    // ---------------- Cấu hình bật/tắt cổng thanh toán (admin quản lý ở site_settings key 'payment_settings') ----------------
    // sepay_enabled: bật/tắt cổng SePay (chuyển khoản/thẻ) — áp dụng cho mọi nút "Xác nhận thanh toán".
    // balance_payment_enabled: bật/tắt tuỳ chọn "Thanh toán bằng số dư ví".
    // wallet_topup_enabled: bật/tắt việc nạp thêm tiền vào ví (nạp tiền vẫn luôn cần qua SePay).
    let paymentSettings = { sepay_enabled: true, sepay_disabled_message: '', balance_payment_enabled: true, wallet_topup_enabled: true };
    async function loadPaymentSettings(){
        try{
            const { data } = await sb.from('site_settings').select('payload').eq('key', 'payment_settings').maybeSingle();
            if (data && data.payload) paymentSettings = Object.assign({}, paymentSettings, data.payload);
        }catch(e){ /* mạng lỗi thì cứ dùng mặc định (mọi thứ đang bật) */ }
        apDungHienThiNutNapTien();
    }
    // Ẩn/hiện nút "Nạp tiền" (cả ở trang Tài khoản lẫn trong modal tài khoản) theo wallet_topup_enabled.
    // Độc lập với sepay_enabled — tắt/bật mục này KHÔNG ảnh hưởng tới cổng SePay/chuyển khoản của các giao dịch khác.
    function apDungHienThiNutNapTien(){
        const show = paymentSettings.wallet_topup_enabled !== false;
        ['acctPageTopupBtn', 'accTopupBtn'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.style.display = show ? '' : 'none';
        });
    }
    // Khoá/mở nút "Xác nhận thanh toán" (cổng SePay) của 1 modal theo cấu hình admin.
    function apDungCauHinhSepayLenNut(okBtnId, defaultHtml){
        const btn = document.getElementById(okBtnId);
        if (!btn) return;
        if (!paymentSettings.sepay_enabled){
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> ' + (paymentSettings.sepay_disabled_message || 'Cổng thanh toán đang tạm ngưng, vui lòng quay lại sau');
            btn.style.opacity = '.6'; btn.style.cursor = 'not-allowed';
        } else {
            btn.disabled = false;
            btn.innerHTML = defaultHtml;
            btn.style.opacity = ''; btn.style.cursor = '';
        }
    }

    // ---------------- Thanh toán bằng số dư ví: hạ tầng dùng chung cho tài liệu / gói Pro / sản phẩm ----------------
    // Hiện/ẩn nút "Thanh toán bằng số dư ví", tô mờ + khoá nút nếu số dư không đủ.
    async function capNhatOptionSoDu(wrapId, textId, price){
        const wrap = document.getElementById(wrapId);
        const textEl = document.getElementById(textId);
        if (!wrap || !textEl) return;
        // Admin đã tắt "Thanh toán bằng số dư ví" -> ẩn hẳn, không cần kiểm tra số dư.
        if (!paymentSettings.balance_payment_enabled){ wrap.style.display = 'none'; return; }
        const balance = await laySoDuViHienTai();
        textEl.textContent = 'còn ' + balance.toLocaleString('vi-VN') + 'đ';
        const enough = balance >= price;
        wrap.style.display = (wrap.tagName === 'BUTTON') ? 'inline-flex' : 'block';
        const btn = (wrap.tagName === 'BUTTON') ? wrap : wrap.querySelector('button');
        if (btn){
            btn.disabled = !enough;
            btn.style.opacity = enough ? '1' : '0.55';
            btn.style.cursor = enough ? 'pointer' : 'not-allowed';
            btn.title = enough ? '' : 'Số dư không đủ, vui lòng nạp thêm tiền vào ví';
        }
    }

    function resetNutSoDu(btnId){
        const btn = document.getElementById(btnId);
        if (!btn) return;
        btn.disabled = false;
        const icon = btn.querySelector('i');
        if (icon) icon.className = 'fa-solid fa-wallet';
    }

    // Gọi thanh toán bằng số dư, tự khoá nút trong lúc xử lý, báo lỗi/refresh nếu cần.
    async function xuLyThanhToanBangSoDu({ orderPayload, balanceBtnId, onSuccess }){
        const btn = document.getElementById(balanceBtnId);
        const originalHtml = btn ? btn.innerHTML : '';
        if (btn){ btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang xử lý...'; }

        const result = await thanhToanBangSoDu(orderPayload); // hàm có sẵn trong frontend/sepay-checkout.js
        if (!result.ok){
            alert(result.error || 'Có lỗi xảy ra khi thanh toán bằng số dư.');
            if (btn){ btn.disabled = false; btn.innerHTML = originalHtml; }
            return;
        }
        if (currentSession) loadAndRenderBalance(currentSession.user.id, 'accBalanceRow', 'accBalanceValue');
        if (typeof onSuccess === 'function') onSuccess();
    }

    // ---------------- Modal "Nạp tiền vào ví" ----------------
    async function openTopupModal(){
        if (!currentSession){ location.href = loginUrl('topup'); return; }
        const input = document.getElementById('napTienAmountInput');
        if (input) input.value = '';
        document.querySelectorAll('.naptien-amt-btn').forEach(btn => btn.classList.remove('active'));
        const errEl = document.getElementById('napTienError');
        if (errEl) errEl.style.display = 'none';
        const balance = await laySoDuViHienTai();
        document.getElementById('napTienCurrentBalance').textContent = balance.toLocaleString('vi-VN') + 'đ';
        document.getElementById('napTienOverlay').classList.remove('hidden');
        // Nạp tiền: chỉ phụ thuộc wallet_topup_enabled — độc lập với sepay_enabled (cổng SePay/CK cho
        // các giao dịch khác như mua khoá học, gói Pro... vẫn hoạt động bình thường dù mục này bật/tắt).
        const topupAllowed = paymentSettings.wallet_topup_enabled !== false;
        const okBtn = document.getElementById('napTienOkBtn');
        if (okBtn){
            okBtn.disabled = !topupAllowed;
            okBtn.innerHTML = topupAllowed
                ? '<i class="fa-solid fa-arrow-right"></i> Tiếp tục thanh toán'
                : '<i class="fa-solid fa-circle-exclamation"></i> ' + (paymentSettings.sepay_disabled_message || 'Nạp tiền đang tạm ngưng, vui lòng quay lại sau');
            okBtn.style.opacity = topupAllowed ? '' : '.6';
            okBtn.style.cursor = topupAllowed ? '' : 'not-allowed';
        }
        document.querySelectorAll('#napTienQuickAmounts .naptien-amt-btn').forEach(btn => btn.disabled = !topupAllowed);
        if (input) input.disabled = !topupAllowed;
    }

    function closeTopupModal(){
        document.getElementById('napTienOverlay').classList.add('hidden');
        const okBtn = document.getElementById('napTienOkBtn');
        if (okBtn){ okBtn.disabled = false; okBtn.innerHTML = '<i class="fa-solid fa-arrow-right"></i> Tiếp tục thanh toán'; }
    }

    function chonNhanhSoTienNap(amount){
        const input = document.getElementById('napTienAmountInput');
        if (input) input.value = amount;
        document.querySelectorAll('.naptien-amt-btn').forEach(btn => {
            btn.classList.toggle('active', Number(btn.dataset.amt) === amount);
        });
    }
    document.addEventListener('DOMContentLoaded', () => {
        const napInput = document.getElementById('napTienAmountInput');
        if (napInput){
            napInput.addEventListener('input', () => {
                const val = Number(napInput.value);
                document.querySelectorAll('.naptien-amt-btn').forEach(btn => {
                    btn.classList.toggle('active', Number(btn.dataset.amt) === val);
                });
            });
        }
    });

    function submitNapTien(){
        const input = document.getElementById('napTienAmountInput');
        const errEl = document.getElementById('napTienError');
        const amount = Number(input ? input.value : 0);

        if (!amount || amount < 10000 || amount > 20000000){
            if (errEl){
                errEl.textContent = 'Số tiền nạp phải từ 10.000đ đến 20.000.000đ.';
                errEl.style.display = 'block';
            }
            return;
        }
        if (errEl) errEl.style.display = 'none';

        const okBtn = document.getElementById('napTienOkBtn');
        if (okBtn){ okBtn.disabled = true; okBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang chuyển tới cổng thanh toán...'; }
        napTienVaoVi(amount); // hàm có sẵn trong frontend/sepay-checkout.js — chuyển sang cổng SePay
    }

    function toolItemCardHtml(item){
        const style = QL_COLOR_MAP[item.color] || QL_COLOR_MAP.indigo;
        const isReady = item.status === 'ready';
        const cls = isReady ? 'card' : 'card locked';
        const lockedAttrs = isReady ? '' : `data-locked="true" data-subject="tool-${escapeHtmlHome(item.id)}" data-subject-name="${escapeHtmlHome(item.title || '')}"`;
        const href = isReady && item.link ? item.link : '#';
        const badge = isReady
            ? (item.desc ? `<div class="badge-row"><i class="fa-solid fa-circle-check"></i> ${escapeHtmlHome(item.desc)}</div>` : '')
            : `<div class="badge-row"><i class="fa-regular fa-clock"></i> Sắp ra mắt</div>`;
        return `
            <a class="${cls}" href="${escapeHtmlHome(href)}" ${lockedAttrs} ${isReady && item.link ? 'target="_blank" rel="noopener"' : ''}>
                ${isReady ? '<div class="card-arrow"><i class="fa-solid fa-arrow-right"></i></div>' : ''}
                <div class="card-top"><div class="icon-chip" style="background:${style.bg}; color:${style.fg}"><i class="${escapeHtmlHome(item.icon || 'fa-solid fa-toolbox')}"></i></div></div>
                <div class="card-title">${escapeHtmlHome(item.title || '')}</div>
                ${badge}
            </a>`;
    }

    async function renderToolContent(){
        const payload = await fetchSiteSettingPayload('tool_content', DEFAULT_TOOL_CONTENT);
        const items = Array.isArray(payload.items) ? payload.items : [];
        const grid = document.getElementById('toolGrid');
        if (!items.length){
            grid.innerHTML = `<div class="empty-state"><div class="empty-icon" style="background:var(--brand-bg); color:var(--brand)"><i class="fa-solid fa-toolbox"></i></div><div class="empty-title">Chưa có công cụ nào</div></div>`;
        } else {
            grid.innerHTML = items.map(toolItemCardHtml).join('');
            bindLockedCards();
        }
    }

    // Cache toàn bộ item sản phẩm (theo id) để modal chi tiết tra cứu khi bấm vào thẻ.
    const PRODUCT_DETAIL_MAP = {};

    function productItemCardHtml(item){
        const style = QL_COLOR_MAP[item.color] || QL_COLOR_MAP.indigo;
        PRODUCT_DETAIL_MAP[String(item.id)] = item;
        const mediaHtml = item.image
            ? `<img class="prod-thumb" src="${escapeHtmlHome(item.image)}" alt="">`
            : `<div class="prod-icon" style="background:${style.bg}; color:${style.fg}"><i class="${escapeHtmlHome(item.icon || 'fa-solid fa-bag-shopping')}"></i></div>`;

        const productId = String(item.id);
        const owned = purchasedProductIds.has(productId);
        const variants = Array.isArray(item.variants) ? item.variants.filter(v => v && v.id) : [];
        const hasVariants = variants.length > 0;
        const variantPrices = hasVariants ? variants.map(v => Number(v.price) || 0).filter(p => p > 0) : [];
        const price = hasVariants ? (variantPrices.length ? Math.min(...variantPrices) : 0) : (Number(item.price) || 0);
        const priceLabel = price > 0 ? price.toLocaleString('vi-VN') + 'đ' : '';

        let tagHtml = '';
        let ctaHtml = '<span>Xem chi tiết</span><i class="fa-solid fa-arrow-right"></i>';
        if (owned){
            tagHtml = '<span class="doc-tag owned"><i class="fa-solid fa-circle-check"></i> Đã sở hữu</span>';
            ctaHtml = hasVariants ? '<span>Xem chi tiết</span><i class="fa-solid fa-arrow-right"></i>' : '<span>Mở / Tải xuống</span><i class="fa-solid fa-download"></i>';
        } else if (price > 0){
            tagHtml = '<span class="doc-tag paid"><i class="fa-solid fa-lock"></i> Trả phí</span>';
            ctaHtml = `<span>Mua ngay · ${priceLabel}</span><i class="fa-solid fa-cart-shopping"></i>`;
        }

        return `
            <a class="prod-card" href="chi-tiet.html?type=product&id=${encodeURIComponent(productId)}">
                <div class="prod-thumb-wrap">${mediaHtml}${tagHtml}</div>
                <div class="prod-body">
                    <div class="prod-title">${escapeHtmlHome(item.title || '')}</div>
                    ${item.desc ? `<div class="prod-desc">${escapeHtmlHome(item.desc)}</div>` : ''}
                    <div class="prod-cta">${ctaHtml}</div>
                </div>
            </a>`;
    }

    function openProductDetail(id){
        const item = PRODUCT_DETAIL_MAP[String(id)];
        if (!item) return;
        const style = QL_COLOR_MAP[item.color] || QL_COLOR_MAP.indigo;
        const mediaEl = document.getElementById('prodDetailMedia');
        mediaEl.innerHTML = item.image
            ? `<img src="${escapeHtmlHome(item.image)}" alt="">`
            : `<div class="prod-detail-icon" style="background:${style.bg}; color:${style.fg}"><i class="${escapeHtmlHome(item.icon || 'fa-solid fa-bag-shopping')}"></i></div>`;
        document.getElementById('prodDetailTitle').textContent = item.title || '';

        const productId = String(item.id);
        const owned = purchasedProductIds.has(productId);
        const price = Number(item.price) || 0;
        const priceLabel = price > 0 ? price.toLocaleString('vi-VN') + 'đ' : '';

        const priceEl = document.getElementById('prodDetailPrice');
        priceEl.textContent = owned ? (priceLabel ? '✅ Đã sở hữu · ' + priceLabel : '✅ Đã sở hữu') : priceLabel;
        priceEl.style.display = (priceLabel || owned) ? '' : 'none';

        const descEl = document.getElementById('prodDetailDesc');
        descEl.textContent = item.desc || '';
        descEl.style.display = item.desc ? '' : 'none';

        const cta = document.getElementById('prodDetailCta');
        cta.onclick = null;
        cta.removeAttribute('target');

        if (owned){
            // Đã mua rồi -> mở/tải thẳng sản phẩm, không cần thanh toán lại.
            if (item.link){
                cta.href = item.link; cta.setAttribute('target', '_blank'); cta.rel = 'noopener';
                cta.classList.remove('disabled');
                cta.style.background = 'var(--brand-bg)'; cta.style.color = 'var(--brand)';
                cta.innerHTML = '<span>Mở / Tải sản phẩm</span><i class="fa-solid fa-arrow-up-right-from-square"></i>';
            } else {
                cta.href = '#'; cta.classList.add('disabled');
                cta.style.background = 'var(--brand-bg)'; cta.style.color = 'var(--brand)';
                cta.innerHTML = '<span><i class="fa-solid fa-circle-check"></i> Đã sở hữu</span>';
            }
        } else if (price > 0){
            // Sản phẩm trả phí, chưa mua -> bấm để chuyển sang cổng thanh toán SePay.
            cta.href = '#';
            cta.classList.remove('disabled');
            cta.style.background = 'var(--amber-bg)'; cta.style.color = 'var(--amber)';
            cta.innerHTML = `<span>Mua ngay · ${priceLabel}</span><i class="fa-solid fa-cart-shopping"></i>`;
            cta.onclick = (evt) => { evt.preventDefault(); purchaseProductFromModal(productId); };
        } else if (item.link){
            // Sản phẩm không thu phí qua site (giới thiệu / link ngoài) -> giữ hành vi cũ.
            cta.href = item.link; cta.setAttribute('target', '_blank'); cta.rel = 'noopener';
            cta.classList.remove('disabled');
            cta.style.background = style.bg; cta.style.color = style.fg;
            cta.innerHTML = '<span>Xem / mua sản phẩm</span><i class="fa-solid fa-arrow-up-right-from-square"></i>';
        } else {
            cta.href = '#'; cta.classList.add('disabled');
            cta.style.background = ''; cta.style.color = '';
            cta.innerHTML = '<span>Sắp ra mắt</span>';
        }

        // Nút "Thanh toán bằng số dư ví" — chỉ hiện khi sản phẩm trả phí và chưa mua.
        prodDetailSelectedId = productId;
        const balanceBtn = document.getElementById('prodDetailBalanceBtn');
        if (balanceBtn){
            if (!owned && price > 0 && currentSession){
                capNhatOptionSoDu('prodDetailBalanceBtn', 'prodDetailBalanceText', price);
            } else {
                balanceBtn.style.display = 'none';
            }
        }

        document.getElementById('prodDetailOverlay').classList.remove('hidden');
    }

    let prodDetailSelectedId = null;

    // ---- Mua sản phẩm trả phí: chuyển sang cổng thanh toán SePay ----
    function purchaseProductFromModal(id){
        if (!currentSession){ location.href = loginUrl('product'); return; }
        const cta = document.getElementById('prodDetailCta');
        if (cta){
            cta.classList.add('disabled');
            cta.innerHTML = '<span><i class="fa-solid fa-spinner fa-spin"></i> Đang chuyển tới cổng thanh toán...</span>';
        }
        thanhToanSanPham(id); // hàm có sẵn trong frontend/sepay-checkout.js
    }

    // ---- Mua sản phẩm trả phí bằng số dư ví ----
    async function muaSanPhamBangSoDu(){
        if (!prodDetailSelectedId) return;
        if (!currentSession){ location.href = loginUrl('product'); return; }
        await xuLyThanhToanBangSoDu({
            orderPayload: { order_type: 'product', product_id: prodDetailSelectedId },
            balanceBtnId: 'prodDetailBalanceBtn',
            onSuccess: () => { closeProductDetail(); renderProductContent(); }
        });
    }

    function closeProductDetail(){
        document.getElementById('prodDetailOverlay').classList.add('hidden');
        prodDetailSelectedId = null;
        const balanceBtn = document.getElementById('prodDetailBalanceBtn');
        if (balanceBtn) balanceBtn.style.display = 'none';
    }

    // Sản phẩm không có danh mục (item.category trống) sẽ được gom chung vào nhóm này.
    const PRODUCT_OTHER_CAT = 'Khác';

    async function renderProductContent(){
        const payload = await fetchSiteSettingPayload('product_content', DEFAULT_PRODUCT_CONTENT);
        // Sản phẩm bị ẩn (item.hidden) không hiện trong danh sách công khai, trừ khi khách đã mua rồi (vẫn cần mở/tải lại được).
        const items = (Array.isArray(payload.items) ? payload.items : []).filter(it => !it.hidden || purchasedProductIds.has(String(it.id)));
        const grid = document.getElementById('productGrid');
        const pillWrap = document.getElementById('productCatPills');
        const allCount = document.getElementById('productAllCount');
        if (allCount) allCount.textContent = items.length + ' sản phẩm';

        if (!items.length){
            grid.innerHTML = `<div class="empty-state"><div class="empty-icon" style="background:var(--amber-bg); color:var(--amber)"><i class="fa-solid fa-bag-shopping"></i></div><div class="empty-title">Chưa có sản phẩm nào</div><div class="empty-sub">Gói tài liệu, khoá ôn thi nâng cao sẽ sớm ra mắt tại đây.</div></div>`;
            if (pillWrap){ pillWrap.style.display = 'none'; pillWrap.innerHTML = ''; }
            loadProductOrderHistory();
            return;
        }

        // Chia sản phẩm thành nhiều nhóm theo item.category, giữ nguyên thứ tự nhóm xuất hiện lần đầu;
        // sản phẩm chưa gắn danh mục rơi vào nhóm "Khác" ở cuối cùng.
        const catOrder = [];
        const catMap = new Map();
        items.forEach(it => {
            const cat = (it.category || '').trim() || PRODUCT_OTHER_CAT;
            if (!catMap.has(cat)){ catMap.set(cat, []); catOrder.push(cat); }
            catMap.get(cat).push(it);
        });
        if (catOrder.includes(PRODUCT_OTHER_CAT) && catOrder[catOrder.length - 1] !== PRODUCT_OTHER_CAT){
            catOrder.splice(catOrder.indexOf(PRODUCT_OTHER_CAT), 1);
            catOrder.push(PRODUCT_OTHER_CAT);
        }

        // Chỉ hiện chia nhóm khi có từ 2 danh mục trở lên — nếu admin chưa phân loại (tất cả cùng rơi vào
        // 1 nhóm), giữ giao diện lưới đơn giản như cũ để đỡ rối mắt.
        if (catOrder.length <= 1){
            grid.innerHTML = `<div class="prod-grid">${items.map(productItemCardHtml).join('')}</div>`;
            if (pillWrap){ pillWrap.style.display = 'none'; pillWrap.innerHTML = ''; }
        } else {
            grid.innerHTML = catOrder.map(cat => {
                const catItems = catMap.get(cat);
                const catIdAttr = escapeHtmlHome(cat);
                return `
                <div class="doc-cat" data-productcat="${catIdAttr}">
                    <div class="doc-cat-head">
                        <div class="doc-cat-name"><i class="fa-solid ${cat === PRODUCT_OTHER_CAT ? 'fa-shapes' : 'fa-tags'}" style="color:var(--amber)"></i> ${escapeHtmlHome(cat)}</div>
                        <span class="doc-count">${catItems.length} sản phẩm</span>
                    </div>
                    <div class="prod-grid">${catItems.map(productItemCardHtml).join('')}</div>
                </div>`;
            }).join('');

            if (pillWrap){
                pillWrap.style.display = '';
                pillWrap.innerHTML = `<button class="filter-pill active" data-productfilter="all" type="button">Tất cả</button>`
                    + catOrder.map(cat => `<button class="filter-pill" data-productfilter="${escapeHtmlHome(cat)}" type="button">${escapeHtmlHome(cat)}</button>`).join('');
                pillWrap.querySelectorAll('.filter-pill').forEach(btn => {
                    btn.onclick = () => {
                        pillWrap.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        applyProductCatFilter(btn.dataset.productfilter);
                    };
                });
            }
        }

        loadProductOrderHistory();
    }

    function applyProductCatFilter(cat){
        document.querySelectorAll('#productGrid .doc-cat[data-productcat]').forEach(sec => {
            sec.style.display = (cat === 'all' || sec.dataset.productcat === cat) ? '' : 'none';
        });
    }

    // ---------------- HỆ THỐNG GHIM NỔI BẬT — mỗi loại ghim rơi đúng vào khối "nổi bật" tương ứng ----------------
    // Quản lý ở trang admin > Ghim nổi bật (site_settings key 'home_featured').
    // - Ghim loại "Học phần" -> nổi lên đầu khối "Học phần nổi bật" (ribbon ★ GHIM).
    // - Ghim loại "Tài liệu"/"Công cụ"/"Sản phẩm" -> hiện ở khối "X nổi bật" riêng ngay dưới khối học phần.
    // - Mỗi mục ghim có thể ẩn/hiện (cờ hidden) và đổi vị trí (kéo thả ở admin) mà không cần bỏ ghim.
    let _homeFeaturedPinsPromise = null;
    async function getHomeFeaturedPins(){
        if (!_homeFeaturedPinsPromise){
            _homeFeaturedPinsPromise = fetchSiteSettingPayload('home_featured', { items: [] }).then(payload => {
                const items = Array.isArray(payload.items) ? payload.items : [];
                return items.filter(p => !p.hidden); // chỉ lấy các mục đang bật hiển thị
            });
        }
        return _homeFeaturedPinsPromise;
    }

    async function renderFeaturedExtras(){
        const docFreeSection = document.getElementById('featuredDocFreeSection');
        const docFreeGrid = document.getElementById('featuredDocFreeGrid');
        const docPaidSection = document.getElementById('featuredDocPaidSection');
        const docPaidGrid = document.getElementById('featuredDocPaidGrid');
        const toolSection = document.getElementById('featuredToolSection');
        const toolGrid = document.getElementById('featuredToolGrid');
        const productSection = document.getElementById('featuredProductSection');
        const productGrid = document.getElementById('featuredProductGrid');
        if (!docFreeSection || !docPaidSection || !toolSection || !productSection) return;

        const pins = await getHomeFeaturedPins();
        const docIds     = pins.filter(p => p.type === 'doc').map(p => String(p.ref_id));
        const toolIds    = pins.filter(p => p.type === 'tool').map(p => String(p.ref_id));
        const productIds = pins.filter(p => p.type === 'product').map(p => String(p.ref_id));

        if (docIds.length){
            const docPayload = await fetchSiteSettingPayload('doc_content', DEFAULT_DOC_CONTENT);
            const docsMap = {};
            (docPayload.free || []).forEach(it => { if (!it.hidden) docsMap[String(it.id)] = { item: it, isPaid: false }; });
            (docPayload.paid || []).forEach(it => { if (!it.hidden || purchasedDocIds.has(String(it.id))) docsMap[String(it.id)] = { item: it, isPaid: true }; });
            // Tách 2 nhóm Miễn phí / Trả phí, mỗi nhóm giữ nguyên thứ tự đã ghim riêng ở admin (không xáo trộn thứ tự tương đối trong từng nhóm)
            const freeHtml = docIds.filter(id => docsMap[id] && !docsMap[id].isPaid).map(id => docItemCardHtml(docsMap[id].item, false)).join('');
            const paidHtml = docIds.filter(id => docsMap[id] && docsMap[id].isPaid).map(id => docItemCardHtml(docsMap[id].item, true)).join('');
            if (freeHtml){ docFreeGrid.innerHTML = freeHtml; docFreeSection.style.display = ''; } else { docFreeSection.style.display = 'none'; }
            if (paidHtml){ docPaidGrid.innerHTML = paidHtml; docPaidSection.style.display = ''; } else { docPaidSection.style.display = 'none'; }
        } else { docFreeSection.style.display = 'none'; docPaidSection.style.display = 'none'; }

        if (toolIds.length){
            const toolPayload = await fetchSiteSettingPayload('tool_content', DEFAULT_TOOL_CONTENT);
            const toolsMap = {};
            (toolPayload.items || []).forEach(it => { toolsMap[String(it.id)] = it; });
            const html = toolIds.map(id => { const it = toolsMap[id]; return it ? toolItemCardHtml(it) : ''; }).join('');
            if (html){ toolGrid.innerHTML = html; toolSection.style.display = ''; bindLockedCards(); } else { toolSection.style.display = 'none'; }
        } else { toolSection.style.display = 'none'; }

        if (productIds.length){
            const productPayload = await fetchSiteSettingPayload('product_content', DEFAULT_PRODUCT_CONTENT);
            const productsMap = {};
            (productPayload.items || []).forEach(it => { productsMap[String(it.id)] = it; });
            const html = productIds.map(id => { const it = productsMap[id]; return it ? productItemCardHtml(it) : ''; }).join('');
            if (html){ productGrid.innerHTML = html; productSection.style.display = ''; } else { productSection.style.display = 'none'; }
        } else { productSection.style.display = 'none'; }
    }

    // ---------------- HỖ TRỢ — nội dung động, quản lý ở trang admin > Hỗ trợ (site_settings key 'support_content') ----------------
    const DEFAULT_SUPPORT_CONTENT = {
        intro_title: 'Vướng chỗ nào, nhắn liền chỗ đó 👋',
        intro_desc: 'Câu hỏi sai, đáp án chưa rõ, hay muốn góp ý thêm tính năng — cứ nhắn. Đội SNG EDU đọc và trả lời trực tiếp, không qua chatbot.',
        contacts: [
            { id:'c1', icon:'fa-solid fa-comment-dots', color:'blue',  title:'Nhắn Zalo',            desc:'Mở Zalo, nhắn thẳng cho admin', status_label:'Phản hồi trong ngày', link:'https://zalo.me/0825160035' },
            { id:'c2', icon:'fa-solid fa-pen-to-square', color:'green', title:'Gửi form góp ý',   desc:'Điền ngay trên web, không cần rời trang',           status_label:'Kèm ảnh, chọn đúng môn & câu',    link:'gop-y.html' },
            { id:'c3', icon:'fa-solid fa-gift', color:'amber', title:'Nhận Pro miễn phí', desc:'Đổi tài liệu, báo lỗi hoặc giới thiệu bạn bè để nhận Premium', status_label:'Không cần thanh toán', link:'nhan-pro.html' }
        ],
        faq: [
            { id:'f1', title:'Tài liệu và trắc nghiệm trên SNG EDU có mất phí không?', desc:'Toàn bộ học phần đang mở đều miễn phí 100%. Nếu SNG EDU ra thêm gói nâng cao, bạn sẽ được báo trước — không có chuyện tự động trừ phí.' },
            { id:'f2', title:'Phát hiện câu hỏi hoặc đáp án bị sai thì báo ở đâu?', desc:'Chụp ảnh câu hỏi rồi gửi qua Zalo, hoặc điền Form góp ý ở trên. Đội SNG EDU kiểm tra và sửa trong thời gian sớm nhất.' },
            { id:'f3', title:'Khi nào các học phần "Sắp ra mắt" sẽ mở?', desc:'Bấm nút "Quan tâm" ngay trên thẻ học phần đó. Học phần càng nhiều người quan tâm, SNG EDU càng ưu tiên biên soạn trước.' }
        ]
    };

    const SUPPORT_ICON_COLOR_MAP = {
        indigo: { bg:'var(--brand-bg)', fg:'var(--brand)' },
        purple: { bg:'#f1ecff',         fg:'var(--brand2)' },
        green:  { bg:'var(--green-bg)', fg:'var(--green)' },
        amber:  { bg:'var(--amber-bg)', fg:'var(--amber)' },
        blue:   { bg:'#e8f3ff',         fg:'#0068ff' },
        red:    { bg:'#fde8e8',         fg:'#dc2626' }
    };

    function supportContactCardHtml(item){
        const style = SUPPORT_ICON_COLOR_MAP[item.color] || SUPPORT_ICON_COLOR_MAP.indigo;
        const href = item.link || '#';
        return `
            <a class="card" href="${escapeHtmlHome(href)}" ${item.link ? 'target="_blank" rel="noopener"' : 'onclick="return false;"'}>
                ${item.link ? '<div class="card-arrow"><i class="fa-solid fa-arrow-right"></i></div>' : ''}
                <div class="card-top"><div class="icon-chip" style="background:${style.bg}; color:${style.fg}"><i class="${escapeHtmlHome(item.icon || 'fa-solid fa-comment-dots')}"></i></div></div>
                <div class="card-title">${escapeHtmlHome(item.title || '')}</div>
                ${item.desc ? `<div class="badge-row"><i class="fa-solid fa-circle-info"></i> ${escapeHtmlHome(item.desc)}</div>` : ''}
                ${item.status_label ? `<div class="status-text" style="color:${style.fg}">${escapeHtmlHome(item.status_label)}</div>` : ''}
            </a>`;
    }

    function supportFaqItemHtml(item){
        return `
            <details class="faq-item">
                <summary>${escapeHtmlHome(item.title || '')}</summary>
                <p>${escapeHtmlHome(item.desc || '')}</p>
            </details>`;
    }

    async function renderSupportContent(){
        const payload = await fetchSiteSettingPayload('support_content', DEFAULT_SUPPORT_CONTENT);

        const titleEl = document.getElementById('supportIntroTitle');
        const descEl = document.getElementById('supportIntroDesc');
        if (titleEl) titleEl.textContent = payload.intro_title || DEFAULT_SUPPORT_CONTENT.intro_title;
        if (descEl) descEl.textContent = payload.intro_desc || DEFAULT_SUPPORT_CONTENT.intro_desc;

        const contacts = Array.isArray(payload.contacts) ? payload.contacts : [];
        const contactsGrid = document.getElementById('supportContactsGrid');
        if (contactsGrid){
            contactsGrid.innerHTML = contacts.length
                ? contacts.map(supportContactCardHtml).join('')
                : `<div class="empty-state small"><div class="empty-title">Chưa có kênh hỗ trợ nào</div></div>`;
        }

        const faq = Array.isArray(payload.faq) ? payload.faq : [];
        const faqList = document.getElementById('supportFaqList');
        if (faqList){
            faqList.innerHTML = faq.length
                ? faq.map(supportFaqItemHtml).join('')
                : `<div class="empty-state small"><div class="empty-title">Chưa có câu hỏi thường gặp nào</div></div>`;
        }
        injectFaqStructuredData(faq);
    }

    // SEO: sinh JSON-LD FAQPage đúng theo nội dung FAQ admin đang cấu hình (site_settings.support_content),
    // để luôn khớp 100% với những gì hiển thị trên trang — không cần đồng bộ tay khi admin sửa FAQ.
    function injectFaqStructuredData(faq){
        const old = document.getElementById('faqStructuredData');
        if (old) old.remove();
        const items = faq.filter(f => f && f.title && f.desc);
        if (!items.length) return;
        const data = {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": items.map(f => ({
                "@type": "Question",
                "name": String(f.title),
                "acceptedAnswer": { "@type": "Answer", "text": String(f.desc) }
            }))
        };
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.id = 'faqStructuredData';
        script.textContent = JSON.stringify(data);
        document.head.appendChild(script);
    }

    // ---------------- GÓI PRO — đọc thẳng từ bảng pro_packages (1 nguồn duy nhất) ----------------
    // Bảng pro_packages vừa là giá gốc cho cổng SePay, vừa là nội dung hiển thị ở đây.
    // Quản lý toàn bộ tại trang admin > Gói Pro.
    function formatHomeDuration(days){
        days = Number(days);
        if (days >= 360) return Math.round(days/365) + ' năm';
        if (days >= 80) return Math.round(days/30) + ' tháng';
        return days + ' ngày';
    }
    function formatHomePrice(days, price){
        return Number(price).toLocaleString('vi-VN') + 'đ / ' + formatHomeDuration(days);
    }

    function proPackageCardHtml(pkg){
        const style = QL_COLOR_MAP[pkg.color] || QL_COLOR_MAP.amber;
        const isHighlight = !!pkg.popular;
        const idAttr = escapeHtmlHome(String(pkg.id));
        return `
            <div class="pro-pkg-card${isHighlight ? ' popular' : ''}" role="button" tabindex="0" onclick="openProConfirmFromAccount('${idAttr}')" onkeydown="if(event.key==='Enter')openProConfirmFromAccount('${idAttr}')">
                ${isHighlight ? '<div class="pro-pkg-ribbon">Phổ biến nhất</div>' : ''}
                <div class="pro-pkg-icon" style="background:${style.bg}; color:${style.fg}"><i class="${escapeHtmlHome(pkg.icon || 'fa-solid fa-crown')}"></i></div>
                <div class="pro-pkg-name">${escapeHtmlHome(pkg.name || '')}</div>
                <div class="pro-pkg-desc">${pkg.description ? escapeHtmlHome(pkg.description) : ''}</div>
                <div class="pro-pkg-price-row">
                    <span class="pro-pkg-price">${Number(pkg.price).toLocaleString('vi-VN')}đ</span>
                    <span class="pro-pkg-duration">/ ${formatHomeDuration(pkg.duration_days)}</span>
                </div>
                <div class="pro-pkg-cta" style="color:${style.fg}">Chọn gói này <i class="fa-solid fa-arrow-right"></i></div>
            </div>`;
    }

    // ---------------- MODAL: Nâng cấp Pro (chọn gói kiểu thẻ + danh sách tính năng) ----------------
    // Danh sách mặc định — dùng khi admin chưa cấu hình gì trong site_settings (key 'pro_features').
    const PRO_UPGRADE_FEATURES_DEFAULT = [
        { title:'Mở khoá toàn bộ đề trắc nghiệm', desc:'Làm không giới hạn mọi đề thi, mọi môn học trong suốt thời gian Premium.' },
        { title:'Xem đáp án & giải thích chi tiết', desc:'Không giới hạn số lần xem lời giải sau khi làm bài.' },
        { title:'Tải tài liệu không giới hạn', desc:'Truy cập và tải toàn bộ tài liệu trong thư viện.' },
        { title:'Hỗ trợ trực tiếp từ quản trị viên', desc:'Ưu tiên phản hồi khi báo lỗi câu hỏi hoặc cần hỗ trợ.' },
    ];
    let PRO_UPGRADE_FEATURES = PRO_UPGRADE_FEATURES_DEFAULT;

    // ---------------- Banner khuyến mãi Premium (đếm ngược + giới hạn suất) — nội dung cấu hình trong Admin > Banner Premium ----------------
    let promoCountdownTimer = null;
    async function loadPromoBanner(){
        const banner = document.getElementById('promoBanner');
        if (!banner) return;
        try{
            const { data, error } = await sb.from('site_settings').select('*').eq('key', 'promo_banner').single();
            const payload = (!error && data && data.payload) ? data.payload : null;

            if (promoCountdownTimer){ clearInterval(promoCountdownTimer); promoCountdownTimer = null; }

            if (!payload || !payload.enabled || !payload.end_at){ banner.classList.add('hidden'); return; }

            const endAt = new Date(payload.end_at);
            if (isNaN(endAt.getTime()) || endAt.getTime() <= Date.now()){ banner.classList.add('hidden'); return; }

            const dismissKey = 'promoBannerDismiss_' + payload.end_at;
            const isDismissed = () => {
                try{ return localStorage.getItem(dismissKey) === '1' || sessionStorage.getItem(dismissKey) === '1'; }
                catch(e){ return false; }
            };
            if (isDismissed()){ banner.classList.add('hidden'); return; }

            document.getElementById('promoBannerMsg').innerText = payload.message || '';

            // "Số suất còn lại" = Tổng số suất - số đơn Gói thành viên đã thanh toán THẬT kể từ mốc
            // payload.start_at (hoặc từ lúc admin lưu cấu hình này nếu không đặt mốc riêng) -- không còn
            // là con số admin gõ tay, nên tự động giảm ngay khi có khách thanh toán thành công.
            const slotsTotal = Number(payload.slots_total) || 0;
            const slotsPill = document.getElementById('promoSlotsPill');
            if (slotsTotal > 0){
                const sinceIso = payload.start_at ? new Date(payload.start_at).toISOString() : (data && data.updated_at ? data.updated_at : null);
                let soldCount = 0;
                if (sinceIso){
                    try{
                        const { data: cnt, error: cntErr } = await sb.rpc('get_paid_subscription_count', { p_since: sinceIso });
                        if (!cntErr) soldCount = Number(cnt) || 0;
                    }catch(e){}
                }
                const slotsLeft = Math.max(0, slotsTotal - soldCount);
                slotsPill.textContent = `còn ${slotsLeft}/${slotsTotal} suất`;
                slotsPill.classList.remove('hidden');
            } else {
                slotsPill.classList.add('hidden');
            }

            const timerPill = document.getElementById('promoTimerPill');
            function tickPromoCountdown(){
                const diff = endAt.getTime() - Date.now();
                if (diff <= 0){
                    banner.classList.add('hidden');
                    if (promoCountdownTimer){ clearInterval(promoCountdownTimer); promoCountdownTimer = null; }
                    return;
                }
                const totalSec = Math.floor(diff / 1000);
                const days = Math.floor(totalSec / 86400);
                const hours = Math.floor((totalSec % 86400) / 3600);
                const mins = Math.floor((totalSec % 3600) / 60);
                const secs = totalSec % 60;
                const pad = n => String(n).padStart(2, '0');
                timerPill.textContent = (days > 0 ? days + 'n ' : '') + `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
                timerPill.classList.remove('hidden');
            }
            tickPromoCountdown();
            promoCountdownTimer = setInterval(tickPromoCountdown, 1000);

            banner.classList.remove('hidden');

            const closeBtn = document.getElementById('promoCloseBtn');
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                banner.classList.add('hidden');
                if (promoCountdownTimer){ clearInterval(promoCountdownTimer); promoCountdownTimer = null; }
                try{ localStorage.setItem(dismissKey, '1'); }catch(e){}
                try{ sessionStorage.setItem(dismissKey, '1'); }catch(e){}
            };
        }catch(e){
            // Banner chỉ là nội dung marketing phụ trợ — lỗi mạng/chưa cấu hình thì âm thầm ẩn đi, không chặn trang.
            banner.classList.add('hidden');
        }
    }

    // ---------------- Popup thông báo nổi khi vào trang — nội dung cấu hình trong Admin > Thông báo nổi ----------------
    async function loadAnnouncementPopup(){
        const overlay = document.getElementById('announcePopupOverlay');
        if (!overlay) return;
        try{
            const { data, error } = await sb.from('site_settings').select('*').eq('key', 'announcement_popup').single();
            const payload = (!error && data && data.payload) ? data.payload : null;

            if (!payload || !payload.enabled || !(payload.message || '').trim()){ overlay.classList.add('hidden'); return; }

            // Khoá lưu ở localStorage gắn theo updated_at -> mỗi lần admin sửa/lưu lại nội dung, popup sẽ hiện lại
            // kể cả với người đã từng bấm "Ẩn trong X giờ" cho nội dung cũ.
            const version = (data && data.updated_at) ? data.updated_at : '';
            const hideKey = 'announcePopupHideUntil_' + version;
            const hideUntil = Number(localStorage.getItem(hideKey) || 0);
            if (hideUntil && hideUntil > Date.now()){ overlay.classList.add('hidden'); return; }

            document.getElementById('announcePopupTitle').innerText = (payload.title || '').trim() || 'Thông báo';
            document.getElementById('announcePopupMsg').innerText = payload.message || '';

            const hours = Number(payload.hide_hours) > 0 ? Number(payload.hide_hours) : 2;
            const hideBtn = document.getElementById('announcePopupHideBtn');
            hideBtn.innerText = `Ẩn trong ${hours} giờ`;
            hideBtn.onclick = () => {
                localStorage.setItem(hideKey, String(Date.now() + hours * 3600 * 1000));
                overlay.classList.add('hidden');
            };

            const closeNow = () => overlay.classList.add('hidden');
            document.getElementById('announcePopupCloseBtn').onclick = closeNow;
            document.getElementById('announcePopupCloseIcon').onclick = closeNow;
            overlay.onclick = (e) => { if (e.target === overlay) closeNow(); };

            overlay.classList.remove('hidden');
        }catch(e){
            // Popup chỉ là nội dung thông báo phụ trợ — lỗi mạng/chưa cấu hình thì âm thầm ẩn đi, không chặn trang.
            overlay.classList.add('hidden');
        }
    }

    let proFeaturesConfigPromise = null;
    // Tải danh sách tính năng do admin cấu hình (trang admin > Cài đặt > "Tính năng gói Pro") — nếu chưa cấu hình thì dùng mặc định ở trên.
    async function loadProUpgradeFeaturesConfig(){
        try{
            const { data, error } = await sb.from('site_settings').select('*').eq('key', 'pro_features').single();
            const items = (!error && data && data.payload && Array.isArray(data.payload.items)) ? data.payload.items : null;
            if (items && items.length) PRO_UPGRADE_FEATURES = items;
        }catch(e){ /* giữ nguyên danh sách mặc định nếu lỗi mạng/chưa có bảng */ }
    }

    let proUpgradeItems = [];
    let proUpgradeSelectedId = null;

    async function openProUpgradeModal(){
        if (!currentSession){ location.href = loginUrl('account'); return; }
        const overlay = document.getElementById('proUpgradeOverlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');
        if (proFeaturesConfigPromise) await proFeaturesConfigPromise;

        const plansEl = document.getElementById('proUpgradePlans');
        plansEl.innerHTML = `<div class="empty-state small"><div class="empty-title">Đang tải gói...</div></div>`;

        const FULL_SELECT = 'id, name, description, price, duration_days, icon, color, popular, order_no, active';
        let { data, error } = await sb.from('pro_packages').select(FULL_SELECT).eq('active', true).order('order_no', { ascending:true }).order('price', { ascending:true });
        if (error && (error.code === '42703' || /column .* does not exist/i.test(error.message || ''))){
            const fallback = await sb.from('pro_packages').select('id, name, price, duration_days, active').eq('active', true).order('price', { ascending:true });
            data = fallback.data; error = fallback.error;
        }
        proUpgradeItems = (!error && data) ? data : [];

        if (!proUpgradeItems.length){
            plansEl.innerHTML = `<div class="empty-state small"><div class="empty-title">Chưa có gói Pro nào</div></div>`;
            document.getElementById('proUpgradeCta').disabled = true;
            return;
        }

        // Mặc định chọn gói được đánh dấu "popular", nếu không có thì chọn gói ở giữa danh sách.
        const defaultPick = proUpgradeItems.find(p => p.popular) || proUpgradeItems[Math.floor((proUpgradeItems.length - 1) / 2)];
        proUpgradeSelectedId = defaultPick.id;

        renderProUpgradePlans();
        renderProUpgradeFeatures();
        updateProUpgradeCta();
    }

    function closeProUpgradeModal(){
        const overlay = document.getElementById('proUpgradeOverlay');
        if (overlay) overlay.classList.add('hidden');
    }

    function proUpgradePlanTag(pkg, index){
        if (pkg.popular) return 'Phổ biến';
        if (index === 0) return 'Linh hoạt';
        if (index === proUpgradeItems.length - 1) return 'Tốt nhất';
        return '';
    }

    function renderProUpgradePlans(){
        const plansEl = document.getElementById('proUpgradePlans');
        plansEl.innerHTML = proUpgradeItems.map((pkg, i) => {
            const tag = proUpgradePlanTag(pkg, i);
            const isActive = pkg.id === proUpgradeSelectedId;
            return `
                <div class="pro-upg-plan${isActive ? ' active' : ''}" role="button" tabindex="0"
                     onclick="pickProUpgradePlan('${escapeHtmlHome(String(pkg.id))}')"
                     onkeydown="if(event.key==='Enter')pickProUpgradePlan('${escapeHtmlHome(String(pkg.id))}')">
                    <span class="radio-dot"></span>
                    <div class="plan-name">${escapeHtmlHome(pkg.name || '')}${tag ? `<span class="plan-tag">${tag}</span>` : ''}</div>
                    <div class="plan-price">${Number(pkg.price).toLocaleString('vi-VN')}đ</div>
                    <div class="plan-days">${formatHomeDuration(pkg.duration_days)}</div>
                </div>`;
        }).join('');
    }

    function pickProUpgradePlan(id){
        proUpgradeSelectedId = id;
        renderProUpgradePlans();
        updateProUpgradeCta();
    }

    function renderProUpgradeFeatures(){
        const featEl = document.getElementById('proUpgradeFeatures');
        featEl.innerHTML = PRO_UPGRADE_FEATURES.map(f => `
            <div class="pro-upg-feat-row">
                <span class="feat-check"><i class="fa-solid fa-check"></i></span>
                <div>
                    <div class="feat-title">${escapeHtmlHome(f.title)}</div>
                    <div class="feat-desc">${escapeHtmlHome(f.desc)}</div>
                </div>
            </div>`).join('');
    }

    function updateProUpgradeCta(){
        const btn = document.getElementById('proUpgradeCta');
        const pkg = proUpgradeItems.find(p => p.id === proUpgradeSelectedId);
        if (!btn || !pkg) return;
        btn.textContent = `Thanh toán ${formatHomeDuration(pkg.duration_days)} - ${Number(pkg.price).toLocaleString('vi-VN')}đ`;
        btn.disabled = false;
    }

    function submitProUpgrade(){
        if (!proUpgradeSelectedId) return;
        openProConfirm();
    }

    // ---- Popup xác nhận thanh toán (bước 2) — hiện đầy đủ gói + tính năng, chỉ gọi thanh toán khi bấm "Xác nhận" ----
    function openProConfirm(){
        const pkg = proUpgradeItems.find(p => p.id === proUpgradeSelectedId);
        if (!pkg) return;

        document.getElementById('proConfirmName').textContent = pkg.name || '';
        document.getElementById('proConfirmDays').textContent = formatHomeDuration(pkg.duration_days);
        document.getElementById('proConfirmPrice').textContent = Number(pkg.price).toLocaleString('vi-VN') + 'đ';

        document.getElementById('proConfirmFeatures').innerHTML = PRO_UPGRADE_FEATURES.map(f => `
            <div class="pro-confirm-feat-row">
                <span class="feat-check"><i class="fa-solid fa-check"></i></span>
                <div>
                    <div class="feat-title">${escapeHtmlHome(f.title)}</div>
                    <div class="feat-desc">${escapeHtmlHome(f.desc)}</div>
                </div>
            </div>`).join('');

        document.getElementById('proConfirmOverlay').classList.remove('hidden');
        apDungCauHinhSepayLenNut('proConfirmOkBtn', '<i class="fa-solid fa-lock"></i> Xác nhận thanh toán');
        capNhatOptionSoDu('proConfirmBalancePayWrap', 'proConfirmBalanceText', Number(pkg.price || 0));
    }

    // Mở popup xác nhận trực tiếp từ thẻ gói trong tab "Tài khoản" (proGrid) —
    // dùng chung modal xác nhận với luồng mở từ nút "Nâng cấp Pro" ở sidebar.
    async function openProConfirmFromAccount(id){
        if (!currentSession){ location.href = loginUrl('account'); return; }
        if (proFeaturesConfigPromise) await proFeaturesConfigPromise;
        proUpgradeSelectedId = id;
        openProConfirm();
    }

    function closeProConfirm(){
        document.getElementById('proConfirmOverlay').classList.add('hidden');
        const okBtn = document.getElementById('proConfirmOkBtn');
        if (okBtn){ okBtn.disabled = false; okBtn.innerHTML = '<i class="fa-solid fa-lock"></i> Xác nhận thanh toán'; }
        resetNutSoDu('proConfirmBalanceBtn');
    }

    async function confirmProUpgrade(useBalance){
        if (!proUpgradeSelectedId) return;
        if (useBalance){
            await xuLyThanhToanBangSoDu({
                orderPayload: { order_type: 'subscription', plan_id: proUpgradeSelectedId },
                balanceBtnId: 'proConfirmBalanceBtn',
                onSuccess: () => { closeProConfirm(); location.reload(); }
            });
            return;
        }
        const okBtn = document.getElementById('proConfirmOkBtn');
        if (okBtn){ okBtn.disabled = true; okBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang chuyển tới cổng thanh toán...'; }
        thanhToanGoiThanhVien(proUpgradeSelectedId); // hàm có sẵn trong frontend/sepay-checkout.js
    }

    async function renderProContent(){
        const grid = document.getElementById('proGrid');
        if (!grid) return;

        const FULL_SELECT = 'id, name, description, price, duration_days, icon, color, popular, order_no, active';
        let { data, error } = await sb.from('pro_packages').select(FULL_SELECT).eq('active', true).order('order_no', { ascending:true }).order('price', { ascending:true });
        if (error && (error.code === '42703' || /column .* does not exist/i.test(error.message || ''))){
            // Bảng chưa chạy migration 0002 (chưa có cột hiển thị) — dùng tạm cột cũ, không có mô tả/icon/màu riêng.
            const fallback = await sb.from('pro_packages').select('id, name, price, duration_days, active').eq('active', true).order('price', { ascending:true });
            data = fallback.data; error = fallback.error;
        }
        const items = (!error && data) ? data : [];

        if (!items.length){
            grid.innerHTML = `<div class="empty-state"><div class="empty-icon" style="background:var(--amber-bg); color:var(--amber)"><i class="fa-solid fa-crown"></i></div><div class="empty-title">Chưa có gói Pro nào</div><div class="empty-sub">Vào trang admin &gt; Gói Pro để thêm gói đầu tiên.</div></div>`;
            return;
        }
        grid.innerHTML = items.map(proPackageCardHtml).join('');
        // Đồng bộ danh sách này vào biến dùng chung với popup xác nhận, để bấm thẻ gói ở đây
        // cũng mở được popup "Xác nhận nâng cấp Pro" (giống hệt luồng mở từ nút Nâng cấp Pro).
        proUpgradeItems = items;
    }

    // ---------------- Đổ dữ liệu tài khoản đang đăng nhập vào tab "Tài khoản & Gói Pro" ----------------
    // Trước khi hiển thị, làm mới session để lấy user_metadata mới nhất từ server
    // (tránh hiện hạn Premium/số dư cũ do session cache trong trình duyệt sau khi vừa thanh toán/được admin chỉnh).
    async function refreshSessionAndRenderAccount(){
        renderAccountPanelInfo(); // hiện tạm dữ liệu đang có ngay, tránh giật màn hình
        try{
            const { data, error } = await sb.auth.refreshSession();
            if (!error && data && data.session) currentSession = data.session;
        }catch(e){ /* mạng lỗi thì cứ dùng dữ liệu cũ đang có */ }
        renderAccountPanelInfo();
        loadAcctOrderHistory();
    }

    function renderAccountPanelInfo(){
        if (!document.getElementById('panel-account')) return;
        const emailEl = document.getElementById('acctPageEmail');
        const nameEl = document.getElementById('acctPageName');
        const badgeEl = document.getElementById('acctPagePlanBadge');
        if (!emailEl) return;

        if (!currentSession){
            emailEl.textContent = '—'; nameEl.textContent = '—';
            badgeEl.textContent = 'Miễn phí'; badgeEl.className = 'acc-plan-badge';
            return;
        }
        const user = currentSession.user;
        const email = user.email || '';
        const displayName = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || email.split('@')[0];
        emailEl.textContent = email || '—';
        nameEl.textContent = displayName || '—';

        const meta = user.user_metadata || {};
        const premiumUntil = meta.premium_until ? new Date(meta.premium_until) : null;
        const isPremiumActive = meta.plan === 'premium' && (!premiumUntil || premiumUntil > new Date());
        if (isPremiumActive){
            badgeEl.textContent = premiumUntil ? `Premium — hết hạn ${premiumUntil.toLocaleDateString('vi-VN')}` : 'Premium — Đang hoạt động';
            badgeEl.className = 'acc-plan-badge premium';
        } else {
            badgeEl.textContent = 'Miễn phí';
            badgeEl.className = 'acc-plan-badge';
        }

        // ----- Số dư: số dư tiền (VNĐ) của tài khoản, lấy từ bảng profiles -----
        loadAndRenderBalance(user.id, 'acctPageBalanceRow', 'acctPageBalanceValue');
    }

    // ---------------- Số dư tiền (VNĐ) — đọc từ bảng profiles.balance ----------------
    async function loadAndRenderBalance(userId, rowId, valueId){
        const row = document.getElementById(rowId);
        const valueEl = document.getElementById(valueId);
        if (!row || !valueEl) return;
        try{
            const { data, error } = await sb.from('profiles').select('balance').eq('id', userId).maybeSingle();
            if (error) throw error;
            const balance = Number(data && data.balance) || 0;
            valueEl.textContent = balance.toLocaleString('vi-VN') + 'đ';
            row.style.display = '';
            apDungHienThiNutNapTien();
        }catch(e){
            row.style.display = 'none';
        }
    }

    // ---------------- Lịch sử giao dịch (đơn nâng cấp gói Pro) — đọc từ bảng sepay_orders ----------------
    const ORDER_STATUS_LABEL = {
        paid:      { text:'Đã thanh toán',        cls:'paid' },
        pending:   { text:'Đang chờ thanh toán',  cls:'pending' },
        failed:    { text:'Thất bại',              cls:'failed' },
        cancelled: { text:'Đã huỷ',                cls:'cancelled' },
    };
    // Lịch sử giao dịch của trang Tài khoản: đơn nâng cấp Pro qua thanh toán (sepay_orders)
    // ĐỒNG BỘ với admin cộng/trừ tiền thủ công (balance_transactions) và admin nâng cấp/huỷ Pro thủ công (pro_grants) —
    // tất cả các nguồn hoạt động liên quan tới Pro/tiền của tài khoản đều gộp chung vào đây, giống hệt bảng
    // "Lịch sử" trong popup tài khoản nhanh, để 2 nơi luôn khớp nhau.
    async function loadAcctOrderHistory(){
        const loadingEl = document.getElementById('acctOrderLoading');
        const listEl = document.getElementById('acctOrderList');
        const emptyEl = document.getElementById('acctOrderEmpty');
        if (!loadingEl || !listEl || !emptyEl) return;

        if (!currentSession){
            loadingEl.style.display = 'none';
            listEl.style.display = 'none';
            emptyEl.style.display = 'flex';
            return;
        }

        loadingEl.style.display = 'block';
        listEl.style.display = 'none';
        emptyEl.style.display = 'none';

        const items = await fetchMergedActivity('subscription', 30);

        loadingEl.style.display = 'none';
        if (!items.length){
            emptyEl.style.display = 'flex';
            return;
        }
        listEl.style.display = 'block';
        listEl.innerHTML = items.map(activityItemHtml).join('');
    }

    // ---------------- Lịch sử mua hàng (dùng chung) — chỉ lấy đơn đã thanh toán thành công ----------------
    async function fetchPaidOrders(orderType, limit){
        if (!currentSession) return [];
        try{
            let query = sb
                .from('sepay_orders')
                .select('id, order_type, plan_id, course_id, amount, status, invoice_number, created_at, paid_at')
                .eq('user_id', currentSession.user.id)
                .eq('status', 'paid')
                .order('created_at', { ascending:false });
            if (orderType) query = query.eq('order_type', orderType);
            if (limit) query = query.limit(limit);
            const { data, error } = await query;
            return (!error && Array.isArray(data)) ? data : [];
        }catch(e){ return []; }
    }

    // ---------------- Gộp & đồng bộ mọi hoạt động của tài khoản: đơn thanh toán + admin cộng/trừ tiền + admin nâng/huỷ Pro ----------------
    // Dùng chung cho popup "Lịch sử" nhanh, subtab "Lịch sử giao dịch" (trang Tài khoản) và trang "Lịch sử mua hàng" đầy đủ,
    // để cả 3 nơi luôn hiển thị đồng bộ, không nơi nào "thiếu" thao tác admin thực hiện thủ công.
    async function fetchMergedActivity(orderType, limit){
        if (!currentSession) return [];
        const userId = currentSession.user.id;
        const [orders, balanceTx, proGrants] = await Promise.all([
            fetchPaidOrders(orderType || null, limit),
            fetchBalanceTransactions(userId, limit),
            fetchProGrants(userId, limit),
        ]);
        const items = [
            ...orders.map(r => ({ type:'order', date: r.paid_at || r.created_at, row:r })),
            ...balanceTx.map(r => ({ type:'balance', date: r.created_at, row:r })),
            ...proGrants.map(r => ({ type: r.action === 'revoke' ? 'pro_revoke' : 'pro_grant', date: r.created_at, row:r })),
        ].sort((a, b) => new Date(b.date) - new Date(a.date));
        return limit ? items.slice(0, limit) : items;
    }

    function orderDisplayMeta(row){
        if (row.order_type === 'subscription'){
            const pkgNameById = {};
            (proUpgradeItems || []).forEach(p => { pkgNameById[p.id] = p.name; });
            return { icon:'fa-crown', title: pkgNameById[row.plan_id] || 'Gói Premium', link:null };
        }
        if (row.order_type === 'document'){
            const doc = DOC_PAID_ITEMS_MAP[String(row.course_id)];
            return { icon:'fa-file-lines', title: (doc && doc.title) || 'Tài liệu', link: (doc && doc.link) || null };
        }
        if (row.order_type === 'product'){
            const prod = PRODUCT_DETAIL_MAP[String(row.course_id)];
            return { icon:'fa-bag-shopping', title: (prod && prod.title) || 'Sản phẩm', link: (prod && prod.link) || null };
        }
        if (row.order_type === 'course'){
            return { icon:'fa-graduation-cap', title:'Khoá học', link:null };
        }
        return { icon:'fa-receipt', title: row.invoice_number || 'Đơn hàng', link:null };
    }

    function orderHistoryItemHtml(row){
        const meta = orderDisplayMeta(row);
        const dateSrc = row.paid_at || row.created_at;
        const dateText = dateSrc ? new Date(dateSrc).toLocaleString('vi-VN') : '';
        const amountText = Number(row.amount || 0).toLocaleString('vi-VN') + 'đ';
        const inner = `
            <div class="acc-history-icon"><i class="fa-solid ${meta.icon}"></i></div>
            <div>
                <div class="acc-history-title">${escapeHtmlHome(meta.title)} — ${amountText}</div>
                <div class="acc-history-meta">${escapeHtmlHome(dateText)}</div>
            </div>
            <span class="acct-order-status paid">Đã thanh toán</span>`;

        // Nếu tra ra được link tài sản (vd. link tải tài liệu) -> cho bấm vào mở luôn, giống thẻ tài liệu đã mua.
        if (meta.link){
            return `<a class="acc-history-item" href="${escapeHtmlHome(meta.link)}" target="_blank" rel="noopener">
                ${inner}
                <i class="fa-solid fa-arrow-up-right-from-square acc-history-arrow"></i>
            </a>`;
        }
        return `<div class="acc-history-item">${inner}</div>`;
    }

    // Lịch sử mua tài liệu (hiển thị ngay trong tab Tài liệu, chỉ đơn thành công)
    async function loadDocOrderHistory(){
        const sec = document.getElementById('docHistorySec');
        const loadingEl = document.getElementById('docOrderLoading');
        const listEl = document.getElementById('docOrderList');
        const emptyEl = document.getElementById('docOrderEmpty');
        if (!sec || !loadingEl || !listEl || !emptyEl) return;

        if (!currentSession){ sec.style.display = 'none'; return; }
        sec.style.display = '';
        loadingEl.style.display = 'block';
        listEl.style.display = 'none';
        emptyEl.style.display = 'none';

        const rows = await fetchPaidOrders('document', 20);

        loadingEl.style.display = 'none';
        if (!rows.length){
            emptyEl.style.display = 'flex';
            return;
        }
        listEl.style.display = 'block';
        listEl.innerHTML = rows.map(orderHistoryItemHtml).join('');
    }

    // Lịch sử mua sản phẩm (hiển thị ngay trong tab Sản phẩm, chỉ đơn thành công) — nhân bản y hệt cơ chế Tài liệu ở trên.
    async function loadProductOrderHistory(){
        const sec = document.getElementById('prodHistorySec');
        const loadingEl = document.getElementById('prodOrderLoading');
        const listEl = document.getElementById('prodOrderList');
        const emptyEl = document.getElementById('prodOrderEmpty');
        if (!sec || !loadingEl || !listEl || !emptyEl) return;

        if (!currentSession){ sec.style.display = 'none'; return; }
        sec.style.display = '';
        loadingEl.style.display = 'block';
        listEl.style.display = 'none';
        emptyEl.style.display = 'none';

        const rows = await fetchPaidOrders('product', 20);

        loadingEl.style.display = 'none';
        if (!rows.length){
            emptyEl.style.display = 'flex';
            return;
        }
        listEl.style.display = 'block';
        listEl.innerHTML = rows.map(orderHistoryItemHtml).join('');
    }

    // Tab "Lịch sử mua hàng" — toàn bộ đơn (tài liệu + khoá học + gói Pro) ĐỒNG BỘ với admin cộng/trừ tiền
    // (balance_transactions) và admin nâng cấp/huỷ Pro thủ công (pro_grants), giống hệt popup "Lịch sử" nhanh
    // và subtab "Lịch sử giao dịch" ở trang Tài khoản — 3 nơi này luôn khớp dữ liệu với nhau.
    let fullHistoryCache = [];
    let fullHistoryActiveType = '';
    let fullHistoryListenersBound = false;

    // Nhóm phân loại của 1 dòng hoạt động, dùng để lọc theo chip ("Gói Pro" / "Tài liệu" / "Khoá học" / "Admin điều chỉnh")
    function histItemCategories(item){
        if (item.type === 'order') return [item.row.order_type];
        if (item.type === 'balance') return ['admin'];
        if (item.type === 'pro_grant' || item.type === 'pro_revoke') return ['subscription', 'admin'];
        return ['other'];
    }

    function histItemSearchText(item){
        if (item.type === 'order'){
            const meta = orderDisplayMeta(item.row);
            return ((meta.title || '') + ' ' + (item.row.invoice_number || '')).toLowerCase();
        }
        if (item.type === 'balance') return ('admin cộng trừ tiền ' + (item.row.note || '')).toLowerCase();
        if (item.type === 'pro_revoke') return ('admin huỷ gói pro ' + (item.row.note || '')).toLowerCase();
        return ('admin nâng cấp pro ' + (item.row.note || '')).toLowerCase();
    }

    function fullHistoryOrderRowHtml(row){
        const meta = orderDisplayMeta(row);
        const dateSrc = row.paid_at || row.created_at;
        const dateText = dateSrc ? new Date(dateSrc).toLocaleString('vi-VN') : '';
        const amountText = Number(row.amount || 0).toLocaleString('vi-VN') + 'đ';
        const typeCls = ['subscription','document','product','course'].includes(row.order_type) ? row.order_type : 'other';
        const inner = `
            <div class="hist-icon type-${typeCls}"><i class="fa-solid ${meta.icon}"></i></div>
            <div class="hist-body">
                <div class="hist-title">${escapeHtmlHome(meta.title)}</div>
                <div class="hist-meta">
                    <span>${escapeHtmlHome(dateText)}</span>
                    ${row.invoice_number ? `<span class="hist-dot">·</span><span>#${escapeHtmlHome(row.invoice_number)}</span>` : ''}
                </div>
            </div>
            <div class="hist-side">
                <span class="hist-amount">${amountText}</span>
                <span class="acct-order-status paid">Đã thanh toán</span>
            </div>`;

        // Nếu tra ra được link tài sản (vd. link tải tài liệu) -> cho bấm vào mở luôn.
        if (meta.link){
            return `<a class="hist-row" href="${escapeHtmlHome(meta.link)}" target="_blank" rel="noopener">
                ${inner}
                <i class="fa-solid fa-arrow-up-right-from-square hist-arrow"></i>
            </a>`;
        }
        return `<div class="hist-row">${inner}</div>`;
    }

    // Dòng hoạt động do admin thực hiện thủ công (cộng/trừ tiền, nâng cấp/huỷ Pro) — hiển thị cùng danh sách,
    // dùng style "hist-row" giống hệt đơn hàng để đồng bộ giao diện.
    function fullHistoryAdminRowHtml(item){
        const r = item.row;
        const dateText = r.created_at ? new Date(r.created_at).toLocaleString('vi-VN') : '';
        const noteHtml = r.note ? `<span class="hist-dot">·</span><span>${escapeHtmlHome(r.note)}</span>` : '';

        if (item.type === 'balance'){
            const isCredit = Number(r.amount) >= 0;
            const amountText = (isCredit ? '+' : '') + Number(r.amount).toLocaleString('vi-VN') + 'đ';
            return `<div class="hist-row">
                <div class="hist-icon type-other"><i class="fa-solid ${isCredit ? 'fa-arrow-up' : 'fa-arrow-down'}"></i></div>
                <div class="hist-body">
                    <div class="hist-title">${isCredit ? 'Admin cộng tiền' : 'Admin trừ tiền'}</div>
                    <div class="hist-meta"><span>${escapeHtmlHome(dateText)}</span>${noteHtml}</div>
                </div>
                <div class="hist-side">
                    <span class="hist-amount">${amountText}</span>
                    <span class="acct-order-status pending">Admin điều chỉnh</span>
                </div>
            </div>`;
        }

        if (item.type === 'pro_revoke'){
            return `<div class="hist-row">
                <div class="hist-icon type-subscription"><i class="fa-solid fa-crown"></i></div>
                <div class="hist-body">
                    <div class="hist-title">Admin huỷ gói Pro</div>
                    <div class="hist-meta"><span>${escapeHtmlHome(dateText)}</span>${noteHtml}</div>
                </div>
                <div class="hist-side"><span class="acct-order-status cancelled">Admin điều chỉnh</span></div>
            </div>`;
        }

        // pro_grant
        const untilText = r.premium_until ? new Date(r.premium_until).toLocaleDateString('vi-VN') : '';
        return `<div class="hist-row">
            <div class="hist-icon type-subscription"><i class="fa-solid fa-crown"></i></div>
            <div class="hist-body">
                <div class="hist-title">Admin nâng cấp Pro${untilText ? (' — hết hạn ' + untilText) : ''}</div>
                <div class="hist-meta"><span>${escapeHtmlHome(dateText)}</span>${noteHtml}</div>
            </div>
            <div class="hist-side"><span class="acct-order-status paid">Admin điều chỉnh</span></div>
        </div>`;
    }

    function fullHistoryRowHtml(item){
        return item.type === 'order' ? fullHistoryOrderRowHtml(item.row) : fullHistoryAdminRowHtml(item);
    }

    function renderFullHistoryList(){
        const listEl = document.getElementById('histOrderList');
        const filterEmptyEl = document.getElementById('histFilterEmpty');
        if (!listEl) return;
        const q = (document.getElementById('histSearchInput')?.value || '').trim().toLowerCase();
        let items = fullHistoryCache;
        if (fullHistoryActiveType) items = items.filter(item => histItemCategories(item).includes(fullHistoryActiveType));
        if (q) items = items.filter(item => histItemSearchText(item).includes(q));
        if (!items.length){
            listEl.style.display = 'none';
            if (filterEmptyEl) filterEmptyEl.style.display = 'flex';
            return;
        }
        if (filterEmptyEl) filterEmptyEl.style.display = 'none';
        listEl.style.display = 'block';
        listEl.innerHTML = items.map(fullHistoryRowHtml).join('');
    }

    function bindFullHistoryToolbar(){
        if (fullHistoryListenersBound) return;
        fullHistoryListenersBound = true;
        const filtersEl = document.getElementById('histFilters');
        if (filtersEl){
            filtersEl.addEventListener('click', (e) => {
                const btn = e.target.closest('.hist-filter-chip');
                if (!btn || !filtersEl.contains(btn)) return;
                filtersEl.querySelectorAll('.hist-filter-chip').forEach(b => b.classList.toggle('active', b === btn));
                fullHistoryActiveType = btn.dataset.histtype || '';
                renderFullHistoryList();
            });
        }
        const searchEl = document.getElementById('histSearchInput');
        if (searchEl) searchEl.addEventListener('input', () => renderFullHistoryList());
    }

    async function loadFullPurchaseHistory(){
        const loadingEl = document.getElementById('histOrderLoading');
        const listEl = document.getElementById('histOrderList');
        const emptyEl = document.getElementById('histOrderEmpty');
        const filterEmptyEl = document.getElementById('histFilterEmpty');
        const statsEl = document.getElementById('histStats');
        const toolbarEl = document.getElementById('histToolbar');
        if (!loadingEl || !listEl || !emptyEl) return;

        bindFullHistoryToolbar();

        if (!currentSession){
            loadingEl.style.display = 'none';
            listEl.style.display = 'none';
            if (statsEl) statsEl.style.display = 'none';
            if (toolbarEl) toolbarEl.style.display = 'none';
            emptyEl.style.display = 'flex';
            return;
        }

        loadingEl.style.display = 'block';
        listEl.style.display = 'none';
        emptyEl.style.display = 'none';
        if (filterEmptyEl) filterEmptyEl.style.display = 'none';
        if (statsEl) statsEl.style.display = 'none';
        if (toolbarEl) toolbarEl.style.display = 'none';

        const items = await fetchMergedActivity(null, 50);
        fullHistoryCache = items;

        loadingEl.style.display = 'none';
        if (!items.length){
            emptyEl.style.display = 'flex';
            return;
        }

        // Thống kê nhanh: tổng số đơn + tổng đã chi tiêu — chỉ tính đơn hàng thanh toán thật (không tính admin cộng/trừ).
        const orderItems = items.filter(item => item.type === 'order');
        const totalAmount = orderItems.reduce((sum, item) => sum + Number(item.row.amount || 0), 0);
        const statCountEl = document.getElementById('histStatCount');
        const statAmountEl = document.getElementById('histStatAmount');
        if (statCountEl) statCountEl.textContent = orderItems.length;
        if (statAmountEl) statAmountEl.textContent = totalAmount.toLocaleString('vi-VN') + 'đ';
        if (statsEl) statsEl.style.display = 'flex';
        if (toolbarEl) toolbarEl.style.display = 'flex';

        // Reset bộ lọc/ô tìm kiếm mỗi lần tải lại danh sách
        fullHistoryActiveType = '';
        const filtersEl = document.getElementById('histFilters');
        if (filtersEl) filtersEl.querySelectorAll('.hist-filter-chip').forEach(b => b.classList.toggle('active', !b.dataset.histtype));
        const searchEl = document.getElementById('histSearchInput');
        if (searchEl) searchEl.value = '';

        renderFullHistoryList();
    }

    // ---------------- MENU ĐIỀU HƯỚNG — ẩn/hiện + sắp xếp thứ tự tab, quản lý ở trang admin (site_settings) ----------------
    const NAV_TABS_DEFAULT = [
        { key:'home',    label:'Trang chủ',   icon:'fa-solid fa-house' },
        { key:'support', label:'Hỗ trợ',      icon:'fa-solid fa-headset' },
        { key:'doc',     label:'Tài liệu',    icon:'fa-solid fa-folder-open' },
        { key:'quiz',    label:'Trắc nghiệm', icon:'fa-solid fa-list-check' },
        { key:'tool',    label:'Công cụ',     icon:'fa-solid fa-toolbox' },
        { key:'product', label:'Sản phẩm',    icon:'fa-solid fa-bag-shopping' },
        { key:'account', label:'Tài khoản', icon:'fa-solid fa-crown' },
        { key:'history', label:'Lịch sử mua hàng', icon:'fa-solid fa-receipt' }
    ];

    async function loadNavTabsConfig(){
        const payload = await fetchSiteSettingPayload('nav_tabs', null);
        if (!payload || !Array.isArray(payload.tabs) || !payload.tabs.length) return NAV_TABS_DEFAULT.map(t => Object.assign({ visible:true }, t));
        const saved = payload.tabs;
        const merged = saved
            .filter(t => NAV_TABS_DEFAULT.some(d => d.key === t.key))
            .map(t => {
                const def = NAV_TABS_DEFAULT.find(d => d.key === t.key);
                return { key:t.key, label:t.label || def.label, icon:def.icon, visible: t.visible !== false };
            });
        NAV_TABS_DEFAULT.forEach(d => { if (!merged.some(t => t.key === d.key)) merged.push(Object.assign({ visible:true }, d)); });
        return merged;
    }

    // Menu di động (drawer): mở bằng nút hamburger trên topbar, đóng bằng nút X ảo (backdrop) hoặc khi chọn 1 tab
    function openMobileMenu(){
        document.querySelector('.sidebar')?.classList.add('mobile-open');
        document.getElementById('sidebarBackdrop')?.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
    function closeMobileMenu(){
        document.querySelector('.sidebar')?.classList.remove('mobile-open');
        document.getElementById('sidebarBackdrop')?.classList.remove('show');
        document.body.style.overflow = '';
    }
    (function initMobileMenu(){
        const menuBtn = document.getElementById('mobileMenuBtn');
        const backdrop = document.getElementById('sidebarBackdrop');
        if (menuBtn) menuBtn.addEventListener('click', openMobileMenu);
        if (backdrop) backdrop.addEventListener('click', closeMobileMenu);
        const logoLink = document.querySelector('.side-logo');
        if (logoLink) logoLink.addEventListener('click', closeMobileMenu);
        window.addEventListener('resize', ()=>{ if (window.innerWidth > 860) closeMobileMenu(); });
    })();

    // Thu gọn / mở rộng sidebar (chỉ còn icon) — trạng thái được nhớ qua localStorage
    function initSideCollapseBtn(){
        const btn = document.getElementById('sideCollapseBtn');
        const sidebar = document.querySelector('.sidebar');
        if (!btn || !sidebar) return;

        const applyState = (collapsed) => {
            sidebar.classList.toggle('collapsed', collapsed);
            btn.setAttribute('aria-label', collapsed ? 'Mở rộng menu' : 'Thu gọn menu');
        };

        let collapsed = false;
        try{ collapsed = localStorage.getItem('sng-sidebar-collapsed') === '1'; }catch(e){}
        applyState(collapsed);

        btn.addEventListener('click', () => {
            collapsed = !collapsed;
            applyState(collapsed);
            try{ localStorage.setItem('sng-sidebar-collapsed', collapsed ? '1' : '0'); }catch(e){}
        });
    }

    function renderSideNav(tabsConfig){
        let visible = tabsConfig.filter(t => t.visible);
        if (!visible.length) visible = [Object.assign({ visible:true }, NAV_TABS_DEFAULT[0])]; // an toàn: không để menu trống hoàn toàn
        const nav = document.getElementById('sideNav');
        const linksHtml = visible.map((t,i) => `<a class="side-link${i===0 ? ' active' : ''}" href="#" data-tab="${t.key}" title="${escapeHtmlHome(t.label)}"><i class="${t.icon}"></i><span class="lbl">${escapeHtmlHome(t.label)}</span></a>`).join('');
        const collapseHtml = `<div class="side-collapse-wrap"><button type="button" class="side-collapse-btn" id="sideCollapseBtn" title="Thu gọn / mở rộng menu" aria-label="Thu gọn / mở rộng menu"><i class="fa-solid fa-angles-left"></i></button></div>`;
        nav.innerHTML = linksHtml + collapseHtml;
        initSideCollapseBtn();
        return visible;
    }

    // ---------------- TRUY CẬP NHANH — hoàn toàn động, quản lý (thêm/sửa/xóa/đổi tên/sắp xếp) ở trang admin ----------------
    const QL_COLOR_MAP = {
        indigo: { bg:'var(--brand-bg)', fg:'var(--brand)' },
        purple: { bg:'#f1ecff',         fg:'var(--brand2)' },
        green:  { bg:'var(--green-bg)', fg:'var(--green)' },
        amber:  { bg:'var(--amber-bg)', fg:'var(--amber)' },
        blue:   { bg:'#e8f3ff',         fg:'#0068ff' },
        red:    { bg:'#fde8e8',         fg:'#dc2626' }
    };
    const QL_KNOWN_TABS = ['home', 'doc', 'quiz', 'tool', 'product', 'account', 'history', 'support'];

    function quickTileHtml(q){
        const style = QL_COLOR_MAP[q.color] || QL_COLOR_MAP.indigo;
        const isTab = QL_KNOWN_TABS.includes(q.link);
        return `
            <div class="quick-tile" data-ql-id="${escapeHtmlHome(q.id)}" ${isTab ? `data-go="${q.link}"` : `data-href="${escapeHtmlHome(q.link || '#')}"`}>
                <div class="q-icon" style="background:${style.bg}; color:${style.fg}"><i class="${escapeHtmlHome(q.icon || 'fa-solid fa-star')}"></i></div>
                <div><div class="q-title">${escapeHtmlHome(q.title)}</div><div class="q-sub">${escapeHtmlHome(q.subtitle || '')}</div></div>
                <i class="fa-solid fa-arrow-right q-arrow"></i>
            </div>`;
    }

    async function renderQuickGrid(){
        const grid = document.getElementById('quickGrid');
        const { data: links, error } = await sb.from('quick_links').select('*').order('order_no', { ascending: true, nullsFirst: false }).order('id');

        if (error){
            grid.innerHTML = `<div class="empty-state small"><div class="empty-title">Không tải được Truy cập nhanh</div><div class="empty-sub">${escapeHtmlHome(error.message)}</div></div>`;
            return;
        }
        if (!links || !links.length){
            grid.innerHTML = `<div class="empty-state small"><div class="empty-title">Chưa có thẻ nào</div><div class="empty-sub">Vào trang admin &gt; Truy cập nhanh để thêm thẻ đầu tiên.</div></div>`;
            return;
        }

        grid.innerHTML = links.map(quickTileHtml).join('');
        // Số thẻ <=4 -> chia đều lấp đầy 1 hàng (khớp đúng số lượng); từ 5 thẻ trở lên -> dùng lưới 5 cột mặc định,
        // dư ra tự xuống hàng tiếp theo. Xem CSS ".quick-grid[data-count]" ở @media (min-width:1021px).
        if (links.length < 5) grid.dataset.count = String(links.length);
        else grid.removeAttribute('data-count');

        // Thẻ trỏ tới 1 tab có sẵn (home/doc/quiz/tool/product/support) -> chuyển tab như menu bên trái
        grid.querySelectorAll('[data-go]').forEach(el=>{
            el.addEventListener('click', (e)=>{ e.preventDefault(); goTab(el.dataset.go); });
        });
        // Thẻ trỏ tới đường dẫn tùy ý (URL khác hoặc file .html khác) -> điều hướng thẳng tới đó
        grid.querySelectorAll('[data-href]').forEach(el=>{
            el.addEventListener('click', ()=>{
                const href = el.dataset.href;
                if (href && href !== '#') window.location.href = href;
            });
        });
    }
    renderQuickGrid();
    renderToolContent();
    loadPurchasedProductIds().then(renderProductContent);
    renderSupportContent();
    renderProContent();
    proFeaturesConfigPromise = loadProUpgradeFeaturesConfig();
    loadPromoBanner();
    loadAnnouncementPopup();

    const panels = { home:'panel-home', quiz:'panel-quiz', doc:'panel-doc', tool:'panel-tool', product:'panel-product', account:'panel-account', history:'panel-history', support:'panel-support' };
    const TAB_TITLES = {
        home:    ['Trang chủ', ''],
        quiz:    ['Trắc nghiệm', ''],
        doc:     ['Tài liệu', ''],
        tool:    ['Công cụ', ''],
        product: ['Sản phẩm', ''],
        account: ['Tài khoản', ''],
        history: ['Lịch sử mua hàng', ''],
        support: ['Hỗ trợ', '']
    };
    const topbarTitle = document.querySelector('.topbar-title');

    function goTab(key, opts){
        opts = opts || {};
        if (!panels[key]) key = 'home';

        if (GATED_TABS.includes(key) && !currentSession){
            location.href = loginUrl(key);
            return;
        }

        currentTabKey = key;
        Object.values(panels).forEach(id => document.getElementById(id).style.display = 'none');
        document.getElementById(panels[key]).style.display = '';
        if (key === 'account') refreshSessionAndRenderAccount();
        if (key === 'history') loadFullPurchaseHistory();
        document.querySelectorAll('.side-link[data-tab]').forEach(el => el.classList.toggle('active', el.dataset.tab === key));
        const [t, sub] = TAB_TITLES[key] || [key, ''];
        topbarTitle.innerHTML = t + '<span>' + sub + '</span>';
        window.scrollTo({top:0, behavior:'smooth'});

        // Ghi nhận lượt truy cập mục này (Thống kê > Lượt truy cập trong trang admin)
        if (window.sngTrackVisit) window.sngTrackVisit(key, t);

        if(!opts.fromPopState){
            const url = key === 'home' ? location.pathname : location.pathname + '#' + key;
            history.pushState({ tab: key }, '', url);
        }
    }

    document.querySelectorAll('[data-go]').forEach(el=>{
        el.addEventListener('click', (e)=>{
            e.preventDefault();
            goTab(el.dataset.go);
            // "Xem tất cả" từ khối Tài liệu miễn phí/trả phí nổi bật -> mở đúng bộ lọc tương ứng trong tab Tài liệu
            const docFilter = el.dataset.docFilter;
            if (docFilter){
                const pill = document.querySelector(`.filter-pill[data-filter="${docFilter}"]`);
                if (pill) pill.click();
            }
        });
    });

    // Bấm nút "Quay lại" của trình duyệt sẽ chuyển tab thay vì thoát hẳn trang
    window.addEventListener('popstate', e=>{
        const key = (e.state && e.state.tab) || 'home';
        goTab(key, { fromPopState:true });
    });

    // ---------------- Dựng menu điều hướng theo cấu hình admin (ẩn/hiện + thứ tự), rồi khởi tạo tab ban đầu ----------------
    // Nếu vừa quay về từ trang thanh toán SePay -> làm mới session để lấy user_metadata mới nhất
    (async function handlePaymentReturn(){
        const params = new URLSearchParams(location.search);
        const paymentStatus = params.get('payment');
        if (!paymentStatus) return;

        const inv = params.get('inv') || '';
        const isDocOrder = inv.startsWith('DOC-');
        const isProductOrder = inv.startsWith('PRD-');
        const isTopupOrder = inv.startsWith('TOP-');

        // Xoá query param khỏi URL cho gọn, không ảnh hưởng logic bên dưới
        history.replaceState({}, '', location.pathname + location.hash);

        if (paymentStatus === 'success') {
            // IPN của SePay có thể xử lý chậm hơn vài giây so với lúc redirect về,
            // nên thử làm mới vài lần trong lúc chờ.
            let latestUser = null;
            for (let i = 0; i < 5; i++) {
                await sb.auth.refreshSession();
                const { data: { user } } = await sb.auth.getUser();
                latestUser = user || null;
                if (isDocOrder) {
                    await loadPurchasedDocIds();
                    if (purchasedDocIds.size) break; // tối thiểu đã có 1 tài liệu -> IPN chắc chắn đã xử lý xong
                } else if (isProductOrder) {
                    await loadPurchasedProductIds();
                    if (purchasedProductIds.size) break; // tối thiểu đã có 1 sản phẩm -> IPN chắc chắn đã xử lý xong
                } else if (isTopupOrder) {
                    const { data: order } = await sb.from('sepay_orders').select('status').eq('invoice_number', inv).maybeSingle();
                    if (order && order.status === 'paid') break; // IPN đã cộng tiền vào ví xong
                } else if (user?.user_metadata?.plan === 'premium') {
                    break;
                }
                await new Promise(r => setTimeout(r, 2000));
            }
            renderDocContent();
            if (isProductOrder) renderProductContent();
            if (isTopupOrder && latestUser) loadAndRenderBalance(latestUser.id, 'accBalanceRow', 'accBalanceValue');
            showSiteToast({
                title: isTopupOrder ? 'Nạp tiền thành công' : (isDocOrder || isProductOrder) ? 'Thanh toán thành công' : 'Nâng cấp thành công',
                message: isTopupOrder
                    ? 'Số dư ví đã được cộng, bạn có thể dùng để thanh toán ngay.'
                    : isDocOrder
                        ? 'Tài liệu đã được mở khoá, có thể tải ngay.'
                        : isProductOrder
                            ? 'Sản phẩm đã được mở khoá, có thể mở/tải ngay.'
                            : 'Tài khoản của bạn đã được nâng cấp lên Pro.',
                type: (isTopupOrder || isDocOrder || isProductOrder) ? 'success' : 'pro',
                icon: isTopupOrder ? 'fa-wallet' : (isDocOrder || isProductOrder) ? 'fa-file-circle-check' : 'fa-crown',
            });
            // Đánh dấu đã thông báo cho lần nâng cấp Pro này, để checkProUpgradeNotice() không hiện lại lần nữa.
            if (!isDocOrder && !isProductOrder && !isTopupOrder && latestUser){
                markProNoticeSeen(latestUser.id, latestUser.user_metadata || {});
            }
        } else if (paymentStatus === 'error' || paymentStatus === 'cancel') {
            showSiteToast({
                title: 'Giao dịch chưa hoàn tất',
                message: 'Vui lòng thử lại.',
                type: 'error',
                icon: 'fa-triangle-exclamation',
            });
        }
    })();

    (async function initSideNav(){
        const { data: { session } } = await sb.auth.getSession();
        currentSession = session;
        updateAccountUI();
        loadPaymentSettings();

        // ---------------- Vừa bị chặn vì hết lượt làm trắc nghiệm miễn phí (?openPro=1) -> tự mở bảng nâng cấp Pro ----------------
        const initParams = new URLSearchParams(location.search);
        if (initParams.get('openPro') === '1'){
            history.replaceState({}, '', location.pathname + location.hash);
            if (currentSession) openProUpgradeModal();
            else location.href = loginUrl('home');
        }

        const sideUserEl = document.querySelector('.side-user');
        const topAvatarEl = document.querySelector('.avatar-btn');
        if (sideUserEl) sideUserEl.style.cursor = 'pointer';
        if (topAvatarEl) topAvatarEl.style.cursor = 'pointer';
        if (sideUserEl) sideUserEl.addEventListener('click', ()=>{ handleAccountClick(); closeMobileMenu(); });
        if (topAvatarEl) topAvatarEl.addEventListener('click', handleAccountClick);

        // sb.auth.onAuthStateChange tự bắn 1 lần ngay khi đăng ký (event 'INITIAL_SESSION'),
        // trùng với lệnh loadPurchasedDocIds() + renderDocContent() gọi thủ công ngay bên dưới.
        // Nếu không chặn, cứ mỗi lần tải/tải lại trang chủ sẽ có 2 lệnh render tài liệu chạy song song,
        // đôi khi lệnh chạy sau "đè" lên kết quả của lệnh chạy trước ngay giữa chừng -> flash sai layout/giao diện.
        let authListenerFiredOnce = false;
        sb.auth.onAuthStateChange((_event, session) => {
            if (!authListenerFiredOnce){ authListenerFiredOnce = true; return; }
            currentSession = session;
            updateAccountUI();
            renderAccountPanelInfo();
            loadPurchasedDocIds().then(renderDocContent);
            loadPurchasedProductIds().then(renderProductContent);
            checkProUpgradeNotice();
        });

        await loadPurchasedDocIds();
        renderDocContent();
        // Thông báo nổi "Tài khoản Pro đang hoạt động" — chỉ hiện 1 lần duy nhất mỗi khi tài khoản
        // vừa được nâng cấp lên Pro, dù là tự thanh toán hay được admin cộng/nâng cấp thủ công.
        checkProUpgradeNotice();

        const tabsConfig = await loadNavTabsConfig();
        tabsConfig.forEach(t => { TAB_TITLES[t.key] = [t.label, '']; });
        const visibleTabs = renderSideNav(tabsConfig);

        document.querySelectorAll('.side-link[data-tab]').forEach(el=>{
            el.addEventListener('click', e=>{ e.preventDefault(); goTab(el.dataset.tab); closeMobileMenu(); });
        });

        // Thiết lập trạng thái ban đầu trong lịch sử trình duyệt, chỉ dùng tab đang hiển thị trong menu
        const hashTab = location.hash.replace('#', '');
        const visibleKeys = visibleTabs.map(t => t.key);
        const defaultTab = visibleKeys.includes('home') ? 'home' : (visibleKeys[0] || 'home');
        const startTab = (panels[hashTab] && visibleKeys.includes(hashTab)) ? hashTab : defaultTab;

        if (GATED_TABS.includes(startTab) && !currentSession){
            location.href = loginUrl(startTab);
            return;
        }
        history.replaceState({ tab: startTab }, '', location.pathname + (startTab === 'home' ? '' : '#' + startTab));
        goTab(startTab, { fromPopState:true });
    })();

    const themeBtn = document.getElementById('themeToggle');
    themeBtn.addEventListener('click', ()=>{
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const next = isDark ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try{ localStorage.setItem('sng-theme', next); }catch(e){}
    });

    document.querySelectorAll('.filter-pill').forEach(pill=>{
        pill.addEventListener('click', ()=>{
            document.querySelectorAll('.filter-pill').forEach(p=>p.classList.remove('active'));
            pill.classList.add('active');
            applyDocFilter();
        });
    });
