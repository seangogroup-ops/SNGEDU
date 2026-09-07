// supabase/functions/doc-pages/index.ts
//
// Phát ẢNH từng trang tài liệu (đã tách sẵn lúc admin đăng bài) cho trang
// xem trước "xem-tai-lieu.html", có kiểm tra quyền TRÊN SERVER trước khi trả:
//   - Trang <= free_pages (admin đặt riêng cho từng tài liệu)  -> ai cũng xem được
//     (kể cả khách chưa đăng nhập, giống Scribd cho xem vài trang đầu không cần login).
//   - Trang > free_pages  -> phải đăng nhập VÀ (đang có Pro HOẶC đã mua đúng
//     tài liệu này), nếu không sẽ trả 403.
// File PDF gốc KHÔNG bao giờ lộ ra ngoài — bucket R2 lưu ảnh trang không bật
// public access, đường dẫn thật nằm trong bảng document_sources (RLS chặn
// hết client, chỉ function này bằng service_role đọc được).
//
// Gọi: GET {SUPABASE_URL}/functions/v1/doc-pages?doc_id=xxx&page=1
// Header: Authorization: Bearer <access_token của user, hoặc anon key nếu khách chưa đăng nhập>
//
// ⚠️ CẦN THÊM 3 SECRET SAU (Supabase Dashboard -> Edge Functions -> Secrets),
// dùng ĐÚNG giá trị mà Edge Function "r2-storage" của bạn đang dùng để tải file
// lên R2 (nếu r2-storage đặt tên biến khác 3 tên dưới đây, sửa lại cho khớp):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY

import { createClient } from "npm:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.17";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const R2_ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID")!;
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID")!;
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const r2 = new AwsClient({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  region: "auto",
  service: "s3",
});

// Giống hệt logic isProActive() trong frontend/usage-limits.js —
// để 2 nơi luôn đồng nhất "Pro" nghĩa là gì.
// deno-lint-ignore no-explicit-any
function isProActive(user: any): boolean {
  if (!user) return false;
  const meta = user.user_metadata || {};
  const until = meta.premium_until ? new Date(meta.premium_until) : null;
  return meta.plan === "premium" && (!until || until > new Date());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const docId = (url.searchParams.get("doc_id") || "").trim();
    const page = parseInt(url.searchParams.get("page") || "0", 10);
    if (!docId || !Number.isFinite(page) || page < 1) {
      throw new Error("Thiếu doc_id hoặc số trang không hợp lệ");
    }

    // Xác định người xem (có thể là khách chưa đăng nhập -> user = null)
    let user: { id: string; user_metadata?: Record<string, unknown> } | null = null;
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token) {
      const { data } = await db.auth.getUser(token);
      user = data?.user ?? null;
    }

    // Đọc cấu hình công khai của tài liệu (free_pages, preview_mode) từ site_settings
    const { data: settingsRow, error: settingsErr } = await db
      .from("site_settings")
      .select("payload")
      .eq("key", "doc_content")
      .single();
    if (settingsErr || !settingsRow) throw new Error("Không tải được cấu hình tài liệu");

    const payload = settingsRow.payload || { free: [], paid: [] };
    const paidList: any[] = Array.isArray(payload.paid) ? payload.paid : [];
    const freeList: any[] = Array.isArray(payload.free) ? payload.free : [];

    let item = paidList.find((it) => String(it.id) === docId);
    const isPaidDoc = !!item;
    if (!item) item = freeList.find((it) => String(it.id) === docId);
    if (!item) throw new Error("Không tìm thấy tài liệu");
    if (item.preview_mode !== "pages") throw new Error("Tài liệu này chưa bật chế độ xem trước theo trang");

    // Đường dẫn lưu trữ thật — chỉ đọc được ở đây (service_role, bỏ qua RLS)
    const { data: source, error: sourceErr } = await db
      .from("document_sources")
      .select("*")
      .eq("doc_id", docId)
      .single();
    if (sourceErr || !source) throw new Error("Tài liệu chưa được xử lý tách trang");

    const pagesTotal = Number(source.pages_total) || 0;
    if (page > pagesTotal) throw new Error("Trang không tồn tại");

    // Tính quyền xem full tài liệu — CHỈ Pro mới mở khoá, không có chuyện mua lẻ
    // tài liệu để mở khoá xem trước (khác với luồng mua-tải-file cũ ở chi-tiet.html).
    let hasFullAccess = !isPaidDoc; // tài liệu miễn phí -> full luôn, không giới hạn
    if (isPaidDoc && user && isProActive(user)) {
      hasFullAccess = true;
    }

    const freePages = Number.isFinite(+item.free_pages) ? Math.max(0, Math.floor(+item.free_pages)) : 0;
    const allowedMaxPage = hasFullAccess ? pagesTotal : Math.min(freePages, pagesTotal);

    if (page > allowedMaxPage) {
      return new Response(
        JSON.stringify({
          error: "locked",
          message: "Cần đăng nhập + nâng cấp Pro hoặc mua tài liệu để xem tiếp",
          allowed_max_page: allowedMaxPage,
          pages_total: pagesTotal,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Lấy ảnh trang từ R2 (bucket private) qua API tương thích S3, ký request bằng aws4fetch
    const objectKey = `${source.storage_prefix}/page-${page}.jpg`;
    const r2Url = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${source.storage_bucket}/${objectKey}`;
    const r2Res = await r2.fetch(r2Url);
    if (!r2Res.ok || !r2Res.body) {
      throw new Error(`Không tải được ảnh trang (mã lỗi R2: ${r2Res.status})`);
    }

    // Ghi log lượt xem — best-effort, không chặn phản hồi nếu ghi lỗi.
    // Dùng để truy vết nếu sau này phát hiện tài liệu bị chụp/phát tán.
    db.from("document_view_logs").insert({ user_id: user?.id ?? null, document_id: docId, page }).then(
      () => {},
      () => {},
    );

    return new Response(r2Res.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=120, no-store",
        "Content-Disposition": "inline",
        "X-Pages-Total": String(pagesTotal),
        "X-Allowed-Max-Page": String(allowedMaxPage),
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Lỗi không xác định" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
