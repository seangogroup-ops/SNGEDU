// ============================================================================
// Edge Function: ctv-portal
// Các hành động tự-phục-vụ (self-service) dành cho CHÍNH CTV đang đăng nhập —
// khác với admin-ctv (dành cho admin quản lý). Dùng service_role vì cần gọi
// các hàm SQL security-definer (ctv_request_withdrawal, ctv_credit_*) vốn đã
// bị khoá không cho client gọi trực tiếp.
//
// actions:
//  - request_withdrawal   { amount, bank_name, bank_account_number, bank_account_holder }
//  - submit_document      { title, description, suggested_price, file_path, file_name }
//
// Lưu ý: file phải được CTV tự upload lên bucket "ctv-documents" (đúng thư mục
// <user_id>/...) BẰNG session của chính họ TRƯỚC khi gọi action submit_document
// — hàm này chỉ ghi nhận đường dẫn, không nhận file trực tiếp.
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

async function requireCtv(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return { ok: false as const, error: "Thiếu token đăng nhập." };

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false as const, error: "Token không hợp lệ hoặc đã hết hạn." };

  const { data: ctv, error: ctvErr } = await admin
    .from("ctv_accounts")
    .select("*")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (ctvErr || !ctv) return { ok: false as const, error: "Tài khoản của bạn chưa được cấp quyền CTV." };
  if (!ctv.active) return { ok: false as const, error: "Kênh CTV của bạn đang bị tạm khoá." };

  return { ok: true as const, ctv, userId: userData.user.id };
}

async function actionRequestWithdrawal(ctv: any, payload: any) {
  const amount = Number(payload.amount);
  const bankName = String(payload.bank_name || "").trim();
  const bankAccountNumber = String(payload.bank_account_number || "").trim();
  const bankAccountHolder = String(payload.bank_account_holder || "").trim();

  if (!Number.isFinite(amount) || amount <= 0) return json({ error: "Số tiền rút không hợp lệ." }, 400);
  if (amount < 50000) return json({ error: "Số tiền rút tối thiểu là 50.000đ." }, 400);
  if (!bankName || !bankAccountNumber || !bankAccountHolder) {
    return json({ error: "Vui lòng nhập đầy đủ thông tin ngân hàng." }, 400);
  }

  const { data, error } = await admin.rpc("ctv_request_withdrawal", {
    p_ctv_id: ctv.id,
    p_amount: amount,
    p_bank_name: bankName,
    p_bank_account_number: bankAccountNumber,
    p_bank_account_holder: bankAccountHolder,
  });

  if (error) {
    if (String(error.message || "").includes("INSUFFICIENT_BALANCE")) {
      return json({ error: "Số dư ví không đủ để rút số tiền này." }, 400);
    }
    return json({ error: error.message }, 500);
  }

  return json({ ok: true, id: data });
}

async function actionSubmitDocument(ctv: any, payload: any) {
  const title = String(payload.title || "").trim();
  const description = String(payload.description || "").trim();
  const suggestedPrice = Number(payload.suggested_price);
  const filePath = String(payload.file_path || "").trim();
  const fileName = String(payload.file_name || "").trim();

  if (!title) return json({ error: "Vui lòng nhập tên tài liệu." }, 400);
  if (!Number.isFinite(suggestedPrice) || suggestedPrice < 0) return json({ error: "Giá đề xuất không hợp lệ." }, 400);
  if (!filePath) return json({ error: "Thiếu file tài liệu đã upload." }, 400);
  if (!filePath.startsWith(ctv.user_id + "/")) {
    return json({ error: "Đường dẫn file không hợp lệ." }, 400);
  }

  const { data, error } = await admin
    .from("ctv_document_submissions")
    .insert({
      ctv_id: ctv.id,
      title,
      description: description || null,
      suggested_price: suggestedPrice,
      file_path: filePath,
      file_name: fileName || null,
    })
    .select("id")
    .single();

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, id: data.id });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method không hỗ trợ." }, 405);

  const auth = await requireCtv(req);
  if (!auth.ok) return json({ error: auth.error }, 401);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Body không phải JSON hợp lệ." }, 400);
  }

  switch (payload.action) {
    case "request_withdrawal":
      return await actionRequestWithdrawal(auth.ctv, payload);
    case "submit_document":
      return await actionSubmitDocument(auth.ctv, payload);
    default:
      return json({ error: "Action không hợp lệ: " + payload.action }, 400);
  }
});
