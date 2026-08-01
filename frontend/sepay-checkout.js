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

async function batDauThanhToan(orderPayload) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      window.location.href = '/account/login.html';
      return;
    }

    const res = await fetch(`${SEPAY_FUNCTIONS_BASE}/sepay-create-checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        ...orderPayload,
        payment_method: 'BANK_TRANSFER', // hoặc 'CARD' / 'NAPAS_BANK_TRANSFER'
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Có lỗi xảy ra khi tạo đơn thanh toán.');
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
