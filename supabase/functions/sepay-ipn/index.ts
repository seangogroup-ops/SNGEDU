import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SEPAY_SECRET_KEY = Deno.env.get("SEPAY_SECRET_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-secret-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- 1. Xác thực webhook bằng Secret Key (KHÔNG dùng Authorization/JWT của user) ---
    // SePay có thể gửi secret key qua header "X-Secret-Key" hoặc "Authorization: Apikey <key>"
    const secretHeader = req.headers.get("X-Secret-Key");
    const authHeader = req.headers.get("Authorization");
    const authKey = authHeader?.replace(/^Apikey\s+/i, "").trim();

    const isValid =
      (secretHeader && secretHeader === SEPAY_SECRET_KEY) ||
      (authKey && authKey === SEPAY_SECRET_KEY);

    if (!isValid) {
      console.error("sepay-ipn: xác thực thất bại - secret key không khớp hoặc thiếu");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- 2. Đọc payload ---
    const payload = await req.json();
    const order = payload.order ?? payload; // phòng trường hợp SePay gửi phẳng không bọc "order"

    const invoiceNumber: string | undefined = order.order_invoice_number ?? order.invoice_number;
    const orderStatus: string | undefined = order.order_status;
    const orderAmount = Number(order.order_amount ?? 0);
    const sepayOrderId: string | undefined = order.order_id ?? order.id;
    const notificationType: string | undefined = payload.notification_type;

    if (!invoiceNumber) {
      throw new Error("Thiếu order_invoice_number trong payload");
    }

    // --- 3. Lấy đơn hàng tương ứng trong DB ---
    const { data: existingOrder, error: findErr } = await db
      .from("sepay_orders")
      .select("id, status, amount, order_type, plan_id, course_id, user_id, sepay_transaction_id, coupon_code")
      .eq("invoice_number", invoiceNumber)
      .single();

    if (findErr || !existingOrder) {
      console.error("sepay-ipn: không tìm thấy đơn hàng", invoiceNumber, findErr);
      // Vẫn trả 200 để SePay không retry vô ích với đơn không tồn tại phía mình
      return new Response(JSON.stringify({ received: true, note: "order not found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- 4. Chống xử lý trùng lặp (webhook có thể gửi lại nhiều lần) ---
    if (existingOrder.status === "paid") {
      return new Response(JSON.stringify({ received: true, note: "already processed" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- 5. Chỉ xử lý khi giao dịch thực sự đã thanh toán ---
    const paidStatuses = ["CAPTURED", "PAID", "SUCCESS"];
    const isPaid =
      notificationType === "ORDER_PAID" ||
      (orderStatus && paidStatuses.includes(orderStatus.toUpperCase()));

    if (!isPaid) {
      // Ghi nhận nhưng chưa cập nhật paid (ví dụ trạng thái pending/failed)
      return new Response(JSON.stringify({ received: true, note: "not a paid event" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- 6. Đối chiếu số tiền để chống gian lận ---
    if (orderAmount && Number(existingOrder.amount) !== orderAmount) {
      console.error(
        "sepay-ipn: số tiền không khớp!",
        "DB:", existingOrder.amount,
        "SePay gửi:", orderAmount,
        "invoice:", invoiceNumber,
      );
      return new Response(
        JSON.stringify({ error: "Amount mismatch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- 7. Cập nhật đơn hàng -> paid ---
    const { error: updateErr } = await db
      .from("sepay_orders")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        sepay_transaction_id: sepayOrderId ?? null,
      })
      .eq("id", existingOrder.id);

    if (updateErr) throw updateErr;

    // --- 7b. Đơn hàng có dùng mã giảm giá -> tăng used_count (chỉ tăng khi thanh toán THÀNH CÔNG,
    //         không tăng khi mới tạo đơn, tránh coupon bị "ăn" lượt bởi các đơn bỏ ngang) ---
    if (existingOrder.coupon_code) {
      const { data: coupon } = await db
        .from("coupons")
        .select("id, used_count")
        .eq("code", existingOrder.coupon_code)
        .single();
      if (coupon) {
        await db.from("coupons").update({ used_count: (coupon.used_count || 0) + 1 }).eq("id", coupon.id);
      }
    }

    // --- 8. Kích hoạt quyền lợi cho user: gói thành viên hoặc khoá học ---
    if (existingOrder.order_type === "subscription" && existingOrder.plan_id) {
      const { data: plan, error: planErr } = await db
        .from("pro_packages")
        .select("id, duration_days")
        .eq("id", existingOrder.plan_id)
        .single();

      if (planErr || !plan) throw new Error("Không tìm thấy gói thành viên khi kích hoạt");

      const durationDays = Number(plan.duration_days) || 30;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

      const { error: subErr } = await db.from("subscriptions").upsert(
        {
          user_id: existingOrder.user_id,
          plan_id: existingOrder.plan_id,
          status: "active",
          started_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (subErr) throw subErr;

      // Đồng bộ badge Premium trên giao diện (đọc từ user_metadata)
      const { error: metaErr } = await db.auth.admin.updateUserById(existingOrder.user_id, {
        user_metadata: {
          plan: "premium",
          premium_until: expiresAt.toISOString(),
        },
      });
      if (metaErr) console.error("sepay-ipn: lỗi cập nhật user_metadata:", metaErr);

      // --- Đây là đơn Pro đầu tiên của user này? -> kích hoạt thưởng giới thiệu bạn bè (nếu có) ---
      await rewardReferralIfFirstPurchase(db, existingOrder.user_id, existingOrder.id);
    } else if (existingOrder.order_type === "course" && existingOrder.course_id) {
      const { error: enrollErr } = await db.from("course_enrollments").upsert(
        {
          user_id: existingOrder.user_id,
          course_id: existingOrder.course_id,
          status: "active",
          enrolled_at: new Date().toISOString(),
        },
        { onConflict: "user_id,course_id" },
      );
      if (enrollErr) throw enrollErr;
    }

    return new Response(JSON.stringify({ received: true, processed: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("sepay-ipn error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Lỗi không xác định" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

/**
 * Thưởng chương trình giới thiệu bạn bè: khi user (referredUserId) vừa nâng cấp Pro
 * THÀNH CÔNG LẦN ĐẦU TIÊN (không tính các lần gia hạn sau đó), cộng tiền vào profiles.balance
 * cho cả người giới thiệu (referrer) và người được giới thiệu (referred), ghi log vào
 * balance_transactions để khớp với cách trang admin đang hiển thị lịch sử số dư.
 *
 * Mức thưởng cấu hình qua site_settings (key = 'referral_settings'), mặc định:
 *   referrer_reward = 20000đ, referred_reward = 10000đ.
 * Nếu bảng referrals/balance_transactions chưa tồn tại hoặc user không được ai giới thiệu
 * thì bỏ qua êm, KHÔNG làm hỏng luồng kích hoạt Pro chính.
 */
async function rewardReferralIfFirstPurchase(
  db: ReturnType<typeof createClient>,
  referredUserId: string,
  currentOrderId: string,
) {
  try {
    const { data: referral, error: refErr } = await db
      .from("referrals")
      .select("id, referrer_id, status")
      .eq("referred_id", referredUserId)
      .maybeSingle();
    if (refErr || !referral || referral.status === "rewarded") return;

    // Chỉ thưởng nếu đây là đơn "subscription" đã paid ĐẦU TIÊN của user này (tránh thưởng lặp mỗi lần gia hạn)
    const { count: priorPaidSubs } = await db
      .from("sepay_orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", referredUserId)
      .eq("order_type", "subscription")
      .eq("status", "paid")
      .neq("id", currentOrderId);
    if ((priorPaidSubs || 0) > 0) return; // không phải lần nâng cấp đầu tiên -> bỏ qua

    const { data: settingsRow } = await db
      .from("site_settings")
      .select("payload")
      .eq("key", "referral_settings")
      .maybeSingle();
    const cfg = settingsRow?.payload || {};
    if (cfg.enabled === false) return;
    const referrerReward = Number.isFinite(+cfg.referrer_reward) ? +cfg.referrer_reward : 20000;
    const referredReward = Number.isFinite(+cfg.referred_reward) ? +cfg.referred_reward : 10000;

    await creditBalance(db, referral.referrer_id, referrerReward, "Thưởng giới thiệu bạn bè nâng cấp Pro");
    if (referredReward > 0) {
      await creditBalance(db, referredUserId, referredReward, "Thưởng chào mừng khi được giới thiệu & nâng cấp Pro");
    }

    await db
      .from("referrals")
      .update({
        status: "rewarded",
        reward_amount: referrerReward,
        referred_reward_amount: referredReward,
        rewarded_at: new Date().toISOString(),
      })
      .eq("id", referral.id);
  } catch (e) {
    // Không throw ra ngoài — lỗi ở phần thưởng referral không được phép làm hỏng việc kích hoạt Pro
    console.error("sepay-ipn: lỗi xử lý thưởng giới thiệu bạn bè:", e);
  }
}

async function creditBalance(
  db: ReturnType<typeof createClient>,
  userId: string,
  amount: number,
  note: string,
) {
  if (!amount) return;
  const { data: profile } = await db.from("profiles").select("balance").eq("id", userId).maybeSingle();
  const currentBalance = Number(profile?.balance) || 0;
  const newBalance = currentBalance + amount;

  await db.from("profiles").update({ balance: newBalance }).eq("id", userId);
  await db.from("balance_transactions").insert({
    user_id: userId,
    amount,
    balance_after: newBalance,
    note,
  });
}