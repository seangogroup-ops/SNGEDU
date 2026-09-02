// ============================================================================
// Edge Function: admin-ctv
// Quản lý Cộng tác viên (CTV) từ trang admin — dùng service_role để:
//  - tra cứu user theo email (tạo CTV mới)
//  - tạo / sửa mức hoa hồng / khoá-mở CTV
//  - lấy danh sách CTV kèm số liệu tổng quan (clicks, đơn hàng, hoa hồng)
// Cùng pattern requireAdmin() như admin-users để tái dùng, tránh phải sửa
// file admin-users vốn đã lớn.
// Deploy: Supabase Dashboard → Edge Functions → admin-ctv → dán file này.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function requireAdmin(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return { ok: false as const, error: "Thiếu token đăng nhập." };

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false as const, error: "Token không hợp lệ hoặc đã hết hạn." };

  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profErr || !profile || profile.role !== "admin") {
    return { ok: false as const, error: "Bạn không có quyền admin." };
  }
  return { ok: true as const, adminId: userData.user.id };
}

// Tìm user Auth theo email (không phân biệt hoa/thường) — lặp trang giống admin-users.
async function findUserByEmail(email: string) {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  const perPage = 1000;
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data) return null;
    const found = data.users.find((u) => (u.email || "").toLowerCase() === target);
    if (found) return found;
    if (!data.users.length || data.users.length < perPage) return null;
    page++;
    if (page > 200) return null;
  }
}

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // bỏ ký tự dễ nhầm (0/O, 1/I)
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return "CTV-" + s;
}

// ----------------------------------------------------------------------
// action: list — toàn bộ CTV + số liệu tổng quan (email, clicks, đơn, hoa hồng)
// ----------------------------------------------------------------------
async function actionList() {
  const { data: ctvs, error } = await admin
    .from("ctv_accounts")
    .select("id, user_id, code, commission_type, commission_value, active, note, created_at")
    .order("created_at", { ascending: false });
  if (error) return json({ error: error.message }, 500);
  if (!ctvs || !ctvs.length) return json({ ctvs: [] });

  // Email hiển thị cho từng CTV (không tin profiles có email, lấy từ Auth)
  const emailById: Record<string, string> = {};
  await Promise.all(
    ctvs.map(async (c) => {
      const { data } = await admin.auth.admin.getUserById(c.user_id);
      emailById[c.user_id] = data?.user?.email || "(không rõ)";
    }),
  );

  // Số liệu tổng hợp: clicks theo code, hoa hồng theo ctv_id
  const codes = ctvs.map((c) => c.code);
  const ctvIds = ctvs.map((c) => c.id);

  const clickCountByCode: Record<string, number> = {};
  {
    const { data } = await admin.from("ctv_clicks").select("ctv_code").in("ctv_code", codes);
    (data || []).forEach((row: any) => {
      const k = String(row.ctv_code).toUpperCase();
      clickCountByCode[k] = (clickCountByCode[k] || 0) + 1;
    });
  }

  const commissionByCtv: Record<string, { orders: number; revenue: number; commission: number }> = {};
  {
    const { data } = await admin
      .from("ctv_commissions")
      .select("ctv_id, order_amount, commission_amount, status")
      .in("ctv_id", ctvIds)
      .eq("status", "credited");
    (data || []).forEach((row: any) => {
      const cur = commissionByCtv[row.ctv_id] || { orders: 0, revenue: 0, commission: 0 };
      cur.orders += 1;
      cur.revenue += Number(row.order_amount) || 0;
      cur.commission += Number(row.commission_amount) || 0;
      commissionByCtv[row.ctv_id] = cur;
    });
  }

  const result = ctvs.map((c) => ({
    ...c,
    email: emailById[c.user_id] || "(không rõ)",
    clicks: clickCountByCode[c.code.toUpperCase()] || 0,
    orders: commissionByCtv[c.id]?.orders || 0,
    revenue: commissionByCtv[c.id]?.revenue || 0,
    commission_total: commissionByCtv[c.id]?.commission || 0,
  }));

  return json({ ctvs: result });
}

// ----------------------------------------------------------------------
// action: create — tạo CTV mới từ email (báo lỗi nếu không tìm thấy hoặc đã là CTV)
// ----------------------------------------------------------------------
async function actionCreate(payload: any) {
  const email = String(payload.email || "").trim();
  if (!email) return json({ error: "Thiếu email." }, 400);

  const user = await findUserByEmail(email);
  if (!user) return json({ error: "Không tìm thấy tài khoản với email này." }, 404);

  const { data: existing } = await admin.from("ctv_accounts").select("id").eq("user_id", user.id).maybeSingle();
  if (existing) return json({ error: "Tài khoản này đã là CTV." }, 400);

  let code = String(payload.code || "").trim().toUpperCase();
  if (code && !/^[A-Z0-9_-]{2,32}$/.test(code)) {
    return json({ error: "Mã CTV chỉ gồm chữ/số/gạch ngang, 2-32 ký tự." }, 400);
  }
  if (!code) {
    // tự sinh mã, thử lại nếu trùng (hiếm khi xảy ra)
    for (let i = 0; i < 5; i++) {
      const candidate = randomCode();
      const { data: dup } = await admin.from("ctv_accounts").select("id").ilike("code", candidate).maybeSingle();
      if (!dup) { code = candidate; break; }
    }
    if (!code) return json({ error: "Không tạo được mã CTV, thử lại." }, 500);
  }

  const commissionType = payload.commission_type === "fixed" ? "fixed" : "percent";
  const commissionValue = Number(payload.commission_value);
  if (!Number.isFinite(commissionValue) || commissionValue < 0) {
    return json({ error: "Mức hoa hồng không hợp lệ." }, 400);
  }

  const { data: inserted, error } = await admin
    .from("ctv_accounts")
    .insert({
      user_id: user.id,
      code,
      commission_type: commissionType,
      commission_value: commissionValue,
      note: payload.note || null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.message?.includes("duplicate")) return json({ error: "Mã CTV này đã tồn tại, chọn mã khác." }, 400);
    return json({ error: error.message }, 500);
  }

  return json({ ok: true, id: inserted.id, code });
}

// ----------------------------------------------------------------------
// action: update — sửa mức hoa hồng / bật-tắt / ghi chú
// ----------------------------------------------------------------------
async function actionUpdate(payload: any) {
  const id = payload.id;
  if (!id) return json({ error: "Thiếu id." }, 400);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (payload.commission_type !== undefined) patch.commission_type = payload.commission_type === "fixed" ? "fixed" : "percent";
  if (payload.commission_value !== undefined) {
    const v = Number(payload.commission_value);
    if (!Number.isFinite(v) || v < 0) return json({ error: "Mức hoa hồng không hợp lệ." }, 400);
    patch.commission_value = v;
  }
  if (payload.active !== undefined) patch.active = !!payload.active;
  if (payload.note !== undefined) patch.note = payload.note || null;

  const { error } = await admin.from("ctv_accounts").update(patch).eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

// ----------------------------------------------------------------------
// action: delete — gỡ quyền CTV (không xoá lịch sử hoa hồng đã cộng)
// ----------------------------------------------------------------------
async function actionDelete(payload: any) {
  const id = payload.id;
  if (!id) return json({ error: "Thiếu id." }, 400);
  const { error } = await admin.from("ctv_accounts").delete().eq("id", id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

// ----------------------------------------------------------------------
// action: commissions — lịch sử hoa hồng của 1 CTV cụ thể
// ----------------------------------------------------------------------
async function actionCommissions(payload: any) {
  const ctvId = payload.ctv_id;
  if (!ctvId) return json({ error: "Thiếu ctv_id." }, 400);
  const { data, error } = await admin
    .from("ctv_commissions")
    .select("order_id, buyer_id, order_amount, commission_amount, status, created_at")
    .eq("ctv_id", ctvId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return json({ error: error.message }, 500);
  return json({ commissions: data || [] });
}

// ----------------------------------------------------------------------
// action: withdrawals — danh sách yêu cầu rút tiền (mặc định: đang chờ xử lý)
// ----------------------------------------------------------------------
async function actionWithdrawals(payload: any) {
  let q = admin
    .from("ctv_withdrawals")
    .select("id, ctv_id, amount, bank_name, bank_account_number, bank_account_holder, status, admin_note, created_at, processed_at")
    .order("created_at", { ascending: false })
    .limit(300);
  if (payload.status) q = q.eq("status", payload.status);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const ctvIds = Array.from(new Set((data || []).map((w: any) => w.ctv_id)));
  const emailByCtvId: Record<string, string> = {};
  if (ctvIds.length) {
    const { data: ctvs } = await admin.from("ctv_accounts").select("id, user_id, code").in("id", ctvIds);
    await Promise.all(
      (ctvs || []).map(async (c: any) => {
        const { data: u } = await admin.auth.admin.getUserById(c.user_id);
        emailByCtvId[c.id] = (u?.user?.email || "(không rõ)") + " · " + c.code;
      }),
    );
  }

  return json({ withdrawals: (data || []).map((w: any) => ({ ...w, ctv_label: emailByCtvId[w.ctv_id] || w.ctv_id })) });
}

// ----------------------------------------------------------------------
// action: process_withdrawal — duyệt / từ chối / đánh dấu đã chuyển khoản
// ----------------------------------------------------------------------
async function actionProcessWithdrawal(payload: any) {
  const id = payload.id;
  const status = payload.status; // 'approved' | 'rejected' | 'paid'
  if (!id || !["approved", "rejected", "paid"].includes(status)) {
    return json({ error: "Thiếu id hoặc trạng thái không hợp lệ." }, 400);
  }
  const { error } = await admin.rpc("ctv_process_withdrawal", {
    p_withdrawal_id: id,
    p_new_status: status,
    p_admin_note: payload.admin_note || null,
  });
  if (error) {
    if (String(error.message || "").includes("ALREADY_FINALIZED")) {
      return json({ error: "Yêu cầu này đã được xử lý trước đó." }, 400);
    }
    return json({ error: error.message }, 500);
  }
  return json({ ok: true });
}

// ----------------------------------------------------------------------
// action: document_submissions — danh sách tài liệu CTV nộp (mặc định: chờ duyệt)
// ----------------------------------------------------------------------
async function actionDocumentSubmissions(payload: any) {
  let q = admin
    .from("ctv_document_submissions")
    .select("id, ctv_id, title, description, suggested_price, file_path, file_name, status, reject_reason, approved_price, revenue_share_percent, doc_content_id, created_at, reviewed_at")
    .order("created_at", { ascending: false })
    .limit(300);
  if (payload.status) q = q.eq("status", payload.status);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const ctvIds = Array.from(new Set((data || []).map((d: any) => d.ctv_id)));
  const emailByCtvId: Record<string, string> = {};
  if (ctvIds.length) {
    const { data: ctvs } = await admin.from("ctv_accounts").select("id, user_id, code").in("id", ctvIds);
    await Promise.all(
      (ctvs || []).map(async (c: any) => {
        const { data: u } = await admin.auth.admin.getUserById(c.user_id);
        emailByCtvId[c.id] = (u?.user?.email || "(không rõ)") + " · " + c.code;
      }),
    );
  }

  const result = (data || []).map((d: any) => ({
    ...d,
    ctv_label: emailByCtvId[d.ctv_id] || d.ctv_id,
    file_url: `${SUPABASE_URL}/storage/v1/object/public/ctv-documents/${d.file_path}`,
  }));

  return json({ submissions: result });
}

// ----------------------------------------------------------------------
// action: review_document — duyệt (thêm vào catalogue doc_content.paid) hoặc từ chối
// ----------------------------------------------------------------------
async function actionReviewDocument(payload: any) {
  const id = payload.id;
  const decision = payload.decision; // 'approve' | 'reject'
  if (!id || !["approve", "reject"].includes(decision)) {
    return json({ error: "Thiếu id hoặc quyết định không hợp lệ." }, 400);
  }

  const { data: sub, error: subErr } = await admin
    .from("ctv_document_submissions")
    .select("*")
    .eq("id", id)
    .single();
  if (subErr || !sub) return json({ error: "Không tìm thấy tài liệu." }, 404);
  if (sub.status !== "pending") return json({ error: "Tài liệu này đã được xử lý trước đó." }, 400);

  if (decision === "reject") {
    const { error } = await admin
      .from("ctv_document_submissions")
      .update({ status: "rejected", reject_reason: payload.reject_reason || null, reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // decision === 'approve'
  const approvedPrice = Number(payload.approved_price);
  const revenuePercent = Number(payload.revenue_share_percent);
  if (!Number.isFinite(approvedPrice) || approvedPrice < 0) return json({ error: "Giá bán không hợp lệ." }, 400);
  if (!Number.isFinite(revenuePercent) || revenuePercent < 0 || revenuePercent > 100) {
    return json({ error: "Tỷ lệ % hoa hồng tác giả phải từ 0-100." }, 400);
  }

  const { data: settingRow } = await admin.from("site_settings").select("payload").eq("key", "doc_content").maybeSingle();
  const payloadJson = settingRow?.payload
    ? (typeof settingRow.payload === "string" ? JSON.parse(settingRow.payload) : settingRow.payload)
    : { free: [], paid: [] };
  if (!Array.isArray(payloadJson.paid)) payloadJson.paid = [];
  if (!Array.isArray(payloadJson.free)) payloadJson.free = [];

  const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/ctv-documents/${sub.file_path}`;
  const newDocId = "ctv-" + sub.id;

  payloadJson.paid.push({
    id: newDocId,
    title: sub.title,
    desc: sub.description || "",
    price: approvedPrice,
    image: null,
    link: fileUrl,
    size: sub.file_name || "PDF",
    ctv_id: sub.ctv_id,
    ctv_revenue_percent: revenuePercent,
  });

  const { error: upsertErr } = await admin
    .from("site_settings")
    .upsert({ key: "doc_content", payload: payloadJson }, { onConflict: "key" });
  if (upsertErr) return json({ error: upsertErr.message }, 500);

  const { error: subUpdateErr } = await admin
    .from("ctv_document_submissions")
    .update({
      status: "approved",
      approved_price: approvedPrice,
      revenue_share_percent: revenuePercent,
      doc_content_id: newDocId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (subUpdateErr) return json({ error: subUpdateErr.message }, 500);

  return json({ ok: true, doc_content_id: newDocId });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method không hỗ trợ." }, 405);

  const auth = await requireAdmin(req);
  if (!auth.ok) return json({ error: auth.error }, 401);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Body không phải JSON hợp lệ." }, 400);
  }

  switch (payload.action) {
    case "list":
      return await actionList();
    case "create":
      return await actionCreate(payload);
    case "update":
      return await actionUpdate(payload);
    case "delete":
      return await actionDelete(payload);
    case "commissions":
      return await actionCommissions(payload);
    case "withdrawals":
      return await actionWithdrawals(payload);
    case "process_withdrawal":
      return await actionProcessWithdrawal(payload);
    case "document_submissions":
      return await actionDocumentSubmissions(payload);
    case "review_document":
      return await actionReviewDocument(payload);
    default:
      return json({ error: "Action không hợp lệ: " + payload.action }, 400);
  }
});
