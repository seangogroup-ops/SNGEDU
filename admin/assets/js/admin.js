const SUPABASE_URL = 'https://sakombvgdobdehbvsfjw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_gsXHbhvTTlYPyaa58FkNOQ_IylV8uEU';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let subjects = [];
let subjectQuestionCounts = {}; // { subject_id: số câu hỏi }
let chapters = [];
let currentSubject = null;   // {id, name}
let currentChapter = null;   // {chapter, label}
let editingQuestionId = null;
let editingSubjectId = null;
let editingChapterId = null;
let editingChapterOldCode = null; // mã chương gốc trước khi sửa, dùng để cascade cập nhật câu hỏi nếu đổi mã

// ---------- SIDEBAR: nhóm menu dạng accordion (Trang chủ / Nội dung / Kinh doanh / Hệ thống) ----------
const SIDE_GROUP_KEY = 'sng_admin_nav_groups';
function getSideGroupState(){
    try{
        const raw = localStorage.getItem(SIDE_GROUP_KEY);
        if (raw) return JSON.parse(raw);
    }catch(e){}
    return null;
}
function saveSideGroupState(){
    const state = {};
    document.querySelectorAll('.side-group').forEach(el => { state[el.dataset.group] = el.classList.contains('open'); });
    try{ localStorage.setItem(SIDE_GROUP_KEY, JSON.stringify(state)); }catch(e){}
}
function toggleSideGroup(key, forceOpen){
    const el = document.querySelector('.side-group[data-group="' + key + '"]');
    if (!el) return;
    const open = forceOpen !== undefined ? forceOpen : !el.classList.contains('open');
    el.classList.toggle('open', open);
    saveSideGroupState();
}
function initSideGroups(){
    const state = getSideGroupState();
    document.querySelectorAll('.side-group').forEach(el => {
        const key = el.dataset.group;
        // Chưa từng lưu trạng thái -> mặc định chỉ mở nhóm "Nội dung" (chứa màn hình mặc định "Trắc nghiệm")
        const isOpen = state ? !!state[key] : (key === 'content');
        el.classList.toggle('open', isOpen);
    });
}
function expandGroupOfActiveNavItem(){
    const active = document.querySelector('#settingsNavList .settings-item.active');
    const group = active ? active.closest('.side-group') : null;
    if (group && !group.classList.contains('open')) toggleSideGroup(group.dataset.group, true);
}
initSideGroups();

document.addEventListener('DOMContentLoaded', () => {
    const pwdInput = document.getElementById('loginPass');
    const pwdToggle = document.getElementById('loginPwdToggle');
    if (pwdToggle && pwdInput){
        pwdToggle.addEventListener('click', () => {
            const showing = pwdInput.type === 'text';
            pwdInput.type = showing ? 'password' : 'text';
            pwdToggle.setAttribute('aria-label', showing ? 'Hiện mật khẩu' : 'Ẩn mật khẩu');
        });
    }
    const emailInput = document.getElementById('loginEmail');
    [emailInput, pwdInput].forEach(el => {
        if (!el) return;
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    });
});

// ---------- MENU TRƯỢT TRÊN DI ĐỘNG (hamburger + backdrop) ----------
function openAdminMobileMenu(){
    document.getElementById('adminSidebar').classList.add('mobile-open');
    document.getElementById('adminSidebarBackdrop').classList.add('show');
    document.body.classList.add('no-scroll');
}
function closeAdminMobileMenu(){
    document.getElementById('adminSidebar').classList.remove('mobile-open');
    document.getElementById('adminSidebarBackdrop').classList.remove('show');
    document.body.classList.remove('no-scroll');
}
function setAdminTopbarTitle(text){
    const el = document.getElementById('adminTopbarTitle');
    if (el && text) el.textContent = text.trim();
}
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('adminMobileMenuBtn');
    const backdrop = document.getElementById('adminSidebarBackdrop');
    const closeBtn = document.getElementById('adminAsideCloseBtn');
    if (btn) btn.addEventListener('click', openAdminMobileMenu);
    if (backdrop) backdrop.addEventListener('click', closeAdminMobileMenu);
    if (closeBtn) closeBtn.addEventListener('click', closeAdminMobileMenu);
    // Chọn 1 mục điều hướng bất kỳ (kể cả trong nhóm "Cài đặt trang chủ") -> tự đóng menu
    // trên di động + cập nhật tiêu đề trên thanh trên cùng, không cần sửa từng onclick có sẵn.
    const navList = document.getElementById('settingsNavList');
    if (navList){
        navList.addEventListener('click', (e) => {
            const item = e.target.closest('.side-item');
            if (!item) return;
            const nameEl = item.querySelector('.name');
            if (nameEl) setAdminTopbarTitle(nameEl.textContent);
            closeAdminMobileMenu();
        });
    }
});

// ---------- AUTH ----------
// Chỉ tài khoản có profiles.role = 'admin' mới được vào trang admin.
// Lưu ý: đây là lớp chặn ở giao diện. Lớp chặn THẬT SỰ nằm ở RLS trên Supabase
// (xem file supabase-admin-setup.sql) — nếu không bật RLS, người dùng vẫn có
// thể gọi thẳng Supabase REST API bằng token của họ để sửa dữ liệu.
// truyền sẵn user (từ session đang có) để khỏi gọi getUser() thêm 1 lượt mạng nữa cho nhanh;
// không truyền thì tự lấy (dùng khi vừa signInWithPassword xong).
async function isAdminUser(knownUser){
    let user = knownUser;
    if (!user){
        const { data } = await sb.auth.getUser();
        user = data?.user;
    }
    if (!user) return false;
    const { data: profile, error } = await sb
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
    if (error || !profile) return false;
    return profile.role === 'admin';
}

// Ẩn màn loading, hiện đúng 1 màn (login hoặc dashboard) — không để lộ form login rồi mới chuyển.
function revealLoginScreen(msg){
    document.getElementById('authLoading').classList.add('hidden');
    document.getElementById('shell').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    if (msg) document.getElementById('loginMsg').innerText = msg;
}

async function doLogin(){
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPass').value;
    const msgEl = document.getElementById('loginMsg');
    msgEl.innerText = '';
    if (!email || !password){ msgEl.innerText = 'Nhập đủ email và mật khẩu.'; return; }

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error){ msgEl.innerText = 'Sai email hoặc mật khẩu.'; return; }

    const ok = await isAdminUser(data.user);
    if (!ok){
        await sb.auth.signOut();
        msgEl.innerText = 'Tài khoản này không có quyền quản trị (admin).';
        return;
    }
    showAdmin(data.user.email);
}
async function doLogout(){
    await sb.auth.signOut();
    location.reload();
}
async function checkSession(){
    const { data } = await sb.auth.getSession();
    if (!data.session){ revealLoginScreen(); return; }
    const ok = await isAdminUser(data.session.user);
    if (!ok){
        // Có phiên đăng nhập nhưng không phải admin -> đá ra khỏi trang admin
        await sb.auth.signOut();
        revealLoginScreen('Tài khoản này không có quyền quản trị (admin).');
        return;
    }
    showAdmin(data.session.user.email);
}
function showAdmin(email){
    document.getElementById('authLoading').classList.add('hidden');
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('shell').classList.remove('hidden');
    document.getElementById('userEmail').innerText = email;
    const footAvatarEl = document.getElementById('footAvatar');
    if (footAvatarEl) footAvatarEl.textContent = (email || '?').trim().charAt(0).toUpperCase();
    renderOptionForm();
    loadSubjects();
    restoreLastAdminPanel();
    expandGroupOfActiveNavItem();
    refreshFeedbackBadge();
    loadMaintenanceStatus();
}

// Chỉ cập nhật số đếm "chưa đọc" trên menu, không đụng tới danh sách/panel đang mở
async function refreshFeedbackBadge(){
    try{
        const { count, error } = await sb.from('feedback').select('id', { count:'exact', head:true }).eq('status', 'new');
        if (error) return;
        const badge = document.getElementById('fbNavBadge');
        if (!badge) return;
        if (count > 0){ badge.innerText = count; badge.classList.remove('hidden'); }
        else { badge.classList.add('hidden'); }
    }catch(e){}
}

// ---------- GHI NHỚ MÀN HÌNH ĐANG XEM — load lại trang (F5) sẽ quay về đúng màn đó thay vì luôn về "Trắc nghiệm" ----------
const ADMIN_LAST_PANEL_KEY = 'sng_admin_last_panel';
function rememberAdminPanel(key){
    try{ localStorage.setItem(ADMIN_LAST_PANEL_KEY, key); }catch(e){}
}
function restoreLastAdminPanel(){
    let last = null;
    try{ last = localStorage.getItem(ADMIN_LAST_PANEL_KEY); }catch(e){}
    if (last){
        if (last.startsWith('settings:')) return openSettingsPanel(last.slice(9));
        if (last.startsWith('content:'))  return showContentManager(last.slice(8));
        if (last === 'sepayPkg')          return showSepayPackages();
        if (last === 'accounts')          return showAccountsManager();
        if (last === 'feedback')          return showFeedbackManager();
        if (last === 'notify')            return showNotifyManager();
        if (last === 'paymentSettings')   return showPaymentSettingsPanel();
        if (last === 'emailSettings')     return showEmailSettingsPanel();
        if (last === 'usageLimits')       return showUsageLimitsPanel();
        if (last === 'generalSettings')   return showGeneralSettings();
        if (last === 'maintenance')       return showMaintenancePanel();
        if (last === 'featured')          return showFeaturedManager();
        if (last === 'subjectMgr')        return showSubjectManager();
        if (last === 'stats')             return showStatsPanel();
        if (last === 'visits')            return showVisitsPanel();
        if (last === 'stock')             return showStockManager();
    }
    showStatsPanel(); // mặc định: lần đăng nhập đầu tiên / chưa từng chọn màn nào -> luôn vào Thống kê trước
}

// ---------- CHUYỂN ĐỔI GIỮA 3 KHU VỰC CHÍNH ----------
// subjectManagerPanel: chọn/quản lý Môn học + Chương/đề (rộng rãi, khu vực chính)
// mainAppArea: soạn/xem câu hỏi của 1 chương/đề đã chọn
// settingsPanel: cài đặt trang chủ (hero + các thẻ truy cập nhanh)
const ADMIN_PANEL_IDS = ['statsPanel', 'visitsPanel', 'subjectManagerPanel', 'mainAppArea', 'settingsPanel', 'generalSettingsPanel', 'maintenancePanel', 'comingSoonPanel', 'contentManagerPanel', 'accountsPanel', 'sepayPackagesPanel', 'featuredPanel', 'usageLimitsPanel', 'feedbackPanel', 'notifyPanel', 'paymentSettingsPanel', 'emailSettingsPanel', 'stockManagerPanel'];
function showAdminPanel(panelId, navId){
    ADMIN_PANEL_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', id !== panelId);
    });
    document.querySelectorAll('#settingsNavList .settings-item').forEach(el => {
        el.classList.toggle('active', el.id === navId);
    });
}
const COMING_SOON_META = {
    doc:     { icon:'📁', title:'Tài liệu',   hint:'Quản lý mục "Tài liệu ôn thi" trên trang chủ.' },
    tool:    { icon:'🧰', title:'Công cụ',    hint:'Quản lý mục "Công cụ hỗ trợ" trên trang chủ.' },
    product: { icon:'🛍️', title:'Sản phẩm',   hint:'Quản lý mục "Sản phẩm" trên trang chủ.' },
};
function showComingSoon(key){
    showAdminPanel('comingSoonPanel', 'nav_' + key);
    const meta = COMING_SOON_META[key] || { icon:'📁', title:'', hint:'' };
    document.getElementById('comingSoonIcon').innerText = meta.icon;
    document.getElementById('comingSoonTitle').innerText = meta.title;
    document.getElementById('comingSoonHint').innerText = meta.hint;
}
function showSubjectManager(){
    rememberAdminPanel('subjectMgr');
    showAdminPanel('subjectManagerPanel', 'navSubjectMgr');
}

// ---------- THỐNG KÊ (trang đầu tiên khi vào admin) ----------
// Đọc trực tiếp bảng sepay_orders (yêu cầu RLS cho phép profiles.role='admin'
// SELECT/DELETE toàn bộ bảng này — xem migration 0002_admin_orders_stats_policy.sql).
function showStatsPanel(){
    rememberAdminPanel('stats');
    showAdminPanel('statsPanel', 'navStats');
    loadStatsData();
}

const STATS_TYPE_LABEL = { course: 'Khoá học', subscription: 'Gói thành viên', document: 'Tài liệu', product: 'Sản phẩm' };
const STATS_METHOD_LABEL = { BANK_TRANSFER: 'Chuyển khoản', CARD: 'Thẻ', NAPAS_BANK_TRANSFER: 'Napas' };
const STATS_RESET_PASSWORD = 'SNGEDU';

let statsOrdersCache = [];
let statsView = 'overview';           // 'overview' | 'day' | 'month' | 'year'
let statsDayDate = new Date();
let statsMonthDate = new Date();
let statsYear = new Date().getFullYear();

function ymd(d){
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function loadStatsData(){
    const listEl = document.getElementById('statsRecentList');
    const chartEl = document.getElementById('statsChartBox');
    listEl.innerHTML = `<div class="empty-state" style="padding:20px;">Đang tải...</div>`;
    if (chartEl) chartEl.innerHTML = `<div class="empty-state" style="padding:20px;">Đang tải...</div>`;
    const { data, error } = await sb
        .from('sepay_orders')
        .select('id, invoice_number, order_type, amount, status, payment_method, created_at, paid_at')
        .order('created_at', { ascending: false })
        .limit(5000);
    if (error){
        listEl.innerHTML = `<div class="empty-state" style="padding:20px;color:var(--red);">Không tải được dữ liệu đơn hàng: ${escapeHtml(error.message)}</div>`;
        if (chartEl) chartEl.innerHTML = '';
        return;
    }
    statsOrdersCache = data || [];
    renderStatsSummary(statsOrdersCache);
    renderStatsView();
}

// ----- 6 thẻ tổng quan + phân loại theo loại đơn hàng (không đổi theo tab đang xem) -----
function renderStatsSummary(orders){
    const now = new Date();
    const paid = orders.filter(o => o.status === 'paid');

    const totalRevenue = paid.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);

    const isSameDay = (d, ref) => d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
    const isSameMonth = (d, ref) => d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
    const todayRevenue = paid.filter(o => o.paid_at && isSameDay(new Date(o.paid_at), now)).reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
    const monthRevenue = paid.filter(o => o.paid_at && isSameMonth(new Date(o.paid_at), now)).reduce((sum, o) => sum + (Number(o.amount) || 0), 0);

    const courseOrders = paid.filter(o => o.order_type === 'course');
    const subOrders = paid.filter(o => o.order_type === 'subscription');
    const courseAmount = courseOrders.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
    const subAmount = subOrders.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);

    document.getElementById('statPaidCount').innerText = paid.length;
    document.getElementById('statTotalRevenue').innerText = fmtMoney(totalRevenue);
    document.getElementById('statTodayRevenue').innerText = fmtMoney(todayRevenue);
    document.getElementById('statMonthRevenue').innerText = fmtMoney(monthRevenue);
    document.getElementById('statCourseCount').innerText = courseOrders.length + ' đơn';
    document.getElementById('statCourseAmount').innerText = fmtMoney(courseAmount);
    document.getElementById('statSubCount').innerText = subOrders.length + ' đơn';
    document.getElementById('statSubAmount').innerText = fmtMoney(subAmount);
}

// ----- Chuyển tab Tổng quan / Theo ngày / Theo tháng / Theo năm -----
function switchStatsView(view){
    statsView = view;
    document.querySelectorAll('#statsViewTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    renderStatsView();
}

function renderStatsView(){
    const paid = statsOrdersCache.filter(o => o.status === 'paid');
    document.getElementById('statsRangeBar').innerHTML = renderStatsRangeBarHtml();
    if (statsView === 'day') renderStatsDayView(paid);
    else if (statsView === 'month') renderStatsMonthView(paid);
    else if (statsView === 'year') renderStatsYearView(paid);
    else renderStatsOverviewView(paid);
}

function renderStatsRangeBarHtml(){
    if (statsView === 'day'){
        return `<div class="stats-range-nav">
            <button type="button" class="srn-btn" onclick="statsShiftDay(-1)">‹</button>
            <input type="date" id="statsDayInput" value="${ymd(statsDayDate)}" onchange="statsDayInputChanged()">
            <button type="button" class="srn-btn" onclick="statsShiftDay(1)">›</button>
            <button type="button" class="srn-today" onclick="statsGotoToday()">Hôm nay</button>
        </div>`;
    }
    if (statsView === 'month'){
        const v = statsMonthDate.getFullYear() + '-' + String(statsMonthDate.getMonth() + 1).padStart(2, '0');
        return `<div class="stats-range-nav">
            <button type="button" class="srn-btn" onclick="statsShiftMonth(-1)">‹</button>
            <input type="month" id="statsMonthInput" value="${v}" onchange="statsMonthInputChanged()">
            <button type="button" class="srn-btn" onclick="statsShiftMonth(1)">›</button>
            <button type="button" class="srn-today" onclick="statsGotoThisMonth()">Tháng này</button>
        </div>`;
    }
    if (statsView === 'year'){
        return `<div class="stats-range-nav">
            <button type="button" class="srn-btn" onclick="statsShiftYear(-1)">‹</button>
            <input type="number" id="statsYearInput" value="${statsYear}" onchange="statsYearInputChanged()" style="width:96px;text-align:center;">
            <button type="button" class="srn-btn" onclick="statsShiftYear(1)">›</button>
            <button type="button" class="srn-today" onclick="statsGotoThisYear()">Năm nay</button>
        </div>`;
    }
    return '';
}

function statsShiftDay(delta){ statsDayDate = new Date(statsDayDate.getFullYear(), statsDayDate.getMonth(), statsDayDate.getDate() + delta); renderStatsView(); }
function statsDayInputChanged(){ const v = document.getElementById('statsDayInput').value; if (v) statsDayDate = new Date(v + 'T00:00:00'); renderStatsView(); }
function statsGotoToday(){ statsDayDate = new Date(); renderStatsView(); }

function statsShiftMonth(delta){ statsMonthDate = new Date(statsMonthDate.getFullYear(), statsMonthDate.getMonth() + delta, 1); renderStatsView(); }
function statsMonthInputChanged(){
    const v = document.getElementById('statsMonthInput').value;
    if (v){ const [y, m] = v.split('-').map(Number); statsMonthDate = new Date(y, m - 1, 1); }
    renderStatsView();
}
function statsGotoThisMonth(){ const n = new Date(); statsMonthDate = new Date(n.getFullYear(), n.getMonth(), 1); renderStatsView(); }

function statsShiftYear(delta){ statsYear += delta; renderStatsView(); }
function statsYearInputChanged(){ const v = Number(document.getElementById('statsYearInput').value); if (v) statsYear = v; renderStatsView(); }
function statsGotoThisYear(){ statsYear = new Date().getFullYear(); renderStatsView(); }

// Click vào cột biểu đồ để đi sâu hơn: năm -> tháng, tháng/tổng quan -> ngày
function jumpToDay(dateKey){ statsDayDate = new Date(dateKey + 'T00:00:00'); switchStatsView('day'); }
function jumpToMonth(monthKey){ const [y, m] = monthKey.split('-').map(Number); statsMonthDate = new Date(y, m - 1, 1); switchStatsView('month'); }

// ----- Tổng quan: doanh thu 14 ngày gần đây -----
function renderStatsOverviewView(paid){
    document.getElementById('statsListTitle').innerText = 'Đơn hàng thành công gần đây';
    document.getElementById('statsChartTitle').innerText = 'Doanh thu 14 ngày gần đây';
    const now = new Date();
    const days = [];
    for (let i = 13; i >= 0; i--){
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const key = ymd(d);
        const dayOrders = paid.filter(o => o.paid_at && ymd(new Date(o.paid_at)) === key);
        const value = dayOrders.reduce((s, o) => s + (Number(o.amount) || 0), 0);
        days.push({ key, label: d.getDate() + '/' + (d.getMonth() + 1), value, tooltip: `${d.toLocaleDateString('vi-VN')}: ${fmtMoney(value)} (${dayOrders.length} đơn)` });
    }
    const total = days.reduce((s, d) => s + d.value, 0);
    document.getElementById('statsChartTotal').innerText = fmtMoney(total);
    renderStatsBarChart('statsChartBox', days, { onBarClick: 'jumpToDay' });
    renderStatsOrderList(paid.slice(0, 20));
}

// ----- Theo ngày: doanh thu theo từng giờ trong ngày đã chọn -----
function renderStatsDayView(paid){
    const d = statsDayDate;
    const key = ymd(d);
    document.getElementById('statsListTitle').innerText = 'Giao dịch ngày ' + d.toLocaleDateString('vi-VN');
    document.getElementById('statsChartTitle').innerText = 'Doanh thu theo giờ — ' + d.toLocaleDateString('vi-VN');
    const dayOrders = paid.filter(o => o.paid_at && ymd(new Date(o.paid_at)) === key);
    const hours = [];
    for (let h = 0; h < 24; h++){
        const hourOrders = dayOrders.filter(o => new Date(o.paid_at).getHours() === h);
        const value = hourOrders.reduce((s, o) => s + (Number(o.amount) || 0), 0);
        hours.push({ key: String(h), label: h + 'h', value, tooltip: `${h}h: ${fmtMoney(value)} (${hourOrders.length} đơn)` });
    }
    const total = dayOrders.reduce((s, o) => s + (Number(o.amount) || 0), 0);
    document.getElementById('statsChartTotal').innerText = fmtMoney(total) + ' · ' + dayOrders.length + ' đơn';
    renderStatsBarChart('statsChartBox', hours, {});
    renderStatsOrderList(dayOrders);
}

// ----- Theo tháng: doanh thu theo từng ngày trong tháng đã chọn -----
function renderStatsMonthView(paid){
    const y = statsMonthDate.getFullYear(), m = statsMonthDate.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    document.getElementById('statsListTitle').innerText = 'Giao dịch tháng ' + (m + 1) + '/' + y;
    document.getElementById('statsChartTitle').innerText = 'Doanh thu theo ngày — tháng ' + (m + 1) + '/' + y;
    const monthOrders = paid.filter(o => { if (!o.paid_at) return false; const dd = new Date(o.paid_at); return dd.getFullYear() === y && dd.getMonth() === m; });
    const days = [];
    for (let day = 1; day <= daysInMonth; day++){
        const dayOrders = monthOrders.filter(o => new Date(o.paid_at).getDate() === day);
        const value = dayOrders.reduce((s, o) => s + (Number(o.amount) || 0), 0);
        const key = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        days.push({ key, label: String(day), value, tooltip: `${day}/${m + 1}/${y}: ${fmtMoney(value)} (${dayOrders.length} đơn)` });
    }
    const total = monthOrders.reduce((s, o) => s + (Number(o.amount) || 0), 0);
    document.getElementById('statsChartTotal').innerText = fmtMoney(total) + ' · ' + monthOrders.length + ' đơn';
    renderStatsBarChart('statsChartBox', days, { onBarClick: 'jumpToDay' });
    renderStatsOrderList(monthOrders.slice(0, 50));
}

// ----- Theo năm: doanh thu theo từng tháng trong năm đã chọn -----
function renderStatsYearView(paid){
    const y = statsYear;
    document.getElementById('statsListTitle').innerText = 'Giao dịch năm ' + y;
    document.getElementById('statsChartTitle').innerText = 'Doanh thu theo tháng — năm ' + y;
    const yearOrders = paid.filter(o => o.paid_at && new Date(o.paid_at).getFullYear() === y);
    const months = [];
    for (let m = 0; m < 12; m++){
        const mOrders = yearOrders.filter(o => new Date(o.paid_at).getMonth() === m);
        const value = mOrders.reduce((s, o) => s + (Number(o.amount) || 0), 0);
        const key = y + '-' + String(m + 1).padStart(2, '0');
        months.push({ key, label: 'T' + (m + 1), value, tooltip: `Tháng ${m + 1}/${y}: ${fmtMoney(value)} (${mOrders.length} đơn)` });
    }
    const total = yearOrders.reduce((s, o) => s + (Number(o.amount) || 0), 0);
    document.getElementById('statsChartTotal').innerText = fmtMoney(total) + ' · ' + yearOrders.length + ' đơn';
    renderStatsBarChart('statsChartBox', months, { onBarClick: 'jumpToMonth' });
    renderStatsOrderList(yearOrders.slice(0, 50));
}

// ----- Vẽ biểu đồ cột (SVG thuần, không cần thư viện ngoài) -----
function renderStatsBarChart(containerId, items, opts){
    opts = opts || {};
    const box = document.getElementById(containerId);
    if (!box) return;
    if (!items.length){
        box.innerHTML = `<div class="empty-state" style="padding:24px;">Không có dữ liệu.</div>`;
        return;
    }
    const max = Math.max.apply(null, items.map(i => i.value).concat([1]));
    const H = 176, padBottom = 24, padTop = 10;
    const colW = 40;
    const W = Math.max(items.length * colW, 320);
    const step = W / items.length;
    const barW = Math.min(26, step - 10);
    const cols = items.map((it, i) => {
        const h = max > 0 ? Math.round((it.value / max) * (H - padBottom - padTop)) : 0;
        const x = i * step + (step - barW) / 2;
        const y = H - padBottom - h;
        const clickable = opts.onBarClick ? ' clickable' : '';
        const onclick = opts.onBarClick ? ` onclick="${opts.onBarClick}('${it.key}')"` : '';
        return `<g class="bar-col${clickable}"${onclick}>
            <title>${escapeHtml(it.tooltip || it.label)}</title>
            <rect class="bar" x="${x.toFixed(1)}" y="${it.value > 0 ? y : H - padBottom - 3}" width="${barW}" height="${it.value > 0 ? Math.max(h, 2) : 3}" rx="4" style="fill:${it.value > 0 ? 'var(--accent)' : 'var(--border)'};"></rect>
            <text x="${(x + barW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" style="font-size:10px;fill:var(--gray);font-family:var(--font-body);">${escapeHtml(it.label)}</text>
        </g>`;
    }).join('');
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMid meet" style="width:100%;min-height:${H}px;display:block;">${cols}</svg>`;
}

// ----- Danh sách giao dịch (dùng chung cho mọi tab) -----
function renderStatsOrderList(list){
    const listEl = document.getElementById('statsRecentList');
    if (!list.length){
        listEl.innerHTML = `<div class="empty-state" style="padding:30px 14px;text-align:center;">Không có giao dịch nào trong khoảng thời gian này.</div>`;
        return;
    }
    listEl.innerHTML = list.map(o => {
        const typeLabel = STATS_TYPE_LABEL[o.order_type] || o.order_type || '—';
        const methodLabel = STATS_METHOD_LABEL[o.payment_method] || o.payment_method || '';
        return `
        <div class="stats-order-row">
            <span class="stats-order-ico">✅</span>
            <span class="stats-order-info">
                <span class="soi-title">${escapeHtml(o.invoice_number || o.id)}</span>
                <span class="soi-meta">${escapeHtml(typeLabel)}${methodLabel ? ' · ' + escapeHtml(methodLabel) : ''} · ${fmtDate(o.paid_at || o.created_at)}</span>
            </span>
            <span class="stats-order-amount">+${fmtMoney(o.amount)}</span>
        </div>`;
    }).join('');
}

// ============================================================
// ---------- LƯỢT TRUY CẬP (bảng page_views) ----------
// Đọc trực tiếp bảng page_views (yêu cầu RLS cho phép profiles.role='admin'
// SELECT/DELETE toàn bộ bảng này — xem migration 0006_page_views.sql).
// ============================================================
const PAGE_KEY_META = {
    home:              { icon: '🏠', label: 'Trang chủ' },
    quiz:              { icon: '📝', label: 'Trắc nghiệm' },
    doc:               { icon: '📁', label: 'Tài liệu' },
    tool:              { icon: '🧰', label: 'Công cụ' },
    product:           { icon: '🛍️', label: 'Sản phẩm' },
    account:           { icon: '👤', label: 'Tài khoản' },
    history:           { icon: '🧾', label: 'Lịch sử mua hàng' },
    support:           { icon: '🆘', label: 'Hỗ trợ' },
    'mon-hoc':         { icon: '📚', label: 'Chọn chương/đề' },
    'quiz-exam':       { icon: '🧪', label: 'Đề thi thử' },
    'quiz-tinhtoan':   { icon: '🧮', label: 'Luyện tính toán' },
    'quiz-dynamic':    { icon: '✍️', label: 'Thi trắc nghiệm' },
    'gop-y':           { icon: '💬', label: 'Gửi góp ý' },
    login:             { icon: '🔑', label: 'Đăng nhập / Đăng ký' },
    'payment-success': { icon: '✅', label: 'Thanh toán thành công' },
    'payment-error':   { icon: '⚠️', label: 'Thanh toán lỗi' },
    'payment-cancel':  { icon: '🚫', label: 'Đã huỷ thanh toán' },
};
const VISITS_RESET_PASSWORD = STATS_RESET_PASSWORD; // dùng chung mật khẩu xác nhận với reset giao dịch

let visitsCache = [];
let visitsView = 'overview';          // 'overview' | 'day' | 'month' | 'year'
let visitsDayDate = new Date();
let visitsMonthDate = new Date();
let visitsYear = new Date().getFullYear();

function showVisitsPanel(){
    rememberAdminPanel('visits');
    showAdminPanel('visitsPanel', 'navVisits');
    loadVisitsData();
}

async function loadVisitsData(){
    const listEl = document.getElementById('visitsByPageList');
    const chartEl = document.getElementById('visitsChartBox');
    listEl.innerHTML = `<div class="empty-state" style="padding:20px;">Đang tải...</div>`;
    if (chartEl) chartEl.innerHTML = `<div class="empty-state" style="padding:20px;">Đang tải...</div>`;
    const { data, error } = await sb
        .from('page_views')
        .select('id, page_key, visitor_id, ip, language, device_type, browser, country, city, created_at')
        .order('created_at', { ascending: false })
        .limit(20000);
    if (error){
        listEl.innerHTML = `<div class="empty-state" style="padding:20px;color:var(--red);">Không tải được dữ liệu truy cập: ${escapeHtml(error.message)}</div>`;
        if (chartEl) chartEl.innerHTML = '';
        return;
    }
    visitsCache = data || [];
    renderVisitsSummary(visitsCache);
    renderVisitsView();
}

// ----- Nhận diện "thiết bị": ưu tiên IP thật (ip); nếu dòng cũ/không lấy được
// IP (trước khi chạy migration 0007, hoặc lỗi header) thì dùng visitor_id
// (localStorage) làm dự phòng, để không bị đếm thiếu. -----
function deviceKeyOf(v){
    if (v.ip) return 'ip:' + v.ip;
    if (v.visitor_id) return 'vid:' + v.visitor_id;
    return null;
}
// Đếm số THIẾT BỊ khác nhau trong tập lượt xem — mỗi thiết bị chỉ tính 1 lượt
// truy cập duy nhất, dù họ xem lại/quay lại nhiều lần.
function countUniqueDevices(views){
    const set = new Set();
    views.forEach(v => { const k = deviceKeyOf(v); if (k) set.add(k); });
    return set.size;
}

// ----- 4 thẻ tổng quan (không đổi theo tab đang xem) -----
function renderVisitsSummary(views){
    const now = new Date();
    const isSameDay = (d, ref) => d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
    const isSameMonth = (d, ref) => d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
    const todayViews = views.filter(v => isSameDay(new Date(v.created_at), now));
    const monthViews = views.filter(v => isSameMonth(new Date(v.created_at), now));

    // "Tổng lượt truy cập": số thiết bị (IP) khác nhau đã từng ghé, tính suốt lịch sử.
    document.getElementById('visitTotalCount').innerText = countUniqueDevices(views).toLocaleString('vi-VN');
    // "Tổng lượt xem trang": số dòng thô (mỗi lần load 1 trang), để tham khảo mức độ hoạt động.
    document.getElementById('visitUniqueCount').innerText = views.length.toLocaleString('vi-VN');
    // "Hôm nay" / "Tháng này": số thiết bị khác nhau ghé trong khoảng đó (không cộng dồn từ tổng).
    document.getElementById('visitTodayCount').innerText = countUniqueDevices(todayViews).toLocaleString('vi-VN');
    document.getElementById('visitMonthCount').innerText = countUniqueDevices(monthViews).toLocaleString('vi-VN');
}

// ----- Chuyển tab Tổng quan / Theo ngày / Theo tháng / Theo năm -----
function switchVisitsView(view){
    visitsView = view;
    document.querySelectorAll('#visitsViewTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    renderVisitsView();
}

function renderVisitsView(){
    document.getElementById('visitsRangeBar').innerHTML = renderVisitsRangeBarHtml();
    if (visitsView === 'day') renderVisitsDayView(visitsCache);
    else if (visitsView === 'month') renderVisitsMonthView(visitsCache);
    else if (visitsView === 'year') renderVisitsYearView(visitsCache);
    else renderVisitsOverviewView(visitsCache);
}

function renderVisitsRangeBarHtml(){
    if (visitsView === 'day'){
        return `<div class="stats-range-nav">
            <button type="button" class="srn-btn" onclick="visitsShiftDay(-1)">‹</button>
            <input type="date" id="visitsDayInput" value="${ymd(visitsDayDate)}" onchange="visitsDayInputChanged()">
            <button type="button" class="srn-btn" onclick="visitsShiftDay(1)">›</button>
            <button type="button" class="srn-today" onclick="visitsGotoToday()">Hôm nay</button>
        </div>`;
    }
    if (visitsView === 'month'){
        const v = visitsMonthDate.getFullYear() + '-' + String(visitsMonthDate.getMonth() + 1).padStart(2, '0');
        return `<div class="stats-range-nav">
            <button type="button" class="srn-btn" onclick="visitsShiftMonth(-1)">‹</button>
            <input type="month" id="visitsMonthInput" value="${v}" onchange="visitsMonthInputChanged()">
            <button type="button" class="srn-btn" onclick="visitsShiftMonth(1)">›</button>
            <button type="button" class="srn-today" onclick="visitsGotoThisMonth()">Tháng này</button>
        </div>`;
    }
    if (visitsView === 'year'){
        return `<div class="stats-range-nav">
            <button type="button" class="srn-btn" onclick="visitsShiftYear(-1)">‹</button>
            <input type="number" id="visitsYearInput" value="${visitsYear}" onchange="visitsYearInputChanged()" style="width:96px;text-align:center;">
            <button type="button" class="srn-btn" onclick="visitsShiftYear(1)">›</button>
            <button type="button" class="srn-today" onclick="visitsGotoThisYear()">Năm nay</button>
        </div>`;
    }
    return '';
}

function visitsShiftDay(delta){ visitsDayDate = new Date(visitsDayDate.getFullYear(), visitsDayDate.getMonth(), visitsDayDate.getDate() + delta); renderVisitsView(); }
function visitsDayInputChanged(){ const v = document.getElementById('visitsDayInput').value; if (v) visitsDayDate = new Date(v + 'T00:00:00'); renderVisitsView(); }
function visitsGotoToday(){ visitsDayDate = new Date(); renderVisitsView(); }

function visitsShiftMonth(delta){ visitsMonthDate = new Date(visitsMonthDate.getFullYear(), visitsMonthDate.getMonth() + delta, 1); renderVisitsView(); }
function visitsMonthInputChanged(){
    const v = document.getElementById('visitsMonthInput').value;
    if (v){ const [y, m] = v.split('-').map(Number); visitsMonthDate = new Date(y, m - 1, 1); }
    renderVisitsView();
}
function visitsGotoThisMonth(){ const n = new Date(); visitsMonthDate = new Date(n.getFullYear(), n.getMonth(), 1); renderVisitsView(); }

function visitsShiftYear(delta){ visitsYear += delta; renderVisitsView(); }
function visitsYearInputChanged(){ const v = Number(document.getElementById('visitsYearInput').value); if (v) visitsYear = v; renderVisitsView(); }
function visitsGotoThisYear(){ visitsYear = new Date().getFullYear(); renderVisitsView(); }

// Click vào cột biểu đồ để đi sâu hơn: năm -> tháng, tháng/tổng quan -> ngày
function jumpToVisitsDay(dateKey){ visitsDayDate = new Date(dateKey + 'T00:00:00'); switchVisitsView('day'); }
function jumpToVisitsMonth(monthKey){ const [y, m] = monthKey.split('-').map(Number); visitsMonthDate = new Date(y, m - 1, 1); switchVisitsView('month'); }

// ----- Đếm số THIẾT BỊ khác nhau theo từng nhóm (quốc gia/thành phố/thiết bị/
// trình duyệt/ngôn ngữ) — mỗi thiết bị chỉ tính 1 lần trong nhóm đó, không phải
// đếm số lượt xem trang thô, để không bị lệch vì 1 người xem nhiều trang. -----
function countUniqueDevicesBy(views, keyFn){
    const map = {};
    views.forEach(v => {
        const k = keyFn(v);
        if (!k) return;
        const dk = deviceKeyOf(v);
        if (!dk) return;
        if (!map[k]) map[k] = new Set();
        map[k].add(dk);
    });
    const counts = {};
    Object.keys(map).forEach(k => { counts[k] = map[k].size; });
    return counts;
}
// Gộp ngôn ngữ trình duyệt (vi-VN, vi -> "Tiếng Việt"...) cho dễ đọc.
const SNG_LANG_LABELS = { vi: 'Tiếng Việt', en: 'English', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', fr: 'French', es: 'Spanish', th: 'Thai', ru: 'Russian', de: 'German', id: 'Indonesian' };
function normalizeLang(code){
    if (!code) return null;
    const base = String(code).split('-')[0].toLowerCase();
    return SNG_LANG_LABELS[base] || code;
}
// Danh sách xếp hạng (quốc gia/thành phố/trình duyệt): #thứ tự + tên + số lượng.
function renderInsightRankList(containerId, counts, opts){
    opts = opts || {};
    const el = document.getElementById(containerId);
    if (!el) return;
    const entries = Object.keys(counts).map(k => ({ label: k, val: counts[k] })).sort((a, b) => b.val - a.val);
    if (!entries.length){ el.innerHTML = '<div class="insight-empty">Chưa có dữ liệu.</div>'; return; }
    const top = entries.slice(0, opts.limit || 8);
    el.innerHTML = top.map((e, i) => `
        <div class="insight-rank-row">
            <span class="irr-idx">${i + 1}</span>
            <span class="irr-label">${escapeHtml(e.label)}</span>
            <span class="irr-val">${e.val.toLocaleString('vi-VN')}</span>
        </div>`).join('');
}
// Danh sách thanh ngang có %  (thiết bị/ngôn ngữ) — kiểu Google Analytics.
function renderInsightBarList(containerId, counts, opts){
    opts = opts || {};
    const el = document.getElementById(containerId);
    if (!el) return;
    const entries = Object.keys(counts).map(k => ({ label: k, val: counts[k] })).sort((a, b) => b.val - a.val);
    if (!entries.length){ el.innerHTML = '<div class="insight-empty">Chưa có dữ liệu.</div>'; return; }
    const top = entries.slice(0, opts.limit || 6);
    const total = top.reduce((s, e) => s + e.val, 0) || 1;
    const max = top[0].val || 1;
    el.innerHTML = top.map(e => {
        const pct = Math.round((e.val / total) * 100);
        const barPct = Math.max(3, Math.round((e.val / max) * 100));
        return `
        <div class="insight-bar-row">
            <div class="ibr-top"><span>${escapeHtml(e.label)}</span><span class="ibr-pct">${e.val.toLocaleString('vi-VN')} · ${pct}%</span></div>
            <div class="ibr-track"><div class="ibr-fill" style="width:${barPct}%;"></div></div>
        </div>`;
    }).join('');
}
// Vẽ cả 5 thẻ "insight" (quốc gia/thành phố/thiết bị/trình duyệt/ngôn ngữ)
// theo đúng tập lượt truy cập đang xem (tổng quan/ngày/tháng/năm).
function renderVisitsInsights(views){
    renderInsightRankList('visitsByCountry', countUniqueDevicesBy(views, v => v.country || null), { limit: 8 });
    renderInsightRankList('visitsByCity', countUniqueDevicesBy(views, v => v.city || null), { limit: 8 });
    renderInsightBarList('visitsByDevice', countUniqueDevicesBy(views, v => v.device_type || null), { limit: 5 });
    renderInsightRankList('visitsByBrowser', countUniqueDevicesBy(views, v => v.browser || null), { limit: 8 });
    renderInsightBarList('visitsByLanguage', countUniqueDevicesBy(views, v => normalizeLang(v.language)), { limit: 6 });
}

// ----- Tổng quan: lượt truy cập 14 ngày gần đây -----
function renderVisitsOverviewView(views){
    document.getElementById('visitsListTitle').innerText = 'Truy cập theo mục';
    document.getElementById('visitsChartTitle').innerText = 'Lượt truy cập 14 ngày gần đây';
    const now = new Date();
    const days = [];
    for (let i = 13; i >= 0; i--){
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const key = ymd(d);
        const dayViews = views.filter(v => ymd(new Date(v.created_at)) === key);
        const uniq = countUniqueDevices(dayViews);
        days.push({ key, label: d.getDate() + '/' + (d.getMonth() + 1), value: uniq, tooltip: `${d.toLocaleDateString('vi-VN')}: ${uniq} lượt (thiết bị)` });
    }
    const total = days.reduce((s, d) => s + d.value, 0);
    document.getElementById('visitsChartTotal').innerText = total.toLocaleString('vi-VN');
    renderStatsBarChart('visitsChartBox', days, { onBarClick: 'jumpToVisitsDay' });
    renderVisitsByPageList(views);
    renderVisitsInsights(views);
}

// ----- Theo ngày: lượt truy cập theo từng giờ trong ngày đã chọn -----
function renderVisitsDayView(views){
    const d = visitsDayDate;
    const key = ymd(d);
    document.getElementById('visitsListTitle').innerText = 'Truy cập theo mục — ngày ' + d.toLocaleDateString('vi-VN');
    document.getElementById('visitsChartTitle').innerText = 'Lượt truy cập theo giờ — ' + d.toLocaleDateString('vi-VN');
    const dayViews = views.filter(v => ymd(new Date(v.created_at)) === key);
    const hours = [];
    for (let h = 0; h < 24; h++){
        const hourViews = dayViews.filter(v => new Date(v.created_at).getHours() === h);
        const uniq = countUniqueDevices(hourViews);
        hours.push({ key: String(h), label: h + 'h', value: uniq, tooltip: `${h}h: ${uniq} lượt (thiết bị)` });
    }
    document.getElementById('visitsChartTotal').innerText = countUniqueDevices(dayViews).toLocaleString('vi-VN') + ' lượt';
    renderStatsBarChart('visitsChartBox', hours, {});
    renderVisitsByPageList(dayViews);
    renderVisitsInsights(dayViews);
}

// ----- Theo tháng: lượt truy cập theo từng ngày trong tháng đã chọn -----
function renderVisitsMonthView(views){
    const y = visitsMonthDate.getFullYear(), m = visitsMonthDate.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    document.getElementById('visitsListTitle').innerText = 'Truy cập theo mục — tháng ' + (m + 1) + '/' + y;
    document.getElementById('visitsChartTitle').innerText = 'Lượt truy cập theo ngày — tháng ' + (m + 1) + '/' + y;
    const monthViews = views.filter(v => { const dd = new Date(v.created_at); return dd.getFullYear() === y && dd.getMonth() === m; });
    const days = [];
    for (let day = 1; day <= daysInMonth; day++){
        const dayViews = monthViews.filter(v => new Date(v.created_at).getDate() === day);
        const key = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        const uniq = countUniqueDevices(dayViews);
        days.push({ key, label: String(day), value: uniq, tooltip: `${day}/${m + 1}/${y}: ${uniq} lượt (thiết bị)` });
    }
    document.getElementById('visitsChartTotal').innerText = countUniqueDevices(monthViews).toLocaleString('vi-VN') + ' lượt';
    renderStatsBarChart('visitsChartBox', days, { onBarClick: 'jumpToVisitsDay' });
    renderVisitsByPageList(monthViews);
    renderVisitsInsights(monthViews);
}

// ----- Theo năm: lượt truy cập theo từng tháng trong năm đã chọn -----
function renderVisitsYearView(views){
    const y = visitsYear;
    document.getElementById('visitsListTitle').innerText = 'Truy cập theo mục — năm ' + y;
    document.getElementById('visitsChartTitle').innerText = 'Lượt truy cập theo tháng — năm ' + y;
    const yearViews = views.filter(v => new Date(v.created_at).getFullYear() === y);
    const months = [];
    for (let m = 0; m < 12; m++){
        const mViews = yearViews.filter(v => new Date(v.created_at).getMonth() === m);
        const key = y + '-' + String(m + 1).padStart(2, '0');
        const uniq = countUniqueDevices(mViews);
        months.push({ key, label: 'T' + (m + 1), value: uniq, tooltip: `Tháng ${m + 1}/${y}: ${uniq} lượt (thiết bị)` });
    }
    document.getElementById('visitsChartTotal').innerText = countUniqueDevices(yearViews).toLocaleString('vi-VN') + ' lượt';
    renderStatsBarChart('visitsChartBox', months, { onBarClick: 'jumpToVisitsMonth' });
    renderVisitsByPageList(yearViews);
    renderVisitsInsights(yearViews);
}

// ----- Bảng "Truy cập theo mục": gộp theo page_key, sắp xếp giảm dần, kèm % trên tổng -----
function renderVisitsByPageList(views){
    const listEl = document.getElementById('visitsByPageList');
    if (!views.length){
        listEl.innerHTML = `<div class="empty-state" style="padding:30px 14px;text-align:center;">Không có lượt truy cập nào trong khoảng thời gian này.</div>`;
        return;
    }
    const counts = {};
    views.forEach(v => {
        const key = v.page_key || 'unknown';
        counts[key] = (counts[key] || 0) + 1;
    });
    const total = views.length;
    const rows = Object.keys(counts)
        .map(key => ({ key, count: counts[key] }))
        .sort((a, b) => b.count - a.count);
    listEl.innerHTML = rows.map(r => {
        const meta = PAGE_KEY_META[r.key] || { icon: '📄', label: r.key };
        const pct = total ? Math.round((r.count / total) * 100) : 0;
        return `
        <div class="stats-order-row">
            <span class="stats-order-ico">${meta.icon}</span>
            <span class="stats-order-info">
                <span class="soi-title">${escapeHtml(meta.label)}</span>
                <span class="soi-meta">${escapeHtml(r.key)} · ${pct}% tổng lượt xem trang</span>
            </span>
            <span class="stats-order-amount">${r.count.toLocaleString('vi-VN')} lượt</span>
        </div>`;
    }).join('');
}

// ----- Xoá toàn bộ dữ liệu lượt truy cập (chỉ xoá bảng page_views, không đụng gì khác) -----
function openResetVisitsModal(){
    document.getElementById('resetVisitsPwd').value = '';
    document.getElementById('resetVisitsErr').innerText = '';
    document.getElementById('resetVisitsOverlay').classList.remove('hidden');
    setTimeout(() => document.getElementById('resetVisitsPwd').focus(), 50);
}
function closeResetVisitsModal(){
    document.getElementById('resetVisitsOverlay').classList.add('hidden');
}
async function submitResetVisits(){
    const pwdEl = document.getElementById('resetVisitsPwd');
    const errEl = document.getElementById('resetVisitsErr');
    const pwd = pwdEl.value;
    if (!pwd){ errEl.innerText = 'Vui lòng nhập mật khẩu xác nhận.'; return; }
    if (pwd !== VISITS_RESET_PASSWORD){ errEl.innerText = 'Sai mật khẩu xác nhận.'; pwdEl.value = ''; pwdEl.focus(); return; }
    errEl.innerText = '';
    const btn = document.getElementById('resetVisitsConfirmBtn');
    btn.disabled = true;
    btn.innerText = 'Đang xoá...';
    const { error } = await sb.from('page_views').delete().not('id', 'is', null);
    btn.disabled = false;
    btn.innerText = 'Xoá toàn bộ';
    if (error){
        errEl.innerText = 'Lỗi khi xoá: ' + error.message;
        return;
    }
    closeResetVisitsModal();
    showMsg('Đã xoá toàn bộ dữ liệu lượt truy cập.', 'ok');
    loadVisitsData();
}

// ----- Reset tất cả giao dịch (chỉ xoá số liệu sepay_orders, không đụng tài khoản / Pro / tài liệu) -----
function openResetStatsModal(){
    document.getElementById('resetStatsPwd').value = '';
    document.getElementById('resetStatsErr').innerText = '';
    document.getElementById('resetStatsOverlay').classList.remove('hidden');
    setTimeout(() => document.getElementById('resetStatsPwd').focus(), 50);
}
function closeResetStatsModal(){
    document.getElementById('resetStatsOverlay').classList.add('hidden');
}
async function submitResetStats(){
    const pwdEl = document.getElementById('resetStatsPwd');
    const errEl = document.getElementById('resetStatsErr');
    const pwd = pwdEl.value;
    if (!pwd){ errEl.innerText = 'Vui lòng nhập mật khẩu xác nhận.'; return; }
    if (pwd !== STATS_RESET_PASSWORD){ errEl.innerText = 'Sai mật khẩu xác nhận.'; pwdEl.value = ''; pwdEl.focus(); return; }
    errEl.innerText = '';
    const btn = document.getElementById('resetStatsConfirmBtn');
    btn.disabled = true;
    btn.innerText = 'Đang xoá...';
    const { error } = await sb.from('sepay_orders').delete().not('id', 'is', null);
    btn.disabled = false;
    btn.innerText = 'Xoá toàn bộ';
    if (error){
        errEl.innerText = 'Lỗi khi xoá: ' + error.message;
        return;
    }
    closeResetStatsModal();
    showMsg('Đã reset toàn bộ số liệu giao dịch. Tài khoản, gói Pro và tài liệu của khách hàng không bị ảnh hưởng.', 'ok');
    loadStatsData();
}
function showQuestionsPanel(){
    showAdminPanel('mainAppArea', 'navSubjectMgr');
}
function showUsageLimitsPanel(){
    rememberAdminPanel('usageLimits');
    showAdminPanel('usageLimitsPanel', 'navUsageLimits');
    loadUsageLimits();
}
async function loadUsageLimits(){
    const msgEl = document.getElementById('ulSaveMsg');
    msgEl.innerText = '';
    const { data, error } = await sb.from('site_settings').select('*').eq('key', 'usage_limits').single();
    if (error && error.code !== 'PGRST116'){
        msgEl.style.color = '#e5484d';
        msgEl.innerText = 'Lỗi tải cấu hình: ' + error.message;
    }
    const payload = (data && data.payload) ? data.payload : {};
    document.getElementById('ulQuizPerDay').value = (payload.quiz_per_day ?? 3);
    document.getElementById('ulDocPerDay').value = (payload.doc_download_per_day ?? 2);
}
async function saveUsageLimits(){
    const msgEl = document.getElementById('ulSaveMsg');
    const quizVal = Math.max(0, parseInt(document.getElementById('ulQuizPerDay').value, 10) || 0);
    const docVal = Math.max(0, parseInt(document.getElementById('ulDocPerDay').value, 10) || 0);
    const payload = { quiz_per_day: quizVal, doc_download_per_day: docVal };

    const { error } = await sb.from('site_settings')
        .upsert({ key: 'usage_limits', payload, updated_at: new Date().toISOString() }, { onConflict: 'key' });

    if (error){
        msgEl.style.color = 'var(--red)';
        msgEl.innerText = 'Lỗi: ' + error.message;
    } else {
        msgEl.style.color = 'var(--green)';
        msgEl.innerText = '✔ Đã lưu. Giới hạn mới áp dụng ngay từ lượt tiếp theo của người dùng.';
        setTimeout(()=>{ if (msgEl.innerText.startsWith('✔')) msgEl.innerText=''; }, 4000);
    }
}

// ---------- CẤU HÌNH THANH TOÁN (site_settings key 'payment_settings') ----------
function showPaymentSettingsPanel(){
    rememberAdminPanel('paymentSettings');
    showAdminPanel('paymentSettingsPanel', 'navPaymentSettings');
    loadPaymentSettingsAdmin();
}
async function loadPaymentSettingsAdmin(){
    const msgEl = document.getElementById('paySaveMsg');
    msgEl.innerText = '';
    const { data, error } = await sb.from('site_settings').select('*').eq('key', 'payment_settings').single();
    if (error && error.code !== 'PGRST116'){
        msgEl.style.color = '#e5484d';
        msgEl.innerText = 'Lỗi tải cấu hình: ' + error.message;
    }
    const p = (data && data.payload) ? data.payload : {};
    document.getElementById('paySepayEnabled').checked = p.sepay_enabled !== false;
    document.getElementById('paySepayDisabledMsg').value = p.sepay_disabled_message || '';
    document.getElementById('payBalanceEnabled').checked = p.balance_payment_enabled !== false;
    document.getElementById('payTopupEnabled').checked = p.wallet_topup_enabled !== false;
}
async function savePaymentSettings(){
    const msgEl = document.getElementById('paySaveMsg');
    const payload = {
        sepay_enabled: document.getElementById('paySepayEnabled').checked,
        sepay_disabled_message: document.getElementById('paySepayDisabledMsg').value.trim(),
        balance_payment_enabled: document.getElementById('payBalanceEnabled').checked,
        wallet_topup_enabled: document.getElementById('payTopupEnabled').checked,
    };
    const { error } = await sb.from('site_settings')
        .upsert({ key: 'payment_settings', payload, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error){
        msgEl.style.color = 'var(--red)';
        msgEl.innerText = 'Lỗi: ' + error.message;
    } else {
        msgEl.style.color = 'var(--green)';
        msgEl.innerText = '✔ Đã lưu. Áp dụng ngay cho khách hàng ở lượt mở popup thanh toán tiếp theo.';
        setTimeout(()=>{ if (msgEl.innerText.startsWith('✔')) msgEl.innerText=''; }, 4500);
    }
}

// ---------- MINI RICH-TEXT TOOLBAR (đậm/nghiêng/gạch chân/màu chữ cho vài ô nhắn admin) ----------
let _rtLastRange = null;
function _rtFocus(id){
    const el = document.getElementById(id);
    el.focus();
    if (_rtLastRange) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(_rtLastRange);
    }
    return el;
}
function rtRemember(id){
    // Lưu lại vùng bôi đen trước khi bấm vào ô chọn màu (input[type=color] làm mất focus/selection)
    const el = document.getElementById(id);
    const sel = window.getSelection();
    if (sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
        _rtLastRange = sel.getRangeAt(0).cloneRange();
    }
}
function rtCmd(id, cmd){
    _rtFocus(id);
    document.execCommand(cmd, false, null);
}
function rtColor(id, color){
    _rtFocus(id);
    document.execCommand('foreColor', false, color);
    _rtLastRange = null;
}
function rtClear(id){
    const el = document.getElementById(id);
    el.innerText = el.innerText; // bỏ hết định dạng, giữ nguyên chữ
}
// ---------- CẤU HÌNH EMAIL (site_settings key 'email_settings') ----------
function showEmailSettingsPanel(){
    rememberAdminPanel('emailSettings');
    showAdminPanel('emailSettingsPanel', 'navEmailSettings');
    loadEmailSettings();
}
async function loadEmailSettings(){
    const msgEl = document.getElementById('emlSaveMsg');
    msgEl.innerText = '';
    const { data, error } = await sb.from('site_settings').select('*').eq('key', 'email_settings').single();
    if (error && error.code !== 'PGRST116'){
        msgEl.style.color = '#e5484d';
        msgEl.innerText = 'Lỗi tải cấu hình: ' + error.message;
    }
    const p = (data && data.payload) ? data.payload : {};
    document.getElementById('emlWelcomeEnabled').checked = p.welcome_email_enabled !== false;
    document.getElementById('emlResetCodeEnabled').checked = p.reset_code_email_enabled !== false;
    document.getElementById('emlPasswordChangedEnabled').checked = p.password_changed_email_enabled !== false;
    document.getElementById('emlRegisterSuccessMsg').innerHTML = p.register_success_text || '';
    document.getElementById('emlRegisterSpamHint').innerHTML = p.register_spam_hint_text || '';
    document.getElementById('emlForgotSpamHint').value = p.forgot_spam_hint_text || '';
}
async function saveEmailSettings(){
    const msgEl = document.getElementById('emlSaveMsg');
    const payload = {
        welcome_email_enabled: document.getElementById('emlWelcomeEnabled').checked,
        reset_code_email_enabled: document.getElementById('emlResetCodeEnabled').checked,
        password_changed_email_enabled: document.getElementById('emlPasswordChangedEnabled').checked,
        register_success_text: document.getElementById('emlRegisterSuccessMsg').innerHTML.trim(),
        register_spam_hint_text: document.getElementById('emlRegisterSpamHint').innerHTML.trim(),
        forgot_spam_hint_text: document.getElementById('emlForgotSpamHint').value.trim(),
    };
    const { error } = await sb.from('site_settings')
        .upsert({ key: 'email_settings', payload, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error){
        msgEl.style.color = 'var(--red)';
        msgEl.innerText = 'Lỗi: ' + error.message;
    } else {
        msgEl.style.color = 'var(--green)';
        msgEl.innerText = '✔ Đã lưu. Áp dụng ngay từ email tiếp theo được gửi.';
        setTimeout(()=>{ if (msgEl.innerText.startsWith('✔')) msgEl.innerText=''; }, 4500);
    }
}

// ---------- BẢO TRÌ WEBSITE (site_settings key 'site_maintenance') ----------
// Các trang thuộc "trang chủ" (index, môn học, chi tiết, trắc nghiệm, góp ý, đăng nhập)
// gắn sẵn frontend/maintenance-check.js, tự đọc key này và chuyển sang bao-tri.html khi enabled=true.
// Trang admin và lien-he.html KHÔNG gắn script đó nên luôn dùng được.
let mntCurrentPayload = { enabled: false, message: '' };
async function loadMaintenanceStatus(){
    const { data } = await sb.from('site_settings').select('payload').eq('key', 'site_maintenance').maybeSingle();
    mntCurrentPayload = (data && data.payload) || { enabled: false, message: '' };
    renderMaintenanceBadges();
}
function renderMaintenanceBadges(){
    const on = !!mntCurrentPayload.enabled;
    const navBadge = document.getElementById('mntNavBadge');
    if (navBadge) navBadge.classList.toggle('hidden', !on);
    const banner = document.getElementById('mntGlobalBanner');
    if (banner) banner.classList.toggle('hidden', !on);
}
async function showMaintenancePanel(){
    rememberAdminPanel('maintenance');
    showAdminPanel('maintenancePanel', 'navMaintenance');
    document.getElementById('mntSaveMsg').innerText = '';
    await loadMaintenanceStatus();
    document.getElementById('mntEnabledToggle').checked = !!mntCurrentPayload.enabled;
    document.getElementById('mntMessageInput').value = mntCurrentPayload.message || '';
    updateMntStatusPill(!!mntCurrentPayload.enabled);
}
function updateMntStatusPill(on){
    const pill = document.getElementById('mntStatusPill');
    pill.classList.toggle('on', on);
    pill.classList.toggle('off', !on);
    pill.innerText = on ? 'Đang bảo trì' : 'Đang hoạt động';
}
function onMntToggleChange(){
    updateMntStatusPill(document.getElementById('mntEnabledToggle').checked);
}
async function saveMaintenanceSettings(){
    const msgEl = document.getElementById('mntSaveMsg');
    const enabled = document.getElementById('mntEnabledToggle').checked;
    const message = document.getElementById('mntMessageInput').value.trim();
    const payload = { enabled, message };
    const { error } = await sb.from('site_settings')
        .upsert({ key: 'site_maintenance', payload, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error){
        msgEl.style.color = 'var(--red)';
        msgEl.innerText = 'Lỗi: ' + error.message;
        return;
    }
    mntCurrentPayload = payload;
    renderMaintenanceBadges();
    msgEl.style.color = 'var(--green)';
    msgEl.innerText = enabled ? '✔ Đã bật bảo trì. Khách vào các trang trang chủ sẽ tự chuyển sang trang bảo trì trong giây lát.' : '✔ Đã tắt bảo trì. Website hoạt động lại bình thường.';
    setTimeout(()=>{ if (msgEl.innerText.startsWith('✔')) msgEl.innerText=''; }, 5000);
}

function showGeneralSettings(){
    rememberAdminPanel('generalSettings');
    showAdminPanel('generalSettingsPanel', 'navGeneralSettings');
    const emailEl = document.getElementById('genAccountEmail');
    const sideEmailEl = document.getElementById('userEmail');
    if (emailEl && sideEmailEl) emailEl.textContent = sideEmailEl.textContent || '';
    document.getElementById('genNewPassword').value = '';
    document.getElementById('genNewPasswordConfirm').value = '';
    document.getElementById('genPassMsg').innerText = '';
    loadSupportCard();
    loadNavTabsList();
    loadProFeaturesList();
    loadAdminContact();
}

// ---------- Thẻ "Hỗ trợ" (trang chủ) — quản lý ngay trong tab Cài đặt, dùng chung bảng quick_links ----------
let supportCardId = null;
let supportCardMaxOrder = 0;
async function loadSupportCard(){
    const msgEl = document.getElementById('genSupportMsg');
    msgEl.innerText = '';
    const { data, error } = await sb.from('quick_links').select('*').order('order_no', { ascending: true, nullsFirst: false }).order('id');
    if (error){ msgEl.style.color = '#e5484d'; msgEl.innerText = 'Lỗi tải thẻ Hỗ trợ: ' + error.message; return; }
    const rows = data || [];
    supportCardMaxOrder = rows.reduce((max, q) => Math.max(max, q.order_no || 0), 0);
    const support = rows.find(q => q.link === 'support');
    supportCardId = support ? support.id : null;
    document.getElementById('genSupportIcon').value = support ? (support.icon || '') : 'fa-solid fa-headset';
    document.getElementById('genSupportTitle').value = support ? (support.title || '') : 'Hỗ trợ';
    document.getElementById('genSupportSubtitle').value = support ? (support.subtitle || '') : '';
    pickGenSupportColor(support ? (support.color || 'blue') : 'blue');
    updateGenSupportPreview();
}
function pickGenSupportColor(color){
    document.querySelectorAll('#genSupportColorRow .color-swatch').forEach(el=>{
        el.classList.toggle('selected', el.dataset.color === color);
    });
    updateGenSupportPreview();
}
function updateGenSupportPreview(){
    const icon = document.getElementById('genSupportIcon').value.trim() || 'fa-solid fa-headset';
    const title = document.getElementById('genSupportTitle').value.trim() || '—';
    const subtitle = document.getElementById('genSupportSubtitle').value.trim() || '';
    const selected = document.querySelector('#genSupportColorRow .color-swatch.selected');
    const color = selected ? selected.dataset.color : 'blue';
    document.getElementById('genSupportPreviewIco').innerHTML = `<i class="${escapeHtml(icon)}"></i>`;
    document.getElementById('genSupportPreviewIco').className = 'prev-ico color-swatch ' + color;
    document.getElementById('genSupportPreviewTitle').innerText = title;
    document.getElementById('genSupportPreviewSubtitle').innerText = subtitle;
}
['genSupportIcon','genSupportTitle','genSupportSubtitle'].forEach(id=>{
    document.addEventListener('DOMContentLoaded', () => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateGenSupportPreview);
    });
});
async function saveSupportCard(){
    const icon = document.getElementById('genSupportIcon').value.trim() || 'fa-solid fa-headset';
    const title = document.getElementById('genSupportTitle').value.trim();
    const subtitle = document.getElementById('genSupportSubtitle').value.trim();
    const selected = document.querySelector('#genSupportColorRow .color-swatch.selected');
    const color = selected ? selected.dataset.color : 'blue';
    const msgEl = document.getElementById('genSupportMsg');
    if (!title){ msgEl.style.color = '#e5484d'; msgEl.innerText = 'Nhập tiêu đề cho thẻ Hỗ trợ.'; return; }
    msgEl.style.color = '';
    msgEl.innerText = 'Đang lưu...';
    if (supportCardId){
        const { error } = await sb.from('quick_links').update({ icon, color, title, subtitle }).eq('id', supportCardId);
        if (error){ msgEl.style.color = '#e5484d'; msgEl.innerText = 'Lỗi: ' + error.message; return; }
    } else {
        const { data, error } = await sb.from('quick_links').insert({ icon, color, title, subtitle, link: 'support', order_no: supportCardMaxOrder + 1 }).select().single();
        if (error){ msgEl.style.color = '#e5484d'; msgEl.innerText = 'Lỗi: ' + error.message; return; }
        supportCardId = data.id;
    }
    msgEl.style.color = '#2f9e44';
    msgEl.innerText = '✔ Đã lưu thẻ Hỗ trợ.';
}
async function changePassword(){
    const pass = document.getElementById('genNewPassword').value;
    const confirm = document.getElementById('genNewPasswordConfirm').value;
    const msgEl = document.getElementById('genPassMsg');
    msgEl.style.color = '';
    if (!pass || pass.length < 6){ msgEl.style.color = '#e5484d'; msgEl.innerText = 'Mật khẩu mới cần tối thiểu 6 ký tự.'; return; }
    if (pass !== confirm){ msgEl.style.color = '#e5484d'; msgEl.innerText = 'Hai mật khẩu nhập không khớp.'; return; }
    msgEl.innerText = 'Đang lưu...';
    const { error } = await sb.auth.updateUser({ password: pass });
    if (error){ msgEl.style.color = '#e5484d'; msgEl.innerText = 'Lỗi: ' + error.message; return; }
    msgEl.style.color = '#2f9e44';
    msgEl.innerText = '✔ Đã đổi mật khẩu.';
    document.getElementById('genNewPassword').value = '';
    document.getElementById('genNewPasswordConfirm').value = '';
}


// ---------- SIDEBAR HELPERS ----------
function toggleForm(id){
    document.getElementById(id).classList.toggle('show');
}
const STATUS_META = {
    ready:       { label: '● Sẵn sàng',      cls: 'ready' },
    maintenance: { label: '🛠️ Bảo trì',      cls: 'maintenance' },
    pending:     { label: '○ Chưa cập nhật', cls: 'empty' },
    hidden:      { label: '🚫 Đang ẩn',       cls: 'hidden' }
};
function subjectStatusHtml(subjectId){
    const s = subjects.find(x => x.id === subjectId);
    if (!s) return '';
    const meta = STATUS_META[s.status || 'ready'] || STATUS_META.ready;
    return `<span class="status-badge ${meta.cls}">${meta.label}</span>`;
}
function updateContextBar(){
    toggleMergeButton();
    const bar = document.getElementById('contextBar');
    const switchBtn = `<button class="ctx-switch-btn" onclick="showSubjectManager()">🔁 Đổi môn / chương</button>`;
    if (!currentSubject){
        bar.innerHTML = `<span class="ctx-empty">👈 Chọn một môn học để bắt đầu</span>${switchBtn}`;
        return;
    }
    if (!currentChapter){
        bar.innerHTML = `<span><span class="ctx-label">Môn</span> <span class="ctx-value">${escapeHtml(currentSubject.name)}</span>
            ${subjectStatusHtml(currentSubject.id)}
            <span class="ctx-sep">/</span> <span class="ctx-empty">👈 Chọn một chương/đề</span></span>${switchBtn}`;
        return;
    }
    bar.innerHTML = `<span><span class="ctx-label">Môn</span> <span class="ctx-value">${escapeHtml(currentSubject.name)}</span>
        ${subjectStatusHtml(currentSubject.id)}
        <span class="ctx-sep">/</span>
        <span class="ctx-label">Chương</span> <span class="ctx-value">${escapeHtml(currentChapter.label)}</span></span>${switchBtn}`;
}

// ---------- SUBJECTS ----------
async function loadSubjects(){
    const { data, error } = await sb.from('subjects').select('*').order('order_no', { ascending: true, nullsFirst: false }).order('id');
    if (error) return showMsg('Lỗi tải môn học: ' + error.message, 'err');
    subjects = data || [];

    if (currentSubject){
        currentSubject = subjects.find(s => s.id === currentSubject.id) || null;
    }
    if (!currentSubject && subjects.length){
        currentSubject = subjects[0];
    }
    renderSubjectList();
    loadChapters();
    loadSubjectQuestionCounts();
}
async function loadSubjectQuestionCounts(){
    await Promise.all(subjects.map(async s => {
        const { count } = await sb.from('questions').select('*', { count:'exact', head:true }).eq('subject_id', s.id);
        subjectQuestionCounts[s.id] = count || 0;
    }));
    renderSubjectList();
    updateContextBar();
}
async function refreshSubjectQuestionCount(subjectId){
    const { count } = await sb.from('questions').select('*', { count:'exact', head:true }).eq('subject_id', subjectId);
    subjectQuestionCounts[subjectId] = count || 0;
    renderSubjectList();
    updateContextBar();
}
let collapsedFolders = new Set(); // các thư mục đang bị thu gọn (chỉ lưu tạm trong phiên làm việc)
function toggleFolderCollapse(folder){
    if (collapsedFolders.has(folder)) collapsedFolders.delete(folder);
    else collapsedFolders.add(folder);
    renderSubjectList();
}
function getAllFolders(){
    return [...new Set(subjects.map(s => (s.folder || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'vi'));
}
function renderFolderDropdown(){
    const dd = document.getElementById('folderSelectDropdown');
    if (!dd) return;
    const raw = document.getElementById('newSubjectFolder').value;
    const q = raw.trim().toLowerCase();
    const folders = getAllFolders();
    const matched = folders.filter(f => f.toLowerCase().includes(q));

    let html = `<div class="folder-select-option muted" onclick="pickFolder('')">🚫 Không có thư mục</div>`;
    if (matched.length){
        html += matched.map(f => `<div class="folder-select-option" onclick="pickFolder(${JSON.stringify(f)})">📁 ${escapeHtml(f)}</div>`).join('');
    } else if (!q){
        html += `<div class="folder-select-empty">Chưa có thư mục nào, gõ tên để tạo mới.</div>`;
    }
    if (q && !folders.some(f => f.toLowerCase() === q)){
        html += `<div class="folder-select-option create" onclick="pickFolder(${JSON.stringify(raw.trim())})">➕ Tạo thư mục mới "${escapeHtml(raw.trim())}"</div>`;
    }
    dd.innerHTML = html;
}
function openFolderDropdown(){
    renderFolderDropdown();
    document.getElementById('folderSelectDropdown').classList.remove('hidden');
    document.getElementById('folderSelectWrap').classList.add('open');
}
function closeFolderDropdown(){
    document.getElementById('folderSelectDropdown').classList.add('hidden');
    document.getElementById('folderSelectWrap').classList.remove('open');
}
function onFolderInput(){
    renderFolderDropdown();
    document.getElementById('folderSelectDropdown').classList.remove('hidden');
    document.getElementById('folderSelectWrap').classList.add('open');
}
function pickFolder(name){
    document.getElementById('newSubjectFolder').value = name;
    closeFolderDropdown();
}
document.addEventListener('click', (e) => {
    const wrap = document.getElementById('folderSelectWrap');
    if (wrap && !wrap.contains(e.target)) closeFolderDropdown();
});
function subjectItemHtml(s){
    const meta = STATUS_META[s.status || 'ready'] || STATUS_META.ready;
    const isActive = currentSubject && currentSubject.id === s.id;
    return `
        <div class="side-item ${isActive ? 'active' : ''}" data-id="${s.id}"
             onclick="selectSubject('${s.id}')">
            <span class="drag-handle" title="Kéo để đổi thứ tự">⋮⋮</span>
            <span class="name">${escapeHtml(s.name)}</span>
            <span class="right-cluster">
                <span class="status-dot ${meta.cls}" title="${meta.label.replace(/^[^\s]+\s/,'')}"></span>
                <span class="code">${escapeHtml(s.id)}</span>
                <span class="menu-wrap">
                    <button class="icon-edit" title="Tùy chọn" onclick="event.stopPropagation(); toggleSubjectMenu('${s.id}', this)"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle></svg></button>
                    <div class="menu-drop hidden" id="menu-${s.id}">
                        <button onclick="event.stopPropagation(); closeAllSubjectMenus(); editSubject('${s.id}')">✏️ Sửa</button>
                        <button onclick="event.stopPropagation(); closeAllSubjectMenus(); deleteSubject('${s.id}')">🗑️ Xóa</button>
                    </div>
                </span>
            </span>
        </div>`;
}
function renderSubjectList(){
    const box = document.getElementById('subjectList');
    if (!subjects.length){ box.innerHTML = `<div class="empty-state" style="padding:14px 4px;">Chưa có môn học nào.</div>`; return; }

    // Gom các môn có cùng "folder" (thư mục) vào 1 nhóm có thể thu/mở, giữ đúng thứ tự
    // thư mục xuất hiện lần đầu tiên trong danh sách. Môn không có thư mục hiển thị bình thường.
    const folderOrder = [];
    const folderMap = {};
    const rootItems = [];
    subjects.forEach(s => {
        const f = (s.folder || '').trim();
        if (!f){ rootItems.push(s); return; }
        if (!folderMap[f]){ folderMap[f] = []; folderOrder.push(f); }
        folderMap[f].push(s);
    });

    let html = '';
    folderOrder.forEach(f => {
        const items = folderMap[f];
        const collapsed = collapsedFolders.has(f);
        html += `
        <div class="folder-group">
            <div class="folder-header" onclick='toggleFolderCollapse(${JSON.stringify(f)})'>
                <span class="folder-arrow ${collapsed ? 'collapsed' : ''}">▾</span>
                <span class="folder-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg></span>
                <span class="folder-name">${escapeHtml(f)}</span>
                <span class="folder-count">${items.length}</span>
            </div>
            <div class="folder-items ${collapsed ? 'hidden' : ''}">
                ${items.map(s => subjectItemHtml(s)).join('')}
            </div>
        </div>`;
    });
    html += rootItems.map(s => subjectItemHtml(s)).join('');

    box.innerHTML = html;

    const nameEl = document.getElementById('chapCurrentSubjectName');
    if (nameEl) nameEl.textContent = currentSubject ? currentSubject.name : '';
}
async function reorderSubjects(fromId, toId){
    if (!fromId || !toId || fromId === toId) return;
    const fromIdx = subjects.findIndex(s => s.id === fromId);
    const toIdx = subjects.findIndex(s => s.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;

    const reordered = subjects.slice();
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    subjects = reordered;
    renderSubjectList(); // phản hồi ngay trên giao diện trước khi lưu

    const results = await Promise.all(
        reordered.map((s, i) => sb.from('subjects').update({ order_no: i + 1 }).eq('id', s.id))
    );
    const failed = results.find(r => r.error);
    if (failed) showMsg('Lỗi lưu thứ tự: ' + failed.error.message, 'err');

    loadSubjects();
}
function toggleSubjectMenu(id, btn){
    const menu = document.getElementById('menu-' + id);
    const wasHidden = menu.classList.contains('hidden');
    closeAllSubjectMenus();
    if (wasHidden && btn){
        const rect = btn.getBoundingClientRect();
        menu.style.top = (rect.bottom + 4) + 'px';
        menu.style.left = 'auto';
        menu.style.right = (window.innerWidth - rect.right) + 'px';
        menu.classList.remove('hidden');
    }
}
function closeAllSubjectMenus(exceptId){
    document.querySelectorAll('.menu-drop').forEach(el => {
        if (!exceptId || el.id !== 'menu-' + exceptId) el.classList.add('hidden');
    });
}
document.addEventListener('click', () => closeAllSubjectMenus());
document.getElementById('subjectList').addEventListener('scroll', () => closeAllSubjectMenus());
window.addEventListener('resize', () => closeAllSubjectMenus());
function selectSubject(id){
    showSubjectManager(); // đảm bảo luôn ở đúng màn quản lý môn/chương, không phụ thuộc currentChapter cũ
    currentSubject = subjects.find(s => s.id === id) || null;
    currentChapter = null;
    chapters = []; // tránh nháy danh sách chương của môn cũ trong lúc chờ tải dữ liệu môn mới
    renderSubjectList();
    updateContextBar();
    loadChapters();
    loadQuestions();
}
function openSubjectForm(){
    editingSubjectId = null;
    document.getElementById('subjectFormTitle').innerText = 'Thêm môn học';
    document.getElementById('newSubjectId').value = '';
    document.getElementById('newSubjectName').value = '';
    document.getElementById('newSubjectFolder').value = '';
    document.getElementById('newSubjectStatus').value = 'ready';
    document.getElementById('newSubjectShowExpl').checked = true;
    document.getElementById('newSubjectId').disabled = false;
    collapsedFolders.clear(); // luôn hiện đầy đủ danh sách môn khi đang thêm, tránh trông như bị mất danh sách
    renderSubjectList();
    document.getElementById('subjectForm').classList.add('show');
    closeFolderDropdown();
}
function closeSubjectForm(){
    editingSubjectId = null;
    document.getElementById('newSubjectId').disabled = false;
    document.getElementById('subjectForm').classList.remove('show');
    closeFolderDropdown();
}
function editSubject(id){
    const s = subjects.find(x => x.id === id);
    if (!s) return;
    editingSubjectId = id;
    document.getElementById('subjectFormTitle').innerText = 'Sửa môn học';
    document.getElementById('newSubjectId').value = s.id;
    document.getElementById('newSubjectId').disabled = true; // mã môn không đổi vì được dùng làm khóa liên kết chương/câu hỏi
    document.getElementById('newSubjectName').value = s.name;
    document.getElementById('newSubjectFolder').value = s.folder || '';
    document.getElementById('newSubjectStatus').value = s.status || 'ready';
    document.getElementById('newSubjectShowExpl').checked = s.show_explanation !== false;
    document.getElementById('subjectForm').classList.add('show');
    document.getElementById('newSubjectName').focus();
    closeFolderDropdown();
}
async function addSubject(){
    const id = document.getElementById('newSubjectId').value.trim().toUpperCase();
    const name = document.getElementById('newSubjectName').value.trim();
    const folder = document.getElementById('newSubjectFolder').value.trim();
    const status = document.getElementById('newSubjectStatus').value;
    const showExplanation = document.getElementById('newSubjectShowExpl').checked;
    if (!id || !name) return showMsg('Nhập đủ mã môn và tên môn.', 'err');

    if (editingSubjectId){
        const { error } = await sb.from('subjects').update({ name, status, folder: folder || null, show_explanation: showExplanation }).eq('id', editingSubjectId);
        if (error) return showMsg('Lỗi cập nhật: ' + error.message, 'err');
        showMsg('Đã cập nhật môn học "' + name + '".', 'ok');
    } else {
        const maxOrder = subjects.reduce((max, s) => Math.max(max, s.order_no || 0), 0);
        const { error } = await sb.from('subjects').insert({ id, name, order_no: maxOrder + 1, status, folder: folder || null, show_explanation: showExplanation });
        if (error) return showMsg('Lỗi: ' + error.message, 'err');
        showMsg('Đã thêm môn học "' + name + '".', 'ok');
    }
    closeSubjectForm();
    loadSubjects();
}
function deleteSubject(id){
    const s = subjects.find(x => x.id === id);
    const name = s ? s.name : id;
    showConfirm(
        'Xóa môn học?',
        `Xóa môn "${name}"? Toàn bộ chương và câu hỏi bên trong môn này cũng sẽ bị xóa vĩnh viễn. Không thể hoàn tác.`,
        async () => {
            const { error } = await sb.from('subjects').delete().eq('id', id);
            if (error) return showMsg('Lỗi xóa: ' + error.message, 'err');
            if (currentSubject && currentSubject.id === id) currentSubject = null;
            showMsg('Đã xóa môn học.', 'ok');
            loadSubjects();
        }
    );
}

// ---------- QUICK LINKS (thẻ "Truy cập nhanh" ở trang chủ, bảng quick_links) ----------
let quickLinks = [];
let editingQuickLinkId = null;
const QL_TAB_LABELS = { home:'Trang chủ', doc:'Tài liệu', quiz:'Trắc nghiệm', tool:'Công cụ', product:'Sản phẩm', support:'Hỗ trợ' };

async function loadQuickLinks(){
    const { data, error } = await sb.from('quick_links').select('*').order('order_no', { ascending: true, nullsFirst: false }).order('id');
    if (error) return showMsg('Lỗi tải Truy cập nhanh: ' + error.message, 'err');
    quickLinks = data || [];
    renderQuickLinkList();
}
function quickLinkItemHtml(q){
    return `
        <div class="side-item" data-id="${q.id}">
            <span class="drag-handle" title="Kéo để đổi thứ tự">⋮⋮</span>
            <span class="prev-ico color-swatch ${q.color || 'indigo'}" style="width:26px;height:26px;min-width:26px;font-size:.72rem;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;color:#fff;"><i class="${escapeHtml(q.icon || 'fa-solid fa-star')}"></i></span>
            <span class="name">${escapeHtml(q.title)}</span>
            <span class="right-cluster">
                <span class="menu-wrap">
                    <button class="icon-edit" title="Tùy chọn" onclick="event.stopPropagation(); toggleQuickLinkMenu('${q.id}', this)"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle></svg></button>
                    <div class="menu-drop hidden" id="qlmenu-${q.id}">
                        <button onclick="event.stopPropagation(); closeAllQuickLinkMenus(); editQuickLink('${q.id}')">✏️ Sửa</button>
                        <button onclick="event.stopPropagation(); closeAllQuickLinkMenus(); deleteQuickLink('${q.id}')">🗑️ Xóa</button>
                    </div>
                </span>
            </span>
        </div>`;
}
function renderQuickLinkList(){
    const box = document.getElementById('quickLinkList');
    if (!box) return;
    if (!quickLinks.length){ box.innerHTML = `<div class="empty-state" style="padding:14px 4px;">Chưa có thẻ nào. Bấm "+ Thêm thẻ" để tạo thẻ đầu tiên.</div>`; return; }
    box.innerHTML = quickLinks.map(q => quickLinkItemHtml(q)).join('');
}
async function reorderQuickLinks(fromId, toId){
    if (!fromId || !toId || fromId === toId) return;
    const fromIdx = quickLinks.findIndex(q => String(q.id) === String(fromId));
    const toIdx = quickLinks.findIndex(q => String(q.id) === String(toId));
    if (fromIdx < 0 || toIdx < 0) return;

    const reordered = quickLinks.slice();
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    quickLinks = reordered;
    renderQuickLinkList();

    const results = await Promise.all(
        reordered.map((q, i) => sb.from('quick_links').update({ order_no: i + 1 }).eq('id', q.id))
    );
    const failed = results.find(r => r.error);
    if (failed) showMsg('Lỗi lưu thứ tự: ' + failed.error.message, 'err');
    loadQuickLinks();
}
function toggleQuickLinkMenu(id, btn){
    const menu = document.getElementById('qlmenu-' + id);
    const wasHidden = menu.classList.contains('hidden');
    closeAllQuickLinkMenus();
    if (wasHidden && btn){
        const rect = btn.getBoundingClientRect();
        menu.style.top = (rect.bottom + 4) + 'px';
        menu.style.left = 'auto';
        menu.style.right = (window.innerWidth - rect.right) + 'px';
        menu.classList.remove('hidden');
    }
}
function closeAllQuickLinkMenus(exceptId){
    document.querySelectorAll('[id^="qlmenu-"]').forEach(el => {
        if (!exceptId || el.id !== 'qlmenu-' + exceptId) el.classList.add('hidden');
    });
}
document.addEventListener('click', () => closeAllQuickLinkMenus());

function pickQlColor(color){
    document.querySelectorAll('#qlColorRow .color-swatch').forEach(el=>{
        el.classList.toggle('selected', el.dataset.color === color);
    });
    updateQlPreview();
}
function updateQlPreview(){
    const icon = document.getElementById('qlIcon').value.trim() || 'fa-solid fa-star';
    const title = document.getElementById('qlTitle').value.trim() || '—';
    const subtitle = document.getElementById('qlSubtitle').value.trim() || '';
    const selected = document.querySelector('#qlColorRow .color-swatch.selected');
    const color = selected ? selected.dataset.color : 'indigo';

    document.getElementById('qlPreviewIco').innerHTML = `<i class="${escapeHtml(icon)}"></i>`;
    document.getElementById('qlPreviewIco').className = 'prev-ico color-swatch ' + color;
    document.getElementById('qlPreviewTitle').innerText = title;
    document.getElementById('qlPreviewSubtitle').innerText = subtitle;
}
['qlIcon','qlTitle','qlSubtitle'].forEach(id=>{
    document.addEventListener('DOMContentLoaded', () => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateQlPreview);
    });
});
document.addEventListener('DOMContentLoaded', () => {
    const sel = document.getElementById('qlLink');
    if (sel) sel.addEventListener('change', () => {
        document.getElementById('qlLinkCustom').classList.toggle('hidden', sel.value !== '__custom');
    });
});

function openQuickLinkForm(){
    editingQuickLinkId = null;
    document.getElementById('quickLinkFormTitle').innerText = 'Thêm thẻ';
    document.getElementById('qlIcon').value = '';
    document.getElementById('qlTitle').value = '';
    document.getElementById('qlSubtitle').value = '';
    document.getElementById('qlLink').value = 'quiz';
    document.getElementById('qlLinkCustom').value = '';
    document.getElementById('qlLinkCustom').classList.add('hidden');
    pickQlColor('indigo');
    updateQlPreview();
    document.getElementById('quickLinkForm').classList.add('show');
}
function closeQuickLinkForm(){
    editingQuickLinkId = null;
    const form = document.getElementById('quickLinkForm');
    if (form) form.classList.remove('show');
}
function editQuickLink(id){
    const q = quickLinks.find(x => String(x.id) === String(id));
    if (!q) return;
    editingQuickLinkId = id;
    document.getElementById('quickLinkFormTitle').innerText = 'Sửa thẻ';
    document.getElementById('qlIcon').value = q.icon || '';
    document.getElementById('qlTitle').value = q.title || '';
    document.getElementById('qlSubtitle').value = q.subtitle || '';
    if (QL_TAB_LABELS[q.link]){
        document.getElementById('qlLink').value = q.link;
        document.getElementById('qlLinkCustom').classList.add('hidden');
        document.getElementById('qlLinkCustom').value = '';
    } else {
        document.getElementById('qlLink').value = '__custom';
        document.getElementById('qlLinkCustom').classList.remove('hidden');
        document.getElementById('qlLinkCustom').value = q.link || '';
    }
    pickQlColor(q.color || 'indigo');
    updateQlPreview();
    document.getElementById('quickLinkForm').classList.add('show');
    document.getElementById('qlTitle').focus();
}
async function saveQuickLink(){
    const icon = document.getElementById('qlIcon').value.trim() || 'fa-solid fa-star';
    const title = document.getElementById('qlTitle').value.trim();
    const subtitle = document.getElementById('qlSubtitle').value.trim();
    const linkSel = document.getElementById('qlLink').value;
    const link = linkSel === '__custom' ? document.getElementById('qlLinkCustom').value.trim() : linkSel;
    const selected = document.querySelector('#qlColorRow .color-swatch.selected');
    const color = selected ? selected.dataset.color : 'indigo';
    if (!title || !link) return showMsg('Nhập đủ tiêu đề và đường dẫn.', 'err');

    if (editingQuickLinkId){
        const { error } = await sb.from('quick_links').update({ icon, color, title, subtitle, link }).eq('id', editingQuickLinkId);
        if (error) return showMsg('Lỗi cập nhật: ' + error.message, 'err');
        showMsg('Đã cập nhật thẻ "' + title + '".', 'ok');
    } else {
        const maxOrder = quickLinks.reduce((max, q) => Math.max(max, q.order_no || 0), 0);
        const { error } = await sb.from('quick_links').insert({ icon, color, title, subtitle, link, order_no: maxOrder + 1 });
        if (error) return showMsg('Lỗi: ' + error.message, 'err');
        showMsg('Đã thêm thẻ "' + title + '".', 'ok');
    }
    closeQuickLinkForm();
    loadQuickLinks();
}
function deleteQuickLink(id){
    const q = quickLinks.find(x => String(x.id) === String(id));
    const title = q ? q.title : '';
    showConfirm(
        'Xóa thẻ truy cập nhanh?',
        `Xóa thẻ "${title}"? Thẻ sẽ biến mất khỏi trang chủ ngay. Không thể hoàn tác.`,
        async () => {
            const { error } = await sb.from('quick_links').delete().eq('id', id);
            if (error) return showMsg('Lỗi xóa: ' + error.message, 'err');
            showMsg('Đã xóa thẻ.', 'ok');
            loadQuickLinks();
        }
    );
}

// ---------- CHAPTERS ----------
async function loadChapters(){
    const box = document.getElementById('chapterList');
    if (!currentSubject){ box.innerHTML = `<div class="empty-state" style="padding:14px 4px;">Chọn môn học trước.</div>`; updateContextBar(); return; }
    const { data, error } = await sb.from('chapters').select('*').eq('subject_id', currentSubject.id).order('order_no');
    if (error){ box.innerHTML = `<div style="color:var(--red);font-size:.82rem;padding:6px 4px;">Lỗi: ${escapeHtml(error.message)}</div>`; updateContextBar(); return; }
    chapters = data || [];
    renderChapterList();
    updateContextBar();
}
async function reorderChapters(fromCode, toCode){
    if (!fromCode || !toCode || fromCode === toCode) return;
    const fromIdx = chapters.findIndex(c => c.chapter === fromCode);
    const toIdx = chapters.findIndex(c => c.chapter === toCode);
    if (fromIdx < 0 || toIdx < 0) return;

    const reordered = chapters.slice();
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    chapters = reordered;
    renderChapterList(); // phản hồi ngay trên giao diện trước khi lưu

    const results = await Promise.all(
        reordered.map((c, i) => sb.from('chapters').update({ order_no: i }).eq('id', c.id))
    );
    const failed = results.find(r => r.error);
    if (failed) showMsg('Lỗi lưu thứ tự: ' + failed.error.message, 'err');

    loadChapters();
}

// ---------- CHỌN NHIỀU / XÓA HÀNG LOẠT ----------
let chapterSelectMode = false;
let selectedChapterIds = new Set();
function toggleChapterSelectMode(){
    chapterSelectMode = !chapterSelectMode;
    selectedChapterIds.clear();
    document.getElementById('chapToolbar').classList.toggle('hidden', chapterSelectMode);
    document.getElementById('chapBulkBar').classList.toggle('hidden', !chapterSelectMode);
    renderChapterList();
}
function toggleChapterChecked(id){
    if (selectedChapterIds.has(id)) selectedChapterIds.delete(id);
    else selectedChapterIds.add(id);
    renderChapterList();
}
function updateChapterBulkBar(){
    if (!chapterSelectMode) return;
    const n = selectedChapterIds.size;
    document.getElementById('chapBulkCount').textContent = `Đã chọn ${n} mục`;
    document.getElementById('chapBulkDeleteBtn').disabled = n === 0;
}
function bulkDeleteChapters(){
    const ids = Array.from(selectedChapterIds);
    if (!ids.length) return;
    const names = chapters.filter(c => ids.includes(c.id)).map(c => c.label);
    showConfirm(
        `Xóa ${ids.length} chương/đề?`,
        `Sẽ xóa ${ids.length} mục: ${names.join(', ')}. Câu hỏi bên trong sẽ KHÔNG bị xóa nhưng sẽ không còn hiển thị theo các chương này. Không thể hoàn tác.`,
        async () => {
            const { error } = await sb.from('chapters').delete().in('id', ids);
            if (error) return showMsg('Lỗi xóa: ' + error.message, 'err');
            showMsg(`Đã xóa ${ids.length} chương/đề.`, 'ok');
            if (currentChapter && ids.includes(currentChapter.id)) currentChapter = null;
            chapterSelectMode = false;
            selectedChapterIds.clear();
            document.getElementById('chapToolbar').classList.remove('hidden');
            document.getElementById('chapBulkBar').classList.add('hidden');
            loadChapters();
            loadQuestions();
        }
    );
}
function renderChapterList(){
    const box = document.getElementById('chapterList');
    if (!chapters.length){
        box.innerHTML = `<div class="empty-state" style="padding:14px 4px;">Môn này chưa có chương/đề nào.</div>`;
        updateChapterBulkBar();
        return;
    }
    box.innerHTML = chapters.map(ch => `
        <div class="side-item ${currentChapter && currentChapter.chapter===ch.chapter ? 'active' : ''} ${chapterSelectMode ? 'select-mode' : ''}"
             data-chapter="${escapeHtml(ch.chapter)}"
             onclick='${chapterSelectMode ? `toggleChapterChecked(${ch.id})` : `selectChapter(${JSON.stringify(ch.chapter)})`}'>
            ${chapterSelectMode
                ? `<input type="checkbox" class="chap-cb" onclick="event.stopPropagation()" onchange="toggleChapterChecked(${ch.id})" ${selectedChapterIds.has(ch.id) ? 'checked' : ''}>`
                : `<span class="drag-handle" title="Kéo để đổi thứ tự">⋮⋮</span>`
            }
            <span class="name">${escapeHtml(ch.label)}</span>
            <span class="right-cluster">
                <span class="code">${escapeHtml(ch.chapter)}</span>
                ${chapterSelectMode ? '' : `
                <button class="icon-edit" title="Sửa chương/đề" onclick='event.stopPropagation(); editChapter(${ch.id})'><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg></button>
                <button class="icon-x" title="Xóa chương" onclick="event.stopPropagation(); deleteChapter(${ch.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg></button>
                `}
            </span>
        </div>
    `).join('');
    updateChapterBulkBar();
}
function selectChapter(code){
    currentChapter = chapters.find(c => c.chapter === code) || null;
    document.getElementById('chapterList').querySelectorAll('.side-item').forEach(el=>{
        el.classList.toggle('active', currentChapter && el.querySelector('.code') && el.querySelector('.code').textContent === currentChapter.chapter);
    });
    updateContextBar();
    loadQuestions();
    if (currentChapter) showQuestionsPanel();
}
function openChapterForm(){
    if (!currentSubject) return showMsg('Chọn môn học trước.', 'err');
    editingChapterId = null;
    editingChapterOldCode = null;
    document.getElementById('chapterFormTitle').innerText = 'Thêm chương/đề';
    document.getElementById('newChapCode').value = '';
    document.getElementById('newChapLabel').value = '';
    document.getElementById('newChapNote').value = '';
    document.getElementById('newChapGroup').value = 'Nội dung chính';
    document.getElementById('newChapCode').disabled = false;
    document.getElementById('chapterForm').classList.add('show');
}
function closeChapterForm(){
    editingChapterId = null;
    editingChapterOldCode = null;
    document.getElementById('newChapCode').disabled = false;
    document.getElementById('chapterForm').classList.remove('show');
}
function editChapter(id){
    const ch = chapters.find(c => c.id === id);
    if (!ch) return;
    editingChapterId = id;
    editingChapterOldCode = ch.chapter;
    document.getElementById('chapterFormTitle').innerText = 'Sửa chương/đề';
    document.getElementById('newChapCode').value = ch.chapter;
    document.getElementById('newChapCode').disabled = false;
    document.getElementById('newChapLabel').value = ch.label;
    document.getElementById('newChapNote').value = ch.note || '';
    document.getElementById('newChapGroup').value = ch.group_name || 'Nội dung chính';
    document.getElementById('chapterForm').classList.add('show');
    document.getElementById('newChapLabel').focus();
}
async function addChapter(){
    if (!currentSubject) return showMsg('Chọn môn học trước.', 'err');
    const chapter = document.getElementById('newChapCode').value.trim();
    const label = document.getElementById('newChapLabel').value.trim();
    const note = document.getElementById('newChapNote').value.trim();
    const group_name = document.getElementById('newChapGroup').value;
    if (!chapter || !label) return showMsg('Nhập đủ mã chương và tên hiển thị.', 'err');

    if (editingChapterId){
        const codeChanged = editingChapterOldCode && chapter !== editingChapterOldCode;

        // Nếu người dùng đổi mã chương: kiểm tra không trùng với chương khác trong cùng môn học,
        // vì mã chương đang được dùng làm khóa liên kết câu hỏi (questions.chapter).
        if (codeChanged){
            const trung = chapters.some(c => c.id !== editingChapterId && c.chapter === chapter);
            if (trung) return showMsg(`Mã chương "${chapter}" đã tồn tại trong môn học này, hãy chọn mã khác.`, 'err');
        }

        const { error } = await sb.from('chapters').update({ chapter, label, note, group_name }).eq('id', editingChapterId);
        if (error) return showMsg('Lỗi cập nhật: ' + error.message, 'err');

        // Đổi mã chương xong -> cascade cập nhật toàn bộ câu hỏi cũ đang trỏ theo mã cũ sang mã mới,
        // để không bị "mất" câu hỏi (vì chapter là khóa liên kết, không phải id chương).
        if (codeChanged){
            const { error: qErr } = await sb.from('questions').update({ chapter })
                .eq('subject_id', currentSubject.id).eq('chapter', editingChapterOldCode);
            if (qErr){
                showMsg('Đã đổi tên chương nhưng lỗi khi cập nhật câu hỏi liên kết: ' + qErr.message, 'err');
            } else if (currentChapter && currentChapter.chapter === editingChapterOldCode){
                currentChapter = { ...currentChapter, chapter };
            }
        }

        showMsg('Đã cập nhật chương "' + label + '".', 'ok');
        closeChapterForm();
        loadChapters();
        loadQuestions();
        return;
    }

    const { data: existing } = await sb.from('chapters').select('order_no')
        .eq('subject_id', currentSubject.id).order('order_no', { ascending: false }).limit(1);
    const nextOrder = existing && existing.length ? existing[0].order_no + 1 : 0;

    const { error } = await sb.from('chapters').insert({
        subject_id: currentSubject.id, chapter, label, note, group_name, order_no: nextOrder
    });
    if (error) return showMsg('Lỗi: ' + error.message, 'err');
    showMsg('Đã thêm chương "' + label + '".', 'ok');
    closeChapterForm();
    loadChapters();
}
function deleteChapter(id){
    const ch = chapters.find(c => c.id === id);
    const label = ch ? ch.label : '';
    showConfirm(
        'Xóa chương/đề?',
        `Xóa chương "${label}"? Câu hỏi bên trong sẽ KHÔNG bị xóa nhưng sẽ không còn hiển thị theo chương này.`,
        async () => {
            const { error } = await sb.from('chapters').delete().eq('id', id);
            if (error) return showMsg('Lỗi xóa: ' + error.message, 'err');
            showMsg('Đã xóa chương.', 'ok');
            if (currentChapter && ch && ch.chapter === currentChapter.chapter) currentChapter = null;
            loadChapters();
            loadQuestions();
        }
    );
}

// ---------- TABS ----------
function switchTab(name){
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById('tab-' + name).classList.remove('hidden');
}

// ---------- QUESTIONS: LIST ----------
let currentQuestions = [];
async function loadQuestions(){
    const box = document.getElementById('qList');
    const countBadge = document.getElementById('qListCount');
    if (!currentSubject || !currentChapter){
        box.innerHTML = `<div class="empty-state">Chọn một môn học và một chương/đề ở thanh bên trái để xem câu hỏi.</div>`;
        if (countBadge) countBadge.textContent = '';
        return;
    }

    // FIX: Supabase/PostgREST chỉ trả tối đa 1000 dòng mỗi lượt gọi. Nếu 1 đề có hơn 1000 câu
    // (ví dụ do tổng hợp nhiều lần bị cộng dồn), select() không giới hạn trang sẽ bị CẮT CỨNG ở
    // 1000 dòng, khiến số câu hiển thị luôn dừng ở 1000 dù thực tế nhiều/ít hơn.
    // -> Tải theo từng trang 1000 dòng bằng .range() và nối lại cho tới khi hết dữ liệu.
    let all = [];
    let from = 0;
    const PAGE = 1000;
    while (true){
        const { data, error } = await sb.from('questions')
            .select('*').eq('subject_id', currentSubject.id).eq('chapter', currentChapter.chapter)
            .order('order_no').range(from, from + PAGE - 1);
        if (error){ box.innerHTML = `<div class="empty-state">Lỗi tải: ${escapeHtml(error.message)}</div>`; return; }
        all = all.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
    }

    refreshSubjectQuestionCount(currentSubject.id);

    currentQuestions = all;
    if (countBadge) countBadge.textContent = `${currentQuestions.length} câu`;
    if (!currentQuestions.length){ box.innerHTML = `<div class="empty-state">Chưa có câu hỏi nào trong đề này. Dùng tab "Thêm câu hỏi" hoặc "Dán nhiều câu hỏi" để bắt đầu.</div>`; return; }
    renderQuestionList();
}
function renderQuestionList(){
    const box = document.getElementById('qList');
    box.innerHTML = currentQuestions.map(q => `
        <div class="q-item" data-id="${q.id}">
            <div class="q-head"><div><span class="drag-handle" title="Kéo để đổi thứ tự">⋮⋮</span> <b class="qnum">Câu ${q.order_no}.</b> ${escapeHtml(q.content)}</div></div>
            ${q.options.map((o,i)=>`<div class="opt ${i===q.correct_idx?'correct':''}">${String.fromCharCode(65+i)}. ${escapeHtml(o)}</div>`).join('')}
            ${q.explanation ? `<div class="expl">💡 ${escapeHtml(q.explanation)}</div>` : ''}
            <div class="actions">
                <button class="btn-edit" onclick='startEdit(${JSON.stringify(q)})'>Sửa</button>
                <button class="btn-danger" onclick="deleteQuestion(${q.id})">Xóa</button>
            </div>
        </div>
    `).join('');
}
async function reorderQuestions(fromId, toId){
    if (!fromId || !toId || fromId === toId) return;
    const fromIdx = currentQuestions.findIndex(q => q.id === fromId);
    const toIdx = currentQuestions.findIndex(q => q.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;

    const reordered = currentQuestions.slice();
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    reordered.forEach((q, i) => { q.order_no = i + 1; }); // cập nhật ngay để hiển thị số đúng
    currentQuestions = reordered;
    renderQuestionList(); // phản hồi ngay trên giao diện trước khi lưu

    const results = await Promise.all(
        reordered.map((q, i) => sb.from('questions').update({ order_no: i + 1 }).eq('id', q.id))
    );
    const failed = results.find(r => r.error);
    if (failed) showMsg('Lỗi lưu thứ tự: ' + failed.error.message, 'err');

    loadQuestions();
}
function deleteQuestion(id){
    showConfirm(
        'Xóa câu hỏi?',
        'Câu hỏi này sẽ bị xóa vĩnh viễn. Không thể hoàn tác.',
        async () => {
            const { error } = await sb.from('questions').delete().eq('id', id);
            if (error) return showMsg('Lỗi xóa: ' + error.message, 'err');
            showMsg('Đã xóa câu hỏi.', 'ok');
            loadQuestions();
        }
    );
}
// ---------- TỔNG HỢP CÂU HỎI (cho đề thuộc nhóm "Đề thi thử") ----------
function toggleMergeButton(){
    const btn = document.getElementById('mergeQBtn');
    if (!btn) return;
    const show = !!(currentChapter && currentChapter.group_name === 'Đề thi thử');
    btn.classList.toggle('hidden', !show);
}
async function openMergeModal(){
    if (!currentSubject || !currentChapter) return showMsg('Chọn môn học và đề thi thử ở thanh bên trái trước.', 'err');
    const sources = chapters.filter(c => c.chapter !== currentChapter.chapter);
    if (!sources.length) return showMsg('Môn học này chưa có chương nào khác để lấy câu hỏi.', 'err');

    document.getElementById('mergeTargetLabel').textContent = currentChapter.label;
    document.getElementById('mergeSourceList').innerHTML = `<div style="text-align:center;color:var(--gray);font-size:.85rem;padding:14px;">Đang tải số câu hỏi...</div>`;
    document.getElementById('mergeClearFirst').checked = false;
    document.getElementById('mergeOverlay').classList.remove('hidden');

    // FIX: trước đây lấy toàn bộ câu hỏi của cả môn học về rồi đếm ở client (select('chapter')
    // không giới hạn số dòng). Với môn học có nhiều câu hỏi, Supabase mặc định chỉ trả về tối đa
    // 1000 dòng/request nên nhiều chương bị đếm hụt/về 0 dù thực tế có câu hỏi.
    // -> Đổi sang đếm CHÍNH XÁC riêng từng chương bằng count('exact', head:true), chạy song song.
    let counts = {};
    try {
        const countResults = await Promise.all(sources.map(c =>
            sb.from('questions')
              .select('id', { count: 'exact', head: true })
              .eq('subject_id', currentSubject.id)
              .eq('chapter', c.chapter)
        ));
        sources.forEach((c, i) => {
            const r = countResults[i];
            if (r.error) throw r.error;
            counts[c.chapter] = r.count || 0;
        });
    } catch (error){
        document.getElementById('mergeSourceList').innerHTML = `<div style="color:var(--red);font-size:.85rem;padding:10px;">Lỗi tải dữ liệu: ${escapeHtml(error.message)}</div>`;
        return;
    }

    document.getElementById('mergeSourceList').innerHTML = sources.map(c => {
        const cnt = counts[c.chapter] || 0;
        const checked = c.group_name !== 'Đề thi thử' && cnt > 0;
        const disabled = cnt === 0;
        return `
        <label class="merge-src-row">
            <input type="checkbox" class="merge-src-cb" value="${escapeHtml(c.chapter)}" data-max="${cnt}"
                   ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} onchange="onMergeSrcToggle(this)">
            <span class="msr-label">${escapeHtml(c.label)} <span class="msr-group">(${escapeHtml(c.group_name || 'Nội dung chính')})</span></span>
            <input type="number" class="merge-src-qty" min="0" max="${cnt}" value="${cnt}"
                   ${(!checked || disabled) ? 'disabled' : ''} title="Số câu lấy từ chương này"
                   oninput="mergeClampQty(this)">
            <span class="msr-count">/ ${cnt} câu</span>
        </label>
    `;
    }).join('');

    mergeUpdateTotal();
}
// Giới hạn giá trị ô số lượng trong khoảng [0, số câu tối đa của chương đó]
function mergeClampQty(input){
    const max = Number(input.max) || 0;
    let v = parseInt(input.value, 10);
    if (isNaN(v) || v < 0) v = 0;
    if (v > max) v = max;
    input.value = v;
    mergeUpdateTotal();
}
// Bật/tắt ô số lượng theo trạng thái checkbox tương ứng
function onMergeSrcToggle(cb){
    const row = cb.closest('.merge-src-row');
    const qty = row.querySelector('.merge-src-qty');
    if (!qty) return;
    const max = Number(cb.dataset.max) || 0;
    qty.disabled = !cb.checked || max === 0;
    if (cb.checked && Number(qty.value) === 0 && max > 0) qty.value = max;
    mergeUpdateTotal();
}
// Chọn tất cả / bỏ chọn tất cả các chương nguồn (bỏ qua chương đã hết câu hỏi)
function mergeSetAll(state){
    document.querySelectorAll('.merge-src-cb').forEach(cb => {
        if (cb.disabled) return;
        cb.checked = state;
        const row = cb.closest('.merge-src-row');
        const qty = row.querySelector('.merge-src-qty');
        const max = Number(cb.dataset.max) || 0;
        if (qty){
            qty.disabled = !cb.checked || max === 0;
            if (cb.checked) qty.value = max;
        }
    });
    mergeUpdateTotal();
}
// Cộng tổng số câu hỏi sẽ được tổng hợp (theo các chương đang tick + số lượng đang nhập), hiển thị lên badge
function mergeUpdateTotal(){
    const badge = document.getElementById('mergeTotalBadge');
    if (!badge) return;
    let total = 0;
    document.querySelectorAll('.merge-src-cb:checked').forEach(cb => {
        const row = cb.closest('.merge-src-row');
        const qty = row ? row.querySelector('.merge-src-qty') : null;
        const v = qty ? parseInt(qty.value, 10) : 0;
        total += (isNaN(v) ? 0 : v);
    });
    badge.textContent = `Tổng: ${total} câu`;
}
function closeMergeModal(){
    document.getElementById('mergeOverlay').classList.add('hidden');
}
async function runMergeQuestions(){
    if (!currentSubject || !currentChapter) return;
    const checkedBoxes = Array.from(document.querySelectorAll('.merge-src-cb:checked'));
    if (!checkedBoxes.length) return showMsg('Chọn ít nhất 1 chương nguồn để tổng hợp.', 'err');

    // Lấy số lượng câu hỏi muốn lấy từ MỖI chương (theo ô số lượng người dùng nhập)
    const selections = checkedBoxes.map(cb => {
        const row = cb.closest('.merge-src-row');
        const qtyInput = row ? row.querySelector('.merge-src-qty') : null;
        const max = Number(cb.dataset.max) || 0;
        let qty = qtyInput ? parseInt(qtyInput.value, 10) : max;
        if (isNaN(qty) || qty < 0) qty = 0;
        if (qty > max) qty = max;
        return { chapter: cb.value, qty };
    }).filter(s => s.qty > 0);

    if (!selections.length) return showMsg('Số lượng câu hỏi cần lấy phải lớn hơn 0.', 'err');

    const btn = document.getElementById('mergeConfirmBtn');
    const oldText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Đang tổng hợp...';

    if (document.getElementById('mergeClearFirst').checked){
        const { error: delErr } = await sb.from('questions').delete()
            .eq('subject_id', currentSubject.id).eq('chapter', currentChapter.chapter);
        if (delErr){
            btn.disabled = false; btn.textContent = oldText;
            return showMsg('Lỗi xóa câu hỏi cũ: ' + delErr.message, 'err');
        }
    }

    // Lấy câu hỏi nguồn theo ĐÚNG số lượng đã chọn cho từng chương (mỗi chương 1 truy vấn riêng,
    // sắp theo order_no và limit theo số lượng để không bị dính giới hạn dòng của Supabase)
    let srcRows = [];
    try {
        const results = await Promise.all(selections.map(s =>
            sb.from('questions').select('*')
              .eq('subject_id', currentSubject.id).eq('chapter', s.chapter)
              .order('order_no').limit(s.qty)
        ));
        results.forEach(r => {
            if (r.error) throw r.error;
            srcRows.push(...(r.data || []));
        });
    } catch (srcErr){
        btn.disabled = false; btn.textContent = oldText;
        return showMsg('Lỗi tải câu hỏi nguồn: ' + srcErr.message, 'err');
    }

    if (!srcRows.length){
        btn.disabled = false; btn.textContent = oldText;
        return showMsg('Không có câu hỏi nào được lấy theo số lượng đã chọn.', 'err');
    }

    const { data: existing } = await sb.from('questions').select('order_no')
        .eq('subject_id', currentSubject.id).eq('chapter', currentChapter.chapter)
        .order('order_no', { ascending: false }).limit(1);
    let nextOrder = existing && existing.length ? existing[0].order_no + 1 : 1;

    const rowsToInsert = srcRows.map(r => ({
        subject_id: currentSubject.id,
        chapter: currentChapter.chapter,
        order_no: nextOrder++,
        content: r.content,
        options: r.options,
        correct_idx: r.correct_idx,
        explanation: r.explanation
    }));

    const { error: insErr } = await sb.from('questions').insert(rowsToInsert);
    btn.disabled = false; btn.textContent = oldText;
    if (insErr) return showMsg('Lỗi tổng hợp: ' + insErr.message, 'err');

    showMsg(`Đã tổng hợp ${rowsToInsert.length} câu hỏi vào đề "${currentChapter.label}".`, 'ok');
    closeMergeModal();
    loadQuestions();
}

function deleteAllQuestions(){
    if (!currentSubject || !currentChapter) return showMsg('Chọn môn học và chương/đề ở thanh bên trái trước.', 'err');
    const count = currentQuestions.length;
    if (!count) return showMsg('Đề này chưa có câu hỏi nào.', 'err');
    showConfirm(
        'Xóa TẤT CẢ câu hỏi trong đề này?',
        `Toàn bộ ${count} câu hỏi trong đề "${escapeHtml(currentChapter.label || currentChapter.chapter)}" sẽ bị xóa vĩnh viễn. Không thể hoàn tác. Dùng cách này trước khi dán/nạp lại để tránh bị trùng hoặc cộng dồn số thứ tự.`,
        async () => {
            const { error } = await sb.from('questions').delete()
                .eq('subject_id', currentSubject.id).eq('chapter', currentChapter.chapter);
            if (error) return showMsg('Lỗi xóa: ' + error.message, 'err');
            showMsg(`Đã xóa toàn bộ ${count} câu hỏi trong đề này.`, 'ok');
            loadQuestions();
        }
    );
}

// ---------- XUẤT FILE ----------
// Chuyển 1 danh sách câu hỏi thành văn bản đúng định dạng dùng để nạp lại (tab "Dán nhiều câu hỏi")
function questionsToText(questions){
    const letters = ['A','B','C','D'];
    return questions.map((q, i) => {
        const num = i + 1;
        const optLines = q.options.map((o, oi) => `${oi === q.correct_idx ? '*' : ''}${letters[oi]}. ${o}`).join('\n');
        const gtLine = q.explanation ? `\n\nGt: ${q.explanation}` : '';
        return `Câu ${num}: ${q.content}\n${optLines}${gtLine}`;
    }).join('\n\n');
}
function slugifyFileName(str){
    return String(str)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // bỏ dấu tiếng Việt
        .replace(/đ/gi, 'd')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'export';
}
function downloadTextFile(filename, text){
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
function exportChapterFile(){
    if (!currentSubject || !currentChapter) return showMsg('Chọn môn học và chương/đề trước.', 'err');
    if (!currentQuestions.length) return showMsg('Đề này chưa có câu hỏi nào để xuất.', 'err');
    const text = questionsToText(currentQuestions);
    const filename = `${slugifyFileName(currentSubject.id)}_${slugifyFileName(currentChapter.label)}.txt`;
    downloadTextFile(filename, text);
    showMsg(`Đã xuất ${currentQuestions.length} câu hỏi ra file "${filename}".`, 'ok');
}
async function exportSubjectFile(){
    if (!currentSubject) return showMsg('Chọn môn học trước.', 'err');
    if (!chapters.length) return showMsg('Môn này chưa có chương/đề nào.', 'err');

    const { data, error } = await sb.from('questions').select('*')
        .eq('subject_id', currentSubject.id).order('chapter').order('order_no');
    if (error) return showMsg('Lỗi tải câu hỏi: ' + error.message, 'err');
    if (!data.length) return showMsg('Môn này chưa có câu hỏi nào để xuất.', 'err');

    const chapterMap = {};
    chapters.forEach(ch => { chapterMap[ch.chapter] = ch.label; });

    const byChapter = {};
    data.forEach(q => { (byChapter[q.chapter] = byChapter[q.chapter] || []).push(q); });

    const parts = Object.keys(byChapter).map(chapCode => {
        const label = chapterMap[chapCode] || chapCode;
        return `===== ${label} =====\n\n` + questionsToText(byChapter[chapCode]);
    });

    const text = parts.join('\n\n\n');
    const filename = `${slugifyFileName(currentSubject.id)}_toanbo.txt`;
    downloadTextFile(filename, text);
    showMsg(`Đã xuất ${data.length} câu hỏi (${Object.keys(byChapter).length} chương/đề) ra file "${filename}".`, 'ok');
}

// ---------- QUESTIONS: ADD / EDIT ----------
function renderOptionForm(){
    const box = document.getElementById('optionsForm');
    box.innerHTML = [0,1,2,3].map(i => `
        <div class="opt-row">
            <span class="opt-letter">${String.fromCharCode(65+i)}</span>
            <input type="radio" name="correctOpt" value="${i}" ${i===0?'checked':''}>
            <input type="text" id="opt${i}" placeholder="Đáp án ${String.fromCharCode(65+i)}">
        </div>
    `).join('');
}
function startEdit(q){
    if (!currentSubject || currentSubject.id !== q.subject_id){
        const s = subjects.find(s=>s.id===q.subject_id);
        if (s) selectSubject(s.id);
    }
    editingQuestionId = q.id;
    document.getElementById('qOrderNo').value = q.order_no;
    document.getElementById('qContent').value = q.content;
    q.options.forEach((o,i)=>{ document.getElementById('opt'+i).value = o; });
    document.querySelector(`input[name=correctOpt][value="${q.correct_idx}"]`).checked = true;
    document.getElementById('qExplain').value = q.explanation || '';
    document.getElementById('singleFormTitle').innerText = 'Sửa câu ' + q.order_no;
    document.getElementById('singleSaveBtn').innerText = 'Cập nhật câu hỏi';
    document.getElementById('cancelEditBtn').classList.remove('hidden');
    switchTab('single');
}
function cancelEdit(){
    editingQuestionId = null;
    document.getElementById('qOrderNo').value = '';
    document.getElementById('qContent').value = '';
    [0,1,2,3].forEach(i=>document.getElementById('opt'+i).value='');
    document.querySelector('input[name=correctOpt][value="0"]').checked = true;
    document.getElementById('qExplain').value = '';
    document.getElementById('singleFormTitle').innerText = 'Thêm 1 câu hỏi';
    document.getElementById('singleSaveBtn').innerText = 'Lưu câu hỏi';
    document.getElementById('cancelEditBtn').classList.add('hidden');
}
// Tính order_no cuối cùng cho câu đang lưu, đồng thời dời order_no các câu khác
// nếu người dùng chỉ định 1 vị trí cụ thể (chèn vào giữa danh sách).
async function shiftQuestionsForPosition(subjectId, chapterCode, desiredPosRaw, excludeId){
    const { data: rows, error } = await sb.from('questions')
        .select('id, order_no')
        .eq('subject_id', subjectId).eq('chapter', chapterCode)
        .order('order_no');
    if (error) return { error };

    const others = excludeId ? rows.filter(r => r.id !== excludeId) : rows;
    const maxPos = others.length + 1;
    let pos = parseInt(desiredPosRaw);
    if (!pos || pos < 1) pos = maxPos;
    if (pos > maxPos) pos = maxPos;

    const updates = [];
    others.forEach((r, i) => {
        const newOrder = (i + 1) >= pos ? (i + 2) : (i + 1);
        if (newOrder !== r.order_no) updates.push({ id: r.id, order_no: newOrder });
    });

    if (updates.length){
        const results = await Promise.all(updates.map(u => sb.from('questions').update({ order_no: u.order_no }).eq('id', u.id)));
        const failed = results.find(r => r.error);
        if (failed) return { error: failed.error };
    }
    return { order_no: pos };
}
async function saveSingleQuestion(){
    if (!currentSubject || !currentChapter) return showMsg('Chọn môn học và chương/đề ở thanh bên trái trước.', 'err');

    const content = document.getElementById('qContent').value.trim();
    const options = [0,1,2,3].map(i => document.getElementById('opt'+i).value.trim());
    const correctIdx = parseInt(document.querySelector('input[name=correctOpt]:checked').value);
    const explanation = document.getElementById('qExplain').value.trim();
    const orderNoRaw = document.getElementById('qOrderNo').value.trim();
    if (!content || options.some(o=>!o)) return showMsg('Điền đủ nội dung và 4 đáp án.', 'err');

    if (editingQuestionId){
        const { order_no, error: shiftErr } = await shiftQuestionsForPosition(
            currentSubject.id, currentChapter.chapter, orderNoRaw, editingQuestionId
        );
        if (shiftErr) return showMsg('Lỗi sắp xếp: ' + shiftErr.message, 'err');

        const { error } = await sb.from('questions').update({
            content, options, correct_idx: correctIdx, explanation, order_no
        }).eq('id', editingQuestionId);
        if (error) return showMsg('Lỗi cập nhật: ' + error.message, 'err');
        showMsg('Đã cập nhật câu hỏi.', 'ok');
        cancelEdit();
    } else {
        const { order_no, error: shiftErr } = await shiftQuestionsForPosition(
            currentSubject.id, currentChapter.chapter, orderNoRaw, null
        );
        if (shiftErr) return showMsg('Lỗi sắp xếp: ' + shiftErr.message, 'err');

        const { error } = await sb.from('questions').insert({
            subject_id: currentSubject.id, chapter: currentChapter.chapter, order_no,
            content, options, correct_idx: correctIdx, explanation
        });
        if (error) return showMsg('Lỗi lưu: ' + error.message, 'err');
        showMsg('Đã thêm câu hỏi.', 'ok');
        document.getElementById('qOrderNo').value='';
        document.getElementById('qContent').value='';
        [0,1,2,3].forEach(i=>document.getElementById('opt'+i).value='');
        document.getElementById('qExplain').value='';
    }
    switchTab('list');
    loadQuestions();
}

// ---------- BULK IMPORT: FILE UPLOAD ----------
// Tìm khối văn bản chứa danh sách câu hỏi bên trong 1 file .html.
// Hỗ trợ cả 2 dạng: (1) 1 biến duy nhất `const rawData = \`...\`;`,
// và (2) nhiều khối gộp trong 1 mảng, ví dụ `const database = [ {name, content:\`...\`}, {name, content:\`...\`}, ... ]`
// (dạng đề thi thử random nhiều chương). Mọi khối template string có chứa "Câu N:" đều được gom lại theo đúng thứ tự xuất hiện trong file.
function extractQuestionTextFromHtml(html){
    const templateLiterals = [...html.matchAll(/`([\s\S]*?)`/g)].map(m => m[1]);
    const questionParts = templateLiterals
        .map(t => ({ text: t, count: (t.match(/Câu\s*\d+\s*:/g) || []).length }))
        .filter(x => x.count > 0)
        .map(x => x.text.trim());
    if (questionParts.length) return questionParts.join('\n\n');

    // dự phòng: nếu không tìm thấy template literal nào, thử lấy toàn bộ text hiển thị của trang
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const plain = (bodyMatch ? bodyMatch[1] : html).replace(/<[^>]+>/g, '\n');
    return plain.trim();
}
function readFileAsText(file){
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file, 'UTF-8');
    });
}
async function handleBulkFiles(fileList){
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const summaryBox = document.getElementById('fileReadSummary');
    summaryBox.innerHTML = `<div class="file-list" id="fileListBox"></div>`;
    const listBox = document.getElementById('fileListBox');

    const extractedParts = [];
    let totalOk = 0, totalFiles = 0;

    for (const file of files){
        totalFiles++;
        const row = document.createElement('div');
        row.className = 'file-row';
        row.innerHTML = `<span class="fname">${escapeHtml(file.name)}</span><span class="fcount">Đang đọc...</span>`;
        listBox.appendChild(row);

        try {
            const raw = await readFileAsText(file);
            const isHtml = /\.html?$/i.test(file.name) || /<html/i.test(raw);
            const text = isHtml ? extractQuestionTextFromHtml(raw) : raw;
            const parsed = parseBulkText(text);

            if (parsed.length){
                extractedParts.push(text.trim());
                totalOk += parsed.length;
                row.querySelector('.fcount').outerHTML = `<span class="fcount ok">✓ ${parsed.length} câu</span>`;
            } else {
                row.querySelector('.fcount').outerHTML = `<span class="fcount err">✗ không đọc được câu nào</span>`;
            }
        } catch (err) {
            row.querySelector('.fcount').outerHTML = `<span class="fcount err">✗ lỗi đọc file</span>`;
        }
    }

    if (extractedParts.length){
        const ta = document.getElementById('bulkText');
        const existing = ta.value.trim();
        const combined = extractedParts.join('\n\n');
        ta.value = existing ? (existing + '\n\n' + combined) : combined;
        showMsg(`Đã trích ${totalOk} câu hỏi từ ${extractedParts.length}/${totalFiles} file. Kiểm tra lại nội dung bên dưới rồi bấm "Nạp tất cả".`, 'ok');
    } else {
        showMsg('Không trích được câu hỏi nào từ file đã chọn. Kiểm tra lại định dạng file.', 'err');
    }

    document.getElementById('bulkFileInput').value = ''; // cho phép chọn lại cùng file lần sau
}
function clearBulkText(){
    document.getElementById('bulkText').value = '';
    document.getElementById('fileReadSummary').innerHTML = '';
}
// Hỗ trợ kéo-thả file vào vùng chọn
(function initFileDrop(){
    document.addEventListener('DOMContentLoaded', () => {
        const zone = document.getElementById('fileDrop');
        if (!zone) return;
        ['dragenter','dragover'].forEach(evt => zone.addEventListener(evt, e => {
            e.preventDefault(); zone.classList.add('dragover');
        }));
        ['dragleave','drop'].forEach(evt => zone.addEventListener(evt, e => {
            e.preventDefault(); zone.classList.remove('dragover');
        }));
        zone.addEventListener('drop', e => {
            const dt = e.dataTransfer;
            if (dt && dt.files && dt.files.length) handleBulkFiles(dt.files);
        });
    });
})();

// ---------- BULK IMPORT ----------
function parseBulkText(text){
    const blocks = text.trim().split(/(?=Câu\s*\d+\s*:)/);
    const letters = ['A','B','C','D'];
    const out = [];
    blocks.forEach(block=>{
        if (!block.trim()) return;
        const lines = block.trim().split('\n');
        const header = lines[0];
        const contentMatch = header.match(/Câu\s*\d+\s*:\s*(.*)/);
        if (!contentMatch) return;
        const content = contentMatch[1].trim();
        // Ghi đáp án theo đúng chữ cái (A/B/C/D) thay vì theo thứ tự xuất hiện dòng —
        // nếu 1 chữ cái bị lặp dòng (lỗi dữ liệu hay gặp), dòng lặp sẽ ghi đè chứ không tạo thêm 1 "đáp án thứ 5" khiến câu bị loại bỏ.
        const optsByLetter = {};
        let correctIdx = -1, explanation = '';
        lines.slice(1).forEach(line=>{
            const l = line.trim();
            const m = l.match(/^(\*?)([A-D])\.\s*(.*)$/);
            if (m){
                const idx = letters.indexOf(m[2]);
                optsByLetter[idx] = m[3].trim();
                if (m[1] === '*') correctIdx = idx;
            } else if (/^Gt\s*:/.test(l)){
                explanation = l.replace(/^Gt\s*:/,'').trim();
            }
        });
        const options = letters.map((_, i) => optsByLetter[i]);
        if (content && options.every(o => o !== undefined && o !== '') && correctIdx>=0){
            out.push({ content, options, correctIdx, explanation });
        }
    });
    return out;
}
async function bulkImport(){
    if (!currentSubject || !currentChapter) return showMsg('Chọn môn học và chương/đề ở thanh bên trái trước.', 'err');

    const text = document.getElementById('bulkText').value;
    const parsed = parseBulkText(text);
    if (!parsed.length) return showMsg('Không đọc được câu hỏi nào, kiểm tra lại định dạng.', 'err');

    const { count } = await sb.from('questions').select('*', { count: 'exact', head: true })
        .eq('subject_id', currentSubject.id).eq('chapter', currentChapter.chapter);

    const rows = parsed.map((q,i)=>({
        subject_id: currentSubject.id, chapter: currentChapter.chapter, order_no: (count||0)+i+1,
        content: q.content, options: q.options, correct_idx: q.correctIdx, explanation: q.explanation
    }));

    const { error } = await sb.from('questions').insert(rows);
    if (error) return showMsg('Lỗi nạp: ' + error.message, 'err');

    showMsg(`Đã nạp thành công ${rows.length} câu hỏi.`, 'ok');
    document.getElementById('bulkText').value='';
    switchTab('list');
    loadQuestions();
}

// ---------- CONFIRM MODAL ----------
function showConfirm(title, message, onConfirm){
    document.getElementById('confirmTitle').innerText = title;
    document.getElementById('confirmMessage').innerText = message;
    document.getElementById('confirmOverlay').classList.remove('hidden');
    const btn = document.getElementById('confirmDangerBtn');
    const newBtn = btn.cloneNode(true); // clear previous listeners
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', () => { closeConfirm(); onConfirm(); });
}
function closeConfirm(){
    document.getElementById('confirmOverlay').classList.add('hidden');
}

// ---------- UTIL ----------
function showMsg(text, type){
    const box = document.getElementById('msgBox');
    box.innerHTML = `<div class="msg ${type}">${escapeHtml(text)}</div>`;
    setTimeout(()=>{ if (box.innerHTML.includes(text)) box.innerHTML=''; }, 4500);
}
function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// ---------- KÉO-THẢ (dùng Pointer Events, hoạt động cả chuột lẫn cảm ứng/touch) ----------
function enableDragReorder(containerId, itemSelector, getId, isBlocked, onDrop){
    const container = document.getElementById(containerId);
    if (!container) return;

    container.addEventListener('pointerdown', (e) => {
        if (isBlocked && isBlocked()) return;
        const handle = e.target.closest('.drag-handle');
        if (!handle || !container.contains(handle)) return;
        const item = handle.closest(itemSelector);
        if (!item) return;

        e.preventDefault();
        const pointerId = e.pointerId;
        const dragId = getId(item);
        let overItem = null;
        item.classList.add('dragging');
        try { handle.setPointerCapture(pointerId); } catch(err){}

        function onMove(ev){
            if (ev.pointerId !== pointerId) return;
            ev.preventDefault();
            const el = document.elementFromPoint(ev.clientX, ev.clientY);
            const hovered = el ? el.closest(itemSelector) : null;
            if (overItem && overItem !== hovered) overItem.classList.remove('drag-over');
            if (hovered && hovered !== item && container.contains(hovered)){
                hovered.classList.add('drag-over');
                overItem = hovered;
            } else {
                overItem = null;
            }
        }
        function onUp(ev){
            if (ev.pointerId !== pointerId) return;
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            handle.removeEventListener('pointercancel', onUp);
            try { handle.releasePointerCapture(pointerId); } catch(err){}
            item.classList.remove('dragging');
            if (overItem){
                overItem.classList.remove('drag-over');
                const targetId = getId(overItem);
                if (targetId !== dragId) onDrop(dragId, targetId);
            }
        }
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
    });
}
enableDragReorder('subjectList', '.side-item', el => el.dataset.id, null, reorderSubjects);
enableDragReorder('chapterList', '.side-item', el => el.dataset.chapter, () => chapterSelectMode, reorderChapters);
enableDragReorder('qList', '.q-item', el => Number(el.dataset.id), null, reorderQuestions);
enableDragReorder('sepayPkgList', '.side-item', el => el.dataset.id, null, reorderSepayPackages);
enableDragReorder('quickLinkList', '.side-item', el => el.dataset.id, null, reorderQuickLinks);
enableDragReorder('sepayPkgList', '.side-item', el => el.dataset.id, null, reorderSepayPackages);

// ============================================================================
// QUẢN LÝ NỘI DUNG: TÀI LIỆU / CÔNG CỤ / SẢN PHẨM
// Cả 3 mục đều lưu trong bảng site_settings (key/payload JSON) — không cần bảng mới.
//   doc_content     -> { free: [...], paid: [...] }
//   tool_content    -> { items: [...] }
//   product_content -> { items: [...] }
// Mỗi phần tử: { id, icon, color, title, desc, link, size?/status?/price? }
// ============================================================================
const CONTENT_COLOR_OPTIONS = ['indigo','purple','green','amber','blue','red'];

const CONTENT_DEFAULTS = {
    doc_content: { free: [], paid: [] },
    tool_content: { items: [
        { id:'t1', icon:'fa-solid fa-shuffle',    color:'green',  title:'Đề thi ngẫu nhiên',  desc:'', status:'soon', link:'' },
        { id:'t2', icon:'fa-solid fa-clone',      color:'indigo', title:'Flashcard ôn nhanh', desc:'', status:'soon', link:'' },
        { id:'t3', icon:'fa-solid fa-chart-line', color:'amber',  title:'Thống kê kết quả',   desc:'', status:'soon', link:'' }
    ]},
    product_content: { items: [] },
    pro_content: { items: [] },
    earn_pro_content: {
        intro_title: 'Nhận Pro miễn phí',
        intro_desc: 'Không cần trả phí — tham gia một trong các chương trình dưới đây, được duyệt là nhận Premium ngay.',
        zalo_phone: '0825160035',
        zalo_link: 'https://zalo.me/0825160035',
        items: [
            { id:'ep1', icon:'fa-solid fa-file-arrow-up', color:'green',  title:'Đổi tài liệu lấy Pro', desc:'Gửi tài liệu học tập chất lượng (đề thi, tóm tắt, slide bài giảng...) mà hệ thống chưa có. Nhắn Zalo kèm file để được duyệt.', reward:'+15 ngày Pro / tài liệu', link:'' },
            { id:'ep2', icon:'fa-solid fa-bug',            color:'red',    title:'Tìm lỗi lấy Pro',     desc:'Phát hiện câu hỏi sai, đáp án sai, lỗi giao diện hoặc lỗi chức năng trên web. Chụp ảnh màn hình và nhắn Zalo mô tả lỗi.', reward:'+7 ngày Pro / lỗi hợp lệ', link:'' },
            { id:'ep3', icon:'fa-solid fa-user-plus',      color:'indigo', title:'Giới thiệu nhận Pro', desc:'Giới thiệu bạn bè tạo tài khoản và sử dụng SNG EDU. Nhắn Zalo kèm tên tài khoản của bạn và của người được giới thiệu.', reward:'+10 ngày Pro / lượt giới thiệu', link:'' }
        ]
    },
    support_content: {
        intro_title: 'Kẹt chỗ nào, nhắn liền chỗ đó 👋',
        intro_desc: 'Báo lỗi câu hỏi, góp ý tính năng, hay chỉ đơn giản chưa hiểu một đáp án nào đó trong đề — đội SNG EDU đọc và trả lời trực tiếp, không qua chatbot.',
        contacts: [
            { id:'c1', icon:'fa-solid fa-comment-dots', color:'blue',  title:'Nhắn Zalo',          desc:'Nhấn để mở Zalo chat', status_label:'Phản hồi trong ngày', link:'https://zalo.me/0825160035' },
            { id:'c2', icon:'fa-solid fa-pen-to-square', color:'green', title:'Gửi form góp ý', desc:'Điền ngay trên web, không cần rời trang',          status_label:'Kèm ảnh, chọn đúng môn & câu',    link:'gop-y.html' },
            { id:'c3', icon:'fa-solid fa-gift', color:'amber', title:'Nhận Pro miễn phí', desc:'Đổi tài liệu, báo lỗi hoặc giới thiệu bạn bè để nhận Premium', status_label:'Không cần thanh toán', link:'nhan-pro.html' }
        ],
        faq: [
            { id:'f1', title:'Tài liệu và trắc nghiệm trên SNG EDU có mất phí không?', desc:'Toàn bộ học phần đang mở đều miễn phí 100%. Các gói nâng cao (nếu có trong tương lai) sẽ được thông báo rõ trước khi ra mắt, không tự động trừ phí.' },
            { id:'f2', title:'Phát hiện câu hỏi hoặc đáp án bị sai thì báo ở đâu?', desc:'Gửi qua Zalo kèm ảnh chụp câu hỏi, hoặc điền vào Form góp ý ở trên — đội ngũ sẽ kiểm tra và cập nhật trong thời gian sớm nhất.' },
            { id:'f3', title:'Khi nào các học phần "Sắp ra mắt" sẽ mở?', desc:'Bạn có thể bấm nút "Quan tâm" ngay trên thẻ học phần đó — hệ thống sẽ ghi nhận và ưu tiên biên soạn theo mức độ quan tâm.' }
        ]
    }
};

// subKey -> { settingsKey, arrayField, items, editingId, meta }
const contentLists = {};
function registerContentList(subKey, settingsKey, arrayField, meta){
    contentLists[subKey] = { settingsKey, arrayField, items: [], editingId: null, meta };
}
const DOC_BUCKET = 'tai-lieu';
const DOC_ALLOWED_EXT = ['pdf','doc','docx'];
const DOC_MAX_SIZE = 100 * 1024 * 1024; // 100MB
const DOC_IMAGE_MAX_SIZE = 5 * 1024 * 1024; // 5MB

// ---------------- Lưu trữ file trên Cloudflare R2 (thay cho Supabase Storage) ----------------
// Lý do: Supabase Storage tính egress theo GB tải xuống, dễ vượt hạn mức gói Free khi
// nhiều học viên cùng tải tài liệu. R2 miễn phí hoàn toàn egress, chỉ đổi nơi lưu file,
// database (bảng questions, feedback, ctv...) vẫn ở Supabase như cũ, không đổi gì khác.
// Việc upload/xoá thật sự diễn ra ở Edge Function "r2-storage" (giữ khoá bí mật an toàn
// phía server) — ở đây chỉ là các hàm gọi tới function đó.
const R2_PUBLIC_URLS = {
    'tai-lieu': 'https://pub-1d650009eedc4c9bb38c2a0a5713407f.r2.dev',
    'feedback-images': 'https://pub-b6c3ac33d32c483d9532578f9ed21303.r2.dev',
    'ctv-documents': 'https://pub-04d67e116ce44411888b66104e6c614e.r2.dev'
};
async function r2Upload(bucket, path, file){
    const form = new FormData();
    form.append('bucket', bucket);
    form.append('path', path);
    form.append('file', file);
    const { data, error } = await sb.functions.invoke('r2-storage', { body: form });
    if (error) throw new Error(error.message || 'Lỗi tải file lên.');
    if (!data || !data.ok) throw new Error((data && data.error) || 'Lỗi tải file lên.');
    return data; // { ok:true, publicUrl, path }
}
async function r2Delete(bucket, path){
    if (!path) return;
    try{
        await sb.functions.invoke('r2-storage', { body: { action:'delete', bucket, path } });
    }catch(e){ /* best-effort — không chặn thao tác của admin nếu xoá file cũ lỗi */ }
}

registerContentList('doc', 'doc_content', null, {
    label:'Tài liệu', icon:'fa-solid fa-file-lines', color:'green', defaultIcon:'fa-solid fa-file-lines',
    hideIconColor:true, // icon/màu không được dùng ở thẻ tài liệu ngoài trang chủ -> ẩn để đỡ rối
    priceField:true, docTypeField:true, visibilityField:true, sourceToggle:true,
    upload:true, linkLabel:'File tài liệu (PDF hoặc Word)',
    imageRatioHint:'Ảnh bìa hiện dạng dải ngang phía trên thẻ — nên dùng ảnh <b>ngang, tỉ lệ ~16:9 đến 2:1</b> (VD 800×450px hoặc 800×400px), đặt chủ thể chính (chữ/logo) ở giữa để không bị cắt mất trên-dưới. Ảnh dọc hoặc vuông sẽ bị crop bớt.'
});
registerContentList('tool_items', 'tool_content', 'items', {
    label:'Công cụ', icon:'fa-solid fa-toolbox', color:'indigo', defaultIcon:'fa-solid fa-toolbox',
    statusField:true,
    linkLabel:'Đường dẫn (khi đã "Sẵn sàng")', linkPlaceholder:'https://... hoặc ten-file.html'
});
registerContentList('product_items', 'product_content', 'items', {
    label:'Sản phẩm', icon:'fa-solid fa-bag-shopping', color:'indigo', defaultIcon:'fa-solid fa-bag-shopping',
    priceField:true, variantsField:true,
    descTextarea:true, descLabel:'Mô tả (hiện rút gọn ở thẻ, đầy đủ ở trang chi tiết)',
    extraField:{ key:'category', label:'Danh mục sản phẩm', placeholder:'VD: Khoá ôn thi, Gói tài liệu, Tài khoản Premium...', suggest:true, hint:'Sản phẩm cùng danh mục sẽ được gom vào chung 1 khối riêng ở tab "Sản phẩm" trên trang chủ. Để trống nếu muốn xếp vào nhóm "Khác".' },
    imageField:true, visibilityField:true,
    imageRatioHint:'Khung hiển thị ở thẻ trang chủ dùng tỉ lệ <b>ngang 2:1</b> (giống khối Tài liệu), khung ở trang chi tiết hiển thị nguyên ảnh không crop — nên dùng ảnh <b>ngang, tỉ lệ ~2:1</b> (VD 1000×500px, 1200×600px), đặt chủ thể chính (sản phẩm, logo) ở giữa để không bị cắt mất 2 bên khi hiện ở thẻ trang chủ.',
    linkLabel:'Đường dẫn tải xuống / truy cập sản phẩm (chỉ lộ ra cho khách sau khi thanh toán thành công qua SePay)', linkPlaceholder:'https://...'
});
registerContentList('earn_pro_items', 'earn_pro_content', 'items', {
    label:'Chương trình nhận Pro', icon:'fa-solid fa-gift', color:'green', defaultIcon:'fa-solid fa-gift',
    descTextarea:true, descLabel:'Hướng dẫn thực hiện (cách gửi, điều kiện...)',
    extraField:{ key:'reward', label:'Phần thưởng nhận được', placeholder:'VD: +15 ngày Pro' },
    linkLabel:'Đường dẫn hướng dẫn thêm (không bắt buộc)', linkPlaceholder:'https://... (để trống nếu không có)',
    visibilityField:true
});
registerContentList('support_contacts', 'support_content', 'contacts', {
    label:'Kênh liên hệ', icon:'fa-solid fa-headset', color:'indigo', defaultIcon:'fa-solid fa-comment-dots',
    extraField:{ key:'status_label', label:'Dòng trạng thái (chữ màu, hiện dưới cùng thẻ)', placeholder:'VD: Phản hồi trong ngày' },
    linkLabel:'Đường dẫn (Zalo, Google Form...)', linkPlaceholder:'https://...'
});
registerContentList('support_faq', 'support_content', 'faq', {
    label:'Câu hỏi thường gặp', icon:'fa-solid fa-circle-question', color:'indigo', defaultIcon:'fa-solid fa-circle-question',
    hideIconColor:true, hideLink:true, descTextarea:true,
    titleLabel:'Câu hỏi', descLabel:'Câu trả lời'
});
registerContentList('pro_items', 'pro_content', 'items', {
    label:'Gói Pro', icon:'fa-solid fa-crown', color:'amber', defaultIcon:'fa-solid fa-crown',
    extraField:{ key:'price', label:'Giá / chu kỳ', placeholder:'VD: 49.000đ / tháng' },
    linkLabel:'Đường dẫn mua (Zalo, Momo, link thanh toán...) — bỏ trống nếu đã chọn gói SePay bên dưới', linkPlaceholder:'https://zalo.me/... hoặc link thanh toán',
    planField:true
});

const CONTENT_MANAGER_GROUPS = {
    doc:     { title:'Tài liệu',  icon:'📁',  hint:'Quản lý danh sách tài liệu (miễn phí & trả phí) hiển thị ở tab "Tài liệu" trên trang chủ. Tải file PDF/Word lên trực tiếp, không cần link ngoài. Chọn loại "Trả phí" và bắt buộc nhập "Giá bán" — khách phải thanh toán qua SePay thì nút mới đổi thành "Tải xuống", trước đó file không lộ link công khai. Bấm biểu tượng mắt 👁️ ở mỗi dòng để ẩn/hiện tạm thời mà không cần xoá — khách đã mua vẫn tải được bình thường khi bị ẩn.', subKeys:['doc'] },
    tool:    { title:'Công cụ',   icon:'🧰',  hint:'Quản lý các thẻ công cụ hiển thị ở tab "Công cụ" trên trang chủ.', subKeys:['tool_items'] },
    product: { title:'Sản phẩm',  icon:'🛍️', hint:'Quản lý các thẻ sản phẩm hiển thị ở tab "Sản phẩm" trên trang chủ. Bắt buộc nhập "Giá bán" — khách phải thanh toán qua SePay thì nút mới đổi thành "Mở/Tải sản phẩm" và link mới lộ ra, trước đó link không công khai. Bấm biểu tượng mắt 👁️ ở mỗi dòng để ẩn/hiện tạm thời mà không cần xoá — khách đã mua vẫn xem/tải được bình thường khi bị ẩn. Sản phẩm có thể chia thành nhiều <b>phiên bản</b> (VD: "1 tháng"/"3 tháng"/"6 tháng"), mỗi phiên bản giá và kho tài khoản riêng — bật ở mục "Giá" trong form. Với sản phẩm dạng bán tài khoản (VD: YouTube Premium), tick <b>"Giao hàng tự động qua Kho tài khoản"</b> rồi vào tab <b>🔑 Kho tài khoản</b> ở sidebar bên trái để nhập sẵn danh sách tài khoản (chọn đúng tab phiên bản nếu có) — khi khách thanh toán thành công, hệ thống tự động lấy 1 tài khoản còn trống và đánh dấu đã bán, khách xem được ngay ở trang chi tiết sản phẩm. <b>Lưu ý:</b> nếu đã tick ô này mà kho chưa có tài khoản nào, trang sản phẩm sẽ tự hiện "Hết hàng" và khoá nút mua — tránh trường hợp khách thanh toán xong mà không có gì để giao.', subKeys:['product_items'], stockManagedField:true },
    pro:     { title:'Gói Pro',   icon:'👑',  hint:'Quản lý các gói Pro hiển thị ở tab "Tài khoản & Gói Pro" trên trang chủ. Chọn màu "amber" để đánh dấu gói "Phổ biến nhất". Mục "Gói thanh toán tự động (SePay)" cho phép chọn gói tương ứng trong bảng giá tự động — khi đã chọn, thẻ sẽ hiện nút "Mua ngay" mở thẳng cổng SePay thay vì link ngoài. Nếu để trống, thẻ vẫn hoạt động theo kiểu cũ: trỏ ra Zalo/Momo, sau khi khách chuyển khoản bạn vào mục "Tài khoản" bên dưới để gán Premium thủ công.', subKeys:['pro_items'] },
    support: { title:'Hỗ trợ',    icon:'🆘',  hint:'Quản lý nội dung tab "Hỗ trợ" trên trang chủ: khối giới thiệu đầu trang, các kênh liên hệ (Zalo, Form...) và danh sách câu hỏi thường gặp.', subKeys:['support_contacts','support_faq'], intro:true },
    earn_pro: { title:'Nhận Pro miễn phí', icon:'🎁', hint:'Quản lý trang "Nhận Pro miễn phí" (nhan-pro.html): khối giới thiệu, số Zalo liên hệ xác nhận, và danh sách các chương trình đổi lấy Pro (đổi tài liệu, báo lỗi, giới thiệu bạn bè...). Bấm biểu tượng mắt 👁️ ở mỗi dòng để ẩn/hiện chương trình mà không cần xoá.', subKeys:['earn_pro_items'], earnPro:true }
};

function contentColorSwatchesHtml(subKey){
    return CONTENT_COLOR_OPTIONS.map(c => `<div class="color-swatch ${c}" data-color="${c}" onclick="pickContentColor('${subKey}','${c}')">🎨</div>`).join('');
}

function contentBlockHtml(subKey){
    const meta = contentLists[subKey].meta;
    return `
    <div class="cm-block" style="margin-bottom:26px;">
        <div class="subj-mgr-grid">
            <div class="subj-mgr-col" style="max-width:460px;">
                <div class="subj-mgr-col-head">
                    <h4><i class="${meta.icon}"></i> ${meta.label}</h4>
                    <button class="side-add" onclick="openContentForm('${subKey}')">+ Thêm</button>
                </div>
                <div id="cmList_${subKey}" class="side-list subj-mgr-list"></div>
            </div>
            <div class="subj-mgr-col">
                <div id="cmForm_${subKey}" class="mini-form">
                    <div id="cmFormTitle_${subKey}" class="mini-form-title">Thêm ${meta.label.toLowerCase()}</div>
                    ${meta.hideIconColor ? '' : `
                    <div class="cm-section"><i class="fa-solid fa-palette"></i> Biểu tượng</div>
                    <label>Icon (mã lớp Font Awesome)</label>
                    <input id="cmIcon_${subKey}" placeholder="${escapeHtml(meta.defaultIcon)}" oninput="updateContentPreview('${subKey}')">
                    <div class="hint" style="margin:2px 0 0;">Xem mã icon tại <a href="https://fontawesome.com/search" target="_blank" rel="noopener">fontawesome.com/search</a>.</div>
                    <label style="margin-top:10px;">Màu icon</label>
                    <div class="color-swatch-row" id="cmColorRow_${subKey}">${contentColorSwatchesHtml(subKey)}</div>`}
                    ${meta.docTypeField ? `
                    <div class="cm-section"><i class="fa-solid fa-tags"></i> Loại &amp; giá</div>
                    <label>Loại tài liệu</label>
                    <div class="doc-type-toggle" id="cmDocType_${subKey}">
                        <div class="doc-type-opt free" data-type="free" onclick="pickDocType('${subKey}','free')"><i class="fa-solid fa-gift"></i> Miễn phí</div>
                        <div class="doc-type-opt paid" data-type="paid" onclick="pickDocType('${subKey}','paid')"><i class="fa-solid fa-lock"></i> Trả phí</div>
                    </div>
                    <label style="margin-top:10px;">Giá bán (VNĐ)</label>
                    <input id="cmPrice_${subKey}" type="number" min="0" step="1000" placeholder="VD: 20000" oninput="updateContentPreview('${subKey}')">
                    <div class="hint" id="cmPriceHint_${subKey}" style="margin:2px 0 0;">Tài liệu miễn phí — giá tự động là 0đ, khách tải trực tiếp.</div>` : ''}
                    <div class="cm-section"><i class="fa-solid fa-align-left"></i> Nội dung hiển thị</div>
                    <label>${escapeHtml(meta.titleLabel || 'Tiêu đề')}</label>
                    <input id="cmTitle_${subKey}" placeholder="${escapeHtml(meta.titleLabel || 'Tiêu đề')}" oninput="updateContentPreview('${subKey}')">
                    <label>${escapeHtml(meta.descLabel || 'Mô tả ngắn')}</label>
                    ${meta.descTextarea
                        ? `<textarea id="cmDesc_${subKey}" rows="4" placeholder="${escapeHtml(meta.descLabel || 'Mô tả')}" oninput="updateContentPreview('${subKey}')"></textarea>`
                        : `<input id="cmDesc_${subKey}" placeholder="${escapeHtml(meta.descLabel || 'Mô tả ngắn (không bắt buộc)')}" oninput="updateContentPreview('${subKey}')">`}
                    ${meta.extraField ? `
                    <label>${escapeHtml(meta.extraField.label)}</label>
                    <input id="cmExtra_${subKey}" placeholder="${escapeHtml(meta.extraField.placeholder)}" ${meta.extraField.suggest ? `list="cmExtraList_${subKey}"` : ''}>
                    ${meta.extraField.suggest ? `<datalist id="cmExtraList_${subKey}"></datalist>` : ''}
                    ${meta.extraField.hint ? `<div class="hint" style="margin-top:4px;">${meta.extraField.hint}</div>` : ''}` : ''}
                    ${meta.stockManagedField ? `
                    <div class="cm-section"><i class="fa-solid fa-key"></i> Giao hàng</div>
                    <label class="cm-visibility-toggle" style="display:flex;align-items:center;gap:9px;cursor:pointer;margin-bottom:10px;">
                        <span class="tgl-switch"><input type="checkbox" id="cmStockManaged_${subKey}"><span class="tgl-slider"></span></span>
                        <span>🔑 Giao hàng tự động qua <b>Kho tài khoản</b> — nếu bật, sản phẩm bắt buộc phải có tài khoản trong kho mới bán được; hết tài khoản sẽ tự hiện "Hết hàng" và khoá nút mua (tránh khách trả tiền mà không có gì để giao).</span>
                    </label>
                    ` : ''}
                    ${meta.priceField && !meta.docTypeField ? `
                    <div class="cm-section"><i class="fa-solid fa-tags"></i> Giá</div>
                    ${meta.variantsField ? `
                    <label class="cm-visibility-toggle" style="display:flex;align-items:center;gap:9px;cursor:pointer;margin-bottom:10px;">
                        <span class="tgl-switch"><input type="checkbox" id="cmVariantToggle_${subKey}" onchange="onVariantToggleChanged('${subKey}')"><span class="tgl-slider"></span></span>
                        <span>Sản phẩm có nhiều phiên bản (VD: 1 tháng / 3 tháng / 6 tháng — mỗi phiên bản giá và kho tài khoản riêng)</span>
                    </label>
                    ` : ''}
                    <div id="cmPriceWrap_${subKey}">
                    <label>Giá bán (VNĐ)</label>
                    <input id="cmPrice_${subKey}" type="number" min="0" step="1000" placeholder="VD: 20000" oninput="updateContentPreview('${subKey}')">
                    <div class="hint" id="cmPriceHint_${subKey}" style="margin:2px 0 0;">Bắt buộc &gt; 0. Khách phải thanh toán qua SePay mới tải được file này.</div>
                    </div>
                    ${meta.variantsField ? `
                    <div id="cmVariantsWrap_${subKey}" class="hidden">
                        <div id="cmVariantsList_${subKey}" class="cm-variants-list"></div>
                        <button type="button" class="side-add" style="margin-top:4px;" onclick="addVariantRow('${subKey}')">+ Thêm phiên bản</button>
                        <div class="hint" style="margin-top:4px;">Mỗi phiên bản là 1 lựa chọn khách thấy ở trang chi tiết (VD: "1 tháng" — 79.000đ). Sau khi lưu, vào "🔑 Kho tài khoản" để nhập kho riêng cho từng phiên bản.</div>
                    </div>
                    ` : ''}` : ''}
                    ${meta.statusField ? `
                    <label>Trạng thái</label>
                    <select id="cmStatus_${subKey}">
                        <option value="soon">Sắp ra mắt (khoá, chưa bấm được)</option>
                        <option value="ready">Sẵn sàng (mở khoá, bấm được)</option>
                    </select>` : ''}
                    ${meta.hideLink ? '' : `
                    <div class="cm-section"><i class="fa-solid fa-paperclip"></i> ${meta.upload ? 'Tệp &amp; ảnh bìa' : 'Đường dẫn'}</div>
                    <label>${escapeHtml(meta.linkLabel)}</label>
                    ${meta.upload ? `
                    ${meta.sourceToggle ? `
                    <div class="doc-type-toggle" id="cmSrc_${subKey}">
                        <div class="doc-type-opt neutral" data-src="upload" onclick="pickDocSource('${subKey}','upload')"><i class="fa-solid fa-upload"></i> Tải file lên</div>
                        <div class="doc-type-opt neutral" data-src="link" onclick="pickDocSource('${subKey}','link')"><i class="fa-solid fa-link"></i> Dùng link ngoài</div>
                    </div>
                    ` : ''}
                    <div id="cmSrcUpload_${subKey}" style="margin-top:8px;">
                    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                        <input type="file" id="cmFile_${subKey}" accept=".pdf,.doc,.docx" style="display:none;" onchange="onContentFileSelected('${subKey}')">
                        <button type="button" class="side-add" onclick="document.getElementById('cmFile_${subKey}').click()">📎 Chọn file</button>
                        <span class="hint-inline" id="cmFileName_${subKey}"></span>
                    </div>
                    <div class="hint" id="cmUploadHint_${subKey}" style="margin-top:4px;">Chỉ hỗ trợ .pdf, .doc, .docx — tối đa 100MB. File được lưu trực tiếp trên hệ thống, khách bấm tải là có ngay.</div>
                    </div>
                    ${meta.sourceToggle ? `
                    <div id="cmSrcLinkWrap_${subKey}" class="hidden" style="margin-top:8px;">
                        <input id="cmExternalLink_${subKey}" placeholder="https://drive.google.com/... hoặc link tải trực tiếp">
                        <div class="hint" style="margin-top:4px;">Dán link tài liệu có sẵn (Google Drive, Dropbox, link tải trực tiếp...) thay vì tải file lên hệ thống. Bạn tự đảm bảo link luôn còn hoạt động và đúng quyền chia sẻ (ai có link đều xem/tải được).</div>
                    </div>
                    ` : ''}
                    <input type="hidden" id="cmLink_${subKey}" value="">

                    <label style="margin-top:10px;">Ảnh bìa (tuỳ chọn)</label>
                    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                        <input type="file" id="cmImage_${subKey}" accept="image/*" style="display:none;" onchange="onContentImageSelected('${subKey}')">
                        <button type="button" class="side-add" onclick="document.getElementById('cmImage_${subKey}').click()">🖼️ Chọn ảnh</button>
                        <span class="hint-inline" id="cmImageName_${subKey}"></span>
                        <button type="button" class="btn-mini-cancel" id="cmImageRemoveBtn_${subKey}" style="display:none;padding:4px 10px;" onclick="removeContentImage('${subKey}')">Xóa ảnh</button>
                    </div>
                    <div class="hint" style="margin-top:4px;">Không bắt buộc — tối đa 5MB. Ảnh nhỏ hơn ~600px sẽ bị rỗ khi phóng to, nên dùng ảnh gốc tối thiểu 800px chiều rộng.${meta.imageRatioHint ? '<br>' + meta.imageRatioHint : ''}</div>
                    <input type="hidden" id="cmImageUrl_${subKey}" value="">
                    ` : `
                    <input id="cmLink_${subKey}" placeholder="${escapeHtml(meta.linkPlaceholder)}">
                    ${meta.imageField ? `
                    <label style="margin-top:10px;">Hình ảnh sản phẩm (hiện thay icon trên thẻ &amp; trang chi tiết)</label>
                    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                        <input type="file" id="cmImage_${subKey}" accept="image/*" style="display:none;" onchange="onContentImageSelected('${subKey}')">
                        <button type="button" class="side-add" onclick="document.getElementById('cmImage_${subKey}').click()">🖼️ Chọn ảnh</button>
                        <span class="hint-inline" id="cmImageName_${subKey}"></span>
                        <button type="button" class="btn-mini-cancel" id="cmImageRemoveBtn_${subKey}" style="display:none;padding:4px 10px;" onclick="removeContentImage('${subKey}')">Xóa ảnh</button>
                    </div>
                    <div class="hint" style="margin-top:4px;">Không bắt buộc — nếu bỏ trống sẽ hiện icon. Tối đa 5MB. Ảnh nhỏ hơn ~600px sẽ bị rỗ khi phóng to, nên dùng ảnh gốc tối thiểu 800px chiều rộng.${meta.imageRatioHint ? '<br>' + meta.imageRatioHint : ''}</div>
                    <input type="hidden" id="cmImageUrl_${subKey}" value="">
                    ` : ''}
                    `}`}
                    ${meta.planField ? `
                    <label style="margin-top:10px;">Gói thanh toán tự động (SePay)</label>
                    <select id="cmPlan_${subKey}" onchange="onContentPlanChanged('${subKey}')"><option value="">— Đang tải danh sách gói... —</option></select>
                    <div class="hint" style="margin-top:4px;">Chọn gói trong bảng giá tự động (pro_packages) để nút "Mua ngay" mở thẳng cổng SePay. Để "Không liên kết" nếu chỉ muốn hiển thị thẻ giới thiệu + link ngoài như cũ.</div>
                    ` : ''}
                    ${meta.visibilityField ? `
                    <div class="cm-section"><i class="fa-solid fa-eye"></i> Hiển thị</div>
                    <label class="cm-visibility-toggle" style="display:flex;align-items:center;gap:9px;cursor:pointer;">
                        <span class="tgl-switch"><input type="checkbox" id="cmVisible_${subKey}" checked onchange="updateContentPreview('${subKey}')"><span class="tgl-slider"></span></span>
                        <span>Hiển thị trên trang chủ</span>
                    </label>
                    <div class="hint" style="margin-top:2px;">Bỏ chọn để ẩn tạm — mục vẫn được lưu, khách đã mua vẫn tải được bình thường, chỉ không hiện trong danh sách công khai nữa.</div>
                    ` : ''}
                    ${meta.docTypeField ? `
                    <div class="doc-card-preview">
                        <div class="dcp-label"><i class="fa-solid fa-eye"></i> Xem trước thẻ ngoài trang chủ</div>
                        <div class="dcp-card">
                            <div class="dcp-top">
                                <img class="dcp-thumb hidden" id="cmPrevThumb_${subKey}" alt="">
                                <div class="dcp-icon" id="cmPrevIcon_${subKey}"><i class="fa-solid fa-file-lines"></i></div>
                                <span class="dcp-tag" id="cmPrevTag_${subKey}"><i class="fa-solid fa-gift"></i> Miễn phí</span>
                            </div>
                            <div class="dcp-title" id="cmPreviewTitle_${subKey}">Tiêu đề tài liệu</div>
                            <div class="dcp-desc" id="cmPreviewDesc_${subKey}"></div>
                            <div class="dcp-cta" id="cmPrevCta_${subKey}"><i class="fa-solid fa-download"></i> Tải xuống</div>
                        </div>
                    </div>
                    ` : `
                    <div class="settings-preview">
                        <div class="prev-ico" id="cmPreviewIco_${subKey}"><i class="fa-solid fa-star"></i></div>
                        <div class="prev-text"><b id="cmPreviewTitle_${subKey}">Tiêu đề</b><span id="cmPreviewDesc_${subKey}">Mô tả</span></div>
                    </div>
                    `}
                    <div class="mini-actions">
                        <button class="btn-mini-save" onclick="saveContentItem('${subKey}')">Lưu</button>
                        <button class="btn-mini-cancel" onclick="closeContentForm('${subKey}')">Hủy</button>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

async function showContentManager(type){
    const group = CONTENT_MANAGER_GROUPS[type];
    if (!group) return;
    rememberAdminPanel('content:' + type);
    showAdminPanel('contentManagerPanel', 'nav_' + type);
    document.getElementById('cmHeaderIcon').textContent = group.icon;
    document.getElementById('cmHeaderTitle').textContent = group.title;
    document.getElementById('cmHeaderHint').textContent = group.hint;
    document.getElementById('cmListsWrap').innerHTML = group.subKeys.map(contentBlockHtml).join('');

    document.getElementById('supportIntroBlock').classList.toggle('hidden', !group.intro);
    if (group.intro) await loadSupportIntro();
    document.getElementById('earnProIntroBlock').classList.toggle('hidden', !group.earnPro);
    if (group.earnPro) await loadEarnProIntro();

    const planSubKeys = group.subKeys.filter(k => contentLists[k].meta.planField);
    if (planSubKeys.length){
        await loadProPackagesCache();
        planSubKeys.forEach(k => refreshPlanSelect(k, ''));
    }

    for (const subKey of group.subKeys){
        await loadContentList(subKey);
        enableDragReorder('cmList_' + subKey, '.side-item', el => el.dataset.id, null, (fromId, toId) => reorderContentList(subKey, fromId, toId));
    }
}

async function loadContentList(subKey){
    const cfg = contentLists[subKey];
    const { data, error } = await sb.from('site_settings').select('*').eq('key', cfg.settingsKey).single();
    if (error && error.code !== 'PGRST116') showMsg('Lỗi tải ' + cfg.meta.label.toLowerCase() + ': ' + error.message, 'err');
    let payload = (data && data.payload) ? data.payload : null;
    if (!payload) payload = CONTENT_DEFAULTS[cfg.settingsKey] || {};
    let arr;
    if (cfg.meta.docTypeField){
        // Tài liệu: gộp 2 mảng free/paid (định dạng lưu trữ cũ, trang chủ vẫn đọc riêng 2 mảng này)
        // thành 1 danh sách duy nhất trong admin, đánh dấu bằng item.type.
        const freeArr = Array.isArray(payload.free) ? payload.free : [];
        const paidArr = Array.isArray(payload.paid) ? payload.paid : [];
        arr = freeArr.map(x => Object.assign({}, x, { type: 'free', price: 0 }))
            .concat(paidArr.map(x => Object.assign({}, x, { type: 'paid' })));
    } else {
        arr = Array.isArray(payload[cfg.arrayField]) ? payload[cfg.arrayField] : [];
        arr = arr.map(x => Object.assign({}, x));
    }
    cfg.items = arr;
    cfg.items.forEach(it => { if (!it.id) it.id = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); });
    renderContentList(subKey);
}

function contentItemRowHtml(subKey, item){
    const cfg = contentLists[subKey].meta;
    const color = item.color || cfg.color || 'indigo';
    const icon = item.icon || cfg.defaultIcon;
    const hasVariants = cfg.variantsField && Array.isArray(item.variants) && item.variants.length > 0;
    let extraLabel = '';
    if (cfg.statusField){
        extraLabel = item.status === 'ready' ? ' · Sẵn sàng' : ' · Sắp ra mắt';
    } else if (cfg.extraField && item[cfg.extraField.key]){
        extraLabel = ' · ' + escapeHtml(item[cfg.extraField.key]);
    }
    if (hasVariants){
        const prices = item.variants.map(v => Number(v.price) || 0).filter(p => p > 0);
        const min = prices.length ? Math.min(...prices) : 0;
        const max = prices.length ? Math.max(...prices) : 0;
        extraLabel += ` · ${item.variants.length} phiên bản · ` + (min === max ? min.toLocaleString('vi-VN') + 'đ' : 'từ ' + min.toLocaleString('vi-VN') + 'đ');
    } else if (cfg.priceField && !cfg.docTypeField && item.price){
        extraLabel += ' · ' + Number(item.price).toLocaleString('vi-VN') + 'đ';
    }
    let typeBadgeHtml = '';
    if (cfg.docTypeField){
        const isPaid = item.type === 'paid';
        typeBadgeHtml = `<span class="status-badge ${isPaid ? 'maintenance' : 'ready'}" style="margin-right:6px;">${isPaid ? 'Trả phí' : 'Miễn phí'}</span>`;
        if (isPaid && item.price) extraLabel += ' · ' + Number(item.price).toLocaleString('vi-VN') + 'đ';
    }
    const thumbSize = cfg.docTypeField ? 38 : 26;
    const thumbHtml = item.image
        ? `<img src="${escapeHtml(item.image)}" style="width:${thumbSize}px;height:${thumbSize}px;min-width:${thumbSize}px;border-radius:8px;object-fit:cover;border:1px solid var(--border);">`
        : `<span class="prev-ico color-swatch ${color}" style="width:${thumbSize}px;height:${thumbSize}px;min-width:${thumbSize}px;font-size:.72rem;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;color:#fff;"><i class="${escapeHtml(icon)}"></i></span>`;
    const isHidden = !!item.hidden;
    const hiddenBadgeHtml = isHidden ? `<span class="status-badge" style="margin-right:6px;background:rgba(220,38,38,.12);color:var(--red, #dc2626);">Đã ẩn</span>` : '';
    const eyeBtnHtml = cfg.visibilityField
        ? `<button class="icon-edit" title="${isHidden ? 'Hiện lại trên trang chủ' : 'Ẩn khỏi trang chủ'}" onclick="event.stopPropagation(); toggleContentItemHidden('${subKey}','${item.id}')"><i class="fa-solid ${isHidden ? 'fa-eye-slash' : 'fa-eye'}"></i></button>`
        : '';
    return `
        <div class="side-item" data-id="${item.id}" style="${isHidden ? 'opacity:.55;' : ''}">
            <span class="drag-handle" title="Kéo để đổi thứ tự">⋮⋮</span>
            ${thumbHtml}
            <span class="name">${hiddenBadgeHtml}${typeBadgeHtml}${escapeHtml(item.title || '(chưa đặt tên)')}<span class="hint-inline">${extraLabel}</span></span>
            <span class="right-cluster">
                ${eyeBtnHtml}
                <span class="menu-wrap">
                    <button class="icon-edit" title="Tùy chọn" onclick="event.stopPropagation(); toggleContentMenu('${subKey}','${item.id}', this)"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle></svg></button>
                    <div class="menu-drop hidden" id="cmmenu-${subKey}-${item.id}">
                        <button onclick="event.stopPropagation(); closeAllContentMenus(); editContentItem('${subKey}','${item.id}')">✏️ Sửa</button>
                        <button onclick="event.stopPropagation(); closeAllContentMenus(); deleteContentItem('${subKey}','${item.id}')">🗑️ Xóa</button>

                    </div>
                </span>
            </span>
        </div>`;
}
async function toggleContentItemHidden(subKey, id){
    const cfg = contentLists[subKey];
    const item = cfg.items.find(x => String(x.id) === String(id));
    if (!item) return;
    item.hidden = !item.hidden;
    renderContentList(subKey);
    const err = await saveContentList(subKey);
    if (err) showMsg('Lỗi lưu: ' + err.message, 'err');
    else showMsg(item.hidden ? 'Đã ẩn khỏi trang chủ.' : 'Đã hiện lại trên trang chủ.', 'ok');
}
function renderContentList(subKey){
    const cfg = contentLists[subKey];
    const box = document.getElementById('cmList_' + subKey);
    refreshExtraFieldSuggestions(subKey);
    if (!box) return;
    if (!cfg.items.length){ box.innerHTML = `<div class="empty-state" style="padding:14px 4px;">Chưa có ${cfg.meta.label.toLowerCase()} nào. Bấm "+ Thêm" để tạo mục đầu tiên.</div>`; return; }
    box.innerHTML = cfg.items.map(it => contentItemRowHtml(subKey, it)).join('');
}
// Gợi ý (datalist) các giá trị đã dùng cho ô "extraField" (VD: danh mục sản phẩm) — giúp gõ lại đúng tên cũ,
// tránh tạo ra nhiều danh mục trùng ý nhưng khác chính tả (VD: "Khoá học" vs "khoá học").
function refreshExtraFieldSuggestions(subKey){
    const cfg = contentLists[subKey];
    if (!cfg.meta.extraField || !cfg.meta.extraField.suggest) return;
    const list = document.getElementById('cmExtraList_' + subKey);
    if (!list) return;
    const key = cfg.meta.extraField.key;
    const seen = new Set();
    const options = [];
    cfg.items.forEach(it => {
        const v = (it[key] || '').trim();
        if (v && !seen.has(v.toLowerCase())){ seen.add(v.toLowerCase()); options.push(v); }
    });
    list.innerHTML = options.map(v => `<option value="${escapeHtml(v)}"></option>`).join('');
}

// ============================================================================
// KHO TÀI KHOẢN SẢN PHẨM — bảng product_stock, dùng cho sản phẩm dạng "bán tài khoản"
// (vd: YouTube Premium...). Mỗi dòng là 1 tài khoản, khi khách mua hệ thống tự động
// lấy 1 dòng "available" -> đánh dấu "sold" (xem RPC claim_product_stock trong migration 0010/0012).
// Sản phẩm có nhiều phiên bản (item.variants) -> mỗi phiên bản có kho riêng, phân biệt bằng cột "variant".
// Sản phẩm không chia phiên bản -> variant luôn là chuỗi rỗng ''.
// ============================================================================
let stockCurrentProductId = null;
let stockCurrentTab = 'available';
let stockCurrentVariant = '';   // '' = không chia phiên bản (hoặc phiên bản đang chọn)
let stockRowsCache = [];
let stockEditingId = null;      // id dòng đang được sửa nội dung tại chỗ
let stockOverviewMap = {};      // { productId: {available, total} } -- hiện chấm màu còn/hết hàng ở danh sách sản phẩm

function stockCurrentVariants(){
    const item = contentLists.product_items && contentLists.product_items.items.find(x => String(x.id) === String(stockCurrentProductId));
    return item && Array.isArray(item.variants) ? item.variants.filter(v => v && v.id) : [];
}
async function loadStockOverview(){
    const { data, error } = await sb.from('product_stock').select('product_id, status');
    if (error) return;
    const map = {};
    (data || []).forEach(r => {
        const id = String(r.product_id);
        if (!map[id]) map[id] = { available: 0, total: 0 };
        map[id].total++;
        if (r.status === 'available') map[id].available++;
    });
    stockOverviewMap = map;
}
async function showStockManager(){
    rememberAdminPanel('stock');
    showAdminPanel('stockManagerPanel', 'nav_stock');
    if (!contentLists.product_items.items.length) await loadContentList('product_items');
    await loadStockOverview();
    renderStockProductList();
    if (stockCurrentProductId){
        const stillExists = contentLists.product_items.items.some(x => String(x.id) === String(stockCurrentProductId));
        if (stillExists){ selectStockProduct(stockCurrentProductId); return; }
    }
    document.getElementById('stockEmptyState').classList.remove('hidden');
    document.getElementById('stockDetailWrap').classList.add('hidden');
}
function renderStockProductList(){
    const wrap = document.getElementById('stockProductList');
    const items = contentLists.product_items.items || [];
    if (!items.length){ wrap.innerHTML = `<div class="empty-state" style="padding:14px;">Chưa có sản phẩm nào. Vào mục "Sản phẩm" để thêm.</div>`; return; }
    wrap.innerHTML = items.map(item => {
        const hasVariants = Array.isArray(item.variants) && item.variants.length > 0;
        const extra = hasVariants ? `${item.variants.length} phiên bản` : (Number(item.price) > 0 ? Number(item.price).toLocaleString('vi-VN') + 'đ' : 'Miễn phí');
        const active = String(item.id) === String(stockCurrentProductId);
        const ov = stockOverviewMap[String(item.id)];
        const dotClass = !ov || ov.total === 0 ? 'none' : (ov.available > 0 ? 'ok' : 'out');
        const dotTitle = !ov || ov.total === 0 ? 'Chưa nhập kho' : `Còn ${ov.available}/${ov.total} tài khoản`;
        return `<div class="side-item${active ? ' active' : ''}" onclick="selectStockProduct('${String(item.id).replace(/'/g,"\\'")}')">
            <span class="stock-badge-dot ${dotClass}" title="${escapeHtml(dotTitle)}"></span>
            <span class="name">${escapeHtml(item.title || '')}</span>
            <span class="code">${escapeHtml(extra)}</span>
        </div>`;
    }).join('');
}
function selectStockProduct(productId){
    const item = contentLists.product_items && contentLists.product_items.items.find(x => String(x.id) === String(productId));
    stockCurrentProductId = productId;
    stockCurrentTab = 'available';
    stockEditingId = null;
    document.getElementById('stockProductTitle').innerText = item ? (item.title || '') : '';
    document.getElementById('stockAddTextarea').value = '';
    document.querySelectorAll('.stock-tab').forEach(el => el.classList.toggle('selected', el.dataset.tab === 'available'));

    const variants = stockCurrentVariants();
    stockCurrentVariant = variants.length ? String(variants[0].id) : '';
    renderStockVariantTabs();

    document.getElementById('stockEmptyState').classList.add('hidden');
    document.getElementById('stockDetailWrap').classList.remove('hidden');
    renderStockProductList();
    loadStockList();
}
function renderStockVariantTabs(){
    const wrap = document.getElementById('stockVariantTabs');
    const variants = stockCurrentVariants();
    if (!variants.length){ wrap.innerHTML = ''; wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    wrap.innerHTML = variants.map(v => {
        const vId = String(v.id);
        const vIdEsc = vId.replace(/'/g,"\\'");
        return `<span class="stock-variant-tab${vId === stockCurrentVariant ? ' selected' : ''}" onclick="switchStockVariant('${vIdEsc}')">
            <span>${escapeHtml(v.label || vId)}</span>
            <button type="button" class="stock-variant-tab-del" title="Xoá phiên bản ${escapeHtml(v.label || vId)}" onclick="event.stopPropagation(); deleteStockVariant('${vIdEsc}')"><i class="fa-solid fa-xmark"></i></button>
        </span>`;
    }).join('');
}
function switchStockVariant(variantId){
    stockCurrentVariant = variantId;
    stockEditingId = null;
    renderStockVariantTabs();
    updateStockCounts();
    renderStockList();
}
// Xoá 1 phiên bản khỏi sản phẩm (VD: xoá "3 tháng" nhưng vẫn giữ "1 tháng"/"12 tháng").
// Xoá cả các tài khoản trong kho đang gắn với phiên bản đó (nếu có), sau khi đã cảnh báo số lượng.
async function deleteStockVariant(variantId){
    const cfg = contentLists.product_items;
    const item = cfg && cfg.items.find(x => String(x.id) === String(stockCurrentProductId));
    if (!item || !Array.isArray(item.variants)) return;
    const variant = item.variants.find(v => String(v.id) === String(variantId));
    if (!variant) return;

    const { count } = await sb.from('product_stock')
        .select('id', { count: 'exact', head: true })
        .eq('product_id', String(stockCurrentProductId))
        .eq('variant', variantId);

    const stockNote = count ? `\n\nLưu ý: phiên bản này đang có ${count} tài khoản trong kho, các tài khoản đó sẽ bị xoá luôn.` : '';
    if (!confirm(`Xoá phiên bản "${variant.label || variantId}"?${stockNote}`)) return;

    item.variants = item.variants.filter(v => String(v.id) !== String(variantId));
    const saveErr = await saveContentList('product_items');
    if (saveErr) return showMsg('Lỗi xoá phiên bản: ' + saveErr.message, 'err');

    if (count){
        await sb.from('product_stock').delete()
            .eq('product_id', String(stockCurrentProductId))
            .eq('variant', variantId);
    }

    showMsg('Đã xoá phiên bản.', 'ok');
    const remaining = stockCurrentVariants();
    stockCurrentVariant = remaining.length ? String(remaining[0].id) : '';
    stockEditingId = null;
    renderStockVariantTabs();
    renderStockProductList();
    await loadStockOverview();
    renderStockProductList();
    loadStockList();
}
function switchStockTab(tab){
    stockCurrentTab = tab;
    stockEditingId = null;
    document.querySelectorAll('.stock-tab').forEach(el => el.classList.toggle('selected', el.dataset.tab === tab));
    renderStockList();
}
async function loadStockList(){
    const list = document.getElementById('stockList');
    list.innerHTML = `<div class="empty-state" style="padding:14px;">Đang tải...</div>`;
    const { data, error } = await sb.from('product_stock')
        .select('id, content, status, variant, assigned_user_id, sold_at, created_at')
        .eq('product_id', String(stockCurrentProductId))
        .order('created_at', { ascending: true });
    if (error){
        list.innerHTML = `<div class="empty-state" style="padding:14px;color:var(--red);">Lỗi tải kho: ${escapeHtml(error.message)}</div>`;
        return;
    }
    stockRowsCache = data || [];
    // Cần danh sách email để hiện ở tab "Đã bán" -> tải sẵn accountsCache nếu chưa có (không bắt buộc phải mở màn Tài khoản trước)
    if (!accountsCache.length){
        const result = await callAdminUsersFn({ action: 'list' });
        if (!result.error) accountsCache = result.users || [];
    }
    updateStockCounts();
    renderStockList();
}
function stockRowsForCurrentVariant(){
    return stockRowsCache.filter(r => (r.variant || '') === stockCurrentVariant);
}
function updateStockCounts(){
    const rows = stockRowsForCurrentVariant();
    const avail = rows.filter(r => r.status === 'available').length;
    const sold = rows.filter(r => r.status === 'sold').length;
    document.getElementById('stockAvailCount').innerText = avail;
    document.getElementById('stockSoldCount').innerText = sold;
}function stockUserLabel(userId){
    const u = accountsCache.find(x => x.id === userId);
    return u ? (u.email || userId) : (userId || '—');
}
function renderStockList(){
    const list = document.getElementById('stockList');
    const rows = stockRowsForCurrentVariant().filter(r => r.status === stockCurrentTab);
    if (!rows.length){
        list.innerHTML = `<div class="empty-state" style="padding:14px;">${stockCurrentTab === 'available' ? 'Kho đang trống, dán tài khoản ở ô trên rồi bấm "Thêm vào kho".' : 'Chưa có tài khoản nào được bán.'}</div>`;
        return;
    }
    list.innerHTML = rows.map((r, i) => stockRowHtml(r, i + 1)).join('');
}
function stockRowHtml(r, idx){
    if (String(r.id) === String(stockEditingId)){
        return `<div class="stock-row editing" data-id="${r.id}">
            <input class="sr-edit-input" id="srEditInput-${r.id}" value="${escapeHtml(r.content)}" onkeydown="if(event.key==='Enter'){event.preventDefault();saveStockRowEdit('${r.id}');} if(event.key==='Escape'){cancelStockRowEdit();}">
            <div class="sr-edit-actions">
                <button class="sr-edit-save" onclick="saveStockRowEdit('${r.id}')"><i class="fa-solid fa-check"></i> Lưu</button>
                <button class="sr-edit-cancel" onclick="cancelStockRowEdit()">Hủy</button>
            </div>
        </div>`;
    }
    if (r.status === 'available'){
        return `<div class="stock-row" data-id="${r.id}">
            <span class="sr-idx">${idx}.</span>
            <span class="sr-content">${escapeHtml(r.content)}</span>
            <div class="sr-actions">
                <button class="sr-btn sr-edit" title="Sửa nội dung" onclick="startStockRowEdit('${r.id}')"><i class="fa-solid fa-pen"></i> Sửa</button>
                <button class="sr-btn sr-del" title="Xoá khỏi kho" onclick="deleteStockRow('${r.id}')"><i class="fa-solid fa-trash"></i> Xoá</button>
            </div>
        </div>`;
    }
    const soldDate = r.sold_at ? new Date(r.sold_at).toLocaleString('vi-VN') : '';
    return `<div class="stock-row" data-id="${r.id}">
        <span class="sr-idx">${idx}.</span>
        <span class="sr-content">${escapeHtml(r.content)}</span>
        <span class="sr-meta">${escapeHtml(stockUserLabel(r.assigned_user_id))}${soldDate ? ' · ' + escapeHtml(soldDate) : ''}</span>
        <div class="sr-actions">
            <button class="sr-btn sr-edit" title="Sửa nội dung (vd đổi mật khẩu mới) — vẫn giữ nguyên người đã mua" onclick="startStockRowEdit('${r.id}')"><i class="fa-solid fa-pen"></i> Sửa</button>
        </div>
    </div>`;
}
function startStockRowEdit(id){
    stockEditingId = id;
    renderStockList();
    const input = document.getElementById('srEditInput-' + id);
    if (input){ input.focus(); input.select(); }
}
function cancelStockRowEdit(){
    stockEditingId = null;
    renderStockList();
}
async function saveStockRowEdit(id){
    const input = document.getElementById('srEditInput-' + id);
    const newContent = input ? input.value.trim() : '';
    if (!newContent){ showMsg('Nội dung tài khoản không được để trống.', 'err'); return; }
    const { error } = await sb.from('product_stock').update({ content: newContent }).eq('id', id);
    if (error){ showMsg('Lỗi lưu: ' + error.message, 'err'); return; }
    stockEditingId = null;
    showMsg('Đã cập nhật tài khoản.', 'ok');
    loadStockList();
}
async function submitAddStock(){
    const ta = document.getElementById('stockAddTextarea');
    const lines = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length){ showMsg('Chưa nhập tài khoản nào.', 'err'); return; }
    const rows = lines.map(content => ({ product_id: String(stockCurrentProductId), variant: stockCurrentVariant, content }));
    const { error } = await sb.from('product_stock').insert(rows);
    if (error){ showMsg('Lỗi thêm vào kho: ' + error.message, 'err'); return; }
    showMsg(`Đã thêm ${lines.length} tài khoản vào kho.`, 'ok');
    ta.value = '';
    loadStockList();
    loadStockOverview().then(renderStockProductList);
}
function deleteStockRow(id){
    const row = stockRowsCache.find(x => String(x.id) === String(id));
    showConfirm(
        'Xoá tài khoản khỏi kho?',
        row ? `Xoá "${row.content}" khỏi kho? Không thể hoàn tác.` : 'Xoá tài khoản này khỏi kho? Không thể hoàn tác.',
        async () => {
            const { error } = await sb.from('product_stock').delete().eq('id', id);
            if (error){ showMsg('Lỗi xoá: ' + error.message, 'err'); return; }
            showMsg('Đã xoá tài khoản khỏi kho.', 'ok');
            loadStockList();
            loadStockOverview().then(renderStockProductList);
        }
    );
}
function toggleContentMenu(subKey, id, btn){
    const menu = document.getElementById('cmmenu-' + subKey + '-' + id);
    const wasHidden = menu.classList.contains('hidden');
    closeAllContentMenus();
    if (wasHidden && btn){
        const rect = btn.getBoundingClientRect();
        menu.style.top = (rect.bottom + 4) + 'px';
        menu.style.left = 'auto';
        menu.style.right = (window.innerWidth - rect.right) + 'px';
        menu.classList.remove('hidden');
    }
}
function closeAllContentMenus(){
    document.querySelectorAll('[id^="cmmenu-"]').forEach(el => el.classList.add('hidden'));
}
document.addEventListener('click', () => closeAllContentMenus());

async function reorderContentList(subKey, fromId, toId){
    const cfg = contentLists[subKey];
    if (!fromId || !toId || fromId === toId) return;
    const fromIdx = cfg.items.findIndex(x => String(x.id) === String(fromId));
    const toIdx = cfg.items.findIndex(x => String(x.id) === String(toId));
    if (fromIdx < 0 || toIdx < 0) return;
    const reordered = cfg.items.slice();
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    cfg.items = reordered;
    renderContentList(subKey);
    const err = await saveContentList(subKey);
    if (err) showMsg('Lỗi lưu thứ tự: ' + err.message, 'err');
}

function pickDocType(subKey, type){
    const wrap = document.getElementById('cmDocType_' + subKey);
    if (!wrap) return;
    wrap.querySelectorAll('.doc-type-opt').forEach(el => el.classList.toggle('selected', el.dataset.type === type));
    const priceEl = document.getElementById('cmPrice_' + subKey);
    const priceHintEl = document.getElementById('cmPriceHint_' + subKey);
    if (priceEl){
        if (type === 'free'){
            priceEl.value = 0;
            priceEl.disabled = true;
        } else {
            priceEl.disabled = false;
            if (Number(priceEl.value) === 0) priceEl.value = '';
        }
    }
    if (priceHintEl){
        priceHintEl.textContent = type === 'free'
            ? 'Tài liệu miễn phí — giá tự động là 0đ, khách tải trực tiếp.'
            : 'Bắt buộc > 0. Khách phải thanh toán qua SePay mới tải được file này.';
    }
    updateContentPreview(subKey);
}
function pickDocSource(subKey, mode){
    const wrap = document.getElementById('cmSrc_' + subKey);
    if (wrap){
        wrap.dataset.mode = mode;
        wrap.querySelectorAll('.doc-type-opt').forEach(el => el.classList.toggle('selected', el.dataset.src === mode));
    }
    const uploadBox = document.getElementById('cmSrcUpload_' + subKey);
    const linkBox = document.getElementById('cmSrcLinkWrap_' + subKey);
    if (uploadBox) uploadBox.classList.toggle('hidden', mode !== 'upload');
    if (linkBox) linkBox.classList.toggle('hidden', mode !== 'link');
}
function pickContentColor(subKey, color){
    document.querySelectorAll('#cmColorRow_' + subKey + ' .color-swatch').forEach(el=>{
        el.classList.toggle('selected', el.dataset.color === color);
    });
    updateContentPreview(subKey);
}
function updateContentPreview(subKey){
    const cfg = contentLists[subKey];
    const titleEl = document.getElementById('cmTitle_' + subKey);
    const descEl = document.getElementById('cmDesc_' + subKey);
    if (!titleEl || !descEl) return;
    const title = titleEl.value.trim() || '—';
    const desc = descEl.value.trim() || '';
    const titlePrevEl = document.getElementById('cmPreviewTitle_' + subKey);
    const descPrevEl = document.getElementById('cmPreviewDesc_' + subKey);
    if (titlePrevEl) titlePrevEl.innerText = title;
    if (descPrevEl) descPrevEl.innerText = desc;

    // Tài liệu: xem trước dạng thẻ giống hệt thẻ thật ngoài trang chủ (ảnh/icon + badge + giá/CTA).
    if (cfg.meta.docTypeField){
        const typeSel = document.querySelector('#cmDocType_' + subKey + ' .doc-type-opt.selected');
        const isPaid = typeSel ? typeSel.dataset.type === 'paid' : false;

        const tagEl = document.getElementById('cmPrevTag_' + subKey);
        if (tagEl){
            tagEl.className = 'dcp-tag' + (isPaid ? ' paid' : '');
            tagEl.innerHTML = isPaid ? '<i class="fa-solid fa-lock"></i> Trả phí' : '<i class="fa-solid fa-gift"></i> Miễn phí';
        }

        const ctaEl = document.getElementById('cmPrevCta_' + subKey);
        if (ctaEl){
            const priceEl = document.getElementById('cmPrice_' + subKey);
            const priceVal = priceEl ? Number(priceEl.value || 0) : 0;
            ctaEl.className = 'dcp-cta' + (isPaid ? ' paid' : '');
            ctaEl.innerHTML = isPaid
                ? '<i class="fa-solid fa-cart-shopping"></i> Mua ngay' + (priceVal > 0 ? ' · ' + priceVal.toLocaleString('vi-VN') + 'đ' : '')
                : '<i class="fa-solid fa-download"></i> Tải xuống';
        }

        const imgUrlEl = document.getElementById('cmImageUrl_' + subKey);
        const imgUrl = imgUrlEl ? imgUrlEl.value.trim() : '';
        const thumbEl = document.getElementById('cmPrevThumb_' + subKey);
        const iconEl2 = document.getElementById('cmPrevIcon_' + subKey);
        if (thumbEl && iconEl2){
            if (imgUrl){
                thumbEl.src = imgUrl;
                thumbEl.classList.remove('hidden');
                iconEl2.classList.add('hidden');
            } else {
                thumbEl.classList.add('hidden');
                iconEl2.classList.remove('hidden');
                iconEl2.innerHTML = '<i class="fa-solid ' + (isPaid ? 'fa-lock' : 'fa-file-lines') + '"></i>';
            }
        }

        const visibleEl = document.getElementById('cmVisible_' + subKey);
        const card = document.querySelector('#cmForm_' + subKey + ' .dcp-card');
        if (card) card.style.opacity = (visibleEl && !visibleEl.checked) ? '.5' : '1';
        return;
    }

    const iconEl = document.getElementById('cmIcon_' + subKey);
    const icon = iconEl ? (iconEl.value.trim() || cfg.meta.defaultIcon) : cfg.meta.defaultIcon;
    const selected = document.querySelector('#cmColorRow_' + subKey + ' .color-swatch.selected');
    const color = selected ? selected.dataset.color : (cfg.meta.color || 'indigo');
    const prevIco = document.getElementById('cmPreviewIco_' + subKey);
    if (prevIco){
        prevIco.innerHTML = `<i class="${escapeHtml(icon)}"></i>`;
        prevIco.className = 'prev-ico color-swatch ' + color;
    }
}

function formatFileSize(bytes){
    if (bytes >= 1024*1024) return (bytes/1024/1024).toFixed(1) + 'MB';
    if (bytes >= 1024) return Math.round(bytes/1024) + 'KB';
    return bytes + 'B';
}
function fileNameFromUrl(url){
    if (!url) return '';
    try{
        const clean = url.split('?')[0];
        const last = decodeURIComponent(clean.split('/').pop() || '');
        return last.replace(/^\d+-/, ''); // bỏ tiền tố "1699999999-" (timestamp) khi hiển thị
    }catch(e){ return url; }
}
function storagePathFromPublicUrl(url, bucket){
    if (!url) return null;
    const base = R2_PUBLIC_URLS[bucket];
    if (!base || !url.startsWith(base + '/')) return null;
    try{ return decodeURIComponent(url.slice(base.length + 1)); }catch(e){ return url.slice(base.length + 1); }
}
function resetContentUploadUI(subKey, existingLink, existingImage){
    const fileInput = document.getElementById('cmFile_' + subKey);
    if (fileInput) fileInput.value = '';
    const nameEl = document.getElementById('cmFileName_' + subKey);
    const hintEl = document.getElementById('cmUploadHint_' + subKey);
    if (nameEl) nameEl.textContent = existingLink ? ('📄 ' + fileNameFromUrl(existingLink) + ' (đang dùng)') : '';
    if (hintEl){
        hintEl.style.color = '';
        hintEl.textContent = existingLink
            ? 'Chọn file mới để thay thế file hiện tại (không bắt buộc).'
            : 'Chỉ hỗ trợ .pdf, .doc, .docx — tối đa 100MB.';
    }

    const imgInput = document.getElementById('cmImage_' + subKey);
    if (imgInput) imgInput.value = '';
    const imgUrlEl = document.getElementById('cmImageUrl_' + subKey);
    if (imgUrlEl) imgUrlEl.value = existingImage || '';
    const imgNameEl = document.getElementById('cmImageName_' + subKey);
    if (imgNameEl) imgNameEl.textContent = existingImage ? ('🖼️ ' + fileNameFromUrl(existingImage) + ' (đang dùng)') : '';
    const imgRemoveBtn = document.getElementById('cmImageRemoveBtn_' + subKey);
    if (imgRemoveBtn) imgRemoveBtn.style.display = existingImage ? '' : 'none';
}
async function onContentImageSelected(subKey){
    const imgInput = document.getElementById('cmImage_' + subKey);
    const file = imgInput.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')){
        showMsg('Vui lòng chọn một file ảnh.', 'err');
        imgInput.value = '';
        return;
    }
    if (file.size > DOC_IMAGE_MAX_SIZE){
        showMsg('Ảnh quá lớn (tối đa 5MB).', 'err');
        imgInput.value = '';
        return;
    }

    const nameEl = document.getElementById('cmImageName_' + subKey);
    if (nameEl) nameEl.textContent = '⏳ Đang tải lên...';

    const oldImage = document.getElementById('cmImageUrl_' + subKey).value;
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const path = subKey + '-covers/' + Date.now() + '-' + safeName;

    let pubUrl;
    try{
        const res = await r2Upload(DOC_BUCKET, path, file);
        pubUrl = res.publicUrl;
    }catch(upErr){
        if (nameEl) nameEl.textContent = '';
        showMsg('Lỗi tải ảnh lên: ' + upErr.message, 'err');
        imgInput.value = '';
        return;
    }

    document.getElementById('cmImageUrl_' + subKey).value = pubUrl;
    if (nameEl) nameEl.textContent = '🖼️ ' + file.name;
    const removeBtn = document.getElementById('cmImageRemoveBtn_' + subKey);
    if (removeBtn) removeBtn.style.display = '';

    if (oldImage){
        const oldPath = storagePathFromPublicUrl(oldImage, DOC_BUCKET);
        if (oldPath) r2Delete(DOC_BUCKET, oldPath);
    }
}
function removeContentImage(subKey){
    const imgUrlEl = document.getElementById('cmImageUrl_' + subKey);
    const oldImage = imgUrlEl ? imgUrlEl.value : '';
    if (imgUrlEl) imgUrlEl.value = '';
    const imgInput = document.getElementById('cmImage_' + subKey);
    if (imgInput) imgInput.value = '';
    const nameEl = document.getElementById('cmImageName_' + subKey);
    if (nameEl) nameEl.textContent = '';
    const removeBtn = document.getElementById('cmImageRemoveBtn_' + subKey);
    if (removeBtn) removeBtn.style.display = 'none';
    if (oldImage){
        const oldPath = storagePathFromPublicUrl(oldImage, DOC_BUCKET);
        if (oldPath) r2Delete(DOC_BUCKET, oldPath);
    }
}
async function onContentFileSelected(subKey){
    const cfg = contentLists[subKey];
    const fileInput = document.getElementById('cmFile_' + subKey);
    const file = fileInput.files[0];
    if (!file) return;

    const nameEl = document.getElementById('cmFileName_' + subKey);
    const hintEl = document.getElementById('cmUploadHint_' + subKey);
    const ext = (file.name.split('.').pop() || '').toLowerCase();

    if (!DOC_ALLOWED_EXT.includes(ext)){
        showMsg('Chỉ hỗ trợ file PDF hoặc Word (.pdf, .doc, .docx).', 'err');
        fileInput.value = '';
        return;
    }
    if (file.size > DOC_MAX_SIZE){
        showMsg('File quá lớn (tối đa 100MB).', 'err');
        fileInput.value = '';
        return;
    }

    if (hintEl){ hintEl.style.color = ''; hintEl.textContent = ''; }
    if (nameEl) nameEl.textContent = '⏳ Đang tải lên...';

    const oldLink = document.getElementById('cmLink_' + subKey).value;
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const path = subKey + '/' + Date.now() + '-' + safeName;

    let pubUrl2;
    try{
        const res = await r2Upload(DOC_BUCKET, path, file);
        pubUrl2 = res.publicUrl;
    }catch(upErr){
        if (nameEl) nameEl.textContent = '';
        showMsg('Lỗi tải file lên: ' + upErr.message, 'err');
        fileInput.value = '';
        return;
    }

    document.getElementById('cmLink_' + subKey).value = pubUrl2;
    if (nameEl) nameEl.textContent = '📄 ' + file.name;
    if (hintEl){ hintEl.style.color = 'var(--green)'; hintEl.textContent = '✔ Đã tải lên. Bấm "Lưu" để hoàn tất.'; }
    updateContentPreview(subKey);

    // Xóa file cũ trên storage nếu đang thay thế (best-effort, không chặn UI)
    if (oldLink){
        const oldPath = storagePathFromPublicUrl(oldLink, DOC_BUCKET);
        if (oldPath) r2Delete(DOC_BUCKET, oldPath);
    }
}

let proPackagesCache = null;
async function loadProPackagesCache(force){
    if (proPackagesCache && !force) return proPackagesCache;
    const { data, error } = await sb.from('pro_packages').select('id, name, price, duration_days').order('price', { ascending:true });
    proPackagesCache = (!error && data) ? data : [];
    return proPackagesCache;
}

// ---------- QUẢN LÝ GÓI PRO (bảng pro_packages — gộp giá SePay + hiển thị trang chủ) ----------
const SEPAY_PKG_COLOR_OPTIONS = ['indigo','purple','green','amber','blue','red'];
const SEPAY_PKG_SELECT_FULL = 'id, name, description, price, duration_days, icon, color, popular, order_no, active';
let sepayPkgSchemaOk = true; // false nếu bảng pro_packages chưa chạy migration 0002 (thiếu cột hiển thị)

function showSepayPackages(){
    rememberAdminPanel('sepayPkg');
    showAdminPanel('sepayPackagesPanel', 'navSepayPkg');
    const colorRow = document.getElementById('sepayPkgColorRow');
    if (colorRow && !colorRow.innerHTML.trim()) colorRow.innerHTML = sepayPkgColorSwatchesHtml();
    closeSepayPackageForm();
    loadSepayPackagesList();
}
async function loadSepayPackagesList(){
    const box = document.getElementById('sepayPkgList');
    const msgEl = document.getElementById('sepayPkgMsg');
    msgEl.innerText = '';
    box.innerHTML = `<div class="empty-state" style="padding:14px 4px;">Đang tải...</div>`;

    let { data, error } = await sb.from('pro_packages').select(SEPAY_PKG_SELECT_FULL).order('order_no', { ascending:true }).order('price', { ascending:true });
    if (error && (error.code === '42703' || /column .* does not exist/i.test(error.message || ''))){
        // Bảng chưa chạy migration 0002_pro_packages_display_fields.sql — dùng tạm các cột cũ.
        sepayPkgSchemaOk = false;
        const fallback = await sb.from('pro_packages').select('id, name, price, duration_days, active').order('price', { ascending:true });
        data = fallback.data; error = fallback.error;
    } else {
        sepayPkgSchemaOk = true;
    }
    if (error){
        box.innerHTML = '';
        msgEl.style.color = '#e5484d';
        msgEl.innerText = 'Lỗi tải danh sách gói: ' + error.message;
        return;
    }
    if (!sepayPkgSchemaOk){
        msgEl.style.color = '#b45309';
        msgEl.innerText = '⚠️ Bảng pro_packages chưa có các cột hiển thị (mô tả, icon, màu...). Chạy file supabase/migrations/0002_pro_packages_display_fields.sql trong Supabase SQL Editor để dùng đầy đủ tính năng.';
    }
    renderSepayPackagesList(data || []);
    await loadProPackagesCache(true);
}
function sepayPkgRowHtml(pkg){
    const priceText = Number(pkg.price || 0).toLocaleString('vi-VN') + 'đ';
    const durationText = formatDurationAdmin(pkg.duration_days);
    const color = pkg.color || 'amber';
    const icon = pkg.icon || 'fa-solid fa-crown';
    const badges = [];
    if (pkg.active === false) badges.push('<span class="hint-inline" style="color:#e5484d;"> · Đang ẩn</span>');
    if (pkg.popular) badges.push('<span class="hint-inline" style="color:#b45309;"> · Phổ biến nhất</span>');
    return `
        <div class="side-item" data-id="${pkg.id}">
            <span class="drag-handle" title="Kéo để đổi thứ tự">⋮⋮</span>
            <span class="prev-ico color-swatch ${color}" style="width:26px;height:26px;min-width:26px;font-size:.72rem;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;color:#fff;"><i class="${escapeHtml(icon)}"></i></span>
            <span class="name">${escapeHtml(pkg.name || '(chưa đặt tên)')}<span class="hint-inline"> · ${priceText} / ${durationText}${badges.join('')}</span></span>
            <span class="right-cluster">
                <span class="menu-wrap">
                    <button class="icon-edit" title="Tùy chọn" onclick="event.stopPropagation(); toggleSepayPkgMenu('${pkg.id}', this)"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle></svg></button>
                    <div class="menu-drop hidden" id="sepaypkgmenu-${pkg.id}">
                        <button onclick="event.stopPropagation(); closeAllSepayPkgMenus(); openSepayPackageForm('${pkg.id}')">✏️ Sửa</button>
                        <button onclick="event.stopPropagation(); closeAllSepayPkgMenus(); deleteSepayPackage('${pkg.id}')">🗑️ Xóa</button>
                    </div>
                </span>
            </span>
        </div>`;
}
function renderSepayPackagesList(rows){
    const box = document.getElementById('sepayPkgList');
    if (!rows.length){ box.innerHTML = `<div class="empty-state" style="padding:14px 4px;">Chưa có gói nào. Bấm "+ Thêm gói" để tạo gói đầu tiên.</div>`; return; }
    box.innerHTML = rows.map(sepayPkgRowHtml).join('');
    sepayPkgListCache = rows;
}
async function reorderSepayPackages(fromId, toId){
    if (!fromId || !toId || fromId === toId) return;
    const fromIdx = sepayPkgListCache.findIndex(p => String(p.id) === String(fromId));
    const toIdx = sepayPkgListCache.findIndex(p => String(p.id) === String(toId));
    if (fromIdx < 0 || toIdx < 0) return;

    const reordered = sepayPkgListCache.slice();
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    sepayPkgListCache = reordered;
    renderSepayPackagesList(reordered);

    const results = await Promise.all(
        reordered.map((p, i) => sb.from('pro_packages').update({ order_no: i + 1 }).eq('id', p.id))
    );
    const failed = results.find(r => r.error);
    if (failed) showMsg('Lỗi lưu thứ tự: ' + failed.error.message, 'err');
    loadSepayPackagesList();
}
let sepayPkgListCache = [];
function toggleSepayPkgMenu(id, btn){
    const menu = document.getElementById('sepaypkgmenu-' + id);
    const wasHidden = menu.classList.contains('hidden');
    closeAllSepayPkgMenus();
    if (wasHidden && btn){
        const rect = btn.getBoundingClientRect();
        menu.style.top = (rect.bottom + 4) + 'px';
        menu.style.left = 'auto';
        menu.style.right = (window.innerWidth - rect.right) + 'px';
        menu.classList.remove('hidden');
    }
}
function closeAllSepayPkgMenus(){
    document.querySelectorAll('[id^="sepaypkgmenu-"]').forEach(el => el.classList.add('hidden'));
}
document.addEventListener('click', () => closeAllSepayPkgMenus());

function sepayPkgColorSwatchesHtml(){
    return SEPAY_PKG_COLOR_OPTIONS.map(c => `<div class="color-swatch ${c}" data-color="${c}" onclick="pickSepayPkgColor('${c}')">🎨</div>`).join('');
}
function pickSepayPkgColor(color){
    document.querySelectorAll('#sepayPkgColorRow .color-swatch').forEach(el=>{
        el.classList.toggle('selected', el.dataset.color === color);
    });
    updateSepayPkgPreview();
}
function updateSepayPkgPreview(){
    const icon = document.getElementById('sepayPkgIcon').value.trim() || 'fa-solid fa-crown';
    const title = document.getElementById('sepayPkgName').value.trim() || '—';
    const desc = document.getElementById('sepayPkgDesc').value.trim();
    const price = Number(document.getElementById('sepayPkgPrice').value || 0);
    const duration = Number(document.getElementById('sepayPkgDuration').value || 0);
    const selected = document.querySelector('#sepayPkgColorRow .color-swatch.selected');
    const color = selected ? selected.dataset.color : 'amber';
    const priceText = (price > 0 && duration > 0) ? (price.toLocaleString('vi-VN') + 'đ / ' + formatDurationAdmin(duration)) : '';
    document.getElementById('sepayPkgPreviewIco').innerHTML = `<i class="${escapeHtml(icon)}"></i>`;
    document.getElementById('sepayPkgPreviewIco').className = 'prev-ico color-swatch ' + color;
    document.getElementById('sepayPkgPreviewTitle').innerText = title;
    document.getElementById('sepayPkgPreviewDesc').innerText = [desc, priceText].filter(Boolean).join(' · ');
}

function openSepayPackageForm(id){
    const form = document.getElementById('sepayPkgForm');
    const title = document.getElementById('sepayPkgFormTitle');
    const pkg = id ? sepayPkgListCache.find(p => String(p.id) === String(id)) : null;
    document.getElementById('sepayPkgId').value = pkg ? pkg.id : '';
    document.getElementById('sepayPkgName').value = pkg ? (pkg.name || '') : '';
    document.getElementById('sepayPkgDesc').value = pkg ? (pkg.description || '') : '';
    document.getElementById('sepayPkgIcon').value = pkg ? (pkg.icon || '') : '';
    document.getElementById('sepayPkgPrice').value = pkg ? pkg.price : '';
    document.getElementById('sepayPkgDuration').value = pkg ? pkg.duration_days : '';
    document.getElementById('sepayPkgOrder').value = pkg && pkg.order_no ? pkg.order_no : '';
    document.getElementById('sepayPkgPopular').checked = pkg ? !!pkg.popular : false;
    document.getElementById('sepayPkgActive').checked = pkg ? (pkg.active !== false) : true;
    pickSepayPkgColor(pkg ? (pkg.color || 'amber') : 'amber');
    title.innerText = pkg ? ('Sửa gói: ' + pkg.name) : 'Thêm gói mới';
    form.style.display = 'flex';
    form.scrollIntoView({ behavior:'smooth', block:'center' });
    updateSepayPkgPreview();
    document.getElementById('sepayPkgName').focus();
}
function closeSepayPackageForm(){
    document.getElementById('sepayPkgId').value = '';
    document.getElementById('sepayPkgName').value = '';
    document.getElementById('sepayPkgDesc').value = '';
    document.getElementById('sepayPkgIcon').value = '';
    document.getElementById('sepayPkgPrice').value = '';
    document.getElementById('sepayPkgDuration').value = '';
    document.getElementById('sepayPkgOrder').value = '';
    document.getElementById('sepayPkgPopular').checked = false;
    document.getElementById('sepayPkgActive').checked = true;
    document.getElementById('sepayPkgFormTitle').innerText = 'Thêm gói mới';
    pickSepayPkgColor('amber');
    updateSepayPkgPreview();
}
async function saveSepayPackage(){
    const msgEl = document.getElementById('sepayPkgMsg');
    const id = document.getElementById('sepayPkgId').value;
    const name = document.getElementById('sepayPkgName').value.trim();
    const description = document.getElementById('sepayPkgDesc').value.trim();
    const icon = document.getElementById('sepayPkgIcon').value.trim();
    const price = Number(document.getElementById('sepayPkgPrice').value);
    const duration_days = Number(document.getElementById('sepayPkgDuration').value);
    const order_no = Number(document.getElementById('sepayPkgOrder').value) || 0;
    const popular = document.getElementById('sepayPkgPopular').checked;
    const active = document.getElementById('sepayPkgActive').checked;
    const selected = document.querySelector('#sepayPkgColorRow .color-swatch.selected');
    const color = selected ? selected.dataset.color : 'amber';

    if (!name){ showMsg('Vui lòng nhập tên gói.', 'err'); return; }
    if (!price || price <= 0){ showMsg('Vui lòng nhập giá hợp lệ (lớn hơn 0).', 'err'); return; }
    if (!duration_days || duration_days <= 0){ showMsg('Vui lòng nhập thời hạn hợp lệ (số ngày, lớn hơn 0).', 'err'); return; }

    let payload = { name, price, duration_days, active };
    if (sepayPkgSchemaOk){
        payload = Object.assign(payload, { description, icon: icon || 'fa-solid fa-crown', color, popular, order_no });
    }
    let error;
    if (id){
        ({ error } = await sb.from('pro_packages').update(payload).eq('id', id));
    } else {
        ({ error } = await sb.from('pro_packages').insert(payload));
    }
    if (error){
        msgEl.style.color = '#e5484d';
        msgEl.innerText = 'Lỗi lưu gói: ' + error.message;
        showMsg('Lỗi lưu gói: ' + error.message, 'err');
        return;
    }
    closeSepayPackageForm();
    showMsg((id ? 'Đã cập nhật gói "' : 'Đã thêm gói "') + name + '".', 'ok');
    loadSepayPackagesList();
}
function deleteSepayPackage(id){
    const pkg = sepayPkgListCache.find(p => String(p.id) === String(id));
    const name = pkg ? pkg.name : '';
    showConfirm(
        'Xóa gói Pro?',
        `Xóa "${name}"? Thẻ này sẽ biến mất khỏi trang chủ ngay và không thể hoàn tác. Nếu đã từng có khách mua gói này, hệ thống có thể chặn xóa để giữ lịch sử đơn hàng — khi đó hãy dùng "Sửa" và tắt "Đang hoạt động" thay vì xóa.`,
        async () => {
            const { error } = await sb.from('pro_packages').delete().eq('id', id);
            if (error){
                // Lỗi khóa ngoại (23503): gói này đã có đơn hàng liên kết (sepay_orders),
                // không thể xóa hẳn vì sẽ làm mất lịch sử đơn hàng. Đề nghị ẩn gói thay vì xóa.
                if (error.code === '23503' || /foreign key constraint/i.test(error.message || '')){
                    showConfirm(
                        'Không thể xóa — đã có khách mua gói này',
                        `Gói "${name}" đã gắn với ít nhất một đơn hàng nên không thể xóa (sẽ làm mất lịch sử đơn hàng). Bạn có muốn ẩn gói này khỏi trang chủ ngay bây giờ thay vì xóa không? (Có thể bật lại sau trong "Sửa".)`,
                        async () => {
                            const { error: updErr } = await sb.from('pro_packages').update({ active: false }).eq('id', id);
                            if (updErr){ showMsg('Lỗi ẩn gói: ' + updErr.message, 'err'); return; }
                            showMsg('Đã ẩn gói "' + name + '" khỏi trang chủ (không xóa để giữ lịch sử đơn hàng).', 'ok');
                            loadSepayPackagesList();
                        }
                    );
                    return;
                }
                showMsg('Lỗi xóa: ' + error.message, 'err');
                return;
            }
            showMsg('Đã xóa gói "' + name + '".', 'ok');
            loadSepayPackagesList();
        }
    );
}
function formatDurationAdmin(days){
    days = Number(days);
    if (days >= 360) return Math.round(days/365) + ' năm';
    if (days >= 80) return Math.round(days/30) + ' tháng';
    return days + ' ngày';
}
function planOptionsHtml(selectedId){
    const opts = ['<option value="">— Không liên kết (chỉ hiển thị, dùng link ngoài) —</option>'];
    (proPackagesCache || []).forEach(p => {
        const sel = String(p.id) === String(selectedId || '') ? ' selected' : '';
        opts.push(`<option value="${escapeHtml(p.id)}"${sel}>${escapeHtml(p.name)} — ${Number(p.price).toLocaleString('vi-VN')}đ / ${formatDurationAdmin(p.duration_days)}</option>`);
    });
    if (!proPackagesCache || !proPackagesCache.length){
        opts.push('<option value="" disabled>(Chưa có gói nào trong pro_packages — tạo trong Supabase trước)</option>');
    }
    return opts.join('');
}
function refreshPlanSelect(subKey, selectedId){
    const sel = document.getElementById('cmPlan_' + subKey);
    if (!sel) return;
    sel.innerHTML = planOptionsHtml(selectedId);
    onContentPlanChanged(subKey);
}
function onContentPlanChanged(subKey){
    const sel = document.getElementById('cmPlan_' + subKey);
    const linkEl = document.getElementById('cmLink_' + subKey);
    if (!sel || !linkEl) return;
    const plan = (proPackagesCache || []).find(p => String(p.id) === sel.value);
    if (plan){
        linkEl.disabled = true;
        linkEl.value = '';
        linkEl.placeholder = 'Không cần nhập — thẻ này sẽ mở cổng SePay';
        const extraEl = document.getElementById('cmExtra_' + subKey);
        if (extraEl && !extraEl.value.trim()){
            extraEl.value = Number(plan.price).toLocaleString('vi-VN') + 'đ / ' + formatDurationAdmin(plan.duration_days);
            updateContentPreview(subKey);
        }
    } else {
        linkEl.disabled = false;
        linkEl.placeholder = 'https://zalo.me/... hoặc link thanh toán';
    }
}

// ============================================================================
// BIẾN THỂ SẢN PHẨM — editor "1 tháng / 3 tháng / 6 tháng..." trong form Sản phẩm.
// Lưu tạm dạng mảng { id, label, price } gắn trên contentLists[subKey]._variantRows,
// chỉ gộp vào item.variants khi bấm "Lưu" (saveContentItem).
// ============================================================================
function onVariantToggleChanged(subKey){
    const toggleEl = document.getElementById('cmVariantToggle_' + subKey);
    const on = toggleEl ? toggleEl.checked : false;
    const priceWrap = document.getElementById('cmPriceWrap_' + subKey);
    const variantsWrap = document.getElementById('cmVariantsWrap_' + subKey);
    if (priceWrap) priceWrap.classList.toggle('hidden', on);
    if (variantsWrap) variantsWrap.classList.toggle('hidden', !on);
    const cfg = contentLists[subKey];
    if (on && (!cfg._variantRows || !cfg._variantRows.length)){
        setVariantRows(subKey, [{ id: 'v' + Date.now().toString(36), label: '', price: '' }]);
    }
    renderVariantRows(subKey);
}
function setVariantRows(subKey, rows){
    contentLists[subKey]._variantRows = (rows || []).map(v => ({ id: v.id || ('v' + Date.now().toString(36) + Math.random().toString(36).slice(2,5)), label: v.label || '', price: v.price != null ? v.price : '' }));
    renderVariantRows(subKey);
}
function renderVariantRows(subKey){
    const box = document.getElementById('cmVariantsList_' + subKey);
    if (!box) return;
    const rows = contentLists[subKey]._variantRows || [];
    box.innerHTML = rows.map(v => `
        <div class="cm-variant-row" data-vid="${v.id}">
            <input class="cm-variant-label" placeholder="Tên phiên bản (VD: 1 tháng)" value="${escapeHtml(v.label)}" oninput="updateVariantRowField('${subKey}','${v.id}','label',this.value)">
            <input class="cm-variant-price" type="number" min="0" step="1000" placeholder="Giá (VNĐ)" value="${escapeHtml(String(v.price))}" oninput="updateVariantRowField('${subKey}','${v.id}','price',this.value)">
            <button type="button" class="cm-variant-del" title="Xoá phiên bản" onclick="removeVariantRow('${subKey}','${v.id}')"><i class="fa-solid fa-trash"></i></button>
        </div>`).join('') || `<div class="hint" style="padding:4px 0;">Chưa có phiên bản nào, bấm "+ Thêm phiên bản" bên dưới.</div>`;
}
function updateVariantRowField(subKey, vid, field, value){
    const rows = contentLists[subKey]._variantRows || [];
    const row = rows.find(v => String(v.id) === String(vid));
    if (row) row[field] = value;
}
function addVariantRow(subKey){
    const cfg = contentLists[subKey];
    cfg._variantRows = cfg._variantRows || [];
    cfg._variantRows.push({ id: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2,5), label: '', price: '' });
    renderVariantRows(subKey);
}
function removeVariantRow(subKey, vid){
    const cfg = contentLists[subKey];
    const rows = cfg._variantRows || [];
    const row = rows.find(v => String(v.id) === String(vid));
    if (row && !confirm(`Xoá phiên bản "${row.label || '(chưa đặt tên)'}"?`)) return;
    cfg._variantRows = rows.filter(v => String(v.id) !== String(vid));
    renderVariantRows(subKey);
}

function openContentForm(subKey){
    const cfg = contentLists[subKey];
    cfg.editingId = null;
    document.getElementById('cmFormTitle_' + subKey).innerText = 'Thêm ' + cfg.meta.label.toLowerCase();
    const iconEl = document.getElementById('cmIcon_' + subKey); if (iconEl) iconEl.value = '';
    document.getElementById('cmTitle_' + subKey).value = '';
    document.getElementById('cmDesc_' + subKey).value = '';
    const extraEl = document.getElementById('cmExtra_' + subKey); if (extraEl) extraEl.value = '';
    const priceEl = document.getElementById('cmPrice_' + subKey); if (priceEl) priceEl.value = '';
    const statusEl = document.getElementById('cmStatus_' + subKey); if (statusEl) statusEl.value = 'soon';
    const linkEl = document.getElementById('cmLink_' + subKey);
    if (linkEl){ linkEl.value = ''; linkEl.disabled = false; }
    if (cfg.meta.planField) refreshPlanSelect(subKey, '');
    if (cfg.meta.upload || cfg.meta.imageField) resetContentUploadUI(subKey, '', '');
    const extLinkEl = document.getElementById('cmExternalLink_' + subKey); if (extLinkEl) extLinkEl.value = '';
    if (cfg.meta.sourceToggle) pickDocSource(subKey, 'upload');
    if (!cfg.meta.hideIconColor) pickContentColor(subKey, cfg.meta.color || 'indigo');
    if (cfg.meta.docTypeField) pickDocType(subKey, 'free');
    const visibleEl = document.getElementById('cmVisible_' + subKey); if (visibleEl) visibleEl.checked = true;
    if (cfg.meta.stockManagedField){
        const stockEl = document.getElementById('cmStockManaged_' + subKey); if (stockEl) stockEl.checked = false;
    }
    if (cfg.meta.variantsField){
        const toggleEl = document.getElementById('cmVariantToggle_' + subKey);
        if (toggleEl) toggleEl.checked = false;
        setVariantRows(subKey, []);
        onVariantToggleChanged(subKey);
    }
    updateContentPreview(subKey);
    document.getElementById('cmForm_' + subKey).classList.add('show');
}
function closeContentForm(subKey){
    contentLists[subKey].editingId = null;
    const form = document.getElementById('cmForm_' + subKey);
    if (form) form.classList.remove('show');
}
function editContentItem(subKey, id){
    const cfg = contentLists[subKey];
    const item = cfg.items.find(x => String(x.id) === String(id));
    if (!item) return;
    cfg.editingId = id;
    document.getElementById('cmFormTitle_' + subKey).innerText = 'Sửa ' + cfg.meta.label.toLowerCase();
    const iconEl = document.getElementById('cmIcon_' + subKey); if (iconEl) iconEl.value = item.icon || '';
    document.getElementById('cmTitle_' + subKey).value = item.title || '';
    document.getElementById('cmDesc_' + subKey).value = item.desc || '';
    const extraEl = document.getElementById('cmExtra_' + subKey);
    if (extraEl && cfg.meta.extraField) extraEl.value = item[cfg.meta.extraField.key] || '';
    const priceEl = document.getElementById('cmPrice_' + subKey);
    if (priceEl && cfg.meta.priceField) priceEl.value = item.price || '';
    const statusEl = document.getElementById('cmStatus_' + subKey);
    if (statusEl && cfg.meta.statusField) statusEl.value = item.status || 'soon';
    const linkEl = document.getElementById('cmLink_' + subKey);
    if (linkEl){ linkEl.value = item.link || ''; linkEl.disabled = false; }
    if (cfg.meta.planField) refreshPlanSelect(subKey, item.plan_id || '');
    if (cfg.meta.upload || cfg.meta.imageField) resetContentUploadUI(subKey, item.link || '', item.image || '');
    if (cfg.meta.sourceToggle){
        const isUploaded = !!(item.link && storagePathFromPublicUrl(item.link, DOC_BUCKET));
        const extLinkEl = document.getElementById('cmExternalLink_' + subKey);
        if (extLinkEl) extLinkEl.value = isUploaded ? '' : (item.link || '');
        pickDocSource(subKey, isUploaded || !item.link ? 'upload' : 'link');
    }
    if (!cfg.meta.hideIconColor) pickContentColor(subKey, item.color || cfg.meta.color || 'indigo');
    if (cfg.meta.docTypeField) pickDocType(subKey, item.type === 'paid' ? 'paid' : 'free');
    if (cfg.meta.docTypeField && priceEl) priceEl.value = item.price || (item.type === 'paid' ? '' : 0);
    const visibleEl = document.getElementById('cmVisible_' + subKey); if (visibleEl) visibleEl.checked = !item.hidden;
    if (cfg.meta.stockManagedField){
        const stockEl = document.getElementById('cmStockManaged_' + subKey); if (stockEl) stockEl.checked = !!item.stock_managed;
    }
    if (cfg.meta.variantsField){
        const hasVariants = Array.isArray(item.variants) && item.variants.length > 0;
        const toggleEl = document.getElementById('cmVariantToggle_' + subKey);
        if (toggleEl) toggleEl.checked = hasVariants;
        setVariantRows(subKey, hasVariants ? item.variants : []);
        onVariantToggleChanged(subKey);
    }
    updateContentPreview(subKey);
    document.getElementById('cmForm_' + subKey).classList.add('show');
    document.getElementById('cmTitle_' + subKey).focus();
}
async function saveContentItem(subKey){
    const cfg = contentLists[subKey];
    const iconEl = document.getElementById('cmIcon_' + subKey);
    const icon = iconEl ? (iconEl.value.trim() || cfg.meta.defaultIcon) : cfg.meta.defaultIcon;
    const title = document.getElementById('cmTitle_' + subKey).value.trim();
    const desc = document.getElementById('cmDesc_' + subKey).value.trim();
    const linkEl = document.getElementById('cmLink_' + subKey);
    let link = linkEl ? linkEl.value.trim() : '';
    if (cfg.meta.sourceToggle){
        const srcWrap = document.getElementById('cmSrc_' + subKey);
        const mode = srcWrap ? (srcWrap.dataset.mode || 'upload') : 'upload';
        if (mode === 'link'){
            const extLinkEl = document.getElementById('cmExternalLink_' + subKey);
            link = extLinkEl ? extLinkEl.value.trim() : '';
        }
    }
    const planId = cfg.meta.planField ? (document.getElementById('cmPlan_' + subKey).value || '') : '';
    const selected = document.querySelector('#cmColorRow_' + subKey + ' .color-swatch.selected');
    const color = selected ? selected.dataset.color : (cfg.meta.color || 'indigo');
    if (!title) return showMsg('Nhập ' + (cfg.meta.titleLabel || 'tiêu đề').toLowerCase() + '.', 'err');

    const item = { id: cfg.editingId || ('i' + Date.now().toString(36) + Math.random().toString(36).slice(2,6)), icon, color, title, desc, link };
    if (cfg.meta.planField) item.plan_id = planId || null;
    if (cfg.meta.upload || cfg.meta.imageField){
        const imgUrlEl = document.getElementById('cmImageUrl_' + subKey);
        item.image = imgUrlEl ? imgUrlEl.value.trim() : '';
    }
    if (cfg.meta.extraField){
        const extraEl = document.getElementById('cmExtra_' + subKey);
        item[cfg.meta.extraField.key] = extraEl ? extraEl.value.trim() : '';
    }
    let docType = null;
    if (cfg.meta.docTypeField){
        const sel = document.querySelector('#cmDocType_' + subKey + ' .doc-type-opt.selected');
        docType = sel ? sel.dataset.type : 'free';
        item.type = docType;
    }
    let usingVariants = false;
    if (cfg.meta.variantsField){
        const toggleEl = document.getElementById('cmVariantToggle_' + subKey);
        usingVariants = toggleEl ? toggleEl.checked : false;
        if (usingVariants){
            const rawRows = cfg._variantRows || [];
            const rows = rawRows.map(v => ({ id: String(v.id), label: (v.label || '').trim(), price: Number(v.price) }));
            if (!rows.length) return showMsg('Thêm ít nhất 1 phiên bản, hoặc bỏ chọn "Sản phẩm có nhiều phiên bản".', 'err');
            for (const v of rows){
                if (!v.label) return showMsg('Nhập tên cho tất cả các phiên bản (VD: "1 tháng").', 'err');
                if (!v.price || v.price <= 0) return showMsg(`Nhập giá bán hợp lệ (lớn hơn 0) cho phiên bản "${v.label}".`, 'err');
            }
            const labelSet = new Set(rows.map(v => v.label.toLowerCase()));
            if (labelSet.size !== rows.length) return showMsg('Tên phiên bản bị trùng nhau, hãy đặt tên khác nhau cho mỗi phiên bản.', 'err');
            item.variants = rows;
            item.price = Math.min(...rows.map(v => v.price));
        } else {
            item.variants = [];
        }
    }
    if (cfg.meta.priceField && !usingVariants){
        const priceEl = document.getElementById('cmPrice_' + subKey);
        if (docType === 'free'){
            item.price = 0;
        } else {
            const price = priceEl ? Number(priceEl.value) : 0;
            if (!price || price <= 0) return showMsg('Nhập giá bán hợp lệ (lớn hơn 0) cho tài liệu trả phí.', 'err');
            item.price = price;
        }
    }
    if (cfg.meta.statusField){
        item.status = document.getElementById('cmStatus_' + subKey).value;
    }
    if (cfg.meta.visibilityField){
        const visibleEl = document.getElementById('cmVisible_' + subKey);
        item.hidden = visibleEl ? !visibleEl.checked : false;
    }
    if (cfg.meta.stockManagedField){
        const stockEl = document.getElementById('cmStockManaged_' + subKey);
        item.stock_managed = stockEl ? !!stockEl.checked : false;
    }

    const wasEditing = cfg.editingId;
    if (wasEditing){
        const idx = cfg.items.findIndex(x => String(x.id) === String(cfg.editingId));
        if (idx >= 0) cfg.items[idx] = item;
    } else {
        cfg.items.push(item);
    }

    renderContentList(subKey);
    closeContentForm(subKey);
    const err = await saveContentList(subKey);
    if (err) showMsg('Lỗi lưu: ' + err.message, 'err');
    else showMsg((wasEditing ? 'Đã cập nhật ' : 'Đã thêm ') + cfg.meta.label.toLowerCase() + ' "' + title + '".', 'ok');
}
function deleteContentItem(subKey, id){
    const cfg = contentLists[subKey];
    const item = cfg.items.find(x => String(x.id) === String(id));
    const title = item ? item.title : '';
    showConfirm(
        'Xóa ' + cfg.meta.label.toLowerCase() + '?',
        `Xóa "${title}"? Mục sẽ biến mất khỏi trang chủ ngay. Không thể hoàn tác.`,
        async () => {
            if (cfg.meta.upload && item && item.link){
                const path = storagePathFromPublicUrl(item.link, DOC_BUCKET);
                if (path) r2Delete(DOC_BUCKET, path);
            }
            if ((cfg.meta.upload || cfg.meta.imageField) && item && item.image){
                const imgPath = storagePathFromPublicUrl(item.image, DOC_BUCKET);
                if (imgPath) r2Delete(DOC_BUCKET, imgPath);
            }
            cfg.items = cfg.items.filter(x => String(x.id) !== String(id));
            renderContentList(subKey);
            const err = await saveContentList(subKey);
            if (err) showMsg('Lỗi xóa: ' + err.message, 'err');
            else showMsg('Đã xóa.', 'ok');
        }
    );
}
async function saveContentList(subKey){
    const cfg = contentLists[subKey];
    // Tải lại payload mới nhất trước khi ghi, để không đè mất mảng còn lại
    // (vd: doc_content chứa cả free & paid trong cùng 1 dòng).
    const { data } = await sb.from('site_settings').select('*').eq('key', cfg.settingsKey).single();
    const payload = (data && data.payload) ? data.payload : Object.assign({}, CONTENT_DEFAULTS[cfg.settingsKey] || {});
    if (cfg.meta.docTypeField){
        // Tách lại danh sách gộp thành 2 mảng free/paid để trang chủ (index.html) đọc như cũ.
        payload.free = cfg.items.filter(it => it.type !== 'paid').map(it => {
            const { type, ...rest } = it;
            return Object.assign({}, rest, { price: 0 });
        });
        payload.paid = cfg.items.filter(it => it.type === 'paid').map(it => {
            const { type, ...rest } = it;
            return rest;
        });
    } else {
        payload[cfg.arrayField] = cfg.items;
    }
    const { error } = await sb.from('site_settings')
        .upsert({ key: cfg.settingsKey, payload, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    return error;
}

// ---------- GHIM NỔI BẬT (site_settings key 'home_featured') ----------
// Cho phép ghim Học phần / Tài liệu / Công cụ / Sản phẩm vào khối "Nổi bật" ở đầu trang chủ.
let featuredPins = []; // [{type:'subject'|'doc'|'tool'|'product', ref_id:string}], thứ tự = thứ tự hiển thị
let featuredSourceData = { subject: [], doc: [], tool: [], product: [] };
let featuredActiveTab = 'subject';
const FEATURED_TYPE_META = {
    subject: { label: 'Học phần', icon: '📝' },
    doc:     { label: 'Tài liệu', icon: '📁' },
    tool:    { label: 'Công cụ',  icon: '🧰' },
    product: { label: 'Sản phẩm', icon: '🛍️' },
};

async function showFeaturedManager(){
    rememberAdminPanel('featured');
    showAdminPanel('featuredPanel', 'navFeatured');
    document.getElementById('featuredPinnedList').innerHTML = `<div class="empty-state" style="padding:14px 4px;">Đang tải...</div>`;
    document.getElementById('featuredSourceList').innerHTML = `<div class="empty-state" style="padding:14px 4px;">Đang tải...</div>`;
    await Promise.all([loadFeaturedPins(), loadFeaturedSources()]);
    featuredActiveTab = 'subject';
    document.querySelectorAll('#featuredSourceTabs .fmgr-tab').forEach(el => el.classList.toggle('active', el.dataset.src === 'subject'));
    renderFeaturedPinnedList();
    renderFeaturedSourceList();
}

function subjectStatusLabelAdmin(status){
    if (status === 'maintenance') return 'Bảo trì';
    if (status === 'pending') return 'Chưa cập nhật';
    if (status === 'hidden') return 'Đang ẩn';
    return 'Sẵn sàng';
}

async function loadFeaturedPins(){
    const { data, error } = await sb.from('site_settings').select('*').eq('key', 'home_featured').single();
    if (error && error.code !== 'PGRST116') showMsg('Lỗi tải danh sách ghim: ' + error.message, 'err');
    const payload = (data && data.payload) ? data.payload : { items: [] };
    featuredPins = Array.isArray(payload.items) ? payload.items.map(x => ({ type: x.type, ref_id: x.ref_id, hidden: !!x.hidden })) : [];
}

async function loadFeaturedSources(){
    const { data: subs } = await sb.from('subjects').select('id,name,status').order('order_no', { ascending: true, nullsFirst: false }).order('id');
    featuredSourceData.subject = (subs || []).map(s => ({ id: s.id, title: s.name, sub: subjectStatusLabelAdmin(s.status) }));

    const { data: docRow } = await sb.from('site_settings').select('*').eq('key', 'doc_content').single();
    const docPayload = (docRow && docRow.payload) ? docRow.payload : { free: [], paid: [] };
    const freeArr = (Array.isArray(docPayload.free) ? docPayload.free : []).map(it => ({ id: String(it.id), title: it.title || '(chưa đặt tên)', sub: 'Miễn phí', paid: false }));
    const paidArr = (Array.isArray(docPayload.paid) ? docPayload.paid : []).map(it => ({ id: String(it.id), title: it.title || '(chưa đặt tên)', sub: 'Trả phí', paid: true }));
    featuredSourceData.doc = freeArr.concat(paidArr);

    const { data: toolRow } = await sb.from('site_settings').select('*').eq('key', 'tool_content').single();
    const toolItems = (toolRow && toolRow.payload && Array.isArray(toolRow.payload.items)) ? toolRow.payload.items : [];
    featuredSourceData.tool = toolItems.map(it => ({ id: String(it.id), title: it.title || '(chưa đặt tên)', sub: it.status === 'ready' ? 'Sẵn sàng' : 'Sắp ra mắt' }));

    const { data: prodRow } = await sb.from('site_settings').select('*').eq('key', 'product_content').single();
    const prodItems = (prodRow && prodRow.payload && Array.isArray(prodRow.payload.items)) ? prodRow.payload.items : [];
    featuredSourceData.product = prodItems.map(it => ({ id: String(it.id), title: it.title || '(chưa đặt tên)', sub: it.price ? Number(it.price).toLocaleString('vi-VN') + 'đ' : '' }));
}

function switchFeaturedSourceTab(src){
    featuredActiveTab = src;
    document.querySelectorAll('#featuredSourceTabs .fmgr-tab').forEach(el => el.classList.toggle('active', el.dataset.src === src));
    renderFeaturedSourceList();
}

function isFeaturedPinned(type, refId){
    return featuredPins.some(p => p.type === type && String(p.ref_id) === String(refId));
}

function renderFeaturedSourceList(){
    const box = document.getElementById('featuredSourceList');
    if (!box) return;
    const list = featuredSourceData[featuredActiveTab] || [];
    if (!list.length){ box.innerHTML = `<div class="empty-state" style="padding:14px 4px;">Chưa có mục nào ở đây.</div>`; return; }
    box.innerHTML = list.map(it => {
        const pinned = isFeaturedPinned(featuredActiveTab, it.id);
        return `
        <div class="side-item" style="cursor:default;">
            <span class="name">${escapeHtml(it.title)}<span class="hint-inline">${it.sub ? ' · ' + escapeHtml(String(it.sub)) : ''}</span></span>
            <span class="right-cluster">
                <button class="fmgr-pin-btn ${pinned ? 'pinned' : ''}" onclick="toggleFeaturedPin('${featuredActiveTab}','${escapeHtml(String(it.id))}')">${pinned ? '✔ Đã ghim' : '📌 Ghim'}</button>
            </span>
        </div>`;
    }).join('');
}

function featuredPinItemHtml(p, meta){
    const src = featuredSourceData[p.type] || [];
    const found = src.find(x => String(x.id) === String(p.ref_id));
    const title = found ? found.title : ('(#' + p.ref_id + ' — không còn tồn tại)');
    const domId = p.type + ':' + p.ref_id;
    const isHidden = !!p.hidden;
    return `
    <div class="side-item" data-id="${escapeHtml(domId)}" style="${isHidden ? 'opacity:.55;' : ''}">
        <span class="drag-handle" title="Kéo để đổi thứ tự">⋮⋮</span>
        <span class="prev-ico color-swatch indigo" style="width:26px;height:26px;min-width:26px;font-size:.78rem;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;">${meta.icon}</span>
        <span class="name">${escapeHtml(title)}${isHidden ? '<span class="hint-inline"> · đang ẩn</span>' : ''}</span>
        <span class="right-cluster">
            <button class="icon-x" title="${isHidden ? 'Hiện lại' : 'Ẩn tạm (vẫn giữ ghim)'}" onclick="toggleFeaturedPinHidden('${p.type}','${escapeHtml(String(p.ref_id))}')"><i class="fa-solid ${isHidden ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
            <button class="icon-x" title="Bỏ ghim" onclick="toggleFeaturedPin('${p.type}','${escapeHtml(String(p.ref_id))}')">✕</button>
        </span>
    </div>`;
}

function renderFeaturedPinnedList(){
    const box = document.getElementById('featuredPinnedList');
    if (!box) return;
    if (!featuredPins.length){ box.innerHTML = `<div class="empty-state" style="padding:14px 4px;">Chưa ghim mục nào. Chọn ở cột bên phải để ghim.</div>`; return; }
    const groupOrder = ['subject', 'doc', 'tool', 'product'];
    const groups = {};
    featuredPins.forEach(p => { (groups[p.type] || (groups[p.type] = [])).push(p); });
    box.innerHTML = groupOrder.filter(t => groups[t] && groups[t].length).map(type => {
        // Riêng "Tài liệu" tách hiển thị 2 nhóm con Miễn phí / Trả phí (thứ tự kéo-thả vẫn tính riêng theo thứ tự
        // tương đối trong từng nhóm con — kéo thả trong nhóm nào chỉ đổi chỗ trong nhóm đó).
        if (type === 'doc'){
            const docSrc = featuredSourceData.doc || [];
            const isPaidRef = (refId) => { const f = docSrc.find(x => String(x.id) === String(refId)); return f ? !!f.paid : false; };
            const freePins = groups.doc.filter(p => !isPaidRef(p.ref_id));
            const paidPins = groups.doc.filter(p => isPaidRef(p.ref_id));
            const subGroupHtml = (label, icon, pins) => !pins.length ? '' : `
            <div class="fmgr-pin-group">
                <div class="fmgr-pin-group-head">${icon} ${escapeHtml(label)}<span class="fmgr-pin-count">${pins.length}</span></div>
                <div class="side-list">${pins.map(p => featuredPinItemHtml(p, { icon })).join('')}</div>
            </div>`;
            return subGroupHtml('Tài liệu miễn phí', '📁', freePins) + subGroupHtml('Tài liệu trả phí', '🔒', paidPins);
        }
        const meta = FEATURED_TYPE_META[type] || { label: type, icon: '⭐' };
        const itemsHtml = groups[type].map(p => featuredPinItemHtml(p, meta)).join('');
        return `
        <div class="fmgr-pin-group">
            <div class="fmgr-pin-group-head">${meta.icon} ${escapeHtml(meta.label)}<span class="fmgr-pin-count">${groups[type].length}</span></div>
            <div class="side-list">${itemsHtml}</div>
        </div>`;
    }).join('');
}

async function toggleFeaturedPinHidden(type, refId){
    const pin = featuredPins.find(p => p.type === type && String(p.ref_id) === String(refId));
    if (!pin) return;
    pin.hidden = !pin.hidden;
    renderFeaturedPinnedList();
    const err = await saveFeaturedPins();
    if (err) showMsg('Lỗi lưu trạng thái ẩn/hiện: ' + err.message, 'err');
    else showMsg(pin.hidden ? 'Đã ẩn mục ghim (vẫn giữ trong danh sách).' : 'Đã hiện lại mục ghim.', 'ok');
}

async function toggleFeaturedPin(type, refId){
    const idx = featuredPins.findIndex(p => p.type === type && String(p.ref_id) === String(refId));
    const wasPinned = idx >= 0;
    if (wasPinned) featuredPins.splice(idx, 1);
    else featuredPins.push({ type, ref_id: refId, hidden: false });
    renderFeaturedPinnedList();
    renderFeaturedSourceList();
    const err = await saveFeaturedPins();
    if (err) showMsg('Lỗi lưu ghim: ' + err.message, 'err');
    else showMsg(wasPinned ? 'Đã bỏ ghim.' : 'Đã ghim vào khối "Nổi bật".', 'ok');
}

async function reorderFeaturedPins(fromId, toId){
    if (!fromId || !toId || fromId === toId) return;
    const idOf = p => p.type + ':' + p.ref_id;
    const fromIdx = featuredPins.findIndex(p => idOf(p) === fromId);
    const toIdx = featuredPins.findIndex(p => idOf(p) === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const reordered = featuredPins.slice();
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    featuredPins = reordered;
    renderFeaturedPinnedList();
    const err = await saveFeaturedPins();
    if (err) showMsg('Lỗi lưu thứ tự: ' + err.message, 'err');
}

async function saveFeaturedPins(){
    const payload = { items: featuredPins.map(p => ({ type: p.type, ref_id: p.ref_id, hidden: !!p.hidden })) };
    const { error } = await sb.from('site_settings')
        .upsert({ key: 'home_featured', payload, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    return error;
}
// featuredPinnedList là container tĩnh, cố định trong HTML (không bị innerHTML-wipe từ ngoài như cmList_*),
// nên chỉ gắn drag-reorder đúng 1 lần ở đây — tránh gọi lại trong showFeaturedManager() làm chồng listener mỗi lần vào lại trang.
enableDragReorder('featuredPinnedList', '.side-item', el => el.dataset.id, null, (fromId, toId) => reorderFeaturedPins(fromId, toId));

// ---------- KHỐI GIỚI THIỆU ĐẦU TAB "HỖ TRỢ" (site_settings key 'support_content', field intro_title/intro_desc) ----------
async function loadSupportIntro(){
    const { data } = await sb.from('site_settings').select('*').eq('key', 'support_content').single();
    const payload = (data && data.payload) ? data.payload : CONTENT_DEFAULTS.support_content;
    document.getElementById('supportIntroTitleInput').value = payload.intro_title || '';
    document.getElementById('supportIntroDescInput').value = payload.intro_desc || '';
    document.getElementById('supportIntroMsg').innerText = '';
}
async function saveSupportIntro(){
    const intro_title = document.getElementById('supportIntroTitleInput').value.trim();
    const intro_desc = document.getElementById('supportIntroDescInput').value.trim();
    const msgEl = document.getElementById('supportIntroMsg');
    const { data } = await sb.from('site_settings').select('*').eq('key', 'support_content').single();
    const payload = (data && data.payload) ? data.payload : Object.assign({}, CONTENT_DEFAULTS.support_content);
    payload.intro_title = intro_title;
    payload.intro_desc = intro_desc;
    const { error } = await sb.from('site_settings')
        .upsert({ key: 'support_content', payload, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error){
        msgEl.style.color = '#e5484d';
        msgEl.innerText = 'Lỗi lưu: ' + error.message;
        showMsg('Lỗi lưu khối giới thiệu: ' + error.message, 'err');
    } else {
        msgEl.style.color = 'var(--green)';
        msgEl.innerText = '✔ Đã lưu.';
        showMsg('Đã cập nhật khối giới thiệu tab Hỗ trợ.', 'ok');
    }
}

// ---------- KHỐI GIỚI THIỆU + LIÊN HỆ ZALO TRANG "NHẬN PRO MIỄN PHÍ" (site_settings key 'earn_pro_content') ----------
async function loadEarnProIntro(){
    const { data } = await sb.from('site_settings').select('*').eq('key', 'earn_pro_content').single();
    const payload = (data && data.payload) ? data.payload : CONTENT_DEFAULTS.earn_pro_content;
    document.getElementById('earnProIntroTitleInput').value = payload.intro_title || '';
    document.getElementById('earnProIntroDescInput').value = payload.intro_desc || '';
    document.getElementById('earnProZaloPhoneInput').value = payload.zalo_phone || '';
    document.getElementById('earnProZaloLinkInput').value = payload.zalo_link || '';
    document.getElementById('earnProIntroMsg').innerText = '';
}
async function saveEarnProIntro(){
    const intro_title = document.getElementById('earnProIntroTitleInput').value.trim();
    const intro_desc = document.getElementById('earnProIntroDescInput').value.trim();
    const zalo_phone = document.getElementById('earnProZaloPhoneInput').value.trim();
    const zalo_link = document.getElementById('earnProZaloLinkInput').value.trim();
    const msgEl = document.getElementById('earnProIntroMsg');
    const { data } = await sb.from('site_settings').select('*').eq('key', 'earn_pro_content').single();
    const payload = (data && data.payload) ? data.payload : Object.assign({}, CONTENT_DEFAULTS.earn_pro_content);
    payload.intro_title = intro_title;
    payload.intro_desc = intro_desc;
    payload.zalo_phone = zalo_phone;
    payload.zalo_link = zalo_link;
    const { error } = await sb.from('site_settings')
        .upsert({ key: 'earn_pro_content', payload, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error){
        msgEl.style.color = '#e5484d';
        msgEl.innerText = 'Lỗi lưu: ' + error.message;
        showMsg('Lỗi lưu khối giới thiệu Nhận Pro: ' + error.message, 'err');
    } else {
        msgEl.style.color = 'var(--green)';
        msgEl.innerText = '✔ Đã lưu.';
        showMsg('Đã cập nhật khối giới thiệu trang Nhận Pro miễn phí.', 'ok');
    }
}

// ============================================================================
// MENU ĐIỀU HƯỚNG (nav_tabs) — ẩn/hiện + kéo thả sắp xếp thứ tự các tab trang chủ
// ============================================================================
const NAV_TABS_DEFAULT = [
    { key:'home',    label:'Trang chủ',   icon:'🏠' },
    { key:'support', label:'Hỗ trợ',      icon:'🎧' },
    { key:'doc',     label:'Tài liệu',    icon:'📁' },
    { key:'quiz',    label:'Trắc nghiệm', icon:'📝' },
    { key:'tool',    label:'Công cụ',     icon:'🧰' },
    { key:'product', label:'Sản phẩm',    icon:'🛍️' },
    { key:'account', label:'Tài khoản', icon:'👑' },
    { key:'history', label:'Lịch sử mua hàng', icon:'🧾' }
];
let navTabsState = [];

async function loadNavTabsList(){
    document.getElementById('navTabsMsg').innerText = '';
    const { data, error } = await sb.from('site_settings').select('*').eq('key', 'nav_tabs').single();
    if (error && error.code !== 'PGRST116') showMsg('Lỗi tải menu điều hướng: ' + error.message, 'err');
    const saved = (data && data.payload && Array.isArray(data.payload.tabs)) ? data.payload.tabs : null;
    if (saved && saved.length){
        const merged = saved
            .filter(t => NAV_TABS_DEFAULT.some(d => d.key === t.key))
            .map(t => {
                const def = NAV_TABS_DEFAULT.find(d => d.key === t.key);
                return { key:t.key, label:t.label || def.label, icon:def.icon, visible: t.visible !== false };
            });
        NAV_TABS_DEFAULT.forEach(d => { if (!merged.some(t => t.key === d.key)) merged.push(Object.assign({ visible:true }, d)); });
        navTabsState = merged;
    } else {
        navTabsState = NAV_TABS_DEFAULT.map(t => Object.assign({ visible:true }, t));
    }
    renderNavTabsList();
}
function navTabRowHtml(t){
    return `
        <div class="side-item" data-id="${t.key}">
            <span class="drag-handle" title="Kéo để đổi thứ tự">⋮⋮</span>
            <span class="set-ico">${t.icon}</span>
            <span class="name">${escapeHtml(t.label)}</span>
            <span class="right-cluster">
                <button class="side-add" style="padding:5px 10px;" onclick="toggleNavTabVisible('${t.key}')">${t.visible ? '👁️ Đang hiện' : '🚫 Đang ẩn'}</button>
            </span>
        </div>`;
}
function renderNavTabsList(){
    document.getElementById('navTabsList').innerHTML = navTabsState.map(navTabRowHtml).join('');
}
function toggleNavTabVisible(key){
    const t = navTabsState.find(x => x.key === key);
    if (!t) return;
    const visibleCount = navTabsState.filter(x => x.visible).length;
    if (t.visible && visibleCount <= 1){
        showMsg('Phải để hiện ít nhất 1 tab trên menu.', 'err');
        return;
    }
    t.visible = !t.visible;
    renderNavTabsList();
    saveNavTabs();
}
async function reorderNavTabs(fromId, toId){
    if (!fromId || !toId || fromId === toId) return;
    const fromIdx = navTabsState.findIndex(t => t.key === fromId);
    const toIdx = navTabsState.findIndex(t => t.key === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const reordered = navTabsState.slice();
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    navTabsState = reordered;
    renderNavTabsList();
    saveNavTabs();
}
async function saveNavTabs(){
    const { error } = await sb.from('site_settings')
        .upsert({ key:'nav_tabs', payload:{ tabs: navTabsState }, updated_at: new Date().toISOString() }, { onConflict:'key' });
    const msgEl = document.getElementById('navTabsMsg');
    if (error){
        msgEl.style.color = 'var(--red)';
        msgEl.innerText = 'Lỗi: ' + error.message;
    } else {
        msgEl.style.color = 'var(--green)';
        msgEl.innerText = '✔ Đã lưu. Trang chủ sẽ cập nhật ngay khi tải lại.';
        setTimeout(()=>{ if (msgEl.innerText.startsWith('✔')) msgEl.innerText=''; }, 4000);
    }
}
enableDragReorder('navTabsList', '.side-item', el => el.dataset.id, null, reorderNavTabs);

// ============================================================================
// TÍNH NĂNG GÓI PRO (site_settings key 'pro_features') — hiện trong popup "Nâng cấp Pro" ở trang chủ
// ============================================================================
const PRO_FEATURES_DEFAULT = [
    { title:'Mở khoá toàn bộ đề trắc nghiệm', desc:'Làm không giới hạn mọi đề thi, mọi môn học trong suốt thời gian Premium.' },
    { title:'Xem đáp án & giải thích chi tiết', desc:'Không giới hạn số lần xem lời giải sau khi làm bài.' },
    { title:'Tải tài liệu không giới hạn', desc:'Truy cập và tải toàn bộ tài liệu trong thư viện.' },
    { title:'Hỗ trợ trực tiếp từ quản trị viên', desc:'Ưu tiên phản hồi khi báo lỗi câu hỏi hoặc cần hỗ trợ.' },
];
let proFeaturesState = [];

async function loadProFeaturesList(){
    document.getElementById('proFeaturesMsg').innerText = '';
    const { data, error } = await sb.from('site_settings').select('*').eq('key', 'pro_features').single();
    if (error && error.code !== 'PGRST116') showMsg('Lỗi tải tính năng gói Pro: ' + error.message, 'err');
    const saved = (data && data.payload && Array.isArray(data.payload.items)) ? data.payload.items : null;
    proFeaturesState = (saved && saved.length)
        ? saved.map(f => ({ title: f.title || '', desc: f.desc || '' }))
        : PRO_FEATURES_DEFAULT.map(f => Object.assign({}, f));
    renderProFeaturesList();
}
function proFeatureRowHtml(f, idx){
    return `
        <div class="pf-row" data-idx="${idx}">
            <span class="drag-handle" title="Kéo để đổi thứ tự">⋮⋮</span>
            <div class="pf-fields">
                <label>Tiêu đề</label>
                <input type="text" value="${escapeHtml(f.title || '')}" placeholder="Tên tính năng" oninput="updateProFeatureField(${idx}, 'title', this.value)">
                <label>Mô tả</label>
                <textarea rows="2" placeholder="Mô tả ngắn" oninput="updateProFeatureField(${idx}, 'desc', this.value)">${escapeHtml(f.desc || '')}</textarea>
            </div>
            <button type="button" class="pf-del" title="Xoá tính năng này" onclick="removeProFeatureRow(${idx})"><i class="fa-solid fa-trash"></i></button>
        </div>`;
}
function renderProFeaturesList(){
    const wrap = document.getElementById('proFeaturesList');
    wrap.innerHTML = proFeaturesState.length
        ? proFeaturesState.map(proFeatureRowHtml).join('')
        : '<p class="hint">Chưa có tính năng nào, bấm "+ Thêm tính năng" bên dưới.</p>';
}
function updateProFeatureField(idx, field, value){
    if (!proFeaturesState[idx]) return;
    proFeaturesState[idx][field] = value;
}
function addProFeatureRow(){
    proFeaturesState.push({ title:'', desc:'' });
    renderProFeaturesList();
}
function removeProFeatureRow(idx){
    proFeaturesState.splice(idx, 1);
    renderProFeaturesList();
}
function reorderProFeatures(fromIdx, toIdx){
    fromIdx = Number(fromIdx); toIdx = Number(toIdx);
    if (Number.isNaN(fromIdx) || Number.isNaN(toIdx) || fromIdx === toIdx) return;
    const reordered = proFeaturesState.slice();
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    proFeaturesState = reordered;
    renderProFeaturesList();
}
async function saveProFeatures(){
    const cleaned = proFeaturesState
        .map(f => ({ title: (f.title || '').trim(), desc: (f.desc || '').trim() }))
        .filter(f => f.title); // bỏ dòng chưa nhập tiêu đề
    const { error } = await sb.from('site_settings')
        .upsert({ key:'pro_features', payload:{ items: cleaned }, updated_at: new Date().toISOString() }, { onConflict:'key' });
    const msgEl = document.getElementById('proFeaturesMsg');
    if (error){
        msgEl.style.color = 'var(--red)';
        msgEl.innerText = 'Lỗi: ' + error.message;
    } else {
        proFeaturesState = cleaned;
        renderProFeaturesList();
        msgEl.style.color = 'var(--green)';
        msgEl.innerText = '✔ Đã lưu. Trang chủ sẽ cập nhật ngay khi tải lại.';
        setTimeout(()=>{ if (msgEl.innerText.startsWith('✔')) msgEl.innerText=''; }, 4000);
    }
}
enableDragReorder('proFeaturesList', '.pf-row', el => el.dataset.idx, null, reorderProFeatures);

// ============================================================================
// TRANG "LIÊN HỆ ADMIN" (site_settings key 'admin_contact') — hiện ở lien-he.html
// ============================================================================
// Danh sách nền tảng dựng sẵn: chọn xong tự điền icon + màu + nhãn, admin chỉ cần dán link.
// Zalo không có icon chính thức trong bộ Font Awesome Free nên dùng icon bong bóng chat thay thế.
const CONTACT_PLATFORMS = {
    zalo:      { label: 'Zalo',      icon: 'fa-solid fa-comment-dots',        color: '#0068ff', placeholder: 'https://zalo.me/09xxxxxxxx' },
    facebook:  { label: 'Facebook',  icon: 'fa-brands fa-facebook',            color: '#1877f2', placeholder: 'https://facebook.com/tenfanpage' },
    messenger: { label: 'Messenger', icon: 'fa-brands fa-facebook-messenger',  color: '#0084ff', placeholder: 'https://m.me/tenfanpage' },
    telegram:  { label: 'Telegram',  icon: 'fa-brands fa-telegram',            color: '#26a5e4', placeholder: 'https://t.me/username' },
    instagram: { label: 'Instagram', icon: 'fa-brands fa-instagram',           color: '#e1306c', placeholder: 'https://instagram.com/username' },
    tiktok:    { label: 'TikTok',    icon: 'fa-brands fa-tiktok',              color: '#111111', placeholder: 'https://tiktok.com/@username' },
    youtube:   { label: 'YouTube',   icon: 'fa-brands fa-youtube',             color: '#ff0000', placeholder: 'https://youtube.com/@kenh' },
    email:     { label: 'Email',     icon: 'fa-solid fa-envelope',             color: '#f5a524', placeholder: 'mailto:admin@sngedu.site' },
    phone:     { label: 'Điện thoại',icon: 'fa-solid fa-phone',                color: '#17b26a', placeholder: 'tel:0987654321' },
    website:   { label: 'Website',   icon: 'fa-solid fa-globe',                color: '#8b5cf6', placeholder: 'https://sngedu.site' },
    custom:    { label: 'Khác',      icon: 'fa-solid fa-link',                 color: '#6b7180', placeholder: 'https://...' },
};
let adminContactState = { avatar:'', name:'', role:'', bio:'', note:'', contacts:[] };

async function loadAdminContact(){
    const { data, error } = await sb.from('site_settings').select('*').eq('key', 'admin_contact').single();
    if (error && error.code !== 'PGRST116') showMsg('Lỗi tải trang Liên hệ Admin: ' + error.message, 'err');
    const p = (data && data.payload) ? data.payload : {};
    adminContactState = {
        avatar: p.avatar || '',
        name: p.name || '',
        role: p.role || '',
        bio: p.bio || '',
        note: p.note || '',
        contacts: Array.isArray(p.contacts) ? p.contacts.map(c => ({
            platform: c.platform || 'custom', icon: c.icon || '', label: c.label || '', value: c.value || '', link: c.link || '',
        })) : [],
    };
    document.getElementById('acName').value = adminContactState.name;
    document.getElementById('acRole').value = adminContactState.role;
    document.getElementById('acBio').value = adminContactState.bio;
    document.getElementById('acNote').value = adminContactState.note;

    const avatarImg = document.getElementById('acAvatarPreviewImg');
    const avatarIcon = document.getElementById('acAvatarPreviewIcon');
    const avatarName = document.getElementById('acAvatarName');
    const avatarRemoveBtn = document.getElementById('acAvatarRemoveBtn');
    document.getElementById('acAvatarUrl').value = adminContactState.avatar;
    if (adminContactState.avatar){
        avatarImg.src = adminContactState.avatar; avatarImg.classList.remove('hidden'); avatarIcon.classList.add('hidden');
        avatarName.textContent = '🖼️ ' + fileNameFromUrl(adminContactState.avatar) + ' (đang dùng)';
        avatarRemoveBtn.style.display = '';
    } else {
        avatarImg.classList.add('hidden'); avatarIcon.classList.remove('hidden');
        avatarName.textContent = ''; avatarRemoveBtn.style.display = 'none';
    }

    renderAdminContactsList();
}
function contactPlatformOptionsHtml(selected){
    return Object.entries(CONTACT_PLATFORMS).map(([key, meta]) =>
        `<option value="${key}" ${key === selected ? 'selected' : ''}>${escapeHtml(meta.label)}</option>`
    ).join('');
}
function adminContactRowHtml(c, idx){
    const meta = CONTACT_PLATFORMS[c.platform] || CONTACT_PLATFORMS.custom;
    const icon = c.icon || meta.icon;
    const isCustom = c.platform === 'custom';
    return `
        <div class="ac-row" data-idx="${idx}">
            <span class="ac-icon-badge" style="background:${meta.color}"><i class="${escapeHtml(icon)}"></i></span>
            <div class="ac-fields">
                <div>
                    <label>Nền tảng</label>
                    <select onchange="updateAdminContactPlatform(${idx}, this.value)">${contactPlatformOptionsHtml(c.platform)}</select>
                </div>
                <div>
                    <label>Tên hiển thị (không bắt buộc)</label>
                    <input type="text" value="${escapeHtml(c.value || '')}" placeholder="${escapeHtml(meta.label)}" oninput="updateAdminContactField(${idx}, 'value', this.value)">
                </div>
                ${isCustom ? `<div><label>Mã icon Font Awesome</label><input type="text" value="${escapeHtml(c.icon || '')}" placeholder="fa-solid fa-link" oninput="updateAdminContactField(${idx}, 'icon', this.value)"></div>` : ''}
                <div class="full">
                    <label>Link / username</label>
                    <input type="text" value="${escapeHtml(c.link || '')}" placeholder="${escapeHtml(meta.placeholder)}" oninput="updateAdminContactField(${idx}, 'link', this.value)">
                </div>
            </div>
            <button type="button" class="ac-del" title="Xoá kênh này" onclick="removeAdminContactRow(${idx})"><i class="fa-solid fa-trash"></i></button>
        </div>`;
}
function renderAdminContactsList(){
    const wrap = document.getElementById('acContactsList');
    wrap.innerHTML = adminContactState.contacts.length
        ? adminContactState.contacts.map(adminContactRowHtml).join('')
        : '<p class="hint">Chưa có kênh liên hệ nào, bấm "+ Thêm kênh liên hệ" bên dưới.</p>';
}
function updateAdminContactField(idx, field, value){
    if (!adminContactState.contacts[idx]) return;
    adminContactState.contacts[idx][field] = value;
}
function updateAdminContactPlatform(idx, platform){
    if (!adminContactState.contacts[idx]) return;
    adminContactState.contacts[idx].platform = platform;
    if (platform !== 'custom') adminContactState.contacts[idx].icon = ''; // dùng icon mặc định của nền tảng
    renderAdminContactsList();
}
function addAdminContactRow(){
    adminContactState.contacts.push({ platform:'zalo', icon:'', label:'', value:'', link:'' });
    renderAdminContactsList();
}
function removeAdminContactRow(idx){
    adminContactState.contacts.splice(idx, 1);
    renderAdminContactsList();
}
async function onAdminContactAvatarSelected(){
    const input = document.getElementById('acAvatarInput');
    const file = input.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')){ showMsg('Vui lòng chọn một file ảnh.', 'err'); input.value=''; return; }
    if (file.size > DOC_IMAGE_MAX_SIZE){ showMsg('Ảnh quá lớn (tối đa 5MB).', 'err'); input.value=''; return; }

    const nameEl = document.getElementById('acAvatarName');
    nameEl.textContent = '⏳ Đang tải lên...';

    const oldAvatar = document.getElementById('acAvatarUrl').value;
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const path = 'admin-contact/' + Date.now() + '-' + safeName;

    let pubUrl3;
    try{
        const res = await r2Upload(DOC_BUCKET, path, file);
        pubUrl3 = res.publicUrl;
    }catch(upErr){
        nameEl.textContent = ''; showMsg('Lỗi tải ảnh lên: ' + upErr.message, 'err'); input.value=''; return;
    }

    document.getElementById('acAvatarUrl').value = pubUrl3;
    const avatarImg = document.getElementById('acAvatarPreviewImg');
    avatarImg.src = pubUrl3; avatarImg.classList.remove('hidden');
    document.getElementById('acAvatarPreviewIcon').classList.add('hidden');
    nameEl.textContent = '🖼️ ' + file.name;
    document.getElementById('acAvatarRemoveBtn').style.display = '';

    if (oldAvatar){
        const oldPath = storagePathFromPublicUrl(oldAvatar, DOC_BUCKET);
        if (oldPath) r2Delete(DOC_BUCKET, oldPath);
    }
}
function removeAdminContactAvatar(){
    const oldAvatar = document.getElementById('acAvatarUrl').value;
    document.getElementById('acAvatarUrl').value = '';
    document.getElementById('acAvatarInput').value = '';
    document.getElementById('acAvatarName').textContent = '';
    document.getElementById('acAvatarRemoveBtn').style.display = 'none';
    document.getElementById('acAvatarPreviewImg').classList.add('hidden');
    document.getElementById('acAvatarPreviewIcon').classList.remove('hidden');
    if (oldAvatar){
        const oldPath = storagePathFromPublicUrl(oldAvatar, DOC_BUCKET);
        if (oldPath) r2Delete(DOC_BUCKET, oldPath);
    }
}
async function saveAdminContact(){
    const cleanedContacts = adminContactState.contacts
        .map(c => {
            const meta = CONTACT_PLATFORMS[c.platform] || CONTACT_PLATFORMS.custom;
            return {
                platform: c.platform || 'custom',
                icon: c.platform === 'custom' ? (c.icon || '').trim() || 'fa-solid fa-link' : meta.icon,
                label: meta.label,
                color: meta.color,
                value: (c.value || '').trim(),
                link: (c.link || '').trim(),
            };
        })
        .filter(c => c.link); // bỏ dòng chưa nhập link
    const payload = {
        avatar: document.getElementById('acAvatarUrl').value || '',
        name: document.getElementById('acName').value.trim(),
        role: document.getElementById('acRole').value.trim(),
        bio: document.getElementById('acBio').value.trim(),
        note: document.getElementById('acNote').value.trim(),
        contacts: cleanedContacts,
    };
    const { error } = await sb.from('site_settings')
        .upsert({ key:'admin_contact', payload, updated_at: new Date().toISOString() }, { onConflict:'key' });
    if (error){
        showMsg('Lỗi lưu trang Liên hệ Admin: ' + error.message, 'err');
    } else {
        adminContactState.contacts = cleanedContacts;
        renderAdminContactsList();
        showMsg('Đã lưu trang Liên hệ Admin. Xem tại lien-he.html.', 'ok');
    }
}

// ============================================================================
// QUẢN LÝ TÀI KHOẢN — gọi Edge Function "admin-users" (giữ service_role key an toàn phía server)
// ============================================================================
const EDGE_FUNCTION_URL = SUPABASE_URL + '/functions/v1/admin-users';
let accountsCache = [];
let acctFilter = 'all'; // all | active | banned
let acctPage = 1;
let acctPageSize = 25;

async function callAdminUsersFn(payload){
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { showMsg('Phiên đăng nhập admin đã hết hạn, hãy đăng nhập lại.', 'err'); return { error: 'no session' }; }
    try{
        const res = await fetch(EDGE_FUNCTION_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + session.access_token,
                'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify(payload)
        });
        const body = await res.json();
        if (!res.ok) return { error: body.error || ('Lỗi HTTP ' + res.status) };
        return body;
    }catch(e){
        return { error: 'Không gọi được server (kiểm tra Edge Function đã deploy chưa): ' + e.message };
    }
}

async function showAccountsManager(){
    rememberAdminPanel('accounts');
    showAdminPanel('accountsPanel', 'navAccounts');
    document.getElementById('acctSearch').value = '';
    closeAccountDetail();
    await loadAccountsList();
}

async function loadAccountsList(){
    document.getElementById('acctListWrap').innerHTML = `<div class="empty-state" style="padding:20px;">Đang tải...</div>`;
    const result = await callAdminUsersFn({ action:'list' });
    if (result.error){
        document.getElementById('acctListWrap').innerHTML = `<div class="empty-state" style="padding:20px;color:var(--red);">${escapeHtml(result.error)}</div>`;
        document.getElementById('acctCount').innerText = '';
        return;
    }
    accountsCache = result.users || [];
    accountsCache.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    acctPage = 1;
    document.getElementById('acctCount').innerText = accountsCache.length + ' tài khoản';

    const bannedCount = accountsCache.filter(u => u.banned_until && new Date(u.banned_until) > new Date()).length;
    const proCount = accountsCache.filter(u => isAcctPro(u)).length;
    const totalBalance = accountsCache.reduce((sum, u) => sum + (Number(u.balance) || 0), 0);
    document.getElementById('acctStatTotal').innerText = accountsCache.length;
    document.getElementById('acctStatBanned').innerText = bannedCount;
    document.getElementById('acctStatActive').innerText = accountsCache.length - bannedCount;
    document.getElementById('acctStatPro').innerText = proCount;
    document.getElementById('acctStatBalance').innerText = totalBalance.toLocaleString('vi-VN');

    renderAccountsList();
}

function setAcctFilter(f){
    acctFilter = f;
    acctPage = 1;
    document.querySelectorAll('#acctFilterChips .acct-chip').forEach(el => el.classList.toggle('active', el.dataset.f === f));
    renderAccountsList();
}

function changeAcctPageSize(val){
    acctPageSize = Number(val) || 25;
    acctPage = 1;
    renderAccountsList();
}

function goAcctPage(p){
    acctPage = p;
    renderAccountsList();
    document.getElementById('acctListWrap').scrollIntoView({ behavior:'smooth', block:'start' });
}

function fmtDate(iso){
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('vi-VN') + ' ' + d.toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' });
}

function isAcctPro(u){
    // is_premium_plan=true & premium_until=null => Pro vĩnh viễn (không hết hạn), vẫn tính là đang Pro.
    if (!u.is_premium_plan) return false;
    return !u.premium_until || new Date(u.premium_until) > new Date();
}
function fmtMoney(n){
    return (Number(n) || 0).toLocaleString('vi-VN') + 'đ';
}

function renderAccountsList(){
    const q = (document.getElementById('acctSearch').value || '').trim().toLowerCase();
    const filtered = accountsCache.filter(u => {
        const isBanned = u.banned_until && new Date(u.banned_until) > new Date();
        if (acctFilter === 'active' && isBanned) return false;
        if (acctFilter === 'banned' && !isBanned) return false;
        if (acctFilter === 'pro' && !isAcctPro(u)) return false;
        return !q || (u.email || '').toLowerCase().includes(q) || (u.full_name || '').toLowerCase().includes(q);
    });

    const wrap = document.getElementById('acctListWrap');
    const pagWrap = document.getElementById('acctPagination');

    if (!filtered.length){
        wrap.innerHTML = `<div class="empty-state" style="padding:36px 14px;text-align:center;">Không có tài khoản nào khớp.</div>`;
        if (pagWrap) pagWrap.style.display = 'none';
        return;
    }

    // ---- Phân trang ----
    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / acctPageSize));
    if (acctPage > totalPages) acctPage = totalPages;
    if (acctPage < 1) acctPage = 1;
    const startIdx = (acctPage - 1) * acctPageSize;
    const endIdx = Math.min(startIdx + acctPageSize, totalItems);
    const list = filtered.slice(startIdx, endIdx);

    renderAcctPagination(totalItems, totalPages, startIdx, endIdx);

    const avatarColors = ['', 'c1', 'c2', 'c3', 'c4'];
    wrap.innerHTML = list.map((u, idx) => {
        const isBanned = u.banned_until && new Date(u.banned_until) > new Date();
        const isPro = isAcctPro(u);
        const initial = (u.full_name || u.email || 'U').trim()[0].toUpperCase();
        const avatarClass = isBanned ? '' : avatarColors[idx % avatarColors.length];
        return `
        <div class="acct-row ${isBanned ? 'banned' : ''} ${isPro ? 'pro' : ''}" data-id="${u.id}" onclick="openAccountDetail('${u.id}')" style="cursor:pointer;">
            <span class="acct-avatar ${avatarClass}">${escapeHtml(initial)}</span>
            <span class="acct-info">
                <span class="acct-name">${escapeHtml(u.full_name || '(chưa đặt tên)')}<span class="acct-badge ${isBanned ? 'banned' : 'active'}">${isBanned ? 'Đã khoá' : 'Hoạt động'}</span>${isPro ? '<span class="acct-badge pro">👑 Pro</span>' : ''}</span>
                <span class="acct-meta">${escapeHtml(u.email || '')}<span class="dot-sep">·</span>Đăng ký ${fmtDate(u.created_at)}</span>
            </span>
            <span class="acct-balance-pill" title="Số dư">💰 ${fmtMoney(u.balance)}</span>
            <span class="acct-row-actions">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;color:var(--gray);"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </span>
        </div>`;
    }).join('');
}

// ---- Render thanh phân trang: "Xem N mục — Đang xem X đến Y trong tổng số Z mục — Trước [1] Tiếp" ----
function renderAcctPagination(totalItems, totalPages, startIdx, endIdx){
    const pagWrap = document.getElementById('acctPagination');
    if (!pagWrap) return;

    if (totalItems <= 0){ pagWrap.style.display = 'none'; return; }
    pagWrap.style.display = 'flex';

    document.getElementById('acctPageSizeSelect').value = String(acctPageSize);
    document.getElementById('acctPageRangeInfo').innerText =
        `Đang xem ${startIdx + 1} đến ${endIdx} trong tổng số ${totalItems} mục`;

    const nav = document.getElementById('acctPageNav');
    if (totalPages <= 1){ nav.innerHTML = ''; return; }

    // Danh sách số trang hiển thị: luôn có trang đầu/cuối, quanh trang hiện tại, còn lại rút gọn bằng "..."
    const pages = [];
    const windowSize = 1; // số trang hiển thị mỗi bên của trang hiện tại
    for (let p = 1; p <= totalPages; p++){
        if (p === 1 || p === totalPages || (p >= acctPage - windowSize && p <= acctPage + windowSize)){
            pages.push(p);
        } else if (pages[pages.length - 1] !== '...') {
            pages.push('...');
        }
    }

    let html = `<button class="acct-pg-btn" ${acctPage === 1 ? 'disabled' : ''} onclick="goAcctPage(${acctPage - 1})">Trước</button>`;
    pages.forEach(p => {
        if (p === '...'){
            html += `<span class="acct-pg-ellipsis">…</span>`;
        } else {
            html += `<button class="acct-pg-btn ${p === acctPage ? 'active' : ''}" onclick="goAcctPage(${p})">${p}</button>`;
        }
    });
    html += `<button class="acct-pg-btn" ${acctPage === totalPages ? 'disabled' : ''} onclick="goAcctPage(${acctPage + 1})">Tiếp</button>`;

    nav.innerHTML = html;
}

// ---------- MODAL: chi tiết tài khoản (bấm vào 1 dòng để mở) ----------
// ---------- TRANG CHI TIẾT TÀI KHOẢN (bấm vào 1 dòng để "đi vào" trang riêng) ----------
function openAccountDetail(userId){
    const u = accountsCache.find(x => x.id === userId);
    if (!u) return;
    const isBanned = u.banned_until && new Date(u.banned_until) > new Date();
    const isPro = isAcctPro(u);
    const initial = (u.email || 'U')[0].toUpperCase();

    document.getElementById('acctDetailView').innerHTML = `
        <button class="acct-detail-back" onclick="closeAccountDetail()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
            Quay lại danh sách
        </button>
        <div class="acct-detail-head">
            <span class="acct-avatar" style="${isBanned ? 'background:linear-gradient(135deg,#dc2626,#f87171);' : ''}">${escapeHtml(initial)}</span>
            <div class="adh-info">
                <div class="adh-name">${escapeHtml(u.full_name || '(chưa đặt tên)')}${isPro ? '<span class="acct-badge pro" style="margin-left:8px;">👑 Pro</span>' : ''}</div>
                <div class="adh-email">${escapeHtml(u.email || '')}</div>
                <div class="adh-meta">Đăng ký ${fmtDate(u.created_at)} · <span style="color:${isBanned ? 'var(--red)' : 'var(--green)'};font-weight:700;">${isBanned ? 'Đã khoá đăng nhập' : 'Đang hoạt động'}</span></div>
                <div class="adh-meta">Số dư: <span class="balance-val">${fmtMoney(u.balance)}</span> · Pro: <b style="color:${isPro ? 'var(--green)' : 'var(--gray)'};">${isPro ? (u.premium_until ? ('còn hạn tới ' + fmtDate(u.premium_until)) : 'vĩnh viễn (không hết hạn)') : 'chưa/không dùng Pro'}</b></div>
            </div>
        </div>
        <div class="acct-detail-grid">
            <div class="acct-action-card pro" onclick="openProModal('${u.id}')">
                <span class="aac-ico">👑</span>
                <span class="aac-title">Nâng cấp / Quản lý Pro</span>
                <span class="aac-desc">Kích hoạt, gia hạn theo gói có sẵn, đặt số ngày tuỳ ý hoặc huỷ Pro thủ công.</span>
            </div>
            <div class="acct-action-card balance" onclick="openBalanceModal('${u.id}')">
                <span class="aac-ico">💰</span>
                <span class="aac-title">Cộng / trừ số dư</span>
                <span class="aac-desc">Điều chỉnh số dư tài khoản này, có lưu lại lịch sử và lý do.</span>
            </div>
            <div class="acct-action-card notify" onclick="openNotifyComposeModal('${u.id}')">
                <span class="aac-ico">🔔</span>
                <span class="aac-title">Gửi thông báo riêng</span>
                <span class="aac-desc">Gửi 1 thông báo chỉ riêng tài khoản này thấy (khác với thông báo nổi cho mọi người).</span>
            </div>
            <div class="acct-action-card pwd" onclick="openPasswordModal('${u.id}')">
                <span class="aac-ico">🔑</span>
                <span class="aac-title">Đặt lại mật khẩu</span>
                <span class="aac-desc">Đặt mật khẩu mới cho khách và gửi cho họ để đăng nhập lại.</span>
            </div>
            <div class="acct-action-card rename" onclick="openRenameModal('${u.id}')">
                <span class="aac-ico">✏️</span>
                <span class="aac-title">Đổi tên hiển thị</span>
                <span class="aac-desc">Sửa tên hiển thị của tài khoản này trên hệ thống.</span>
            </div>
            <div class="acct-action-card lock" onclick="toggleBanAccount('${u.id}', ${!isBanned})">
                <span class="aac-ico">${isBanned ? '🔓' : '🔒'}</span>
                <span class="aac-title">${isBanned ? 'Mở khoá truy cập' : 'Khoá truy cập'}</span>
                <span class="aac-desc">${isBanned ? 'Cho phép tài khoản này đăng nhập lại bình thường.' : 'Tài khoản sẽ không đăng nhập được cho tới khi mở khoá lại.'}</span>
            </div>
            <div class="acct-action-card danger" onclick="deleteAccount('${u.id}')">
                <span class="aac-ico">🗑️</span>
                <span class="aac-title">Xoá tài khoản</span>
                <span class="aac-desc">Xoá vĩnh viễn tài khoản này. Không thể hoàn tác.</span>
            </div>
        </div>

        <div class="acct-orders-section">
            <h4 class="acct-orders-title">🧾 Lịch sử mua hàng</h4>
            <div id="acctOrderHistoryWrap" class="acct-orders-wrap">
                <div class="empty-state" style="padding:20px;">Đang tải...</div>
            </div>
        </div>`;

    document.getElementById('acctListView').classList.add('hidden');
    document.getElementById('acctDetailView').classList.remove('hidden');
    loadAccountOrderHistory(u.id);
}

// ---- Lịch sử mua hàng (sepay_orders) của tài khoản đang xem chi tiết ----
const ACCT_ORDER_STATUS_LABEL = {
    paid: { text: 'Đã thanh toán', cls: 'paid' },
    pending: { text: 'Chờ thanh toán', cls: 'pending' },
    failed: { text: 'Thất bại', cls: 'failed' },
    cancelled: { text: 'Đã huỷ', cls: 'cancelled' },
};
const ACCT_ORDER_TYPE_ICON = {
    subscription: '👑',
    document: '📄',
    product: '🛍️',
    wallet_topup: '💰',
    course: '🎓',
};
async function loadAccountOrderHistory(userId){
    const wrap = document.getElementById('acctOrderHistoryWrap');
    const result = await callAdminUsersFn({ action:'order_history', userId });
    if (!wrap) return; // đã đóng trang chi tiết trước khi tải xong
    if (result.error){
        wrap.innerHTML = `<div class="empty-state" style="padding:20px;color:var(--red);">${escapeHtml(result.error)}</div>`;
        return;
    }
    const orders = result.orders || [];
    if (!orders.length){
        wrap.innerHTML = `<div class="empty-state" style="padding:20px;">Tài khoản này chưa có đơn hàng nào.</div>`;
        return;
    }
    wrap.innerHTML = orders.map(o => {
        const st = ACCT_ORDER_STATUS_LABEL[o.status] || { text: o.status, cls: '' };
        const icon = ACCT_ORDER_TYPE_ICON[o.order_type] || '🧾';
        return `
        <div class="acct-order-row">
            <span class="aor-ico">${icon}</span>
            <span class="aor-info">
                <span class="aor-title">${escapeHtml(o.title || o.order_type)}</span>
                <span class="aor-meta">${escapeHtml(o.invoice_number || '')}${o.payment_method ? ('<span class="dot-sep">·</span>' + escapeHtml(o.payment_method)) : ''}<span class="dot-sep">·</span>${fmtDate(o.created_at)}</span>
            </span>
            <span class="aor-amount">${fmtMoney(o.amount)}</span>
            <span class="aor-status ${st.cls}">${escapeHtml(st.text)}</span>
        </div>`;
    }).join('');
}
function closeAccountDetail(){
    document.getElementById('acctDetailView').classList.add('hidden');
    document.getElementById('acctListView').classList.remove('hidden');
}

function toggleAcctMenu(id, btn){
    const menu = document.getElementById('acctmenu-' + id);
    const wasHidden = menu.classList.contains('hidden');
    closeAllAcctMenus();
    if (wasHidden && btn){
        const rect = btn.getBoundingClientRect();
        menu.style.top = (rect.bottom + 4) + 'px';
        menu.style.left = 'auto';
        menu.style.right = (window.innerWidth - rect.right) + 'px';
        menu.classList.remove('hidden');
    }
}
function closeAllAcctMenus(){
    document.querySelectorAll('[id^="acctmenu-"]').forEach(el => el.classList.add('hidden'));
}
document.addEventListener('click', () => closeAllAcctMenus());

// ================= THÔNG BÁO THÀNH VIÊN (bảng user_notifications) =================
// Gửi 1 thông báo riêng tới ĐÚNG 1 thành viên do admin chọn — khác với "Thông báo nổi"
// (site_settings, hiện popup cho TẤT CẢ mọi người). Thành viên chỉ thấy thông báo của
// chính họ nhờ RLS "user_notifications_select_own" (xem migration 0005).
let notifyCache = [];
let notifyFilter = 'all';

async function showNotifyManager(){
    rememberAdminPanel('notify');
    showAdminPanel('notifyPanel', 'navNotify');
    document.getElementById('notifySearch').value = '';
    setNotifyFilter('all');
    await loadNotifyList();
}

// email/tên hiển thị của người nhận không nằm trong bảng user_notifications (chỉ có user_id),
// nên cần accountsCache (đã tải qua edge function "list") để tra ngược email/tên. Nếu accountsCache
// chưa có (vào thẳng tab này mà chưa từng mở "Tài khoản"), tải tạm trước.
async function ensureAccountsCacheLoaded(){
    if (!accountsCache || !accountsCache.length){
        const result = await callAdminUsersFn({ action:'list' });
        if (!result.error) accountsCache = result.users || [];
    }
    return accountsCache;
}

async function loadNotifyList(){
    const box = document.getElementById('notifyListWrap');
    box.innerHTML = `<div class="empty-state" style="padding:20px;">Đang tải...</div>`;
    await ensureAccountsCacheLoaded();
    const { data, error } = await sb.from('user_notifications').select('*').order('created_at', { ascending:false });
    if (error){
        box.innerHTML = `<div class="empty-state" style="padding:20px;color:var(--red);">${escapeHtml(error.message)}</div>`;
        document.getElementById('notifyCount').innerText = '';
        return;
    }
    notifyCache = data || [];
    const unread = notifyCache.filter(n => !n.is_read).length;
    document.getElementById('notifyStatTotal').innerText = notifyCache.length;
    document.getElementById('notifyStatUnread').innerText = unread;
    document.getElementById('notifyStatRead').innerText = notifyCache.length - unread;
    renderNotifyList();
}

function setNotifyFilter(f){
    notifyFilter = f;
    document.querySelectorAll('#notifyFilterChips .acct-chip').forEach(el => el.classList.toggle('active', el.dataset.f === f));
    renderNotifyList();
}

function notifyRecipientLabel(userId){
    const u = (accountsCache || []).find(x => x.id === userId);
    if (!u) return '(tài khoản đã xoá)';
    return u.full_name ? `${u.full_name} · ${u.email}` : (u.email || userId);
}

function renderNotifyList(){
    const q = (document.getElementById('notifySearch').value || '').trim().toLowerCase();
    const box = document.getElementById('notifyListWrap');
    const list = notifyCache.filter(n => {
        if (notifyFilter === 'unread' && n.is_read) return false;
        if (notifyFilter === 'read' && !n.is_read) return false;
        if (!q) return true;
        const label = notifyRecipientLabel(n.user_id).toLowerCase();
        return label.includes(q) || (n.title || '').toLowerCase().includes(q) || (n.message || '').toLowerCase().includes(q);
    });
    document.getElementById('notifyCount').innerText = list.length + ' / ' + notifyCache.length + ' thông báo';
    if (!list.length){
        box.innerHTML = `<div class="empty-state" style="padding:36px 14px;text-align:center;">Chưa có thông báo nào khớp. Bấm nút "+" để gửi cho 1 thành viên.</div>`;
        return;
    }
    box.innerHTML = list.map(n => `
        <div class="acct-row ${n.is_read ? '' : 'banned'}" data-id="${n.id}">
            <span class="acct-avatar">🔔</span>
            <span class="acct-info">
                <span class="acct-name">${escapeHtml(n.title || '(không có tiêu đề)')}<span class="acct-badge ${n.is_read ? 'active' : 'banned'}">${n.is_read ? 'Đã đọc' : 'Chưa đọc'}</span></span>
                <span class="acct-meta">${escapeHtml(notifyRecipientLabel(n.user_id))}<span class="dot-sep">·</span>${escapeHtml((n.message || '').slice(0, 80))}${(n.message || '').length > 80 ? '…' : ''}<span class="dot-sep">·</span>${fmtDate(n.created_at)}</span>
            </span>
            <span class="acct-row-actions">
                <button class="icon-edit" title="Xoá thông báo" onclick="event.stopPropagation(); deleteNotify('${n.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path></svg></button>
            </span>
        </div>`).join('');
}

function deleteNotify(id){
    showConfirm(
        'Xoá thông báo?',
        'Xoá thông báo này? Nếu thành viên chưa đọc, họ sẽ không còn thấy thông báo này nữa. Không thể hoàn tác.',
        async () => {
            const { error } = await sb.from('user_notifications').delete().eq('id', id);
            if (error){ showMsg('Lỗi xoá: ' + error.message, 'err'); return; }
            showMsg('Đã xoá thông báo.', 'ok');
            loadNotifyList();
        }
    );
}

// ---------- MODAL: soạn & gửi thông báo riêng cho 1 thành viên ----------
// Nếu gọi với userId có sẵn (từ trang chi tiết 1 tài khoản) -> chọn sẵn người nhận đó.
// Nếu gọi không có tham số (từ tab "Thông báo thành viên") -> cho tìm/chọn người nhận.
let notifyPickedUserId = null;
async function openNotifyComposeModal(userId){
    await ensureAccountsCacheLoaded();
    notifyPickedUserId = userId || null;
    renderNotifyComposeForm();
    document.getElementById('acctFormOverlay').classList.remove('hidden');
}
function renderNotifyComposeForm(){
    const picked = notifyPickedUserId ? (accountsCache || []).find(x => x.id === notifyPickedUserId) : null;
    document.getElementById('acctFormBox').innerHTML = `
        <h4>🔔 Gửi thông báo riêng</h4>
        ${picked
            ? `<p class="acct-form-target">Gửi tới <b>${escapeHtml(picked.full_name || picked.email || '')}</b> (${escapeHtml(picked.email || '')})</p>`
            : `
            <label style="margin-top:0;">Người nhận</label>
            <input id="notifyRecipientSearch" placeholder="Tìm theo email hoặc tên..." oninput="renderNotifyRecipientOptions()">
            <div id="notifyRecipientOptions"></div>
            `}
        <label style="margin-top:10px;">Tiêu đề</label>
        <input id="notifyTitleInput" placeholder="VD: Nhắc gia hạn gói Pro">
        <label style="margin-top:10px;">Nội dung</label>
        <textarea id="notifyMessageInput" rows="4" placeholder="Nội dung thông báo gửi riêng cho thành viên này..."></textarea>
        <div id="acctFormMsg"></div>
        <div class="acct-form-actions">
            <button class="btn-acct-cancel" onclick="closeAcctFormModal()">Hủy</button>
            <button class="btn-acct-save" onclick="submitNotify()">Gửi thông báo</button>
        </div>`;
    if (!picked) renderNotifyRecipientOptions();
}
function renderNotifyRecipientOptions(){
    const wrap = document.getElementById('notifyRecipientOptions');
    if (!wrap) return;
    const q = (document.getElementById('notifyRecipientSearch').value || '').trim().toLowerCase();
    const list = (accountsCache || [])
        .filter(u => !q || (u.email || '').toLowerCase().includes(q) || (u.full_name || '').toLowerCase().includes(q))
        .slice(0, 30);
    if (!list.length){ wrap.innerHTML = `<div class="hint" style="padding:8px;">Không tìm thấy tài khoản nào.</div>`; return; }
    wrap.innerHTML = list.map(u => `
        <div class="notify-recipient-opt${notifyPickedUserId === u.id ? ' picked' : ''}" onclick="pickNotifyRecipient('${u.id}')">
            ${escapeHtml(u.full_name || '(chưa đặt tên)')} <span class="hint-inline">· ${escapeHtml(u.email || '')}</span>
        </div>`).join('');
}
function pickNotifyRecipient(userId){
    notifyPickedUserId = userId;
    renderNotifyComposeForm();
}
async function submitNotify(){
    const msg = document.getElementById('acctFormMsg');
    const title = document.getElementById('notifyTitleInput').value.trim();
    const message = document.getElementById('notifyMessageInput').value.trim();
    if (!notifyPickedUserId){ msg.className='err'; msg.innerText = 'Chọn 1 người nhận trước.'; return; }
    if (!title || !message){ msg.className='err'; msg.innerText = 'Nhập đủ tiêu đề và nội dung.'; return; }

    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from('user_notifications').insert({
        user_id: notifyPickedUserId,
        title,
        message,
        created_by: user ? user.id : null
    });
    if (error){ msg.className='err'; msg.innerText = 'Lỗi gửi: ' + error.message; return; }
    closeAcctFormModal();
    showMsg('Đã gửi thông báo.', 'ok');
    notifyPickedUserId = null;
    if (!document.getElementById('notifyPanel').classList.contains('hidden')) loadNotifyList();
}

// ================= GÓP Ý HỌC VIÊN (bảng feedback) =================
let feedbackCache = [];
let fbFilter = 'all';

async function showFeedbackManager(){
    rememberAdminPanel('feedback');
    showAdminPanel('feedbackPanel', 'navFeedback');
    document.getElementById('fbSearch').value = '';
    closeFeedbackDetail();
    await loadFeedbackList();
}

async function loadFeedbackList(){
    document.getElementById('fbListWrap').innerHTML = `<div class="empty-state" style="padding:20px;">Đang tải...</div>`;
    const { data, error } = await sb.from('feedback').select('*').order('created_at', { ascending:false });
    if (error){
        document.getElementById('fbListWrap').innerHTML = `<div class="empty-state" style="padding:20px;color:var(--red);">${escapeHtml(error.message)}</div>`;
        document.getElementById('fbCount').innerText = '';
        return;
    }
    feedbackCache = data || [];

    const newCount = feedbackCache.filter(f => f.status === 'new').length;
    const resolvedCount = feedbackCache.filter(f => f.status === 'resolved').length;
    document.getElementById('fbStatTotal').innerText = feedbackCache.length;
    document.getElementById('fbStatNew').innerText = newCount;
    document.getElementById('fbStatResolved').innerText = resolvedCount;

    const badge = document.getElementById('fbNavBadge');
    if (newCount > 0){ badge.innerText = newCount; badge.classList.remove('hidden'); }
    else { badge.classList.add('hidden'); }

    renderFeedbackList();
}

function setFbFilter(f){
    fbFilter = f;
    document.querySelectorAll('#fbFilterChips .acct-chip').forEach(el => el.classList.toggle('active', el.dataset.f === f));
    renderFeedbackList();
}

function fbStatusLabel(s){
    return s === 'resolved' ? 'Đã xử lý' : (s === 'read' ? 'Đã đọc' : 'Chưa đọc');
}
function fbTypeMeta(t){
    return {
        wrong_question:  { label:'Câu hỏi sai',    ico:'⚠️' },
        feature_request: { label:'Góp ý tính năng', ico:'💡' },
        payment_issue:   { label:'Thanh toán',      ico:'💳' },
        other:           { label:'Khác',            ico:'💬' }
    }[t] || { label:'Khác', ico:'💬' };
}
function fbContextLine(f){
    return [f.subject_name, f.chapter ? ('Chương ' + f.chapter) : '', f.question_ref].filter(Boolean).join(' · ');
}

function renderFeedbackList(){
    const q = (document.getElementById('fbSearch').value || '').trim().toLowerCase();
    const list = feedbackCache.filter(f => {
        if (fbFilter !== 'all' && f.status !== fbFilter) return false;
        return !q || (f.email || '').toLowerCase().includes(q) || (f.message || '').toLowerCase().includes(q) || (f.full_name || '').toLowerCase().includes(q);
    });
    document.getElementById('fbCount').innerText = list.length + ' góp ý';
    const wrap = document.getElementById('fbListWrap');
    if (!list.length){
        wrap.innerHTML = `<div class="empty-state" style="padding:36px 14px;text-align:center;">Không có góp ý nào khớp.</div>`;
        return;
    }
    wrap.innerHTML = list.map(f => {
        const initial = (f.full_name || f.email || '?').trim()[0].toUpperCase();
        const tMeta = fbTypeMeta(f.type);
        const ctxLine = fbContextLine(f);
        const emailChip = f.email
            ? `<span class="fb-email-chip" title="${escapeHtml(f.email)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="m4 6 8 7 8-7"/></svg>${escapeHtml(f.email)}</span>`
            : `<span class="fb-no-email">✖ Không có email</span>`;
        const sentChip = f.email_sent ? `<span class="fb-sent-chip">✉️ Đã gửi email</span>` : '';
        return `
        <div class="acct-row fb-row ${f.status === 'new' ? 'is-new' : ''}" data-id="${f.id}" onclick="openFeedbackDetail('${f.id}')" style="cursor:pointer;">
            <span class="acct-avatar ${f.image_url ? 'has-img' : ''}">${escapeHtml(initial)}</span>
            <span class="acct-info">
                <span class="acct-name">${escapeHtml(f.full_name || 'Ẩn danh')}<span class="acct-badge ${f.status}">${fbStatusLabel(f.status)}</span><span class="acct-badge" style="background:var(--bg2,#f1f2f6);color:var(--gray);">${tMeta.ico} ${tMeta.label}</span>${sentChip}</span>
                <span class="acct-meta" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;white-space:normal;margin:2px 0;">${emailChip}<span class="dot-sep">·</span>${fmtDate(f.created_at)}</span>
                ${ctxLine ? `<span class="acct-meta" style="white-space:normal;">📍 ${escapeHtml(ctxLine)}</span>` : ''}
                <span class="fb-preview">${escapeHtml((f.message || '').slice(0, 100))}${(f.message || '').length > 100 ? '…' : ''}</span>
            </span>
            <span class="acct-row-actions">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;color:var(--gray);"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </span>
        </div>`;
    }).join('');
}

// ---------- Mẫu email cảm ơn / phản hồi theo loại góp ý ----------
function fbTemplates(f){
    const name = (f.full_name || '').trim() || 'bạn';
    const ctx = fbContextLine(f);
    const ctxLine = ctx ? `\nNội dung liên quan: ${ctx}\n` : '\n';
    return {
        wrong_question: {
            label: '⚠️ Báo lỗi câu hỏi',
            subject: 'SNG EDU đã ghi nhận góp ý về câu hỏi bạn báo lỗi',
            body: `Chào ${name},\n\nCảm ơn bạn đã dành thời gian báo lỗi cho SNG EDU. Đội ngũ đã kiểm tra lại nội dung bạn phản ánh${ctxLine}và tiến hành rà soát, cập nhật lại câu hỏi/đáp án cho chính xác.\n\nSự đóng góp của bạn giúp nội dung học tập trên SNG EDU ngày càng chất lượng hơn cho tất cả học viên. Nếu bạn phát hiện thêm lỗi nào khác, đừng ngại gửi góp ý cho tụi mình nhé!\n\nChúc bạn học tốt 💪\nĐội ngũ SNG EDU`
        },
        feature_request: {
            label: '💡 Góp ý tính năng',
            subject: 'Cảm ơn góp ý của bạn cho SNG EDU',
            body: `Chào ${name},\n\nCảm ơn bạn đã gửi góp ý cho SNG EDU!${ctxLine}Đội ngũ đã ghi nhận đề xuất này và sẽ xem xét đưa vào kế hoạch phát triển sắp tới để cải thiện trải nghiệm học tập tốt hơn.\n\nMọi ý kiến của học viên đều rất quý giá với tụi mình. Cảm ơn bạn đã đồng hành cùng SNG EDU!\n\nThân mến,\nĐội ngũ SNG EDU`
        },
        payment_issue: {
            label: '💳 Thanh toán',
            subject: 'SNG EDU đã xử lý vấn đề thanh toán của bạn',
            body: `Chào ${name},\n\nCảm ơn bạn đã liên hệ về vấn đề thanh toán.${ctxLine}Đội ngũ đã kiểm tra và xử lý xong. Bạn vui lòng đăng nhập lại tài khoản để kiểm tra, nếu vẫn còn vướng mắc, hãy phản hồi lại email này để được hỗ trợ tiếp nhé.\n\nXin lỗi bạn vì sự bất tiện này.\n\nThân mến,\nĐội ngũ SNG EDU`
        },
        other: {
            label: '💬 Khác',
            subject: 'SNG EDU đã nhận được góp ý của bạn',
            body: `Chào ${name},\n\nCảm ơn bạn đã dành thời gian gửi góp ý cho SNG EDU!${ctxLine}Đội ngũ đã đọc và ghi nhận nội dung bạn chia sẻ.\n\nNếu cần hỗ trợ thêm, bạn cứ nhắn lại cho tụi mình nhé. Chúc bạn học tốt!\n\nThân mến,\nĐội ngũ SNG EDU`
        }
    };
}

function applyFbTemplate(key){
    const f = feedbackCache.find(x => x.id === window.__fbOpenId);
    if (!f) return;
    const t = fbTemplates(f)[key] || fbTemplates(f).other;
    document.getElementById('fbReplySubject').value = t.subject;
    document.getElementById('fbReplyBody').value = t.body;
}

async function openFeedbackDetail(id){
    const f = feedbackCache.find(x => x.id === id);
    if (!f) return;
    window.__fbOpenId = id;
    const wasNew = f.status === 'new';
    if (wasNew) f.status = 'read'; // cập nhật cục bộ trước để hiển thị đúng ngay, đồng bộ server bên dưới

    const tMeta = fbTypeMeta(f.type);
    const ctxLine = fbContextLine(f);
    const templates = fbTemplates(f);
    const defaultTplKey = f.type && templates[f.type] ? f.type : 'other';
    const defaultTpl = f.reply_subject || f.reply_message
        ? { subject: f.reply_subject || '', body: f.reply_message || '' }
        : templates[defaultTplKey];

    document.getElementById('fbDetailView').innerHTML = `
        <button class="acct-detail-back" onclick="closeFeedbackDetail()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
            Quay lại danh sách
        </button>

        <div class="fb-detail-grid">
            <!-- ===== CỘT TRÁI: chi tiết góp ý ===== -->
            <div>
                <div class="fb-card">
                    <h4><span class="n">1</span>Người gửi</h4>
                    <div class="fb-sender-row">
                        <span class="acct-avatar">${escapeHtml((f.full_name || f.email || '?').trim()[0].toUpperCase())}</span>
                        <div>
                            <div class="fb-sender-name">${escapeHtml(f.full_name || 'Ẩn danh')}</div>
                            <div class="fb-sender-sub">
                                ${f.email
                                    ? `<span class="fb-email-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="m4 6 8 7 8-7"/></svg>${escapeHtml(f.email)}</span>`
                                    : `<span class="fb-no-email">✖ Không có email — không thể gửi email phản hồi</span>`}
                            </div>
                        </div>
                    </div>
                    <div class="fb-kv-list">
                        <div class="kv-row"><span class="kv-label">Trạng thái</span><span class="kv-val"><span class="acct-badge ${f.status}">${fbStatusLabel(f.status)}</span></span></div>
                        <div class="kv-row"><span class="kv-label">Loại góp ý</span><span class="kv-val">${tMeta.ico} ${tMeta.label}</span></div>
                        <div class="kv-row"><span class="kv-label">Thời gian gửi</span><span class="kv-val">${fmtDate(f.created_at)}</span></div>
                        ${ctxLine ? `<div class="kv-row"><span class="kv-label">Liên quan đến</span><span class="kv-val">${escapeHtml(ctxLine)}</span></div>` : ''}
                        ${f.page_url ? `<div class="kv-row"><span class="kv-label">Trang gốc</span><span class="kv-val"><a href="${escapeHtml(f.page_url)}" target="_blank" rel="noopener">${escapeHtml(f.page_url)}</a></span></div>` : ''}
                        ${f.email_sent ? `<div class="kv-row"><span class="kv-label">Email phản hồi</span><span class="kv-val"><span class="fb-sent-chip">✉️ Đã gửi lúc ${fmtDate(f.email_sent_at)}</span></span></div>` : ''}
                    </div>
                    ${(f.subject_id && f.chapter) ? `
                    <button class="fb-jump-btn" onclick="jumpToFeedbackQuestion('${f.id}')">
                        🔧 Sửa câu hỏi này ${f.question_id ? '(nhảy thẳng, chính xác)' : '(tự dò theo nội dung)'}
                    </button>` : ''}
                </div>

                <div class="fb-card">
                    <h4><span class="n">2</span>Nội dung góp ý</h4>
                    <div class="fb-detail-msg">${escapeHtml(f.message || '(không có nội dung)')}</div>
                    ${f.image_url ? `<a href="${escapeHtml(f.image_url)}" target="_blank" rel="noopener" style="display:block;margin-top:14px;">
                        <img src="${escapeHtml(f.image_url)}" alt="Ảnh minh hoạ" style="max-width:100%;max-height:320px;border-radius:12px;border:1px solid var(--border);">
                    </a>` : ''}
                </div>

                <div class="fb-card">
                    <h4><span class="n">3</span>Ghi chú nội bộ <span style="font-weight:500;color:var(--gray);text-transform:none;font-size:.78rem;">(chỉ admin thấy, không gửi cho học viên)</span></h4>
                    <textarea id="fbNoteInput" rows="3" style="width:100%;border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;font-family:var(--font-body);font-size:.86rem;resize:vertical;" placeholder="VD: đã sửa đáp án câu 12 chương 3...">${escapeHtml(f.admin_note || '')}</textarea>
                    <div id="fbNoteMsg" class="hint" style="margin-top:6px;min-height:1.1em;"></div>
                    <button class="btn-mini-save" style="margin-top:4px;" onclick="saveFeedbackNote('${f.id}')">Lưu ghi chú</button>
                </div>
            </div>

            <!-- ===== CỘT PHẢI: trạng thái + soạn & gửi email ===== -->
            <div>
                <div class="fb-card">
                    <h4>Xử lý nhanh</h4>
                    <div class="fb-status-actions">
                        <button class="fb-status-btn ${f.status === 'read' ? 'active' : ''}" onclick="setFeedbackStatus('${f.id}','read')">👁️ Đã đọc</button>
                        <button class="fb-status-btn ${f.status === 'resolved' ? 'active' : ''}" onclick="setFeedbackStatus('${f.id}','resolved')">✅ Đã xử lý</button>
                        <button class="fb-status-btn danger" onclick="deleteFeedbackItem('${f.id}')">🗑️ Xoá</button>
                    </div>
                </div>

                <div class="fb-card fb-reply-box">
                    <h4>✉️ Soạn email gửi học viên</h4>
                    ${!f.email ? `<p class="hint" style="margin:0;">Góp ý này không có email người gửi nên không thể gửi email phản hồi. Bạn vẫn có thể đánh dấu đã xử lý ở trên.</p>` : `
                    ${f.email_sent ? `
                    <div class="fb-already-sent">
                        <b>Đã gửi email lúc ${fmtDate(f.email_sent_at)}</b>
                        Tiêu đề: ${escapeHtml(f.reply_subject || '')}
                    </div>
                    <button class="fb-resend-link" onclick="document.getElementById('fbResendWrap').classList.toggle('hidden')">Soạn & gửi lại email khác →</button>
                    <div id="fbResendWrap" class="hidden" style="margin-top:10px;">
                    ` : ``}
                    <div class="fb-template-chips">
                        ${Object.keys(templates).map(k => `<button type="button" class="fb-template-chip" onclick="applyFbTemplate('${k}')">${templates[k].label}</button>`).join('')}
                    </div>
                    <label>Tiêu đề email</label>
                    <input type="text" id="fbReplySubject" value="${escapeHtml(defaultTpl.subject || '')}" placeholder="Tiêu đề email...">
                    <label>Nội dung email</label>
                    <textarea id="fbReplyBody" placeholder="Nội dung email...">${escapeHtml(defaultTpl.body || '')}</textarea>
                    <button class="fb-send-btn" id="fbSendBtn" onclick="sendFeedbackReply('${f.id}')">
                        <span id="fbSendBtnLabel">📤 Gửi email cho ${escapeHtml(f.email)}</span>
                    </button>
                    <div id="fbSendMsg" class="fb-send-msg"></div>
                    ${f.email_sent ? `</div>` : ``}
                    `}
                </div>
            </div>
        </div>`;

    document.getElementById('fbListView').classList.add('hidden');
    document.getElementById('fbDetailView').classList.remove('hidden');

    // Tự động đánh dấu "đã đọc" khi mở xem, nếu đang ở trạng thái "chưa đọc"
    if (wasNew) await setFeedbackStatus(id, 'read', true);
}

async function sendFeedbackReply(id){
    const f = feedbackCache.find(x => x.id === id);
    if (!f) return;
    const subject = (document.getElementById('fbReplySubject').value || '').trim();
    const message = (document.getElementById('fbReplyBody').value || '').trim();
    const msgEl = document.getElementById('fbSendMsg');
    const btn = document.getElementById('fbSendBtn');
    if (!subject || !message){
        msgEl.style.color = 'var(--red)';
        msgEl.innerText = 'Vui lòng nhập đủ tiêu đề và nội dung email.';
        return;
    }
    btn.disabled = true;
    document.getElementById('fbSendBtnLabel').innerText = 'Đang gửi...';
    msgEl.style.color = 'var(--gray)';
    msgEl.innerText = '';

    const { data, error } = await sb.functions.invoke('send-feedback-reply', {
        body: { feedback_id: id, subject, message }
    });

    if (error || (data && data.error)){
        btn.disabled = false;
        document.getElementById('fbSendBtnLabel').innerText = '📤 Gửi email cho ' + (f.email || '');
        msgEl.style.color = 'var(--red)';
        msgEl.innerText = 'Lỗi: ' + ((data && data.error) || error.message || 'Không gửi được email.');
        return;
    }

    f.status = 'resolved';
    f.email_sent = true;
    f.email_sent_at = new Date().toISOString();
    f.reply_subject = subject;
    f.reply_message = message;
    showMsg('Đã gửi email cho học viên và đánh dấu xử lý xong.', 'ok');
    await loadFeedbackList();
    document.getElementById('fbListView').classList.add('hidden');
    document.getElementById('fbDetailView').classList.remove('hidden');
    openFeedbackDetail(id);
}
function closeFeedbackDetail(){
    document.getElementById('fbDetailView').classList.add('hidden');
    document.getElementById('fbListView').classList.remove('hidden');
}

async function setFeedbackStatus(id, status, silent){
    const { error } = await sb.from('feedback').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    if (error){ if (!silent) showMsg('Lỗi: ' + error.message, 'err'); return; }
    const f = feedbackCache.find(x => x.id === id);
    if (f) f.status = status;
    if (!silent){
        showMsg('Đã cập nhật trạng thái.', 'ok');
        if (!document.getElementById('fbDetailView').classList.contains('hidden')) openFeedbackDetail(id);
    }
    await loadFeedbackList();
    if (!silent && !document.getElementById('fbDetailView').classList.contains('hidden')){
        document.getElementById('fbListView').classList.add('hidden');
        document.getElementById('fbDetailView').classList.remove('hidden');
    }
}

// Nhảy từ 1 góp ý "câu hỏi sai" thẳng tới đúng môn/chương/câu hỏi trong Quản lý nội dung
// và mở sẵn form sửa, thay vì bắt admin tự dò tìm thủ công.
// - Góp ý mới (sau khi có cột question_id): khớp chính xác 100% theo ID thật của câu hỏi.
// - Góp ý cũ (chưa có question_id, gửi trước khi tính năng này ra mắt): tự dò theo đoạn
//   trích văn bản lưu trong question_ref, làm phương án dự phòng (có thể không tuyệt đối chính xác).
async function jumpToFeedbackQuestion(fbId){
    const f = feedbackCache.find(x => x.id === fbId);
    if (!f) return;
    if (!f.subject_id || !f.chapter){
        showMsg('Góp ý này không có đủ thông tin môn học/chương để nhảy tới câu hỏi.', 'err');
        return;
    }

    if (!subjects.length) await loadSubjects();
    const s = subjects.find(x => x.id === f.subject_id);
    if (!s){
        showMsg('Không tìm thấy môn học tương ứng (có thể đã bị xoá).', 'err');
        return;
    }
    currentSubject = s;
    currentChapter = null;
    renderSubjectList();
    updateContextBar();

    await loadChapters();
    currentChapter = chapters.find(c => c.chapter === f.chapter) || null;
    if (!currentChapter){
        showMsg('Không tìm thấy chương/đề tương ứng (có thể đã bị xoá hoặc đổi tên).', 'err');
        return;
    }
    renderChapterList();
    updateContextBar();
    showQuestionsPanel();
    await loadQuestions(); // nạp currentQuestions cho đúng chương này

    let target = null;
    let approximate = false;
    if (f.question_id){
        target = currentQuestions.find(q => q.id === f.question_id);
    }
    if (!target){
        // Dự phòng cho góp ý cũ: dò theo đoạn trích văn bản sau dấu " — " trong question_ref
        const excerpt = (f.question_ref || '').split(' — ').slice(1).join(' — ').trim().toLowerCase();
        if (excerpt){
            const key = excerpt.slice(0, 40);
            const candidates = currentQuestions.filter(q => (q.content || '').toLowerCase().includes(key));
            if (candidates.length){ target = candidates[0]; approximate = true; }
        }
    }

    if (!target){
        showMsg('Đã mở đúng môn & chương, nhưng không tự tìm được chính xác câu hỏi — bạn tìm giúp trong danh sách bên dưới.', 'err');
        return;
    }

    startEdit(target);
    setTimeout(() => {
        const el = document.querySelector(`#qList .q-item[data-id="${target.id}"]`);
        if (el){
            el.scrollIntoView({ behavior:'smooth', block:'center' });
            el.classList.add('q-jump-highlight');
            setTimeout(() => el.classList.remove('q-jump-highlight'), 2300);
        }
    }, 200);

    showMsg(approximate
        ? 'Đã tự tìm câu gần đúng theo nội dung góp ý (góp ý cũ chưa lưu ID chính xác) — kiểm tra kỹ trước khi lưu.'
        : 'Đã mở đúng câu hỏi học viên báo lỗi.', approximate ? 'err' : 'ok');
}

async function saveFeedbackNote(id){
    const note = document.getElementById('fbNoteInput').value.trim();
    const msg = document.getElementById('fbNoteMsg');
    const { error } = await sb.from('feedback').update({ admin_note: note, updated_at: new Date().toISOString() }).eq('id', id);
    if (error){ msg.style.color = 'var(--red)'; msg.innerText = 'Lỗi: ' + error.message; return; }
    const f = feedbackCache.find(x => x.id === id);
    if (f) f.admin_note = note;
    msg.style.color = 'var(--green)'; msg.innerText = 'Đã lưu ghi chú.';
}

async function deleteFeedbackItem(id){
    if (!confirm('Xoá vĩnh viễn góp ý này? Không thể hoàn tác.')) return;
    const { error } = await sb.from('feedback').delete().eq('id', id);
    if (error){ showMsg('Lỗi: ' + error.message, 'err'); return; }
    showMsg('Đã xoá góp ý.', 'ok');
    closeFeedbackDetail();
    await loadFeedbackList();
}

// ---------- MODAL: đổi tên hiển thị ----------
function openRenameModal(userId){
    const u = accountsCache.find(x => x.id === userId);
    if (!u) return;
    document.getElementById('acctFormBox').innerHTML = `
        <h4>✏️ Đổi tên hiển thị</h4>
        <p class="acct-form-target">Tài khoản <b>${escapeHtml(u.email || '')}</b></p>
        <label style="margin-top:0;">Tên hiển thị</label>
        <input id="acctRenameInput" value="${escapeHtml(u.full_name || '')}" placeholder="Nhập tên hiển thị...">
        <div id="acctFormMsg"></div>
        <div class="acct-form-actions">
            <button class="btn-acct-cancel" onclick="closeAcctFormModal()">Hủy</button>
            <button class="btn-acct-save" onclick="submitRenameAccount('${userId}')">Lưu</button>
        </div>`;
    document.getElementById('acctFormOverlay').classList.remove('hidden');
    document.getElementById('acctRenameInput').focus();
}
async function submitRenameAccount(userId){
    const name = document.getElementById('acctRenameInput').value.trim();
    const msg = document.getElementById('acctFormMsg');
    const result = await callAdminUsersFn({ action:'update_name', userId, fullName: name });
    if (result.error){ msg.className='err'; msg.innerText = 'Lỗi: ' + result.error; return; }
    closeAcctFormModal();
    showMsg('Đã cập nhật tên hiển thị.', 'ok');
    await loadAccountsList();
    if (!document.getElementById('acctDetailView').classList.contains('hidden')) openAccountDetail(userId);
}

// ---------- MODAL: xem / đặt mật khẩu cho khách ----------
// Lưu ý kỹ thuật: mật khẩu được Supabase Auth mã hoá một chiều (hash) ngay khi
// khách đặt, nên KHÔNG có cách nào (kể cả admin) xem lại được mật khẩu gốc của
// khách. Cách khả thi duy nhất là admin đặt một mật khẩu MỚI thay cho khách,
// rồi gửi mật khẩu đó cho khách. Modal dưới đây tạo sẵn 1 mật khẩu mạnh, cho
// phép xem/ẩn, tạo lại hoặc tự nhập, và copy nhanh để gửi cho khách.
function genStrongPassword(){
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}
function openPasswordModal(userId){
    const u = accountsCache.find(x => x.id === userId);
    if (!u) return;
    const suggested = genStrongPassword();
    document.getElementById('acctFormBox').innerHTML = `
        <h4>🔑 Đặt lại mật khẩu</h4>
        <p class="acct-form-target">Tài khoản <b>${escapeHtml(u.email || '')}</b></p>
        <label style="margin-top:0;">Mật khẩu mới cho khách</label>
        <div class="acct-pwd-field">
            <input id="acctPwdInput" type="password" value="${escapeHtml(suggested)}">
            <span class="pwd-actions">
                <button type="button" title="Hiện/ẩn" onclick="toggleAcctPwdVisibility()"><svg id="acctPwdEyeIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path><circle cx="12" cy="12" r="3"></circle></svg></button>
                <button type="button" title="Tạo mật khẩu khác" onclick="regenAcctPwd()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg></button>
                <button type="button" title="Copy" onclick="copyAcctPwd()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
            </span>
        </div>
        <div class="acct-form-note">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            <span>Vì lý do bảo mật, mật khẩu khách tự đặt được mã hoá một chiều nên hệ thống không thể hiện lại mật khẩu cũ. Bạn có thể đặt một mật khẩu mới ở trên rồi gửi cho khách để họ đăng nhập.</span>
        </div>
        <div id="acctFormMsg"></div>
        <div class="acct-form-actions">
            <button class="btn-acct-cancel" onclick="closeAcctFormModal()">Hủy</button>
            <button class="btn-acct-save" onclick="submitAccountPassword('${userId}')">Đặt mật khẩu này</button>
        </div>`;
    document.getElementById('acctFormOverlay').classList.remove('hidden');
}
function toggleAcctPwdVisibility(){
    const input = document.getElementById('acctPwdInput');
    input.type = input.type === 'password' ? 'text' : 'password';
}
function regenAcctPwd(){
    document.getElementById('acctPwdInput').value = genStrongPassword();
    document.getElementById('acctPwdInput').type = 'text';
}
function copyAcctPwd(){
    const input = document.getElementById('acctPwdInput');
    navigator.clipboard.writeText(input.value).then(() => {
        const msg = document.getElementById('acctFormMsg');
        msg.className = 'ok'; msg.innerText = 'Đã copy mật khẩu vào clipboard.';
    }).catch(() => {});
}
async function submitAccountPassword(userId){
    const pass = document.getElementById('acctPwdInput').value;
    const msg = document.getElementById('acctFormMsg');
    if (pass.length < 6){ msg.className='err'; msg.innerText = 'Mật khẩu phải từ 6 ký tự.'; return; }
    const result = await callAdminUsersFn({ action:'reset_password', userId, newPassword: pass });
    if (result.error){ msg.className='err'; msg.innerText = 'Lỗi: ' + result.error; return; }
    closeAcctFormModal();
    showMsg('Đã đặt mật khẩu mới cho tài khoản. Hãy gửi mật khẩu này cho khách.', 'ok');
}
function closeAcctFormModal(){
    document.getElementById('acctFormOverlay').classList.add('hidden');
    notifyPickedUserId = null;
}
function toggleBanAccount(userId, banned){
    showConfirm(
        banned ? 'Khoá đăng nhập?' : 'Mở khoá đăng nhập?',
        banned ? 'Tài khoản này sẽ không đăng nhập được nữa cho tới khi bạn mở khoá lại.' : 'Tài khoản này sẽ đăng nhập lại được bình thường.',
        async () => {
            const result = await callAdminUsersFn({ action:'ban', userId, banned });
            if (result.error) return showMsg('Lỗi: ' + result.error, 'err');
            showMsg(banned ? 'Đã khoá tài khoản.' : 'Đã mở khoá tài khoản.', 'ok');
            closeAccountDetail();
            loadAccountsList();
        }
    );
}
function deleteAccount(userId){
    const u = accountsCache.find(x => x.id === userId);
    showConfirm(
        'Xóa tài khoản?',
        `Xóa vĩnh viễn tài khoản "${u ? u.email : ''}"? Không thể hoàn tác.`,
        async () => {
            const result = await callAdminUsersFn({ action:'delete', userId });
            if (result.error) return showMsg('Lỗi: ' + result.error, 'err');
            showMsg('Đã xóa tài khoản.', 'ok');
            closeAccountDetail();
            loadAccountsList();
        }
    );
}

// ---------- MODAL: nâng cấp / quản lý Pro thủ công ----------
async function openProModal(userId){
    const u = accountsCache.find(x => x.id === userId);
    if (!u) return;
    const isPro = isAcctPro(u);
    const packages = await loadProPackagesCache();
    const pkgOptions = packages.length
        ? packages.map(p => `<option value="${p.id}">${escapeHtml(p.name)} — ${fmtMoney(p.price)} / ${p.duration_days} ngày</option>`).join('')
        : '<option value="" disabled>(Chưa có gói nào trong pro_packages)</option>';

    document.getElementById('acctFormBox').innerHTML = `
        <h4>👑 Quản lý Pro</h4>
        <p class="acct-form-target">Tài khoản <b>${escapeHtml(u.email || '')}</b> — hiện tại: <b style="color:${isPro ? 'var(--green)' : 'var(--gray)'};">${isPro ? (u.premium_until ? ('Pro tới ' + fmtDate(u.premium_until)) : 'Pro vĩnh viễn') : 'Chưa dùng Pro'}</b></p>

        <label style="margin-top:0;">Cách nâng cấp</label>
        <div class="acct-filter-chips" id="proModeChips">
            <button type="button" class="acct-chip active" data-mode="plan" onclick="pickProMode('plan')">Theo gói có sẵn</button>
            <button type="button" class="acct-chip" data-mode="days" onclick="pickProMode('days')">Số ngày tuỳ ý</button>
            <button type="button" class="acct-chip" data-mode="set_date" onclick="pickProMode('set_date')">Chọn ngày hết hạn</button>
        </div>

        <div id="proModePlan">
            <label>Chọn gói</label>
            <select id="proPlanSelect">${pkgOptions}</select>
        </div>
        <div id="proModeDays" class="hidden">
            <label>Số ngày cộng thêm</label>
            <input id="proDaysInput" type="number" min="1" value="30" placeholder="Ví dụ: 30">
        </div>
        <div id="proModeSetDate" class="hidden">
            <label>Hết hạn vào ngày</label>
            <input id="proDateInput" type="date">
        </div>

        <label style="display:flex;align-items:center;gap:9px;text-transform:none;font-weight:600;color:var(--text);margin-top:14px;">
            <span class="tgl-switch"><input type="checkbox" id="proResetFromNow"><span class="tgl-slider"></span></span>
            Tính lại từ hôm nay (bỏ qua hạn Pro hiện có, mặc định là cộng dồn thêm)
        </label>

        <div id="acctFormMsg"></div>
        <div class="acct-form-actions">
            <button class="btn-acct-cancel" onclick="closeAcctFormModal()">Hủy</button>
            <button class="btn-acct-save" onclick="submitSetPro('${userId}')">Kích hoạt / Gia hạn</button>
        </div>
        ${isPro ? `<button class="acct-action-card danger" style="margin-top:14px;width:100%;text-align:center;" onclick="submitRevokePro('${userId}')">
            <span class="aac-title" style="color:var(--red);">🚫 Huỷ Pro ngay (chuyển về Miễn phí)</span>
        </button>` : ''}
    `;
    document.getElementById('acctFormOverlay').classList.remove('hidden');
}
function pickProMode(mode){
    document.querySelectorAll('#proModeChips .acct-chip').forEach(el => el.classList.toggle('active', el.dataset.mode === mode));
    document.getElementById('proModePlan').classList.toggle('hidden', mode !== 'plan');
    document.getElementById('proModeDays').classList.toggle('hidden', mode !== 'days');
    document.getElementById('proModeSetDate').classList.toggle('hidden', mode !== 'set_date');
}
async function submitSetPro(userId){
    const mode = document.querySelector('#proModeChips .acct-chip.active').dataset.mode;
    const msg = document.getElementById('acctFormMsg');
    const payload = { action:'set_pro', userId, mode, resetFromNow: document.getElementById('proResetFromNow').checked };
    if (mode === 'plan'){
        const sel = document.getElementById('proPlanSelect');
        if (!sel.value){ msg.className='err'; msg.innerText = 'Chưa có gói Pro nào để chọn.'; return; }
        payload.planId = sel.value;
    } else if (mode === 'days'){
        payload.days = Number(document.getElementById('proDaysInput').value);
        if (!payload.days || payload.days <= 0){ msg.className='err'; msg.innerText = 'Nhập số ngày hợp lệ.'; return; }
    } else if (mode === 'set_date'){
        payload.date = document.getElementById('proDateInput').value;
        if (!payload.date){ msg.className='err'; msg.innerText = 'Chọn ngày hết hạn.'; return; }
    }
    const result = await callAdminUsersFn(payload);
    if (result.error){ msg.className='err'; msg.innerText = 'Lỗi: ' + result.error; return; }
    closeAcctFormModal();
    showMsg('Đã cập nhật Pro cho tài khoản.', 'ok');
    await loadAccountsList();
    if (!document.getElementById('acctDetailView').classList.contains('hidden')) openAccountDetail(userId);
}
function submitRevokePro(userId){
    showConfirm(
        'Huỷ Pro?',
        'Tài khoản này sẽ chuyển về Miễn phí ngay lập tức.',
        async () => {
            const result = await callAdminUsersFn({ action:'set_pro', userId, mode:'revoke' });
            if (result.error) return showMsg('Lỗi: ' + result.error, 'err');
            closeAcctFormModal();
            showMsg('Đã huỷ Pro.', 'ok');
            await loadAccountsList();
            if (!document.getElementById('acctDetailView').classList.contains('hidden')) openAccountDetail(userId);
        }
    );
}

// ---------- MODAL: cộng / trừ số dư tài khoản ----------
async function openBalanceModal(userId){
    const u = accountsCache.find(x => x.id === userId);
    if (!u) return;
    document.getElementById('acctFormBox').innerHTML = `
        <h4>💰 Cộng / trừ số dư</h4>
        <p class="acct-form-target">Tài khoản <b>${escapeHtml(u.email || '')}</b> — số dư hiện tại: <b class="balance-val">${fmtMoney(u.balance)}</b></p>

        <label style="margin-top:0;">Thao tác</label>
        <div class="acct-filter-chips" id="balModeChips">
            <button type="button" class="acct-chip active" data-mode="add" onclick="pickBalMode('add')">➕ Cộng tiền</button>
            <button type="button" class="acct-chip" data-mode="sub" onclick="pickBalMode('sub')">➖ Trừ tiền</button>
        </div>

        <label>Số tiền (VND)</label>
        <input id="balAmountInput" type="number" min="1" step="1000" placeholder="Ví dụ: 50000">

        <label>Lý do / ghi chú (không bắt buộc)</label>
        <input id="balNoteInput" placeholder="Ví dụ: Tặng do hỗ trợ lỗi hệ thống">

        <div id="balHistoryWrap" class="hint" style="margin-top:10px;">Đang tải lịch sử...</div>

        <div id="acctFormMsg"></div>
        <div class="acct-form-actions">
            <button class="btn-acct-cancel" onclick="closeAcctFormModal()">Hủy</button>
            <button class="btn-acct-save" onclick="submitAdjustBalance('${userId}')">Xác nhận</button>
        </div>
    `;
    document.getElementById('acctFormOverlay').classList.remove('hidden');
    document.getElementById('balAmountInput').focus();

    const hist = await callAdminUsersFn({ action:'balance_history', userId });
    const histWrap = document.getElementById('balHistoryWrap');
    if (!histWrap) return; // modal có thể đã bị đóng trước khi tải xong
    if (hist.error || !hist.transactions || !hist.transactions.length){
        histWrap.innerText = 'Chưa có lịch sử cộng/trừ tiền.';
        return;
    }
    histWrap.innerHTML = '<b style="color:var(--text);">Lịch sử gần đây:</b><br>' + hist.transactions.map(t => {
        const sign = t.amount > 0 ? '+' : '';
        const color = t.amount > 0 ? 'var(--green)' : 'var(--red)';
        return `<span style="color:${color};font-weight:700;">${sign}${fmtMoney(t.amount)}</span> · còn ${fmtMoney(t.balance_after)} · ${fmtDate(t.created_at)}${t.note ? (' · ' + escapeHtml(t.note)) : ''}`;
    }).join('<br>');
}
function pickBalMode(mode){
    document.querySelectorAll('#balModeChips .acct-chip').forEach(el => el.classList.toggle('active', el.dataset.mode === mode));
}
async function submitAdjustBalance(userId){
    const mode = document.querySelector('#balModeChips .acct-chip.active').dataset.mode;
    const raw = Number(document.getElementById('balAmountInput').value);
    const msg = document.getElementById('acctFormMsg');
    if (!raw || raw <= 0){ msg.className='err'; msg.innerText = 'Nhập số tiền hợp lệ (lớn hơn 0).'; return; }
    const amount = mode === 'sub' ? -Math.abs(raw) : Math.abs(raw);
    const note = document.getElementById('balNoteInput').value.trim();
    const result = await callAdminUsersFn({ action:'adjust_balance', userId, amount, note });
    if (result.error){ msg.className='err'; msg.innerText = 'Lỗi: ' + result.error; return; }
    closeAcctFormModal();
    showMsg('Đã cập nhật số dư: ' + fmtMoney(result.balance), 'ok');
    await loadAccountsList();
    if (!document.getElementById('acctDetailView').classList.contains('hidden')) openAccountDetail(userId);
}

// ---------- CÀI ĐẶT TRANG CHỦ (site_settings) ----------
let currentSetKey = null;
let currentSetPayload = null;
let bannerColor = 'amber';
let bannerShape = 'pill';
let bannerSize = 'md';
let bannerEffect = 'subtle';
let promoRealSoldCount = 0; // số đơn Gói thành viên đã thanh toán thật, lấy qua RPC, dùng để tính "còn X/Y suất" ở preview

const SETTINGS_META = {
    site_theme: { title: 'Giao diện', hint: 'Bộ màu thương hiệu &amp; gradient dùng cho TOÀN BỘ trang (khối hero, menu, nút bấm, thẻ...). Đổi ở đây sẽ áp dụng ngay cho mọi người dùng sau khi họ tải lại trang.' },
    home_hero: { title: 'Trang chủ', hint: 'Khối giới thiệu (hero) ở đầu trang chủ, và các thẻ Truy cập nhanh bên dưới nó.' },
    home_texts: { title: 'Chữ trang chủ', hint: 'Tuỳ chỉnh tiêu đề của từng khu vực trên trang chủ và các tab. Mô tả/nội dung từng thẻ vẫn quản lý riêng ở các mục Tài liệu, Trắc nghiệm, Công cụ, Sản phẩm...' },
    site_footer: { title: 'Chân trang', hint: 'Dòng chữ bản quyền / chân trang, dùng chung và đồng bộ trên mọi trang.' },
    report_banner: { title: 'Banner góp ý', hint: 'Banner "Gặp câu hỏi sai?" ở trang danh sách môn học — chỉnh chữ và link đích.' },
    promo_banner: { title: 'Banner Premium', hint: 'Banner đếm ngược + giới hạn suất ở đầu trang chủ, bấm vào sẽ mở popup "Nâng cấp Pro".' },
    announcement_popup: { title: 'Thông báo nổi', hint: 'Popup thông báo hiện giữa màn hình khi người dùng vào trang chủ. Có nút "Đóng" và nút "Ẩn trong X giờ" (X do bạn cấu hình).' },
};

async function openSettingsPanel(key){
    rememberAdminPanel('settings:' + key);
    document.querySelectorAll('#settingsNavList .settings-item').forEach(el => el.classList.remove('active'));
    currentSetKey = key;
    document.querySelectorAll('.settings-item').forEach(el=>{
        el.classList.toggle('active', el.dataset.setkey === key);
    });

    ADMIN_PANEL_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', id !== 'settingsPanel');
    });
    document.getElementById('setSaveMsg').innerText = '';
    closeQuickLinkForm();
    loadQuickLinks();

    const meta = SETTINGS_META[key] || { title:'Cài đặt', hint:'' };
    document.getElementById('setFormTitle').innerText = meta.title;
    document.getElementById('setFormHint').innerText = meta.hint;

    const isTheme = key === 'site_theme';
    const isHero = key === 'home_hero';
    const isTexts = key === 'home_texts';
    const isFooter = key === 'site_footer';
    const isBanner = key === 'report_banner';
    const isPromo = key === 'promo_banner';
    const isAnnounce = key === 'announcement_popup';
    document.getElementById('setFieldsTheme').classList.toggle('hidden', !isTheme);
    document.getElementById('setFieldsHero').classList.toggle('hidden', !isHero);
    document.getElementById('setFieldsTexts').classList.toggle('hidden', !isTexts);
    document.getElementById('setFieldsFooter').classList.toggle('hidden', !isFooter);
    document.getElementById('setFieldsBanner').classList.toggle('hidden', !isBanner);
    document.getElementById('setFieldsPromo').classList.toggle('hidden', !isPromo);
    document.getElementById('setFieldsAnnounce').classList.toggle('hidden', !isAnnounce);
    document.getElementById('setFieldsCard').classList.toggle('hidden', isTheme || isHero || isTexts || isFooter || isBanner || isPromo || isAnnounce);
    document.getElementById('quickLinksSection').classList.toggle('hidden', isTheme || isTexts || isFooter || isBanner || isPromo || isAnnounce);

    const { data, error } = await sb.from('site_settings').select('*').eq('key', key).single();
    if (error && error.code !== 'PGRST116'){
        // PGRST116 = không tìm thấy dòng nào — không sao, dùng giá trị mặc định trống
    }
    currentSetPayload = (data && data.payload) ? data.payload : {};

    if (isTheme){
        document.getElementById('setThemeBrand').value = currentSetPayload.brand || '#4f6bff';
        document.getElementById('setThemeBrand2').value = currentSetPayload.brand2 || '#8b5cf6';
        document.getElementById('setThemeAccent2').value = currentSetPayload.accent2 || '#ff7ab8';
        document.getElementById('setThemeGreen').value = currentSetPayload.green || '#17b26a';
        document.getElementById('setThemeAmber').value = currentSetPayload.amber || '#f5a524';
        document.getElementById('setThemeRadius').value = currentSetPayload.radius || 24;
        document.getElementById('setThemeHeroStyle').value = currentSetPayload.heroStyle || 'gradient';
        document.getElementById('setThemeHoverStyle').value = currentSetPayload.hoverStyle || 'lift';
        document.getElementById('setThemeCardRadius').value = currentSetPayload.cardRadius || 16;
        document.getElementById('setThemeShowIllustration').checked = currentSetPayload.showIllustration !== false;

        const sp = currentSetPayload.socialProof || {};
        document.getElementById('setThemeSPType').value = sp.type || 'avatars';
        document.getElementById('setThemeSPCount').value = sp.count || '1.240 bạn';
        document.getElementById('setThemeSPSuffix').value = sp.suffix || 'đang ôn tập tuần này';
        document.getElementById('setThemeSPEffect').value = sp.effect || 'none';
        document.getElementById('setThemeSPBadgeIcon').value = sp.badgeIcon || 'fa-solid fa-star';
        document.getElementById('setThemeSPBadgeText').value = sp.badgeText || '4.9/5 từ 320 đánh giá';
        const defaultAvts = [{letter:'H',color:'#4f6bff'},{letter:'L',color:'#8b5cf6'},{letter:'M',color:'#17b26a'},{letter:'T',color:'#f5a524'}];
        const avts = (sp.avatars && sp.avatars.length === 4) ? sp.avatars : defaultAvts;
        avts.forEach((a, i) => {
            document.getElementById(`setThemeAvt${i+1}Letter`).value = a.letter || defaultAvts[i].letter;
            document.getElementById(`setThemeAvt${i+1}Color`).value = a.color || defaultAvts[i].color;
        });
        onThemeSPTypeChange();
        updateThemePreview();
    } else if (isHero){
        document.getElementById('setHeroPageTitle').value = currentSetPayload.pageTitle || '';
        document.getElementById('setHeroEyebrow').value = currentSetPayload.eyebrow || '';
        document.getElementById('setHeroTitle').value = currentSetPayload.title || '';
    } else if (isTexts){
        document.getElementById('setTextQuick').value = currentSetPayload.quickTitle || '';
        document.getElementById('setTextHomeSubjects').value = currentSetPayload.homeSubjectsTitle || '';
        document.getElementById('setTextFeaturedDocFree').value = currentSetPayload.featuredDocFreeTitle || '';
        document.getElementById('setTextFeaturedDocPaid').value = currentSetPayload.featuredDocPaidTitle || '';
        document.getElementById('setTextFeaturedTool').value = currentSetPayload.featuredToolTitle || '';
        document.getElementById('setTextFeaturedProduct').value = currentSetPayload.featuredProductTitle || '';
        document.getElementById('setTextQuiz').value = currentSetPayload.quizTitle || '';
        document.getElementById('setTextDoc').value = currentSetPayload.docTitle || '';
        document.getElementById('setTextTool').value = currentSetPayload.toolTitle || '';
        document.getElementById('setTextProduct').value = currentSetPayload.productTitle || '';
    } else if (isFooter){
        document.getElementById('setFooterText').value = currentSetPayload.text || '';
        document.getElementById('setFooterPreview').innerText = currentSetPayload.text || '(chưa có nội dung)';
    } else if (isBanner){
        const defaultText = 'Gặp câu hỏi sai? Click vào đây góp ý giúp tôi!';
        const defaultUnderline = 'Click vào đây';
        document.getElementById('setBannerText').value = currentSetPayload.text || '';
        document.getElementById('setBannerUnderline').value = currentSetPayload.underline || '';
        document.getElementById('setBannerIconLeft').value = currentSetPayload.iconLeft || '';
        document.getElementById('setBannerIconRight').value = currentSetPayload.iconRight || '';
        pickBannerColor(currentSetPayload.color || 'amber');
        pickBannerShape(currentSetPayload.shape || 'pill');
        pickBannerSize(currentSetPayload.size || 'md');
        pickBannerEffect(currentSetPayload.effect || 'subtle');
        updateBannerPreview();
    } else if (isPromo){
        document.getElementById('setPromoEnabled').checked = !!currentSetPayload.enabled;
        document.getElementById('setPromoMessage').value = currentSetPayload.message || '';
        document.getElementById('setPromoSlotsTotal').value = currentSetPayload.slots_total ?? '';
        document.getElementById('setPromoStartAt').value = currentSetPayload.start_at || '';
        document.getElementById('setPromoEndAt').value = currentSetPayload.end_at || '';
        promoRealSoldCount = 0;
        document.getElementById('setPromoSoldNote').innerText = '';
        updatePromoPreview();
        // Lấy số đơn Premium đã thanh toán thật kể từ mốc "Tính suất đã bán từ ngày" để admin xem trước
        // số suất còn lại sẽ hiện đúng thế nào trên trang chủ (không chặn giao diện nếu lỗi mạng).
        const sinceIso = currentSetPayload.start_at ? new Date(currentSetPayload.start_at).toISOString() : (data && data.updated_at ? data.updated_at : new Date().toISOString());
        sb.rpc('get_paid_subscription_count', { p_since: sinceIso }).then(({ data: cnt, error: cntErr }) => {
            if (currentSetKey !== 'promo_banner') return; // đã chuyển sang mục khác thì bỏ qua
            if (!cntErr){
                promoRealSoldCount = Number(cnt) || 0;
                document.getElementById('setPromoSoldNote').innerText = ` Hiện đã bán thật: ${promoRealSoldCount} suất kể từ mốc trên.`;
                updatePromoPreview();
            }
        });
    } else if (isAnnounce){
        document.getElementById('setAnnounceEnabled').checked = !!currentSetPayload.enabled;
        document.getElementById('setAnnounceTitle').value = currentSetPayload.title || '';
        document.getElementById('setAnnounceMessage').value = currentSetPayload.message || '';
        document.getElementById('setAnnounceHideHours').value = currentSetPayload.hide_hours ?? '';
        updateAnnouncePreview();
    } else {
        document.getElementById('setCardIcon').value = currentSetPayload.icon || '';
        document.getElementById('setCardTitle').value = currentSetPayload.title || '';
        document.getElementById('setCardSubtitle').value = currentSetPayload.subtitle || '';
        document.getElementById('setCardLink').value = currentSetPayload.link || '';
        pickSetColor(currentSetPayload.color || 'indigo');
        updateSetPreview();
    }
}

function closeSettingsPanel(){
    currentSetKey = null;
    document.querySelectorAll('.settings-item').forEach(el=>el.classList.remove('active'));
    document.getElementById('settingsPanel').classList.add('hidden');

    // Quay lại đúng khu vực: đã chọn chương/đề thì về câu hỏi, chưa thì về quản lý môn/chương
    if (currentChapter){
        showQuestionsPanel();
    } else {
        showSubjectManager();
    }
}

function pickSetColor(color){
    document.querySelectorAll('#setColorRow .color-swatch').forEach(el=>{
        el.classList.toggle('selected', el.dataset.color === color);
    });
    updateSetPreview();
}

function updateSetPreview(){
    const icon = document.getElementById('setCardIcon').value.trim() || 'fa-solid fa-star';
    const title = document.getElementById('setCardTitle').value.trim() || '—';
    const subtitle = document.getElementById('setCardSubtitle').value.trim() || '';
    const selected = document.querySelector('#setColorRow .color-swatch.selected');
    const color = selected ? selected.dataset.color : 'indigo';

    document.getElementById('setPreviewIco').innerHTML = `<i class="${escapeHtml(icon)}"></i>`;
    document.getElementById('setPreviewIco').className = 'prev-ico color-swatch ' + color;
    document.getElementById('setPreviewTitle').innerText = title;
    document.getElementById('setPreviewSubtitle').innerText = subtitle;
}
['setCardIcon','setCardTitle','setCardSubtitle'].forEach(id=>{
    document.addEventListener('DOMContentLoaded', () => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateSetPreview);
    });
});
document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('setFooterText');
    if (el) el.addEventListener('input', () => {
        document.getElementById('setFooterPreview').innerText = el.value.trim() || '(chưa có nội dung)';
    });
});
const BANNER_COLOR_STYLES = {
    amber:  { bg:'#3a2e12', border:'#b8860b', text:'#f5c065', glow:'245,165,36' },
    blue:   { bg:'#152238', border:'#3b6fdb', text:'#8ab4ff', glow:'37,99,235' },
    green:  { bg:'#123521', border:'#1e9750', text:'#4ade80', glow:'22,163,74' },
    red:    { bg:'#391414', border:'#c62d2d', text:'#f87171', glow:'220,38,38' },
    purple: { bg:'#241c3d', border:'#9a72f2', text:'#c4b5fd', glow:'139,92,246' },
    indigo: { bg:'#1d1c3a', border:'#5f5ef0', text:'#a5a4ff', glow:'79,78,224' },
};
const BANNER_SHAPE_RADIUS = { pill:'999px', rounded:'14px', square:'6px' };
const BANNER_SIZE_STYLES = {
    sm: { pad:'9px 16px',  font:'10.5px', icon:'14px', arrow:'13px', gap:'8px' },
    md: { pad:'13px 22px', font:'12.5px', icon:'16px', arrow:'15px', gap:'10px' },
    lg: { pad:'17px 30px', font:'14.5px', icon:'19px', arrow:'18px', gap:'12px' },
};

function pickBannerColor(color){
    bannerColor = color;
    document.querySelectorAll('#setBannerColorRow .color-swatch').forEach(el=>{
        el.classList.toggle('selected', el.dataset.color === color);
    });
    updateBannerPreview();
}
function pickBannerShape(shape){
    bannerShape = shape;
    document.querySelectorAll('#setBannerShapeRow .acct-chip').forEach(el=>{
        el.classList.toggle('active', el.dataset.shape === shape);
    });
    updateBannerPreview();
}
function pickBannerSize(size){
    bannerSize = size;
    document.querySelectorAll('#setBannerSizeRow .acct-chip').forEach(el=>{
        el.classList.toggle('active', el.dataset.size === size);
    });
    updateBannerPreview();
}
function pickBannerEffect(effect){
    bannerEffect = effect;
    document.querySelectorAll('#setBannerEffectRow .acct-chip').forEach(el=>{
        el.classList.toggle('active', el.dataset.effect === effect);
    });
    updateBannerPreview();
}

function updateBannerPreview(text, underline){
    const defaultText = 'Gặp câu hỏi sai? Click vào đây góp ý giúp tôi!';
    const t = (text !== undefined) ? text : document.getElementById('setBannerText').value;
    const u = (underline !== undefined) ? underline : document.getElementById('setBannerUnderline').value;
    let html = escapeHtml(t || defaultText);
    const underlineTrim = (u || '').trim();
    if (underlineTrim && html.includes(escapeHtml(underlineTrim))){
        html = html.replace(escapeHtml(underlineTrim), '<u>' + escapeHtml(underlineTrim) + '</u>');
    }
    document.getElementById('setBannerPreview').innerHTML = html;

    const iconLeft = document.getElementById('setBannerIconLeft').value.trim() || '🔔';
    const iconRight = document.getElementById('setBannerIconRight').value.trim() || '👉';
    document.getElementById('setBannerPreviewIconLeft').innerText = iconLeft;
    document.getElementById('setBannerPreviewIconRight').innerText = iconRight;

    const style = BANNER_COLOR_STYLES[bannerColor] || BANNER_COLOR_STYLES.amber;
    const radius = BANNER_SHAPE_RADIUS[bannerShape] || BANNER_SHAPE_RADIUS.pill;
    const size = BANNER_SIZE_STYLES[bannerSize] || BANNER_SIZE_STYLES.md;
    const wrap = document.getElementById('setBannerPreviewWrap');
    const iconLeftEl = document.getElementById('setBannerPreviewIconLeft');
    const iconRightEl = document.getElementById('setBannerPreviewIconRight');
    const textEl = document.getElementById('setBannerPreview');
    wrap.style.background = style.bg;
    wrap.style.borderColor = style.border;
    wrap.style.borderRadius = radius;
    wrap.style.setProperty('--rbpv-glow', style.glow);
    wrap.style.padding = size.pad;
    wrap.style.gap = size.gap;
    textEl.style.color = style.text;
    textEl.style.fontSize = size.font;
    iconLeftEl.style.fontSize = size.icon;
    iconRightEl.style.fontSize = size.arrow;

    // reset toàn bộ animation trước khi gán lại, tránh giữ hiệu ứng cũ khi đổi lựa chọn liên tục
    wrap.style.animation = 'none';
    iconLeftEl.style.animation = 'none';
    iconRightEl.style.animation = 'none';
    void wrap.offsetWidth;

    if (bannerEffect === 'subtle'){
        wrap.style.animation = 'rbpvGlow 2s ease-in-out infinite';
        iconLeftEl.style.animation = 'rbpvIconShake 1.8s ease-in-out infinite';
        iconRightEl.style.animation = 'rbpvArrowNudge 1s ease-in-out infinite';
    } else if (bannerEffect === 'pulse'){
        wrap.style.animation = 'rbpvPulse 1.4s ease-in-out infinite';
        iconRightEl.style.animation = 'rbpvArrowNudge 1s ease-in-out infinite';
    } else if (bannerEffect === 'shake'){
        wrap.style.animation = 'rbpvShake 2.4s ease-in-out infinite';
        iconLeftEl.style.animation = 'rbpvIconShake 1.8s ease-in-out infinite';
    }
}
document.addEventListener('DOMContentLoaded', () => {
    const t = document.getElementById('setBannerText');
    const u = document.getElementById('setBannerUnderline');
    const il = document.getElementById('setBannerIconLeft');
    const ir = document.getElementById('setBannerIconRight');
    const handler = () => updateBannerPreview();
    if (t) t.addEventListener('input', handler);
    if (u) u.addEventListener('input', handler);
    if (il) il.addEventListener('input', handler);
    if (ir) ir.addEventListener('input', handler);
});

function formatPromoCountdown(ms){
    if (ms <= 0) return 'Đã kết thúc';
    const totalSec = Math.floor(ms / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const pad = n => String(n).padStart(2, '0');
    return (days > 0 ? days + 'n ' : '') + pad(hours) + ':' + pad(mins) + ':' + pad(secs);
}
function updateAnnouncePreview(){
    const title = document.getElementById('setAnnounceTitle').value.trim() || 'Thông báo';
    document.getElementById('setAnnouncePreviewTitle').innerText = title;

    const msg = document.getElementById('setAnnounceMessage').value.trim() || 'Hệ thống sẽ bảo trì từ 23h đến 1h sáng mai...';
    document.getElementById('setAnnouncePreviewMsg').innerText = msg;

    const hours = Number(document.getElementById('setAnnounceHideHours').value) > 0 ? Number(document.getElementById('setAnnounceHideHours').value) : 2;
    document.getElementById('setAnnouncePreviewHideBtn').innerText = `Ẩn trong ${hours} giờ`;
}
function updatePromoPreview(){
    const msg = document.getElementById('setPromoMessage').value.trim() || 'Người dùng Premium ghi nhớ hiệu quả hơn gấp 3 lần...';
    document.getElementById('setPromoPreviewMsg').innerText = msg;

    const total = Number(document.getElementById('setPromoSlotsTotal').value) || 0;
    const left = Math.max(0, total - promoRealSoldCount);
    const slotsEl = document.getElementById('setPromoPreviewSlots');
    if (total > 0){
        slotsEl.innerText = `còn ${left}/${total} suất`;
        slotsEl.style.display = '';
    } else {
        slotsEl.style.display = 'none';
    }

    const endAtVal = document.getElementById('setPromoEndAt').value;
    const timerEl = document.getElementById('setPromoPreviewTimer');
    if (endAtVal){
        const diff = new Date(endAtVal).getTime() - Date.now();
        timerEl.innerText = formatPromoCountdown(diff);
        timerEl.style.display = '';
    } else {
        timerEl.style.display = 'none';
    }
}

function updateThemePreview(){
    const brand = document.getElementById('setThemeBrand').value;
    const brand2 = document.getElementById('setThemeBrand2').value;
    const accent2 = document.getElementById('setThemeAccent2').value;
    const green = document.getElementById('setThemeGreen').value;
    const amber = document.getElementById('setThemeAmber').value;
    const radius = Number(document.getElementById('setThemeRadius').value) || 24;
    const heroStyle = document.getElementById('setThemeHeroStyle').value;
    const grad = `linear-gradient(135deg, ${brand}, ${brand2})`;

    const hero = document.getElementById('setThemePreviewHero');
    hero.style.borderRadius = radius + 'px';
    if (heroStyle === 'minimal'){
        hero.style.background = 'var(--card)';
        hero.style.backgroundImage = 'none';
        hero.style.boxShadow = 'none';
    } else if (heroStyle === 'dots'){
        hero.style.background = `linear-gradient(120deg, ${brand}22 0%, ${brand2}1f 55%, ${green}1f 100%)`;
        hero.style.backgroundImage = `radial-gradient(${brand}55 1.2px, transparent 1.2px)`;
        hero.style.backgroundSize = '14px 14px';
        hero.style.boxShadow = `inset 0 0 40px -10px ${accent2}55`;
    } else {
        hero.style.background = `linear-gradient(120deg, ${brand}22 0%, ${brand2}1f 55%, ${green}1f 100%)`;
        hero.style.backgroundImage = 'none';
        hero.style.boxShadow = `inset 0 0 40px -10px ${accent2}55`;
    }

    document.getElementById('setThemePreviewEyebrow').style.background = heroStyle === 'minimal' ? `${brand}22` : grad;
    document.getElementById('setThemePreviewEyebrow').style.color = heroStyle === 'minimal' ? brand : '#fff';
    document.getElementById('setThemePreviewTitle').style.background = heroStyle === 'minimal' ? 'none' : `linear-gradient(100deg, var(--text) 45%, ${brand} 100%)`;
    document.getElementById('setThemePreviewTitle').style.webkitBackgroundClip = heroStyle === 'minimal' ? 'initial' : 'text';
    document.getElementById('setThemePreviewTitle').style.backgroundClip = heroStyle === 'minimal' ? 'initial' : 'text';
    document.getElementById('setThemePreviewTitle').style.color = heroStyle === 'minimal' ? 'var(--text)' : 'transparent';
    document.getElementById('setThemePreviewBtn').style.background = grad;
    document.getElementById('setThemePreviewPill').style.background = amber;
}

function onThemeSPTypeChange(){
    const type = document.getElementById('setThemeSPType').value;
    document.getElementById('setThemeSPAvatars').classList.toggle('hidden', type !== 'avatars');
    document.getElementById('setThemeSPBadge').classList.toggle('hidden', type !== 'badge');
    updateThemePreview();
}

async function saveSiteSetting(){
    if (!currentSetKey) return;
    let payload;
    if (currentSetKey === 'site_theme'){
        payload = {
            brand: document.getElementById('setThemeBrand').value,
            brand2: document.getElementById('setThemeBrand2').value,
            accent2: document.getElementById('setThemeAccent2').value,
            green: document.getElementById('setThemeGreen').value,
            amber: document.getElementById('setThemeAmber').value,
            radius: Number(document.getElementById('setThemeRadius').value) || 24,
            heroStyle: document.getElementById('setThemeHeroStyle').value,
            hoverStyle: document.getElementById('setThemeHoverStyle').value,
            cardRadius: Number(document.getElementById('setThemeCardRadius').value) || 16,
            showIllustration: document.getElementById('setThemeShowIllustration').checked,
            socialProof: {
                type: document.getElementById('setThemeSPType').value,
                count: document.getElementById('setThemeSPCount').value.trim(),
                suffix: document.getElementById('setThemeSPSuffix').value.trim(),
                effect: document.getElementById('setThemeSPEffect').value,
                badgeIcon: document.getElementById('setThemeSPBadgeIcon').value.trim(),
                badgeText: document.getElementById('setThemeSPBadgeText').value.trim(),
                avatars: [1,2,3,4].map(i => ({
                    letter: document.getElementById(`setThemeAvt${i}Letter`).value.trim() || '?',
                    color: document.getElementById(`setThemeAvt${i}Color`).value,
                })),
            },
        };
    } else if (currentSetKey === 'home_hero'){
        payload = {
            pageTitle: document.getElementById('setHeroPageTitle').value.trim(),
            eyebrow: document.getElementById('setHeroEyebrow').value.trim(),
            title: document.getElementById('setHeroTitle').value.trim(),
        };
    } else if (currentSetKey === 'home_texts'){
        payload = {
            quickTitle: document.getElementById('setTextQuick').value.trim(),
            homeSubjectsTitle: document.getElementById('setTextHomeSubjects').value.trim(),
            featuredDocFreeTitle: document.getElementById('setTextFeaturedDocFree').value.trim(),
            featuredDocPaidTitle: document.getElementById('setTextFeaturedDocPaid').value.trim(),
            featuredToolTitle: document.getElementById('setTextFeaturedTool').value.trim(),
            featuredProductTitle: document.getElementById('setTextFeaturedProduct').value.trim(),
            quizTitle: document.getElementById('setTextQuiz').value.trim(),
            docTitle: document.getElementById('setTextDoc').value.trim(),
            toolTitle: document.getElementById('setTextTool').value.trim(),
            productTitle: document.getElementById('setTextProduct').value.trim(),
        };
    } else if (currentSetKey === 'site_footer'){
        payload = {
            text: document.getElementById('setFooterText').value.trim(),
        };
    } else if (currentSetKey === 'report_banner'){
        payload = {
            text: document.getElementById('setBannerText').value.trim(),
            underline: document.getElementById('setBannerUnderline').value.trim(),
            iconLeft: document.getElementById('setBannerIconLeft').value.trim(),
            iconRight: document.getElementById('setBannerIconRight').value.trim(),
            color: bannerColor,
            shape: bannerShape,
            size: bannerSize,
            effect: bannerEffect,
        };
    } else if (currentSetKey === 'promo_banner'){
        // "Số suất còn lại" không lưu tay nữa -- trang chủ tự tính = slots_total trừ số đơn Gói thành viên
        // đã thanh toán thật kể từ start_at (xem hàm loadPromoBanner() ở index.html + RPC get_paid_subscription_count).
        payload = {
            enabled: document.getElementById('setPromoEnabled').checked,
            message: document.getElementById('setPromoMessage').value.trim(),
            slots_total: Number(document.getElementById('setPromoSlotsTotal').value) || 0,
            start_at: document.getElementById('setPromoStartAt').value || '',
            end_at: document.getElementById('setPromoEndAt').value || '',
        };
    } else if (currentSetKey === 'announcement_popup'){
        payload = {
            enabled: document.getElementById('setAnnounceEnabled').checked,
            title: document.getElementById('setAnnounceTitle').value.trim(),
            message: document.getElementById('setAnnounceMessage').value.trim(),
            hide_hours: Number(document.getElementById('setAnnounceHideHours').value) || 2,
        };
    } else {
        const selected = document.querySelector('#setColorRow .color-swatch.selected');
        payload = {
            icon: document.getElementById('setCardIcon').value.trim(),
            color: selected ? selected.dataset.color : 'indigo',
            title: document.getElementById('setCardTitle').value.trim(),
            subtitle: document.getElementById('setCardSubtitle').value.trim(),
            link: document.getElementById('setCardLink').value.trim(),
        };
    }

    const { error } = await sb.from('site_settings')
        .upsert({ key: currentSetKey, payload, updated_at: new Date().toISOString() }, { onConflict: 'key' });

    const msgEl = document.getElementById('setSaveMsg');
    if (error){
        msgEl.style.color = 'var(--red)';
        msgEl.innerText = 'Lỗi: ' + error.message;
    } else {
        msgEl.style.color = 'var(--green)';
        msgEl.innerText = '✔ Đã lưu. Các trang liên quan sẽ hiện nội dung mới ngay khi tải lại.';
        setTimeout(()=>{ if (msgEl.innerText.startsWith('✔')) msgEl.innerText=''; }, 4000);
    }
}

checkSession().catch((err) => {
    console.error('checkSession lỗi:', err);
    revealLoginScreen('Không kiểm tra được phiên đăng nhập, vui lòng thử lại.');
});
