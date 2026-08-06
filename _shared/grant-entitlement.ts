// _shared/grant-entitlement.ts
// Dùng chung giữa sepay-ipn (thanh toán qua cổng SePay) và sepay-create-checkout
// (thanh toán trực tiếp bằng số dư ví) để tránh lặp code kích hoạt quyền lợi.
//
// Gọi hàm này SAU KHI đơn hàng (sepay_orders) đã được set status = 'paid'.

// deno-lint-ignore no-explicit-any
type DbClient = any;

export interface OrderRow {
  id: string;
  order_type: "course" | "subscription" | "document" | "product" | "wallet_topup";
  plan_id?: string | null;
  course_id?: string | null;
  document_id?: string | null;
  product_id?: string | null;
  user_id: string;
}

/**
 * Kích hoạt quyền lợi tương ứng với loại đơn hàng đã thanh toán.
 * - subscription -> upsert bảng subscriptions + đồng bộ user_metadata.plan/premium_until
 * - course       -> upsert course_enrollments
 * - document     -> upsert document_purchases
 * - product      -> upsert product_purchases
 * (wallet_topup không cấp quyền lợi ở đây — được xử lý riêng bằng wallet_adjust_balance)
 */
export async function grantEntitlement(db: DbClient, order: OrderRow): Promise<void> {
  if (order.order_type === "subscription" && order.plan_id) {
    const { data: plan, error: planErr } = await db
      .from("pro_packages")
      .select("id, duration_days")
      .eq("id", order.plan_id)
      .single();

    if (planErr || !plan) throw new Error("Không tìm thấy gói thành viên khi kích hoạt");

    const durationDays = Number(plan.duration_days) || 30;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { error: subErr } = await db.from("subscriptions").upsert(
      {
        user_id: order.user_id,
        plan_id: order.plan_id,
        status: "active",
        started_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        last_order_id: order.id,
      },
      { onConflict: "user_id" },
    );
    if (subErr) throw subErr;

    const { error: metaErr } = await db.auth.admin.updateUserById(order.user_id, {
      user_metadata: {
        plan: "premium",
        premium_until: expiresAt.toISOString(),
      },
    });
    if (metaErr) console.error("grantEntitlement: lỗi cập nhật user_metadata:", metaErr);
    return;
  }

  if (order.order_type === "course" && order.course_id) {
    const { error: enrollErr } = await db.from("course_enrollments").upsert(
      {
        user_id: order.user_id,
        course_id: order.course_id,
        order_id: order.id,
      },
      { onConflict: "user_id,course_id" },
    );
    if (enrollErr) throw enrollErr;
    return;
  }

  if (order.order_type === "document" && order.document_id) {
    const { error: docErr } = await db.from("document_purchases").upsert(
      {
        user_id: order.user_id,
        document_id: order.document_id,
        order_id: order.id,
      },
      { onConflict: "user_id,document_id" },
    );
    if (docErr) throw docErr;
    return;
  }

  if (order.order_type === "product" && order.product_id) {
    const { error: prodErr } = await db.from("product_purchases").upsert(
      {
        user_id: order.user_id,
        product_id: order.product_id,
        order_id: order.id,
      },
      { onConflict: "user_id,product_id" },
    );
    if (prodErr) throw prodErr;
    return;
  }
}
