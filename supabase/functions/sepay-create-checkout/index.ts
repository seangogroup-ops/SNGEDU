import { createClient } from "npm:@supabase/supabase-js@2";
import { SePayPgClient } from "npm:sepay-pg-node@latest";
import { grantEntitlement } from "../_shared/grant-entitlement.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SEPAY_MERCHANT_ID = Deno.env.get("SEPAY_MERCHANT_ID")!;
const SEPAY_SECRET_KEY = Deno.env.get("SEPAY_SECRET_KEY")!;
const SEPAY_ENV = Deno.env.get("SEPAY_ENV") ?? "sandbox";
const SITE_URL = Deno.env.get("SITE_URL")!;

const WALLET_TOPUP_MIN = 10000;      // 10.000đ
const WALLET_TOPUP_MAX = 20000000;   // 20.000.000đ

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Thiếu Authorization header (chưa đăng nhập)");

    const supabaseAuth = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Không xác thực được người dùng");
    const user = userData.user;

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const body = await req.json();
    const { order_type, course_id, plan_id, document_id, product_id } = body;
    // Biến thể sản phẩm (vd "1 tháng" / "3 tháng"...) — rỗng '' nếu sản phẩm không chia biến thể.
    const requestedVariantId: string = typeof body.variant_id === "string" ? body.variant_id : "";
    let productVariantId = ""; // giá trị THẬT SỰ dùng để tạo đơn, do server tự xác định lại (không tin client)
    // use_balance = true  -> trừ thẳng vào số dư ví, không qua cổng SePay
    const useBalance = body.use_balance === true;
    const payment_method = useBalance ? "BALANCE" : (body.payment_method ?? "BANK_TRANSFER");

    // -------- Cấu hình bật/tắt cổng thanh toán do admin quản lý (site_settings key 'payment_settings') --------
    // Đây là chốt chặn THẬT SỰ (phía server) — dù người dùng có cố gọi thẳng API này bỏ qua giao diện,
    // vẫn không thanh toán được khi admin đã tắt. Giao diện chỉ ẩn/khoá nút cho gọn, không phải lớp bảo mật chính.
    const { data: paymentSettingsRow } = await db
      .from("site_settings")
      .select("payload")
      .eq("key", "payment_settings")
      .maybeSingle();
    const paymentSettings = paymentSettingsRow?.payload ?? {};
    const sepayEnabled = paymentSettings.sepay_enabled !== false; // mặc định bật nếu chưa cấu hình
    const balancePaymentEnabled = paymentSettings.balance_payment_enabled !== false;
    const walletTopupEnabled = paymentSettings.wallet_topup_enabled !== false;
    const disabledMessage = paymentSettings.sepay_disabled_message || "Cổng thanh toán đang tạm ngưng, vui lòng quay lại sau.";

    if (useBalance && !balancePaymentEnabled) {
      throw new Error("Thanh toán bằng số dư ví đang tạm ngưng. Vui lòng thử phương thức khác.");
    }
    if (!useBalance && order_type === "wallet_topup" && (!sepayEnabled || !walletTopupEnabled)) {
      throw new Error(disabledMessage);
    }
    if (!useBalance && order_type !== "wallet_topup" && !sepayEnabled) {
      throw new Error(disabledMessage);
    }

    let amount: number;
    let description: string;

    if (order_type === "course") {
      if (!course_id) throw new Error("Thiếu course_id");
      const { data: course, error } = await db
        .from("courses")
        .select("id, title, price")
        .eq("id", course_id)
        .single();
      if (error || !course) throw new Error("Không tìm thấy khoá học");
      amount = Number(course.price);
      description = `Thanh toan khoa hoc: ${course.title}`.slice(0, 250);
    } else if (order_type === "subscription") {
      if (!plan_id) throw new Error("Thiếu plan_id");
      const { data: plan, error } = await db
        .from("pro_packages")
        .select("id, name, price")
        .eq("id", plan_id)
        .single();
      if (error || !plan) throw new Error("Không tìm thấy gói thành viên");
      amount = Number(plan.price);
      description = `Dang ky goi thanh vien: ${plan.name}`.slice(0, 250);
    } else if (order_type === "document") {
      if (!document_id) throw new Error("Thiếu document_id");
      const item = await findPaidContentItem(db, "doc_content", "paid", document_id);
      if (!item) throw new Error("Không tìm thấy tài liệu");
      amount = Number(item.price);
      description = `Mua tai lieu: ${item.title || ""}`.slice(0, 250);
    } else if (order_type === "product") {
      if (!product_id) throw new Error("Thiếu product_id");
      const item = await findPaidContentItem(db, "product_content", "items", product_id);
      if (!item) throw new Error("Không tìm thấy sản phẩm");

      // Sản phẩm có biến thể (item.variants là mảng khác rỗng) -> BẮT BUỘC chọn đúng 1 biến thể,
      // giá lấy theo biến thể đó (server tự tra lại, không tin giá client gửi lên).
      const variants = Array.isArray(item.variants) ? item.variants : [];
      if (variants.length > 0) {
        const variant = variants.find((v: { id: unknown }) => String(v.id) === String(requestedVariantId));
        if (!variant) throw new Error("Vui lòng chọn 1 phiên bản sản phẩm hợp lệ");
        productVariantId = String(variant.id);
        amount = Number(variant.price);
        description = `Mua san pham: ${item.title || ""} - ${variant.label || ""}`.slice(0, 250);
      } else {
        amount = Number(item.price);
        description = `Mua san pham: ${item.title || ""}`.slice(0, 250);
      }

      // Nếu sản phẩm (hoặc biến thể) này có dùng "kho tài khoản" (product_stock, quản lý ở trang admin)
      // thì phải còn ít nhất 1 tài khoản trống mới cho tạo đơn — tránh thu tiền nhưng không có gì để giao.
      // "Có dùng kho" = đã bật item.stock_managed HOẶC đã có sẵn dòng nào trong kho cho biến thể này
      // (kể cả khi kho đang trống — bật cờ này rồi mà chưa kịp nhập tài khoản vẫn phải coi là hết hàng,
      // không được ngầm hiểu là "không giới hạn").
      const { count: totalStock } = await db
        .from("product_stock")
        .select("id", { count: "exact", head: true })
        .eq("product_id", String(product_id))
        .eq("variant", productVariantId);
      const usesStock = Boolean(item.stock_managed) || (totalStock ?? 0) > 0;
      if (usesStock) {
        const { count: availableStock } = await db
          .from("product_stock")
          .select("id", { count: "exact", head: true })
          .eq("product_id", String(product_id))
          .eq("variant", productVariantId)
          .eq("status", "available");
        if ((availableStock ?? 0) <= 0) {
          throw new Error("Sản phẩm này đã hết hàng, vui lòng quay lại sau.");
        }
      }
    } else if (order_type === "wallet_topup") {
      if (useBalance) throw new Error("Không thể nạp tiền bằng chính số dư ví");
      amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < WALLET_TOPUP_MIN || amount > WALLET_TOPUP_MAX) {
        throw new Error(
          `Số tiền nạp phải từ ${WALLET_TOPUP_MIN.toLocaleString("vi-VN")}đ đến ${WALLET_TOPUP_MAX.toLocaleString("vi-VN")}đ`,
        );
      }
      description = `Nap tien vao vi SNGEDU`;
    } else {
      throw new Error("order_type không hợp lệ (course | subscription | document | product | wallet_topup)");
    }

    if (!amount || amount <= 0) throw new Error("Số tiền không hợp lệ");

    const prefixMap: Record<string, string> = {
      course: "CRS",
      subscription: "SUB",
      document: "DOC",
      product: "PRD",
      wallet_topup: "TOP",
    };
    const invoiceNumber = `${prefixMap[order_type]}-${Date.now()}-${user.id.slice(0, 8)}`;

    const { data: insertedOrder, error: insertErr } = await db
      .from("sepay_orders")
      .insert({
        invoice_number: invoiceNumber,
        user_id: user.id,
        order_type,
        course_id: order_type === "course" ? course_id : null,
        plan_id: order_type === "subscription" ? plan_id : null,
        document_id: order_type === "document" ? document_id : null,
        product_id: order_type === "product" ? product_id : null,
        variant_id: order_type === "product" ? productVariantId : "",
        amount,
        currency: "VND",
        status: "pending",
        payment_method,
      })
      .select("id")
      .single();
    if (insertErr) throw insertErr;

    // -------- Thanh toán bằng số dư ví: xử lý ngay, không cần chuyển sang SePay --------
    if (useBalance) {
      if (order_type === "wallet_topup") throw new Error("order_type không hợp lệ với use_balance");

      const { data: newBalance, error: rpcErr } = await db.rpc("wallet_adjust_balance", {
        p_user_id: user.id,
        p_amount: -amount,
        p_type: "payment",
        p_note: description,
        p_order_id: insertedOrder.id,
      });

      if (rpcErr) {
        const insufficient = /INSUFFICIENT_BALANCE/i.test(rpcErr.message ?? "");
        await db.from("sepay_orders").update({ status: "failed" }).eq("id", insertedOrder.id);
        if (insufficient) {
          return new Response(
            JSON.stringify({ error: "Số dư không đủ để thanh toán. Vui lòng nạp thêm tiền vào ví." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        throw rpcErr;
      }

      const { error: updateErr } = await db
        .from("sepay_orders")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", insertedOrder.id);
      if (updateErr) throw updateErr;

      await grantEntitlement(db, {
        id: insertedOrder.id,
        order_type,
        plan_id: order_type === "subscription" ? plan_id : null,
        course_id: order_type === "course" ? course_id : null,
        document_id: order_type === "document" ? document_id : null,
        product_id: order_type === "product" ? product_id : null,
        variant_id: order_type === "product" ? productVariantId : "",
        user_id: user.id,
      });

      return new Response(
        JSON.stringify({ paid: true, invoiceNumber, balance: newBalance }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // -------- Thanh toán qua cổng SePay (mặc định) --------
    const client = new SePayPgClient({
      env: SEPAY_ENV,
      merchant_id: SEPAY_MERCHANT_ID,
      secret_key: SEPAY_SECRET_KEY,
    });

    const fields = client.checkout.initOneTimePaymentFields({
      operation: "PURCHASE",
      payment_method,
      order_invoice_number: invoiceNumber,
      order_amount: amount,
      currency: "VND",
      order_description: description,
      customer_id: user.id,
      success_url: `${SITE_URL}/thanh-toan-thanh-cong.html?inv=${invoiceNumber}`,
      error_url: `${SITE_URL}/thanh-toan-loi.html?inv=${invoiceNumber}`,
      cancel_url: `${SITE_URL}/thanh-toan-huy.html?inv=${invoiceNumber}`,
    });

    const checkoutUrl = client.checkout.initCheckoutUrl();

    return new Response(
      JSON.stringify({ checkoutUrl, fields, invoiceNumber }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("sepay-create-checkout error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Lỗi không xác định" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// Đọc site_settings.<key> (JSON) và tìm 1 item trả phí theo id, dùng cho document/product.
// deno-lint-ignore no-explicit-any
async function findPaidContentItem(db: any, settingKey: string, listField: string, itemId: string) {
  const { data, error } = await db
    .from("site_settings")
    .select("payload")
    .eq("key", settingKey)
    .maybeSingle();
  if (error || !data) return null;

  const payload = typeof data.payload === "string" ? JSON.parse(data.payload) : data.payload;
  const list = payload?.[listField];
  if (!Array.isArray(list)) return null;

  return list.find((it: { id: unknown }) => String(it.id) === String(itemId)) ?? null;
}
