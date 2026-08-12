// ============================================================
// SNGEDU — Gửi email chào mừng khi đăng ký tài khoản thành công.
// Gọi từ trang login.html ngay sau khi signUp() thành công.
// Chỉ gửi được ĐÚNG 1 LẦN cho mỗi user (đánh dấu profiles.welcome_email_sent)
// để tránh bị gọi lại spam.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, isEmailKindEnabled, sendEmail, welcomeEmailHtml } from "../_shared/email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Thiếu Authorization header (chưa đăng nhập)");

    // Xác thực đúng là user vừa tạo tài khoản đang gọi (dùng access token của họ).
    const supabaseAuth = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Không xác thực được người dùng");
    const user = userData.user;

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Admin có thể tắt email chào mừng ở Admin > Kinh doanh > Cấu hình email.
    if (!(await isEmailKindEnabled(db, "welcome_email"))) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "disabled_by_admin" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await db
      .from("profiles")
      .select("welcome_email_sent")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.welcome_email_sent) {
      // Đã gửi trước đó rồi -> im lặng bỏ qua, không coi là lỗi.
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const name = user.user_metadata?.full_name || (user.email ? user.email.split("@")[0] : "bạn");
    if (!user.email) throw new Error("Tài khoản không có email để gửi.");

    await sendEmail(user.email, "Chào mừng bạn đến với SNG EDU 🎉", welcomeEmailHtml(name));

    await db
      .from("profiles")
      .upsert({ id: user.id, welcome_email_sent: true }, { onConflict: "id" });

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
