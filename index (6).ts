import { createClient } from "npm:@supabase/supabase-js@2";
import { grantEntitlement } from "../_shared/grant-entitlement.ts";

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
      .select("id, status, amount, order_type, plan_id, course_id, document_id, product_id, user_id, sepay_transaction_id")
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

    // --- 8. Kích hoạt quyền lợi cho user ---
    if (existingOrder.order_type === "wallet_topup") {
      // Nạp tiền vào ví: cộng thẳng vào profiles.balance qua hàm atomic,
      // đồng thời ghi 1 dòng balance_transactions (type='topup') để hiện trong Lịch sử.
      const { error: rpcErr } = await db.rpc("wallet_adjust_balance", {
        p_user_id: existingOrder.user_id,
        p_amount: Number(existingOrder.amount),
        p_type: "topup",
        p_note: `Nạp tiền qua SePay - ${invoiceNumber}`,
        p_order_id: existingOrder.id,
      });
      if (rpcErr) throw rpcErr;
    } else {
      await grantEntitlement(db, {
        id: existingOrder.id,
        order_type: existingOrder.order_type,
        plan_id: existingOrder.plan_id,
        course_id: existingOrder.course_id,
        document_id: existingOrder.document_id,
        product_id: existingOrder.product_id,
        user_id: existingOrder.user_id,
      });
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
