// ============================================================
// SNGEDU — Helper dùng chung để gửi email qua Resend
// (mã OTP quên mật khẩu, email chào mừng khi đăng ký...)
//
// Cần cấu hình 2 secret trong Supabase Project Settings > Edge Functions:
//   RESEND_API_KEY : API key lấy từ https://resend.com (miễn phí 100 email/ngày)
//   EMAIL_FROM      : địa chỉ gửi đi, vd "SNG EDU <hotro@sngedu.site>"
//                      (domain phải verify trên Resend)
// ============================================================

export const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
export const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "SNG EDU <onboarding@resend.dev>";

export function escapeHtml(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Khung email chung — logo + khối nội dung (truyền HTML đã dựng sẵn vào bodyHtml).
export function wrapEmailShell(bodyHtml: string, footerText: string) {
  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;background:#f4f5fb;padding:28px 16px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #eceef7;">
      <div style="background:linear-gradient(135deg,#5b5cf0,#8b7cf6);padding:22px 26px;">
        <div style="font-family:Georgia,serif;font-weight:800;font-size:20px;color:#fff;">SNG EDU</div>
      </div>
      <div style="padding:26px;font-size:14.5px;line-height:1.7;color:#20223c;">
        ${bodyHtml}
      </div>
      <div style="padding:16px 26px;background:#f7f8fc;font-size:12px;color:#8b8fa8;">
        ${footerText}
      </div>
    </div>
  </div>`;
}

// Email mã OTP quên mật khẩu — mã to, rõ, dễ đọc/copy trên điện thoại.
export function otpEmailHtml(code: string, minutesValid: number) {
  const body = `
    <p style="margin:0 0 14px;">Chào bạn,</p>
    <p style="margin:0 0 18px;">Bạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu cho tài khoản SNG EDU gắn với email này. Dùng mã bên dưới để tiếp tục:</p>
    <div style="margin:0 0 18px;text-align:center;">
      <div style="display:inline-block;padding:14px 26px;background:#f4f4ff;border:1.5px dashed #8b7cf6;border-radius:12px;font-family:'Courier New',monospace;font-size:28px;font-weight:800;letter-spacing:8px;color:#5b5cf0;">${code}</div>
    </div>
    <p style="margin:0 0 8px;">Mã có hiệu lực trong <b>${minutesValid} phút</b>. Nếu không phải bạn yêu cầu, bỏ qua email này — mật khẩu của bạn vẫn an toàn, không ai đổi được nếu không có mã này.</p>
    <p style="margin:0;color:#8b8fa8;font-size:13px;">Tuyệt đối không chia sẻ mã này cho bất kỳ ai, kể cả người tự xưng là nhân viên SNG EDU.</p>
  `;
  return wrapEmailShell(body, "Email này được gửi tự động từ hệ thống xác thực tài khoản SNG EDU.");
}

// Email chào mừng khi đăng ký thành công.
export function welcomeEmailHtml(name: string) {
  const safeName = escapeHtml(name || "bạn");
  const body = `
    <p style="margin:0 0 14px;">Chào <b>${safeName}</b>,</p>
    <p style="margin:0 0 14px;">Cảm ơn bạn đã tạo tài khoản tại <b>SNG EDU</b>! Tài khoản của bạn đã sẵn sàng để sử dụng.</p>
    <p style="margin:0 0 14px;">Một vài thứ bạn có thể bắt đầu ngay:</p>
    <ul style="margin:0 0 18px;padding-left:20px;">
      <li style="margin-bottom:6px;">Làm trắc nghiệm theo môn học, theo chương/đề</li>
      <li style="margin-bottom:6px;">Tải tài liệu học tập</li>
      <li style="margin-bottom:6px;">Dùng công cụ tính toán hỗ trợ ôn tập</li>
    </ul>
    <div style="text-align:center;margin:0 0 8px;">
      <a href="https://sngedu.site" style="display:inline-block;padding:12px 28px;background:#5b5cf0;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;">Vào SNG EDU ngay</a>
    </div>
    <p style="margin:18px 0 0;color:#8b8fa8;font-size:13px;">Nếu bạn không phải người tạo tài khoản này, vui lòng bỏ qua email — không cần làm gì thêm.</p>
  `;
  return wrapEmailShell(body, "Email này được gửi tự động khi tài khoản SNG EDU của bạn được tạo thành công.");
}

export async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) {
    throw new Error(
      "Chưa cấu hình RESEND_API_KEY trên server. Vào Supabase > Project Settings > Edge Functions > Secrets để thêm RESEND_API_KEY và EMAIL_FROM."
    );
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error("Gửi email thất bại: " + errText);
  }
}

// Hash mã OTP bằng SHA-256 (không lưu mã gốc trong DB).
export async function hashCode(code: string) {
  const data = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateSixDigitCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
