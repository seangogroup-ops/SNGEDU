// ============================================================
// SNGEDU — Bước 2 của "Quên mật khẩu": xác nhận mã OTP + đặt mật khẩu mới.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, hashCode } from "../_shared/email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_ATTEMPTS = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, code, new_password } = await req.json();
    if (!email || !code) throw new Error("Thiếu email hoặc mã xác nhận.");
    if (!new_password || String(new_password).length < 6) {
      throw new Error("Mật khẩu mới phải từ 6 ký tự trở lên.");
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanCode = String(code).trim();

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: row, error: rowErr } = await db
      .from("password_reset_codes")
      .select("*")
      .eq("email", cleanEmail)
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (rowErr || !row) throw new Error("Mã không hợp lệ hoặc đã hết hạn. Hãy yêu cầu gửi mã mới.");

    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw new Error("Mã đã hết hạn. Hãy yêu cầu gửi mã mới.");
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      throw new Error("Bạn đã nhập sai quá nhiều lần. Hãy yêu cầu gửi mã mới.");
    }

    const inputHash = await hashCode(cleanCode);
    if (inputHash !== row.code_hash) {
      await db.from("password_reset_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
      const left = MAX_ATTEMPTS - (row.attempts + 1);
      throw new Error(left > 0 ? `Mã không đúng. Còn ${left} lần thử.` : "Mã không đúng. Hãy yêu cầu gửi mã mới.");
    }

    // ---- Mã đúng: lấy user id + đổi mật khẩu bằng quyền admin ----
    const { data: userId, error: uidErr } = await db.rpc("get_user_id_by_email", { p_email: cleanEmail });
    if (uidErr || !userId) throw new Error("Không tìm thấy tài khoản tương ứng.");

    const { error: updErr } = await db.auth.admin.updateUserById(userId, { password: new_password });
    if (updErr) throw new Error("Đổi mật khẩu thất bại: " + updErr.message);

    await db.from("password_reset_codes").update({ used: true }).eq("id", row.id);

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
