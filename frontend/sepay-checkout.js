/**
 * sepay-checkout.js
 * Gắn file này (hoặc copy đoạn <script> vào cuối trang) trong mon-hoc.html
 * hoặc trang gói thành viên. Yêu cầu đã có biến `sb` (Supabase client) trong trang,
 * giống cách index.html / mon-hoc.html hiện đang khởi tạo.
 */

const SEPAY_FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`; // dùng chung SUPABASE_URL đã khai báo sẵn trong trang

/**
 * Bắt đầu thanh toán mua 1 khoá học.
 * @param {string} courseId - id khoá học trong bảng `courses`
 */
async function thanhToanKhoaHoc(courseId) {
  await batDauThanhToan({ order_type: 'course', course_id: courseId });
}

/**
 * Bắt đầu thanh toán đăng ký gói thành viên.
 * @param {string} planId - id gói trong bảng `membership_plans`
 */
async function thanhToanGoiThanhVien(planId) {
  await batDauThanhToan({ order_type: 'subscription', plan_id: planId });
}

/**
 * Bắt đầu thanh toán mua 1 tài liệu trả phí.
 * @param {string} documentId - id tài liệu trong site_settings.doc_content.paid[]
 */
async function thanhToanTaiLieu(documentId) {
  await batDauThanhToan({ order_type: 'document', document_id: documentId });
}

/**
 * Bắt đầu thanh toán mua 1 sản phẩm trả phí.
 * @param {string} productId - id sản phẩm trong site_settings.product_content.items[]
 * @param {string} [variantId] - id biến thể đã chọn (vd "1 tháng"), bỏ trống nếu sản phẩm không chia biến thể
 */
async function thanhToanSanPham(productId, variantId) {
  await batDauThanhToan({ order_type: 'product', product_id: productId, variant_id: variantId || '' });
}

async function batDauThanhToan(orderPayload) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      window.location.href = '/account/login.html';
      return;
    }

    // Nếu khách vào site qua link giới thiệu của 1 CTV (?ctv=MA, xem frontend/ctv-track.js)
    // thì đính kèm mã đó vào đơn hàng để tính hoa hồng cho đúng người giới thiệu.
    const ctvCode = (typeof window.sngGetCtvCode === 'function') ? window.sngGetCtvCode() : '';

    const res = await fetch(`${SEPAY_FUNCTIONS_BASE}/sepay-create-checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        payment_method: 'BANK_TRANSFER', // hoặc 'CARD' / 'NAPAS_BANK_TRANSFER'
        ...(ctvCode ? { ctv_code: ctvCode } : {}),
        ...orderPayload,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Có lỗi xảy ra khi tạo đơn thanh toán.');
      return;
    }

    // Thanh toán bằng số dư ví: xử lý xong ngay, không có checkoutUrl để redirect
    if (data.paid) {
      window.location.href = `/thanh-toan-thanh-cong.html?inv=${encodeURIComponent(data.invoiceNumber)}&method=balance`;
      return;
    }

    // Tạo form ẩn với các field đã có chữ ký, auto-submit sang cổng SePay
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = data.checkoutUrl;
    form.style.display = 'none';

    for (const [key, value] of Object.entries(data.fields)) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = value;
      form.appendChild(input);
    }

    document.body.appendChild(form);
    form.submit();
  } catch (err) {
    console.error(err);
    alert('Không thể kết nối tới máy chủ thanh toán. Vui lòng thử lại.');
  }
}

/**
 * Nạp tiền vào ví qua SePay. Luôn chuyển sang cổng thanh toán
 * (không thể nạp tiền bằng chính số dư ví).
 * @param {number} amount - số tiền muốn nạp (VNĐ), tối thiểu 10.000đ
 */
async function napTienVaoVi(amount) {
  await batDauThanhToan({ order_type: 'wallet_topup', amount: Number(amount) });
}

/**
 * Thanh toán 1 dịch vụ (khoá học / gói Pro / tài liệu / sản phẩm) TRỰC TIẾP
 * bằng số dư ví, không qua cổng SePay. Trả về ngay kết quả (không redirect ra ngoài).
 * @param {object} orderPayload - vd: { order_type:'document', document_id:'...' }
 * @returns {Promise<{ok:boolean, balance?:number, error?:string}>}
 */
async function thanhToanBangSoDu(orderPayload) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      window.location.href = '/account/login.html';
      return { ok: false, error: 'Chưa đăng nhập' };
    }

    const ctvCode = (typeof window.sngGetCtvCode === 'function') ? window.sngGetCtvCode() : '';

    const res = await fetch(`${SEPAY_FUNCTIONS_BASE}/sepay-create-checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ ...orderPayload, ...(ctvCode ? { ctv_code: ctvCode } : {}), use_balance: true }),
    });

    const data = await res.json();
    if (!res.ok || !data.paid) {
      return { ok: false, error: data.error || 'Có lỗi xảy ra khi thanh toán bằng số dư.' };
    }
    return { ok: true, balance: data.balance, invoiceNumber: data.invoiceNumber };
  } catch (err) {
    console.error(err);
    return { ok: false, error: 'Không thể kết nối tới máy chủ thanh toán. Vui lòng thử lại.' };
  }
}

/**
 * Lấy số dư ví hiện tại của user đang đăng nhập (đọc trực tiếp từ bảng profiles).
 * @returns {Promise<number>}
 */
async function laySoDuViHienTai() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return 0;
    const { data, error } = await sb.from('profiles').select('balance').eq('id', session.user.id).maybeSingle();
    if (error || !data) return 0;
    return Number(data.balance) || 0;
  } catch (e) {
    return 0;
  }
}
