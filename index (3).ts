// ============================================================
// SNGEDU — Gửi email cảnh báo bảo mật khi user tự đổi mật khẩu
// (từ trang Tài khoản, sau khi đã xác thực lại mật khẩu cũ).
// Gọi từ index.html ngay sau khi sb.auth.updateUser({password}) thành công.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, isEmailKindEnabled, passwordChangedEmailHtml, sendEmail } from "../_shared/email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Thiếu Authorization header (chưa đăng nhập)");

    const supabaseAuth = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Không xác thực được người dùng");
    const user = userData.user;
    if (!user.email) throw new Error("Tài khoản không có email để gửi.");

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Admin có thể tắt email cảnh báo đổi mật khẩu ở Admin > Kinh doanh > Cấu hình email.
    if (!(await isEmailKindEnabled(db, "password_changed_email"))) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "disabled_by_admin" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const name = user.user_metadata?.full_name || user.email.split("@")[0];
    const whenText = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });

    await sendEmail(user.email, "Mật khẩu SNG EDU của bạn vừa được thay đổi", passwordChangedEmailHtml(name, whenText));

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
