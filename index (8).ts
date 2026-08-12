import { createClient } from "npm:@supabase/supabase-js@2";
import { computeDiscount, loadValidCoupon, resolveOrderAmount } from "../_shared/coupon.ts";

/**
 * sepay-validate-coupon
 * Dùng để XEM TRƯỚC mức giảm giá khi người dùng bấm "Áp dụng" mã trong modal thanh toán,
 * KHÔNG tạo đơn hàng và KHÔNG tăng used_count (việc đó chỉ xảy ra khi thanh toán thành công
 * thật sự, xử lý trong sepay-ipn). Logic tính discount dùng chung với sepay-create-checkout
 * (qua ../_shared/coupon.ts) để giá xem trước luôn khớp giá thanh toán thật.
 *
 * Body: { code: string, order_type: 'subscription', plan_id }
 * Trả về: { valid: boolean, message: string, original_amount?, discount_amount?, final_amount? }
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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

    const body = await req.json();
    const { code, order_type, plan_id, course_id, document_id, product_id } = body;

    const resolved = await resolveOrderAmount(db, order_type, { plan_id, course_id, document_id, product_id });
    if (!resolved) {
      return new Response(
        JSON.stringify({ valid: false, message: "Mã giảm giá hiện chỉ áp dụng cho gói Pro." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const check = await loadValidCoupon(db, code, order_type, resolved.amount);
    if (!check.ok) {
      return new Response(JSON.stringify({ valid: false, message: check.message }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const discount = computeDiscount(check.coupon, resolved.amount);
    const final = resolved.amount - discount;

    return new Response(
      JSON.stringify({
        valid: true,
        message: `Đã áp dụng mã "${check.coupon.code}"`,
        original_amount: resolved.amount,
        discount_amount: discount,
        final_amount: final,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ valid: false, message: err instanceof Error ? err.message : "Lỗi không xác định" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
