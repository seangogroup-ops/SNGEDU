// ============================================================
// SNGEDU — Bước 1 của "Quên mật khẩu": tạo mã OTP 6 số, gửi qua email.
// Không tiết lộ email có tồn tại tài khoản hay không (luôn trả về
// success chung chung), chỉ thực sự gửi mail nếu email đó có tài khoản.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, generateSixDigitCode, hashCode, otpEmailHtml, sendEmail } from "../_shared/email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CODE_VALID_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const genericOk = () =>
    new Response(
      JSON.stringify({ success: true, message: "Nếu email này có tài khoản, mã xác nhận đã được gửi." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  try {
    const { email } = await req.json();
    if (!email || !EMAIL_RE.test(String(email).trim())) {
      return new Response(JSON.stringify({ error: "Email không hợp lệ." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const cleanEmail = String(email).trim().toLowerCase();

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ---- Chống spam: chặn gửi lại quá nhanh cho cùng 1 email ----
    const { data: recent } = await db
      .from("password_reset_codes")
      .select("created_at")
      .eq("email", cleanEmail)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recent) {
      const secondsSince = (Date.now() - new Date(recent.created_at).getTime()) / 1000;
      if (secondsSince < RESEND_COOLDOWN_SECONDS) {
        return new Response(
          JSON.stringify({
            error: `Vui lòng đợi ${Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSince)} giây trước khi gửi lại mã.`,
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ---- Kiểm tra email có tài khoản không (không tiết lộ ra ngoài) ----
    const { data: userId } = await db.rpc("get_user_id_by_email", { p_email: cleanEmail });
    if (!userId) {
      // Email không tồn tại tài khoản -> vẫn trả về success chung chung, không gửi mail.
      return genericOk();
    }

    // ---- Tạo mã, lưu hash, gửi email ----
    const code = generateSixDigitCode();
    const codeHash = await hashCode(code);
    const expiresAt = new Date(Date.now() + CODE_VALID_MINUTES * 60 * 1000).toISOString();

    const { error: insErr } = await db.from("password_reset_codes").insert({
      email: cleanEmail,
      code_hash: codeHash,
      expires_at: expiresAt,
    });
    if (insErr) throw new Error("Không tạo được mã xác nhận: " + insErr.message);

    await sendEmail(cleanEmail, "Mã đặt lại mật khẩu SNG EDU", otpEmailHtml(code, CODE_VALID_MINUTES));

    return genericOk();
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
