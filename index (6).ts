// ============================================================
// SNGEDU — Gửi email phản hồi/cảm ơn cho góp ý học viên
// Admin soạn (hoặc dùng mẫu có sẵn) trong trang quản trị -> bấm "Gửi email"
// -> function này gọi Resend API gửi mail -> tự đánh dấu feedback đã xử lý + đã gửi email.
//
// Cần cấu hình 2 secret trong Supabase Project Settings > Edge Functions:
//   RESEND_API_KEY   : API key lấy từ https://resend.com (miễn phí 100 email/ngày)
//   EMAIL_FROM        : địa chỉ gửi đi, vd "SNG EDU <hotro@sngedu.site>" (domain phải verify trên Resend)
// Nếu chưa cấu hình, function sẽ trả lỗi rõ ràng để admin biết cần làm gì.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "SNG EDU <onboarding@resend.dev>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function escapeHtml(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function wrapEmailHtml(bodyText: string) {
  const paragraphs = escapeHtml(bodyText)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;background:#f4f5fb;padding:28px 16px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #eceef7;">
      <div style="background:linear-gradient(135deg,#5b5cf0,#8b7cf6);padding:22px 26px;">
        <div style="font-family:Georgia,serif;font-weight:800;font-size:20px;color:#fff;">SNG EDU</div>
      </div>
      <div style="padding:26px;font-size:14.5px;line-height:1.7;color:#20223c;">
        ${paragraphs}
      </div>
      <div style="padding:16px 26px;background:#f7f8fc;font-size:12px;color:#8b8fa8;">
        Email này được gửi tự động từ hệ thống hỗ trợ SNG EDU dựa trên góp ý bạn đã gửi.
      </div>
    </div>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ---- Xác thực: chỉ admin mới được gửi ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Thiếu Authorization header (chưa đăng nhập)");

    const supabaseAuth = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Không xác thực được người dùng");
    const user = userData.user;

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: profile } = await db.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || profile.role !== "admin") throw new Error("Chỉ admin mới được gửi email phản hồi");

    // ---- Đọc dữ liệu góp ý + nội dung email admin đã soạn ----
    const body = await req.json();
    const { feedback_id, subject, message } = body;
    if (!feedback_id) throw new Error("Thiếu feedback_id");
    if (!subject || !subject.trim()) throw new Error("Thiếu tiêu đề email");
    if (!message || !message.trim()) throw new Error("Thiếu nội dung email");

    const { data: fb, error: fbErr } = await db.from("feedback").select("*").eq("id", feedback_id).single();
    if (fbErr || !fb) throw new Error("Không tìm thấy góp ý này");
    if (!fb.email) throw new Error("Góp ý này không có email người gửi, không thể gửi mail");

    if (!RESEND_API_KEY) {
      throw new Error(
        "Chưa cấu hình RESEND_API_KEY trên server. Vào Supabase > Project Settings > Edge Functions > Secrets để thêm RESEND_API_KEY và EMAIL_FROM."
      );
    }

    // ---- Gửi qua Resend ----
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [fb.email],
        subject: subject,
        html: wrapEmailHtml(message),
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      throw new Error("Gửi email thất bại: " + errText);
    }

    // ---- Lưu lại nội dung đã gửi + đánh dấu đã xử lý ----
    const nowIso = new Date().toISOString();
    const { error: updErr } = await db
      .from("feedback")
      .update({
        reply_subject: subject,
        reply_message: message,
        email_sent: true,
        email_sent_at: nowIso,
        replied_by: user.id,
        status: "resolved",
        updated_at: nowIso,
      })
      .eq("id", feedback_id);
    if (updErr) throw new Error("Đã gửi email nhưng lưu trạng thái lỗi: " + updErr.message);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
