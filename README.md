# Tiệm Bơ Sầu – Chấm công bằng khuôn mặt

Next.js 15 (App Router) + MongoDB + Google Drive (lưu ảnh). Code theo `SPEC_cham_cong.md` v1.1.

## Tính năng đã có

| Nhóm | Chức năng | Spec |
|---|---|---|
| Nhân viên | Đăng nhập Google, đăng ký cơ sở (không cần ảnh khuôn mặt), chờ duyệt | 4.1 |
| | Ràng buộc thiết bị (deviceId cookie + localStorage + fingerprint), yêu cầu đổi thiết bị | 4.1.1 |
| | Chấm công: kiểm tra thiết bị → GPS (bán kính, sai số) → camera: có khuôn mặt trong khung (vòng xanh) là tự chụp – không so khớp ảnh mẫu → giờ server | 4.2 |
| | Làm tròn giờ công (bước 0,5h, làm tròn xuống, có tuỳ chọn dung sai), cảnh báo đi muộn / về sớm theo ca | 4.3, 4.4 |
| | Xem chấm công tháng, lịch ca, bảng lương (sau khi công bố), gửi yêu cầu điều chỉnh, khiếu nại lương | 4.5, 4.6 |
| | Đăng ký ca theo tuần (chỉ tuần tương lai), xem lịch của mình dạng bảng ca × ngày theo tuần / tháng | 4.7 |
| | **Màu giao diện** (Tài khoản → Màu giao diện): Vàng bơ (mặc định), Đỏ son, Hồng phấn, Ngọc bích, Xanh lam, Tối (dark mode) – lưu theo tài khoản, áp dụng cả khu Quản lý; thử việc luôn màu tím. Token màu ở `globals.css` (.theme-x), danh sách ở `lib/themes.ts` – thêm màu mới dùng token (bg-card, ring-line, text-on-primary…), không ghi cứng mã màu | – |
| Admin | Đăng nhập bằng **Gmail**: Chủ (OWNER_EMAIL) + admin do Admin Tổng thêm Gmail ở **Quản lý admin**; phân quyền từng chức năng (mặc định admin không có quyền tài chính, lương, xuất Excel, cơ sở, duyệt chấm công bù…) | 2.1 |
| | Dashboard hôm nay, duyệt đăng ký (+ thiết bị đầu tiên), nhân viên (lương giờ có ngày hiệu lực), thiết bị + cảnh báo nghi chấm hộ | 3.1, 3.3 |
| | Cơ sở (3 cơ sở tạo sẵn), ca mẫu (hỗ trợ qua đêm), xếp ca hàng loạt, copy tuần trước | 1.2, 3.2, 3.4 |
| | **Xếp ca tự động**: lịch tuần theo mẫu, duyệt đăng ký (từng ca / từng người / tất cả), xếp tay, định mức người/ca, xếp tự động có xem trước (ít ca nhất, hay làm ca, hay làm cùng), tổng hợp số ca & cảnh báo thiếu người | 3.2.1 |
| | **Chấm công theo ca cả tháng** (trang Chấm công, chế độ tổng hợp): bảng ca × ngày giống bảng xếp ca, cuộn ngang; icon ⏰ đi muộn/về sớm, ⊕ làm thêm ca, ↪ quên check-out, nhãn xanh CS1/CS2… đi hỗ trợ / từ cơ sở khác sang, tên bôi xám gạch ngang = bỏ ca; bấm tên → bảng chấm công chi tiết | – |
| | Bảng chấm công theo mẫu, tổng hợp tháng, chấm hộ, sửa / xoá có lịch sử, "Thêm phạt" từ dòng muộn/sớm | 5, 3.5, 7.1 |
| | Thưởng / phạt nhập tự do (VND), bảng lương (phụ cấp, tạm ứng), công bố sớm / tự công bố 00:00 ngày 5, khoá tháng, mở khoá | 3.6, 3.7 |
| | Xuất Excel 7 loại báo cáo (header vàng/nâu, freeze, filter, dòng tổng, tô màu) + audit log | 3.8 |
| | **Yêu cầu đăng ký ca**: ở bảng tổng hợp tuần (tuần sau trở đi) admin bấm "Yêu cầu đăng ký" từng người hoặc tất cả NV chưa có ca → nhân viên thấy cảnh báo "chưa đăng ký ca tuần …" + nút **Đăng ký ca** (hoặc "Tuần này tôi nghỉ"); trạng thái Đã yêu cầu / Đã đăng ký / Báo nghỉ hiện cho admin | – |
| | **Thông báo chấm công**: mỗi lần check-in / check-out, bot gửi vào **nhóm chấm công** ảnh + cơ sở, nhân viên, ngày, giờ vào/ra, giờ công, cảnh báo đi muộn / về sớm / ngoài ca (chat ID theo cơ sở hoặc `TELEGRAM_ATTENDANCE_CHAT_ID`) | – |
| | **Hỗ trợ cơ sở khác**: admin gọi nhân viên cơ sở khác sang (chọn ở ô "＋ Thêm…" → nhóm "Gọi hỗ trợ từ …"), chặn trùng giờ giữa các cơ sở; nhân viên chỉ chấm công được ở cơ sở khác khi có **ca hỗ trợ đã duyệt** đúng giờ (app tự nhận cơ sở theo GPS); giờ hỗ trợ tính vào **bảng lương cơ sở gốc** (ghi chú "hỗ trợ: TBS … Xh"); chốt ca gửi vào nhóm Telegram của cơ sở đang làm | – |
| | **Doanh thu chốt ca**: chụp ảnh + nhập Doanh thu máy, Tiền mặt, Tài khoản, Thu chi, Grab, Shopee (gõ được phép cộng "10000 + 20k", "30k sữa chua + 20k ship" → rời ô hiện tổng); Âm/Dương = DT máy − (TM + TK + Thu chi + Grab + Shopee), khác 0 bắt buộc ghi chú → gửi nhóm Telegram; ca cuối ngày cộng các ca & ghi dòng ngày lên Google Sheet; admin xem doanh thu ngày, sửa số, ghi lại sheet | – |
| | **Chốt ca**: nhân viên chụp ảnh cuối ca (camera sau, tối đa 4 ảnh) → gửi album vào nhóm Telegram của cơ sở; admin xem / gửi lại; webhook cho hệ thống phân tích ảnh | – |
| | **Dọn dữ liệu cũ** (Chủ, ở Cài đặt): chọn mốc tháng (chỉ dữ liệu cũ hơn 2 tháng) → xoá lịch sử đăng nhập, nhật ký thao tác, lịch sử sửa chấm công, ảnh check-in/out & chốt ca (tuỳ chọn chuyển thư mục ảnh tháng cũ trên Drive vào thùng rác). Có xem trước số lượng + hộp xác nhận; không xoá chấm công / lương | – |
| | Cài đặt: kết nối Google Drive, cấu hình làm tròn / ngưỡng / số thiết bị…, lịch sử đăng nhập admin, nhật ký thao tác | 2.1 |
| Hệ thống | Cron: quên check-out, upload lại ảnh lỗi, tạo bảng lương nháp, công bố ngày 5 | 6.1 |

**Chưa làm (Phase 3 / P2 còn lại):** thông báo (email/push), nghỉ phép / đổi ca, chế độ kiosk, thống kê biểu đồ, đa ngôn ngữ, PDF bảng lương.

## Cài đặt

### 1. Yêu cầu
- Node.js **22 LTS** (bắt buộc 22.x – file `.nvmrc`). Kiểm tra: `node -v`. Dùng nvm-windows: `nvm install 22` → `nvm use 22`
- MongoDB Atlas (hoặc MongoDB 6+)
- Google Cloud project

### 2. Google Cloud
1. Tạo project → **APIs & Services → Enable APIs** → bật **Google Drive API**.
2. **OAuth consent screen**: External, thêm scope `drive.file`, thêm email Chủ vào Test users (hoặc publish app).
3. **Credentials → OAuth client ID → Web application**, thêm *Authorized redirect URIs*:
   - `https://<domain>/api/auth/callback/google` (đăng nhập Google)
   - `https://<domain>/api/google/callback` (Chủ kết nối Drive)
   - và bản `http://localhost:3000/...` tương ứng khi chạy local.

### 3. Biến môi trường
```bash
cp .env.example .env.local
# điền MONGODB_URI, GOOGLE_CLIENT_ID/SECRET, OWNER_EMAIL, NEXTAUTH_SECRET, ENCRYPTION_KEY, ADMIN_JWT_SECRET, CRON_SECRET
```
`ENCRYPTION_KEY` (64 ký tự hex) dùng mã hoá STK và refresh token – **không được đổi sau khi đã có dữ liệu**.

### 4. Chạy
```bash
npm install
npm run seed                      # tạo Settings + 3 cơ sở + index (app cũng tự seed lần đầu)
npm run set-admin-password -- "MatKhau123"   # hoặc Chủ đặt trong Cài đặt
npm run dev                       # http://localhost:3000
npm test                          # unit test công thức giờ công / lương / múi giờ
```
Camera & GPS cần **HTTPS** (localhost được miễn). Test trên điện thoại: dùng Vercel preview hoặc tunnel (ngrok, cloudflared).

### 5. Lần đầu sử dụng
1. Chủ vào `/admin/login` → **Đăng nhập bằng Google** (email = `OWNER_EMAIL`).
2. **Quản lý admin** → thêm Gmail admin + phân quyền · **Cài đặt** → **Kết nối Google Drive**.
3. **Cơ sở** → nhập toạ độ + bán kính cho TBS Geleximco, TBS Văn Phú, TBS Đô Nghĩa (đứng tại quán bấm "Dùng vị trí hiện tại", hoặc dán toạ độ từ Google Maps).
4. **Ca làm việc** → tạo ca mẫu, xếp ca.
5. Nhân viên mở app trên điện thoại → đăng nhập Google → đăng ký → admin **Duyệt đăng ký**.

### 5b. Chốt ca → nhóm Telegram
1. Chat với **@BotFather** → `/newbot` → lấy **token** → điền `TELEGRAM_BOT_TOKEN`.
2. Thêm bot vào nhóm chốt ca (cho quyền gửi ảnh). Lấy **chat ID** nhóm (dạng `-100…`), VD: thêm @RawDataBot vào nhóm để xem, hoặc gọi `https://api.telegram.org/bot<token>/getUpdates` sau khi nhắn 1 tin trong nhóm.
3. Điền `TELEGRAM_CHAT_ID` (nhóm mặc định) hoặc đặt nhóm riêng cho từng cơ sở ở **Cơ sở → Telegram chat ID** → **Gửi thử Telegram**.
4. **Bot phân tích ảnh**: Telegram **không cho bot đọc tin nhắn do bot khác gửi** trong nhóm. Nếu bot phân tích của bạn cần nhận ảnh, chọn 1 cách:
   - Bot phân tích nhận ảnh qua **webhook**: đặt `CLOSING_WEBHOOK_URL` (+ `CLOSING_WEBHOOK_SECRET`) – app POST JSON gồm thông tin ca + ảnh base64 + `messageIds` trên Telegram để bot trả lời đúng tin.
   - Hoặc dùng **chính bot phân tích** làm bot gửi (cùng token) và để bot đó tự xử lý ảnh ngay khi app gửi (qua webhook ở trên).
5. Gửi lỗi (mất mạng, sai chat ID…) → lượt chốt ca vẫn được lưu, cron hằng giờ tự gửi lại; admin bấm **Gửi lại** ở mục **Chốt ca**.

### 5b2. Đọc ảnh chốt ca bằng Gemini (tuỳ chọn)

Nhân viên bấm **Chụp ảnh chốt ca** → ảnh gửi Gemini → điền sẵn Doanh thu / Tiền mặt / Tài khoản / Thu chi / Grab / Shopee → cảnh báo nếu ảnh **thiếu Tiền mặt, Tài khoản hoặc ngày** (hay ngày trên ảnh khác ngày chốt). Nhân viên kiểm tra, sửa rồi bấm **Chốt ca & gửi nhóm**.

1. Vào https://aistudio.google.com/apikey → **Create API key**.
2. Thêm env `GEMINI_API_KEY` (Vercel + `.env.local`). Key hết lượt miễn phí → tự chuyển sang `GEMINI_API_KEY_2` … `GEMINI_API_KEY_9` (hoặc ghi nhiều key cách nhau dấu phẩy) – mỗi key phải ở 1 project Google khác nhau. Tuỳ chọn `GEMINI_MODEL` (mặc định `gemini-2.5-flash`; rẻ hơn: `gemini-2.5-flash-lite`).
3. Gói miễn phí giới hạn lượt/ngày và Google được dùng dữ liệu để cải thiện sản phẩm – nên bật billing (gói trả phí, vài trăm đồng/ảnh) để không bị dùng dữ liệu và không hết lượt.

Model chính hết lượt / quá tải → app tự thử model dự phòng (`GEMINI_FALLBACK_MODELS`, mặc định `gemini-2.5-flash-lite,gemini-3-flash-preview`), lỗi báo rõ "hết lượt trong ngày" hay "quá tải". Kiểm tra key và hạn mức từng model: `npm run check-gemini`.

Không có key → vẫn chụp ảnh gửi kèm, số liệu nhập tay.

### 5b3. Tài chính: chi phí, lãi lỗ, báo cáo (Admin → Tài chính)

- **Chi phí trong ca**: lấy từ ô "Thu chi" khi chốt ca (VD "30k sữa chua + 20k ship"), tách từng khoản, xem theo ca và khoản chi nhiều nhất. Tiền két → trừ thẳng vào lãi lỗ, không nhập bill lại.
- **Bill / chuyển khoản** (admin): bill mua hàng hoặc ảnh chụp màn hình CK → Gemini đọc số tiền, ngày, người nhận, nội dung CK, chi cho việc gì. Người nhận trùng tên nhân viên hoặc nội dung có "lương / tạm ứng" → tự chọn danh mục **Lương NV**: chỉ lưu chứng từ, **không cộng vào chi phí** (lương đã tính từ giờ công).
- **Chi phí (cách nhập)**: chụp / chọn ảnh bill → Gemini đọc số tiền, ngày, nơi bán, danh mục → kiểm tra → **Lưu & gửi nhóm**. Ảnh chỉ gửi vào nhóm Telegram **Quản lý doanh thu**, không lưu. Chi phí tính cho 1 cơ sở hoặc **chung** (chia theo tỷ lệ doanh thu tháng / chia đều / % tự đặt). Bill trả bằng **tiền két** chỉ lưu chứng từ, không cộng lại (đã nằm trong "Thu chi" chốt ca). Trùng ngày + số tiền → hỏi lại.
- **Tiền thuê nhà** (chi phí cố định duy nhất): mỗi cơ sở 1 khoản / tháng, tự chia đều theo ngày. Tăng giá → đặt "Đến tháng" cho khoản cũ rồi thêm khoản mới.
- **Lãi lỗ** (chỉ chủ): **Doanh thu thật = TK + TM + Grab + Shopee + Chi phí két** (két là tiền doanh thu lấy ra chi); **Âm/Dương = DT máy − Doanh thu thật**; **Lãi = Doanh thu thật − Chi phí két − Lương NV − Chi phí admin nhập − Mặt bằng − Phí sàn**. Có biểu đồ tròn cơ cấu chi phí; xem theo cơ sở là phần tham khảo.
- **Báo cáo Telegram** (chủ bật/tắt ở tab Cài đặt): ngày (khi cơ sở cuối cùng chốt ca Tối, hoặc ~1h sáng hôm sau), tuần (~1h sáng thứ 2), tháng (~1h sáng ngày 1). Có cảnh báo âm két, chưa chốt ca, doanh thu lệch > 30% so với TB cùng thứ, đi muộn / về sớm / bỏ ca, và nhận xét AI (Gemini).
- Cài đặt: tab **Tài chính → Cài đặt** nhập chat ID nhóm Quản lý doanh thu (hoặc env `TELEGRAM_FINANCE_CHAT_ID`), thêm bot vào nhóm, bấm **Gửi tin thử**.

### 5c. Doanh thu chốt ca → Google Sheet

> **Chốt ca là số LUỸ KẾ**: ca Chiều đã gồm ca Sáng, ca Tối = doanh thu cả ngày. Doanh thu ngày (Google Sheet, Lãi lỗ, báo cáo, Excel) = số chốt ca **Tối**; chưa chốt Tối → tạm tính theo ca chốt gần nhất. Xem ở **Tài chính → Doanh thu theo ngày** (bấm dòng để xem 3 ca, "DT riêng ca" = luỹ kế ca này − ca trước). Dữ liệu cũ (trước đây cộng dồn 3 ca) được cron tự tính lại và ghi lại Google Sheet.
Nhân viên nhập tay số liệu ca (gõ được phép cộng). Mỗi lần chốt ca gửi ảnh + số vào nhóm Telegram; **ca cuối ngày** (ca mẫu có giờ bắt đầu muộn nhất) cộng các ca trong ngày và ghi lên sheet.

**Google Sheet** (mỗi cơ sở 1 file, mỗi tháng 1 tab `T11`, dòng 3 = ngày 1):
1. Google Cloud (cùng project) → **IAM & Admin → Service Accounts → Create** → vào service account → **Keys → Add key → JSON** → tải file.
2. **APIs & Services → Library** → bật **Google Sheets API**.
3. Vercel: tạo biến **`GOOGLE_SA_JSON`** và dán **nguyên nội dung file JSON** (cách dễ nhất, không lo lỗi định dạng key).
   Hoặc dùng 2 biến `GOOGLE_SA_EMAIL` = `client_email`, `GOOGLE_SA_PRIVATE_KEY` = `private_key` (gồm `-----BEGIN PRIVATE KEY-----…`).
4. Mở từng file sheet → **Chia sẻ** → thêm email service account, quyền **Người chỉnh sửa**.
5. Admin → **Cơ sở** → dán link sheet, tên tab (`T{m}`), dòng ngày 1 (`3`) → Lưu → **Kiểm tra Google Sheet**.

App ghi theo **mẫu cột của từng cơ sở** (Admin → Cơ sở → *Mẫu cột sheet*):
- **Có cột Grab** (Geleximco, mặc định cho cơ sở mới): **B** DT · **C** Tài khoản · **D** Tiền mặt · **E** CP trong két (= Thu chi) · **F** Shopee · **G** Grab · **J** Ghi chú; cột H, I giữ công thức.
- **Mẫu cũ** (Văn Phú, Đô Nghĩa): **B–E** như trên · **F** Shopee + Grab · **I** Ghi chú (ghi rõ "Shopee … + Grab …"); cột G, H giữ công thức. Ngày chưa ghi được → cron đêm ghi lại, hoặc admin bấm **Ghi sheet** ở mục Chốt ca. Tab tháng mới cần tạo sẵn theo mẫu.

### 6. Deploy Vercel
- `vercel.json`: chạy hàm ở **Hong Kong (`hkg1`)** cho gần MongoDB Atlas (ap-east-1); 2 cron:
  - `/api/cron/publish-payroll` – `0 17 4 * *` (00:00 ngày 5 giờ VN): công bố bảng lương.
  - `/api/cron/hourly` – `0 18 * * *` (01:00 hằng đêm giờ VN; gói **Hobby chỉ cho cron 1 lần/ngày**). Gói Pro có thể đổi thành `0 * * * *`, hoặc dùng cron-job.org gọi `GET /api/cron/hourly` kèm header `Authorization: Bearer <CRON_SECRET>`.
- Biến môi trường như `.env.example`; `MONGODB_URI` là chuỗi Atlas.
- Sau khi có domain: cập nhật `NEXTAUTH_URL` và thêm Redirect URI trên Google Cloud (xem mục 2).

## Cấu trúc
```
src/
  app/
    (user)/            # site nhân viên: chấm công, lịch sử, lịch ca, bảng lương, tài khoản
    onboarding/ pending/ login/
    admin/login/       # đăng nhập trang quản lý bằng Gmail (Chủ / admin được duyệt)
    admin/(panel)/     # site admin
    admin/actions/     # server actions (auth, people, ops, settings)
    api/               # attendance, device, onboarding, photo, export, google, cron, auth
  components/          # UI (theme Tiệm Bơ Sầu), FaceCamera, CheckInWidget, AttendanceTable…
  lib/
    models.ts          # Mongoose models (spec 6.2)
    calc.ts            # công thức giờ công, làm tròn, muộn/sớm, khoảng cách, lương (có test)
    attendance.ts device.ts payroll.ts drive.ts export.ts time.ts …
public/models/         # model nhận diện khuôn mặt (face-api) – tự host
```

## Ghi chú kỹ thuật
- **Khuôn mặt** chỉ dùng để *phát hiện có người* trong khung, chạy trên trình duyệt (`@vladmandic/face-api` – TinyFaceDetector). Không đăng ký ảnh mẫu, không so khớp, không bắt chớp mắt. Khuôn mặt ở trong khung ~0,8s → tự chụp; ảnh lưu Drive để admin đối chiếu. Không có chức năng upload ảnh.
- **Chống chấm trùng**: unique partial index "1 lượt OPEN / nhân viên" + check-out dùng `findOneAndUpdate` có điều kiện + chặn check-out trong N phút sau check-in.
- **Làm tròn**: mặc định làm tròn xuống tuyệt đối (14h55' → 14,5). Dữ liệu sheet cũ có dung sai ~5 phút (14h55' → 15) → chỉnh "Dung sai làm tròn" trong Cài đặt nếu muốn giữ cách cũ.
- **Làm liền nhiều ca**: các ca đã duyệt liền nhau (nghỉ ≤ 30 phút, cùng cơ sở) được gộp thành 1 khối – VD ca 1 08–16 + ca 2 16–20 → check-in đầu ca 1, check-out cuối ca 2 = 1 lượt 12h, không báo về sớm, không bị coi là quên check-out. Đi muộn tính theo đầu ca đầu tiên; về sớm tính theo ca đang làm lúc ra (ra đúng hết ca 1 để nghỉ / check-in lại ca 2 → không báo về sớm).
- **Khoá tháng**: bảng lương đã công bố/đã trả → không chấm hộ, sửa chấm công, thêm/xoá thưởng phạt cho tháng đó. Mở khoá thì cron ngày 5 không tự công bố lại.
- **Ảnh**: upload Drive của Chủ theo `/TBS Chấm công/{Cơ sở}/{Nhân viên}/{YYYY-MM}/`. Mất kết nối → giữ tạm trong MongoDB, cron upload lại.
