import { createClient } from "npm:@supabase/supabase-js@2";
import { SePayPgClient } from "npm:sepay-pg-node@latest";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SEPAY_MERCHANT_ID = Deno.env.get("SEPAY_MERCHANT_ID")!;
const SEPAY_SECRET_KEY = Deno.env.get("SEPAY_SECRET_KEY")!;
const SEPAY_ENV = Deno.env.get("SEPAY_ENV") ?? "sandbox";
const SITE_URL = Deno.env.get("SITE_URL")!;

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
    const { order_type, course_id, plan_id } = body;
    const payment_method = body.payment_method ?? "BANK_TRANSFER";

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
    } else {
      throw new Error("order_type không hợp lệ (course | subscription)");
    }

    if (!amount || amount <= 0) throw new Error("Số tiền không hợp lệ");

    const invoiceNumber = `${order_type === "course" ? "CRS" : "SUB"}-${Date.now()}-${user.id.slice(0, 8)}`;

    const { error: insertErr } = await db.from("sepay_orders").insert({
      invoice_number: invoiceNumber,
      user_id: user.id,
      order_type,
      course_id: order_type === "course" ? course_id : null,
      plan_id: order_type === "subscription" ? plan_id : null,
      amount,
      currency: "VND",
      status: "pending",
      payment_method,
    });
    if (insertErr) throw insertErr;

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