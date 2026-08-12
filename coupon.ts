import type { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Dùng chung cho sepay-validate-coupon (xem trước) và sepay-create-checkout (tạo đơn thật).
 * QUAN TRỌNG: logic ở đây phải là nguồn tính discount DUY NHẤT — không tính lại discount
 * nào khác ở nơi gọi, để tránh giá preview và giá lúc thanh toán bị lệch nhau.
 */

type DB = ReturnType<typeof createClient>;

export async function resolveOrderAmount(
  db: DB,
  order_type: string,
  ids: { course_id?: string; plan_id?: string; document_id?: string; product_id?: string },
): Promise<{ amount: number; label: string } | null> {
  if (order_type === "course" && ids.course_id) {
    const { data } = await db.from("courses").select("price, title").eq("id", ids.course_id).single();
    if (!data) return null;
    return { amount: Number(data.price), label: data.title };
  }
  if (order_type === "subscription" && ids.plan_id) {
    const { data } = await db.from("pro_packages").select("price, name").eq("id", ids.plan_id).single();
    if (!data) return null;
    return { amount: Number(data.price), label: data.name };
  }
  // order_type 'document' / 'product': dự án đã có luồng xử lý riêng cho các loại này
  // (document_purchases / product_purchases) — coupon hiện chỉ áp dụng cho gói Pro (subscription).
  return null;
}

export function computeDiscount(
  coupon: { discount_type: string; discount_value: number; max_discount_amount: number | null },
  amount: number,
): number {
  let discount = 0;
  if (coupon.discount_type === "percent") {
    discount = Math.round((amount * Number(coupon.discount_value)) / 100);
    if (coupon.max_discount_amount) discount = Math.min(discount, Number(coupon.max_discount_amount));
  } else {
    discount = Number(coupon.discount_value);
  }
  // luôn giữ lại tối thiểu 1.000đ để không tạo đơn 0đ (SePay không xử lý được đơn 0đ)
  return Math.max(0, Math.min(discount, amount - 1000));
}

export async function loadValidCoupon(
  db: DB,
  code: string,
  order_type: string,
  amount: number,
): Promise<{ ok: true; coupon: any } | { ok: false; message: string }> {
  const normalized = (code || "").trim().toUpperCase();
  if (!normalized) return { ok: false, message: "Vui lòng nhập mã giảm giá." };

  const { data: coupon, error } = await db.from("coupons").select("*").eq("code", normalized).single();

  if (error || !coupon) return { ok: false, message: "Mã giảm giá không tồn tại." };
  if (!coupon.active) return { ok: false, message: "Mã giảm giá này đã bị tắt." };
  if (coupon.starts_at && new Date(coupon.starts_at) > new Date()) {
    return { ok: false, message: "Mã giảm giá chưa tới thời gian áp dụng." };
  }
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    return { ok: false, message: "Mã giảm giá đã hết hạn." };
  }
  if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
    return { ok: false, message: "Mã giảm giá đã hết lượt sử dụng." };
  }
  if (coupon.applies_to !== "all" && coupon.applies_to !== order_type) {
    return { ok: false, message: "Mã giảm giá không áp dụng cho loại đơn hàng này." };
  }
  if (amount < Number(coupon.min_amount || 0)) {
    return {
      ok: false,
      message: `Đơn hàng cần tối thiểu ${Number(coupon.min_amount).toLocaleString("vi-VN")}đ để dùng mã này.`,
    };
  }
  return { ok: true, coupon };
}
