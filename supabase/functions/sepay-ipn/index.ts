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
      .select("id, status, amount, order_type, plan_id, course_id, user_id, sepay_transaction_id")
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