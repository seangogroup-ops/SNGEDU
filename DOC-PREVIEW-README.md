# Tính năng: Xem trước tài liệu theo trang (kiểu Scribd)

## Cách hoạt động
1. Admin đăng tài liệu **trả phí** như bình thường (mục "Tài liệu" ở trang admin chính),
   sau đó vào trang mới **`admin/doc-preview.html`** để tách trang.
2. Admin chọn file PDF gốc + đặt "Số trang xem thử (free)" → bấm **Tách trang & Lưu**.
   Trình duyệt của admin (dùng PDF.js) tự tách từng trang thành ảnh JPG, tải lên bucket
   R2 **riêng tư** `tai-lieu-trang` (không public), rồi lưu:
   - Đường dẫn lưu trữ thật → bảng `document_sources` (không ai đọc được qua RLS, kể cả
     bằng anon key — chỉ Edge Function bằng service_role đọc được).
   - Thông tin công khai an toàn (`free_pages`, `pages_total`, `preview_mode:'pages'`) →
     vào JSON `site_settings.doc_content.paid[]` như các trường khác.
3. Khách vào **`doc-preview-viewer.html?id=<id tài liệu>`** → trang gọi Edge Function
   **`doc-pages`** để lấy TỪNG ảnh trang một. Function kiểm tra:
   - Trang ≤ số trang free → trả ảnh cho tất cả (kể cả khách chưa đăng nhập).
   - Trang > số trang free → phải **đăng nhập và đang có Pro** mới được trả ảnh,
     không thì trả lỗi 403 và trang viewer hiện khối "Nâng cấp Pro" (không có lựa
     chọn mua lẻ tài liệu — chỉ Pro mới mở khoá xem).
4. File PDF gốc **không còn public** — không có cách nào lấy nguyên file qua giới hạn
   trang nữa (khác với cơ chế `item.link` cũ vẫn lộ URL công khai).

## ⚠️ Giới hạn thực tế (nói thật, không hứa quá)
- **Không có cách nào trên web chặn được chụp màn hình / quay phim màn hình** — kể cả
  Scribd cũng vậy. Mình chỉ chặn được: tải file gốc, "Lưu ảnh" qua right-click, copy
  text, in trang (Ctrl+P/Ctrl+S bị chặn ở mức JS). Mỗi trang có **watermark email
  người xem** (mờ, chéo góc) để nếu ai đó chụp lại rồi phát tán thì admin tra được
  `document_view_logs` ra ai đã xem trang đó lúc nào.
- Người rành kỹ thuật vẫn có thể lưu ảnh từng trang qua tab Network của DevTools —
  nhưng chỉ lưu được **đúng số trang họ được phép xem**, không lấy được nguyên file.

## Việc cần làm để deploy

### 1. Chạy migration
Supabase SQL Editor → chạy `supabase/migrations/0016_doc_page_preview.sql`.

### 2. Tạo bucket R2 mới (riêng tư)
Vào Cloudflare R2 → tạo bucket tên **`tai-lieu-trang`** → **KHÔNG bật Public Access**
(khác với bucket `tai-lieu` hiện tại đang public).

### 3. Deploy Edge Function `doc-pages`
```
supabase functions deploy doc-pages
```
Sau đó vào **Supabase Dashboard → Edge Functions → doc-pages → Settings** →
**tắt "Verify JWT"** (function tự xử lý xác thực bên trong, kể cả khách ẩn danh xem
trang free vẫn gọi được).

Thêm Secret (nếu chưa có sẵn từ trước — dùng đúng giá trị mà function `r2-storage`
của bạn đang dùng để upload lên R2):
```
supabase secrets set R2_ACCOUNT_ID=xxx R2_ACCESS_KEY_ID=xxx R2_SECRET_ACCESS_KEY=xxx
```
> Nếu `r2-storage` đặt tên biến khác 3 tên trên, mở
> `supabase/functions/doc-pages/index.ts`, sửa 3 dòng `Deno.env.get(...)` đầu file
> cho khớp tên biến bạn đang dùng.

### 4. Copy 2 file mới vào đúng chỗ
- `doc-preview-viewer.html` → đặt ở **thư mục gốc** (ngang hàng `chi-tiet.html`).
- `admin/doc-preview.html` → đặt trong thư mục **`admin/`**.

### 5. Dán 2 đoạn nhỏ (thủ công) vào code hiện có

**a) `admin/index.html`** — thêm link vào sidebar, ngay dưới mục "Tài liệu"
(tìm dòng có `id="nav_doc"`, khoảng dòng 1795-1797):
```html
<div class="side-item settings-item" id="nav_doc" onclick="showContentManager('doc')">
    <span class="set-ico">📁</span><span class="name">Tài liệu</span>
</div>
<!-- 👇 THÊM ĐOẠN NÀY -->
<div class="side-item settings-item" id="nav_doc_preview" onclick="window.location.href='doc-preview.html'">
    <span class="set-ico">🧩</span><span class="name">Xem trước theo trang</span>
</div>
```

**b) `chi-tiet.html`** — file này **đã được sửa sẵn** trong gói tải về (đính kèm
cùng chỗ với zip), bạn chỉ cần **ghi đè lên file `chi-tiet.html` gốc** của bạn là
xong, không cần dán tay. Nếu bạn đã tự sửa `chi-tiet.html` từ lúc đăng bài trước thì
nhớ merge lại cho khỏi mất thay đổi riêng của bạn — phần mình thêm nằm trong hàm
`loadDocItem()`, có 2 chỗ:
1. Sau khối `if (!isPaid){...} else if (owned){...} else {...}` xây `ctaHtml`,
   thêm đoạn ghi đè khi `item.preview_mode === 'pages' && item.pages_ready`.
2. Sửa điều kiện `if (isPaid && !owned){` thành
   `if (isPaid && !owned && !(item.preview_mode === 'pages' && item.pages_ready)){`
   để không bị lỗi null khi nút `pdBuyBtn` không còn tồn tại.

### 6. Test
1. Vào `admin/doc-preview.html`, chọn 1 tài liệu trả phí đã có sẵn, tách trang thử.
2. Mở `doc-preview-viewer.html?id=<id>` ở trình duyệt ẩn danh (chưa đăng nhập) → phải xem
   được đúng số trang free, quá số đó phải hiện khối khoá.
3. Đăng nhập bằng tài khoản Pro hoặc tài khoản đã mua tài liệu đó → phải xem được
   hết toàn bộ trang.

## Có thể mở rộng thêm (chưa làm, để sau)
- Hỗ trợ tách trang cho file Word (cần convert .docx → PDF trước, ví dụ qua
  LibreOffice ở 1 service riêng, trình duyệt không tự làm được).
- Đóng dấu watermark **trực tiếp vào pixel ảnh** ở Edge Function (hiện đang overlay
  bằng CSS ở client — dễ làm hơn nhưng dễ gỡ hơn 1 chút so với bake vào ảnh).
- Đếm & hiển thị "X lượt xem" công khai kiểu Scribd (đã có log ở `document_view_logs`,
  chỉ cần thêm 1 query đếm).
- Trang quản lý admin xoá được `document_sources` + ảnh trang khi admin xoá hẳn
  tài liệu (hiện chưa dọn rác khi xoá tài liệu gốc).


---

## Cập nhật: khắc phục ảnh trang bị mờ + tab "Tài liệu doc" trong admin

### 1) Vì sao trang bị mờ, và đã sửa gì
- Bản cũ render mỗi trang bằng `scale: 2.2` -> PDF khổ A4 chỉ ra ảnh **~1350px** ngang.
  Màn hình Retina/2K hiển thị khung đọc ~900px CSS tức **1800px thật**, nên trình duyệt phải
  *phóng to* ảnh lên -> chữ nhoè.
- Bản mới render theo **chiều rộng mục tiêu** (mặc định **2560px**, chọn được 1600/2200/2560/3200
  ngay trên thẻ tài liệu), tô nền trắng trước khi vẽ (tránh JPEG ra nền đen), và nén ở **q=0.95**.
  Trình duyệt chỉ việc thu nhỏ ảnh -> luôn nét.
- Viewer đổi từ `background-image` sang thẻ `<img>` thật (trình duyệt biết kích thước gốc nên
  resample chất lượng cao), có **nút zoom 70–220%**, thanh **số trang nổi** + ô nhảy tới trang,
  khung trang chừa sẵn đúng tỉ lệ (không giật layout), watermark làm nhạt còn `opacity .085`
  cho khỏi làm bẩn chữ.
- Lưu thêm `render_width`, `page_w`, `page_h` vào từng tài liệu trong `doc_content`.

> ⚠️ Tài liệu đã tách bằng bản cũ vẫn mờ vì **ảnh đã lưu trên R2 chỉ có bấy nhiêu pixel**.
> Phải vào tab "Tài liệu doc", chọn lại file PDF gốc và bấm **Tách lại & Lưu** thì mới nét.

### 2) Tab "Tài liệu doc" gắn thẳng vào mục Tài liệu
- Mục **Tài liệu** ở admin giờ có 2 tab: `📄 Danh sách tài liệu` và `🧩 Tài liệu doc (đọc online)`.
  Tab thứ hai nhúng `admin/doc-preview.html?embed=1` — cùng một dữ liệu, cùng ID tài liệu.
- Mỗi tài liệu trả phí trong danh sách có thêm mục menu **🧩 Tài liệu doc (đọc online)** để nhảy
  thẳng tới đúng thẻ tài liệu đó ở tab kia, và có **badge "🧩 Đọc online · N tr"** nếu đã tách trang.
- Sửa lỗi ngầm: trước đây sửa tiêu đề/giá một tài liệu ở mục Tài liệu sẽ **ghi đè mất**
  `preview_mode`/`pages_ready`/`free_pages`... làm khách hết đọc online được. Nay các trường này
  được giữ lại khi lưu.

### 3) Nạp VIP mới xem full
Không đổi luồng: trang <= `free_pages` ai cũng xem; quá số đó `doc-pages` trả 403 nếu tài khoản
không có Pro còn hạn. Viewer hiện khối "Còn N trang đang khoá" + nút **Nâng cấp Pro** dẫn sang
`nhan-pro.html`, và thanh trên cùng luôn có nút Pro khi chưa mở khoá.


---

## Cập nhật 2: 3 loại tài liệu (free / trả phí / nạp VIP) + đồng bộ 2 nơi

### Mô hình dữ liệu (vẫn giữ nguyên `doc_content` cũ, không cần migration)
| Loại | Lưu ở | Trường | Khách thấy gì |
|---|---|---|---|
| 🆓 Miễn phí | `doc_content.free[]` | `price: 0` | Tải/đọc online thoải mái |
| 💰 Trả phí | `doc_content.paid[]` | `access: 'buy'`, `price > 0` | Mua lẻ qua SePay để tải file |
| 👑 Nạp VIP xem | `doc_content.paid[]` | `access: 'pro'`, `price: 0` | Không bán lẻ — có Pro là xem full |

Tài liệu VIP vẫn nằm trong `paid[]` nên Edge Function `doc-pages` tự động coi là tài liệu
cần quyền: quá `free_pages` mà không có Pro thì trả 403 như cũ.

### Đồng bộ 2 màn hình
`admin/doc-preview.html` giờ đọc/ghi **cả hai mảng** `free[]` + `paid[]` — thêm tài liệu ở tab
"Tài liệu doc" hay ở mục "Tài liệu" đều ra cùng một danh sách, cùng ID. Form thêm/sửa ở cả hai
nơi đều có 3 nút chọn loại; ô giá tự khoá về 0đ khi chọn Miễn phí hoặc Nạp VIP.

### Trang khách
- Trang chủ: tài liệu VIP có badge 👑 VIP, CTA "Đọc online · cần Pro".
- `chi-tiet.html`: tài liệu VIP không hiện nút mua; có Pro thì tải/đọc được ngay, chưa có thì
  hiện nút "Nâng cấp Pro để xem".
