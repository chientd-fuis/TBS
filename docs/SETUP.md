# Hướng dẫn cài đặt & triển khai – Tiệm Bơ Sầu

Tài liệu này hướng dẫn dựng ứng dụng **Tiệm Bơ Sầu** (chấm công khuôn mặt / GPS, xếp ca, bảng lương, chốt ca & doanh thu, tài chính, hàng hoá) từ con số 0 hoặc triển khai lại trên một môi trường mới. Ứng dụng là Next.js 15 (App Router) chạy trên **Vercel**, dữ liệu ở **MongoDB Atlas**, đăng nhập bằng **Google (NextAuth)**, ảnh chấm công lưu ở **Google Drive của Chủ**, doanh thu ghi lên **Google Sheet** bằng **service account**, thông báo qua **Telegram bot** và đọc ảnh / AI bằng **Google Gemini**. Làm lần lượt từ mục 1 đến mục 11; các mục đánh dấu *(tuỳ chọn)* có thể bỏ qua, app vẫn chạy được nhưng thiếu chức năng tương ứng.

> Trong tài liệu, `chu.quan@gmail.com` là ví dụ Gmail của Chủ (Admin Tổng), `tiembosau.vercel.app` là ví dụ tên miền. Mọi giá trị bí mật đều ghi dạng `xxxx` – **không bao giờ** commit giá trị thật lên Git.

## Mục lục

1. [Yêu cầu](#1-yêu-cầu)
2. [MongoDB Atlas](#2-mongodb-atlas)
3. [Google Cloud: project, OAuth (đăng nhập + Drive)](#3-google-cloud-project-oauth-đăng-nhập--drive)
4. [Service account cho Google Sheets *(tuỳ chọn)*](#4-service-account-cho-google-sheets-tuỳ-chọn)
5. [Gemini API key *(tuỳ chọn)*](#5-gemini-api-key-tuỳ-chọn)
6. [Telegram bot *(tuỳ chọn)*](#6-telegram-bot-tuỳ-chọn)
7. [Bảng biến môi trường](#7-bảng-biến-môi-trường)
8. [Triển khai lên Vercel](#8-triển-khai-lên-vercel)
9. [Lần chạy đầu tiên](#9-lần-chạy-đầu-tiên)
10. [Phát triển trên máy (local)](#10-phát-triển-trên-máy-local)
11. [Xử lý sự cố thường gặp](#11-xử-lý-sự-cố-thường-gặp)

---

## 1. Yêu cầu

| Thành phần | Yêu cầu | Ghi chú |
| --- | --- | --- |
| Node.js | **22.x** | File `.nvmrc` = `22`, `package.json` → `"engines": { "node": "22.x" }` |
| npm | đi kèm Node 22 | Dự án dùng `package-lock.json` |
| MongoDB | Atlas (gói **M0 Free** 512 MB là đủ để bắt đầu) hoặc MongoDB 6+ | App có thẻ thống kê dung lượng DB và chức năng dọn dữ liệu (Cài đặt) |
| Tài khoản Google | Gmail của Chủ | Dùng để: tạo Google Cloud project, đăng nhập Admin Tổng, sở hữu Drive lưu ảnh |
| Vercel | Gói Hobby dùng được | Gói Hobby chỉ cho cron **1 lần/ngày** (xem mục 8.5) |
| Telegram | 1 tài khoản để tạo bot | Tuỳ chọn |

Kiểm tra Node:

```bash
node -v        # phải ra v22.x.x
# Windows dùng nvm-windows:
nvm install 22
nvm use 22
```

---

## 2. MongoDB Atlas

1. Vào <https://cloud.mongodb.com> → đăng ký / đăng nhập → **Create** một Project (VD `tiem-bo-sau`).
2. **Create Cluster** → chọn **M0 (Free)**.
   - Provider: AWS. Region: nên chọn **Singapore (ap-southeast-1)** – gần region chạy hàm Vercel `sin1` (xem `vercel.json`).
3. **Database Access** → **Add New Database User**:
   - Authentication: Password. Username VD `tbs_app`, mật khẩu ngẫu nhiên (bấm *Autogenerate*).
   - Quyền: **Read and write to any database**.
   - Mật khẩu có ký tự đặc biệt (`@ : / ? # %`…) thì phải **URL-encode** khi dán vào chuỗi kết nối (hoặc dùng mật khẩu chỉ gồm chữ + số cho đỡ lỗi).
4. **Network Access** → **Add IP Address** → **Allow access from anywhere** (`0.0.0.0/0`).
   Vercel không có IP cố định nên bắt buộc mở như vậy; bảo mật dựa vào user/mật khẩu DB.
5. **Database → Connect → Drivers** → copy chuỗi kết nối, **thêm tên database** (VD `tbs`) sau dấu `/`:

```env
MONGODB_URI="mongodb+srv://tbs_app:xxxx@cluster0.xxxxx.mongodb.net/tbs?retryWrites=true&w=majority"
```

Kiểm tra nhanh từ máy (đọc `MONGODB_URI` trong `.env.local`, in user/host, thử kết nối):

```bash
node scripts/check-db.mjs
```

> Trên Windows, nếu có **biến môi trường hệ thống** `MONGODB_URI` thì app (và script) sẽ dùng biến đó, **bỏ qua** `.env.local`. Script `check-db.mjs` sẽ cảnh báo trường hợp này.

App tự tạo collection và index khi chạy; không cần tạo tay.

---

## 3. Google Cloud: project, OAuth (đăng nhập + Drive)

App dùng **một OAuth client (Web)** cho hai việc:

| Việc | Code | Redirect URI | Scope |
| --- | --- | --- | --- |
| Đăng nhập Google (nhân viên, admin, Chủ) | NextAuth – `src/lib/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts` | `<NEXTAUTH_URL>/api/auth/callback/google` | `openid email profile` (mặc định của NextAuth) |
| Chủ kết nối Google Drive để lưu ảnh | `src/lib/drive.ts`, `src/app/api/google/connect`, `src/app/api/google/callback` | `<NEXTAUTH_URL>/api/google/callback` | `https://www.googleapis.com/auth/drive.file`, `openid`, `email` |

### 3.1. Tạo project và bật API

1. Vào <https://console.cloud.google.com> bằng Gmail của Chủ → **Select a project → New project** (VD `tiem-bo-sau`).
2. **APIs & Services → Library**, bật:
   - **Google Drive API** (lưu ảnh chấm công / chốt ca).
   - **Google Sheets API** (ghi doanh thu ngày – chỉ cần nếu dùng mục 4).

> Đăng nhập Google qua NextAuth không cần bật API nào thêm. Gemini dùng API key riêng ở AI Studio (mục 5).

### 3.2. OAuth consent screen (Google Auth Platform)

1. **APIs & Services → OAuth consent screen** (giao diện mới: **Google Auth Platform → Branding / Audience / Data access**).
2. User type: **External**.
3. App name: `Tiệm Bơ Sầu`, User support email + Developer contact: Gmail của Chủ.
4. **Scopes / Data access** → thêm: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `.../auth/drive.file`.
5. **Audience / Publishing status**:
   - Đang thử: để **Testing** và thêm Gmail của Chủ + các Gmail sẽ test vào **Test users**. Chế độ Testing chỉ cho tối đa 100 test user đăng nhập.
   - Dùng thật: bấm **Publish app** (In production) để **mọi nhân viên** đăng nhập được bằng Gmail của họ.
   - Lưu ý: ở chế độ Testing, Google cấp refresh token chỉ sống khoảng **7 ngày** cho app có scope ngoài email/profile (ở đây là `drive.file`) → kết nối Drive sẽ tự rớt sau 7 ngày. Khi dùng thật nên Publish. Scope `drive.file` chỉ cho app truy cập file do chính app tạo.

### 3.3. Tạo OAuth client ID

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**, Name: `TBS web`.
3. **Authorized JavaScript origins** (không bắt buộc nhưng nên thêm):
   - `https://tiembosau.vercel.app`
   - `http://localhost:3000`
4. **Authorized redirect URIs** – phải khớp **chính xác** (giao thức, tên miền, không có `/` cuối):
   - `https://tiembosau.vercel.app/api/auth/callback/google`
   - `https://tiembosau.vercel.app/api/google/callback`
   - `http://localhost:3000/api/auth/callback/google`
   - `http://localhost:3000/api/google/callback`
5. Tạo xong → copy **Client ID** và **Client secret**:

```env
GOOGLE_CLIENT_ID="xxxx.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="xxxx"
```

> Redirect URI của Drive được dựng từ `NEXTAUTH_URL` (`${NEXTAUTH_URL}/api/google/callback`) → `NEXTAUTH_URL` phải đúng tên miền đang chạy, không có `/` ở cuối. Có thêm tên miền riêng / domain preview nào thì phải thêm cặp redirect URI tương ứng.

### 3.4. Google Drive lưu ảnh (làm sau khi deploy – mục 9)

- Ảnh check-in/check-out và ảnh chốt ca được upload vào **Drive của tài khoản Chủ kết nối** (OAuth, không phải service account), theo cây thư mục `TBS Chấm công/{Cơ sở}/{Nhân viên}/{YYYY-MM}/`. App tự tạo thư mục, **không cần share** gì.
- Chủ kết nối ở **Admin → Cài đặt → Kết nối Google Drive (lưu ảnh chấm công)** → bấm **Kết nối Google Drive** → chọn Gmail Chủ → cho phép. Chỉ Admin Tổng thấy và bấm được nút này.
- Refresh token được **mã hoá bằng `ENCRYPTION_KEY`** rồi lưu trong MongoDB (`Settings.googleRefreshTokenEnc`).
- Chưa kết nối / mất kết nối: ảnh được giữ tạm trong MongoDB (collection `pendingphotos`), cron đêm tự upload lại khi Drive kết nối lại. Cài đặt hiển thị số ảnh đang chờ.

---

## 4. Service account cho Google Sheets *(tuỳ chọn)*

Chỉ cần nếu muốn app **tự ghi doanh thu ngày** lên Google Sheet của từng cơ sở (`src/lib/sheets.ts`). Service account **chỉ dùng cho Sheets**, không dùng cho Drive.

### 4.1. Tạo service account và key

1. Google Cloud (cùng project) → **IAM & Admin → Service Accounts → Create service account**. Tên VD `tbs-sheets`. Không cần cấp role nào ở bước phân quyền project.
2. Mở service account vừa tạo → tab **Keys → Add key → Create new key → JSON** → tải file JSON về.
3. Đảm bảo **Google Sheets API** đã bật (mục 3.1).
4. Ghi lại email service account (dạng `tbs-sheets@<project-id>.iam.gserviceaccount.com`, trường `client_email` trong file JSON).

### 4.2. Đưa key vào biến môi trường

Cách 1 – **khuyên dùng**: dán **nguyên nội dung file JSON** (hoặc chuỗi base64 của file) vào một biến:

```env
GOOGLE_SA_JSON='{"type":"service_account","project_id":"xxxx","private_key":"-----BEGIN PRIVATE KEY-----\nxxxx\n-----END PRIVATE KEY-----\n","client_email":"tbs-sheets@xxxx.iam.gserviceaccount.com", ...}'
```

Cách 2 – hai biến riêng:

```env
GOOGLE_SA_EMAIL="tbs-sheets@xxxx.iam.gserviceaccount.com"
GOOGLE_SA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nxxxx\n-----END PRIVATE KEY-----\n"
```

Code chịu được các kiểu dán hay gặp: có dấu nháy bao quanh, `\n` dạng chữ, xuống dòng Windows, key dán thành 1 dòng, base64, hoặc lỡ dán cả file JSON vào `GOOGLE_SA_PRIVATE_KEY`. `GOOGLE_SA_JSON` được ưu tiên nếu có.

Muốn tạo base64 của file JSON (tránh lỗi ký tự khi dán):

```bash
node -e "console.log(require('fs').readFileSync('sa.json').toString('base64'))"
```

### 4.3. Chia sẻ Google Sheet cho service account

Mỗi cơ sở có **1 file Google Sheet**, mỗi tháng **1 tab** (mặc định tên `T{m}`, VD `T11`), dòng 3 là ngày 1.

1. Mở file sheet của cơ sở → **Chia sẻ (Share)** → dán email service account → quyền **Người chỉnh sửa (Editor)** → bỏ tick "Thông báo" → Gửi.
2. Làm với **từng** file sheet (mỗi cơ sở).
3. Tab tháng mới phải **tạo sẵn** theo mẫu (app không tự tạo tab).

### 4.4. Gắn sheet vào cơ sở trong app

**Admin → Cơ sở → sửa cơ sở**:

| Trường | Ý nghĩa | Mặc định |
| --- | --- | --- |
| Google Sheet doanh thu | Dán link `https://docs.google.com/spreadsheets/d/…` (app tự tách ID) | trống = không ghi sheet |
| Tên tab tháng | Mẫu tên tab: `{m}` = tháng (1–12), `{mm}` = 2 chữ số, `{yyyy}` = năm | `T{m}` |
| Dòng ngày 1 | Dòng của ngày 1 trong tab | `3` |
| Mẫu cột sheet | **Có cột Grab** (`GRAB_COL`): B DT · C TK · D TM · E CP · F Shopee · G Grab · J Ghi chú. **Mẫu cũ** (`LEGACY`): B–E như trên · F Shopee + Grab · I Ghi chú | `GRAB_COL` (cơ sở mới) |

Lưu → bấm **Kiểm tra Google Sheet** để app thử đọc file và báo có tab của tháng hiện tại không. Các cột công thức (Chênh lệch, DT thực tế) app không ghi.

Ngày nào ghi sheet lỗi → trạng thái `FAILED`, cron đêm ghi lại; admin cũng bấm **Ghi sheet** được ở mục **Chốt ca**.

---

## 5. Gemini API key *(tuỳ chọn)*

Gemini dùng cho: đọc ảnh tờ chốt ca, bill / sao kê, ảnh bảng chấm công, tin nhắn nhận hàng, nhận xét báo cáo, trợ lý cửa hàng, Hỏi AI (admin), phát hiện bất thường, dự báo số người/ca, tóm tắt nội quy, giải thích lương. Không có key → các chức năng này tắt, số liệu nhập tay vẫn dùng bình thường.

### 5.1. Lấy key

1. Vào <https://aistudio.google.com> → **Get API key / API keys** → **Create API key** → chọn (hoặc tạo) một Google Cloud project.
2. Copy key (dạng `AIza…`):

```env
GEMINI_API_KEY="xxxx"
```

### 5.2. Nhiều key, model, model dự phòng

Code: `src/lib/ocr.ts` (`geminiKeys()`, `geminiModels()`).

| Biến | Cách đọc | Mặc định |
| --- | --- | --- |
| `GEMINI_API_KEY` | 1 key, hoặc nhiều key cách nhau dấu phẩy | – |
| `GEMINI_API_KEY_2` … `GEMINI_API_KEY_9` | Key bổ sung, thử lần lượt khi key trước hết lượt | – |
| `GEMINI_MODEL` | Model chính | `gemini-2.5-flash` |
| `GEMINI_FALLBACK_MODELS` | Danh sách model dự phòng, cách nhau dấu phẩy; đặt chuỗi rỗng để tắt dự phòng | `gemini-2.5-flash-lite,gemini-3-flash-preview` |

- Key trùng nhau tự bị loại. Mỗi lượt gọi thử theo thứ tự key × model; cặp (key, model) vừa hết lượt sẽ được bỏ qua một lúc.
- Trong **Cài đặt → AI**, từng chức năng có thể chọn model riêng (Mặc định / 2.5 Flash / 2.5 Flash-Lite), bật/tắt theo vai trò, giới hạn lượt và ngân sách token tháng.

### 5.3. Gói miễn phí – lưu ý quan trọng

- Hạn mức miễn phí tính theo **project Google Cloud × model × ngày giờ Pacific** (reset 0h giờ Mỹ ≈ **15h giờ VN**, mùa hè Mỹ ≈ 14h). Nhiều key **trong cùng một project** dùng chung hạn mức → muốn tăng lượt thì mỗi key phải thuộc **project khác nhau**.
- Mọi lần gọi đều tính lượt (kể cả thử lại / chuyển model), trừ lần bị từ chối 429.
- App ghi từng lần gọi (collection `aicalls`, giữ 10 ngày, chỉ lưu mã băm của key) và hiển thị lượt đã dùng hôm nay theo key × model ở **Admin → Cài đặt → AI**. Hạn mức free của từng model Google thay đổi thường xuyên → Chủ tự nhập số lượt/ngày theo trang **AI Studio → Rate limits**.
- Gói miễn phí: Google được dùng dữ liệu để cải thiện sản phẩm. Muốn tránh điều này và không lo hết lượt → bật **billing** cho project chứa key.

Kiểm tra key + liệt kê model dùng được (chỉ kiểm `GEMINI_API_KEY`):

```bash
npm run check-gemini
```

### 5.4. Region

Gemini API **không hỗ trợ gọi từ Hong Kong**. Vì vậy `vercel.json` đặt `"regions": ["sin1"]` và các route gọi Gemini có `export const preferredRegion = "sin1"`. Đừng đổi region hàm sang `hkg1`.

### 5.5. Bot đọc ảnh riêng / webhook *(tuỳ chọn, nâng cao)*

| Biến | Dùng khi |
| --- | --- |
| `CLOSING_OCR_URL`, `CLOSING_OCR_SECRET` | Có dịch vụ OCR riêng (HTTP) – dùng khi **không** có key Gemini. Secret gửi kèm dạng Bearer (không có thì dùng `CLOSING_WEBHOOK_SECRET`). |
| `CLOSING_WEBHOOK_URL`, `CLOSING_WEBHOOK_SECRET` | Mỗi lần chốt ca, app POST JSON (thông tin ca + ảnh base64 + `messageIds` Telegram) tới URL này, header `Authorization: Bearer <secret>`. |

---

## 6. Telegram bot *(tuỳ chọn)*

### 6.1. Tạo bot

1. Mở Telegram, chat với **@BotFather** → `/newbot` → đặt tên, username (kết thúc bằng `bot`).
2. Copy token:

```env
TELEGRAM_BOT_TOKEN="1234567890:xxxx"
```

### 6.2. Các nhóm và chat ID

Bot chỉ **gửi** tin (ảnh, album, tin chữ) – không cần đọc tin trong nhóm. Có 4 loại nhóm:

| Nhóm | Nhận gì | Cấu hình trong app (ưu tiên) | Env dự phòng |
| --- | --- | --- | --- |
| Chốt ca | Ảnh + số liệu chốt ca, doanh thu | Cơ sở → **Telegram chat ID nhóm chốt ca** (`Store.telegramChatId`) | `TELEGRAM_CHAT_ID` |
| Chấm công | Ảnh + giờ check-in/out, đi muộn / về sớm / ngoài ca | Cơ sở → **Telegram chat ID nhóm chấm công** (`Store.telegramAttendanceChatId`) | `TELEGRAM_ATTENDANCE_CHAT_ID` (không có → không gửi) |
| Nhận hàng | Tin 📦 Nhận hàng / 📋 Tồn kho | Cơ sở → **Telegram chat ID nhóm nhận hàng** (`Store.telegramGoodsChatId`) | `TELEGRAM_GOODS_CHAT_ID` → nếu vẫn trống thì gửi vào nhóm chốt ca |
| Quản lý doanh thu (tài chính) | Ảnh bill chi phí, báo cáo ngày/tuần/tháng, cảnh báo bất thường, kết quả tự dọn dữ liệu | **Tài chính → Cài đặt → Nhóm Telegram & báo cáo** (`Settings.financeChatId`) | `TELEGRAM_FINANCE_CHAT_ID` |

Lấy chat ID của nhóm:

1. Tạo nhóm → **thêm bot vào nhóm** (cho quyền gửi tin / ảnh).
2. Nhắn 1 tin bất kỳ trong nhóm.
3. Mở trình duyệt: `https://api.telegram.org/bot<TOKEN>/getUpdates` → tìm `"chat":{"id":-100…}`. Hoặc tạm thêm một bot kiểu @RawDataBot vào nhóm để xem ID rồi xoá ra.
4. Chat ID nhóm thường dạng `-100xxxxxxxxxx` (có dấu trừ).

### 6.3. Gửi thử

- **Admin → Cơ sở**: mỗi cơ sở có nút **📨 Gửi thử Telegram**, **Gửi thử nhóm chấm công**, **Gửi thử nhóm nhận hàng** (nút chỉ hiện khi đã có chat ID).
- **Admin → Tài chính → Cài đặt**: nút **Gửi tin thử vào nhóm** và **Gửi báo cáo ngay**.

Gửi chốt ca lỗi (mất mạng, sai chat ID…) → lượt chốt ca vẫn được lưu với trạng thái `FAILED`, cron đêm tự gửi lại; admin bấm **Gửi lại** ở mục **Chốt ca**.

---

## 7. Bảng biến môi trường

Tạo file `.env.local` từ mẫu (local), hoặc nhập trên Vercel (mục 8.3):

```bash
cp .env.example .env.local
```

| Biến | Bắt buộc? | Mục đích | Ví dụ (placeholder) |
| --- | --- | --- | --- |
| `MONGODB_URI` | **Có** | Chuỗi kết nối MongoDB | `mongodb+srv://tbs_app:xxxx@cluster0.xxxxx.mongodb.net/tbs?retryWrites=true&w=majority` |
| `NEXTAUTH_URL` | **Có** | URL gốc của site (không `/` cuối); NextAuth + dựng redirect URI Drive | `https://tiembosau.vercel.app` / `http://localhost:3000` |
| `NEXTAUTH_SECRET` | **Có** | Ký JWT phiên đăng nhập Google | chuỗi ngẫu nhiên ≥ 32 ký tự |
| `GOOGLE_CLIENT_ID` | **Có** | OAuth client (đăng nhập + Drive) | `xxxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | **Có** | OAuth client secret | `xxxx` |
| `OWNER_EMAIL` | **Có** | Gmail của Chủ = Admin Tổng (toàn quyền, kết nối Drive) | `chu.quan@gmail.com` |
| `ENCRYPTION_KEY` | **Có** | AES-256-GCM: mã hoá STK ngân hàng + refresh token Drive. **64 ký tự hex** | `xxxx` (64 hex) |
| `ADMIN_JWT_SECRET` | Nên có | Ký cookie phiên admin `tbs_admin` (thiếu → dùng `NEXTAUTH_SECRET`) | chuỗi ngẫu nhiên ≥ 32 ký tự |
| `CRON_SECRET` | **Có** (nếu dùng cron) | Bảo vệ `/api/cron/*` (header `Authorization: Bearer …`); thiếu → cron luôn 401 | chuỗi ngẫu nhiên |
| `DEFAULT_TIMEZONE` | Không | Múi giờ mặc định (cơ sở seed, tính ngày) | `Asia/Ho_Chi_Minh` |
| `GOOGLE_SA_JSON` | Không | Service account (nguyên JSON hoặc base64) – ghi Google Sheet | `{"type":"service_account",…}` |
| `GOOGLE_SA_EMAIL` | Không | Thay cho `GOOGLE_SA_JSON` (cặp với key bên dưới) | `tbs-sheets@xxxx.iam.gserviceaccount.com` |
| `GOOGLE_SA_PRIVATE_KEY` | Không | Private key PEM của service account | `-----BEGIN PRIVATE KEY-----\nxxxx…` |
| `GEMINI_API_KEY` | Không | Key Gemini (có thể nhiều key cách dấu phẩy) | `xxxx` |
| `GEMINI_API_KEY_2` … `_9` | Không | Key dự phòng (nên ở project khác nhau) | `xxxx` |
| `GEMINI_MODEL` | Không | Model chính | `gemini-2.5-flash` |
| `GEMINI_FALLBACK_MODELS` | Không | Model dự phòng | `gemini-2.5-flash-lite,gemini-3-flash-preview` |
| `TELEGRAM_BOT_TOKEN` | Không | Token bot | `1234567890:xxxx` |
| `TELEGRAM_CHAT_ID` | Không | Nhóm chốt ca mặc định | `-100xxxx` |
| `TELEGRAM_ATTENDANCE_CHAT_ID` | Không | Nhóm chấm công mặc định | `-100xxxx` |
| `TELEGRAM_GOODS_CHAT_ID` | Không | Nhóm nhận hàng mặc định | `-100xxxx` |
| `TELEGRAM_FINANCE_CHAT_ID` | Không | Nhóm Quản lý doanh thu (nếu chưa nhập trong app) | `-100xxxx` |
| `CLOSING_WEBHOOK_URL` | Không | Webhook nhận dữ liệu chốt ca | `https://xxxx/hook` |
| `CLOSING_WEBHOOK_SECRET` | Không | Bearer cho webhook (và OCR nếu thiếu secret riêng) | `xxxx` |
| `CLOSING_OCR_URL` | Không | Dịch vụ OCR riêng (khi không dùng Gemini) | `https://xxxx/ocr` |
| `CLOSING_OCR_SECRET` | Không | Bearer cho OCR riêng | `xxxx` |

### 7.1. Tạo các chuỗi bí mật

```bash
# ENCRYPTION_KEY: đúng 32 byte = 64 ký tự hex
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# NEXTAUTH_SECRET / ADMIN_JWT_SECRET / CRON_SECRET: chuỗi ngẫu nhiên
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Dùng chuỗi khác nhau cho từng biến.

> ⚠️ **`ENCRYPTION_KEY` KHÔNG ĐƯỢC ĐỔI sau khi đã có dữ liệu.** STK ngân hàng của nhân viên (`User.bankAccountEnc`, `PayrollItem.bankAccountEnc`) và refresh token Drive được mã hoá bằng khoá này. Đổi khoá → giải mã thất bại **im lặng** (trả chuỗi rỗng): STK hiện trống, Drive báo "Chưa kết nối Google Drive" dù Cài đặt vẫn ghi "Đã kết nối". Hãy lưu khoá ở nơi an toàn (trình quản lý mật khẩu). Môi trường Preview dùng chung DB thật thì cũng phải dùng **cùng** khoá.

Đổi `NEXTAUTH_SECRET` / `ADMIN_JWT_SECRET` chỉ làm mọi người phải đăng nhập lại – không mất dữ liệu.

---

## 8. Triển khai lên Vercel

### 8.1. Import repo

1. Đẩy code lên GitHub (repo private). **Không** commit `.env.local` (đã có trong `.gitignore`).
2. <https://vercel.com> → **Add New → Project** → Import repo.
3. Framework Preset: **Next.js** (tự nhận). Build command `next build`, Install `npm install` – để mặc định.
4. Node.js Version: **22.x** (Project → Settings → Build and Deployment → Node.js Version; `engines` trong `package.json` cũng ép 22.x).

### 8.2. Region

`vercel.json` đã có:

```json
{ "regions": ["sin1"] }
```

→ Hàm serverless chạy ở **Singapore**. Đặt MongoDB Atlas cùng khu vực (Singapore) để giảm độ trễ. Không đổi sang Hong Kong vì Gemini không hỗ trợ (mục 5.4).

### 8.3. Biến môi trường

Project → **Settings → Environment Variables** → nhập toàn bộ biến ở mục 7:

- **Production**: `NEXTAUTH_URL` = tên miền chính, VD `https://tiembosau.vercel.app`.
- **Preview** (tuỳ chọn): nếu muốn test trên link preview thì phải đặt `NEXTAUTH_URL` = đúng link preview và thêm redirect URI tương ứng trên Google Cloud; nên dùng **database riêng** cho preview. Nếu dùng chung DB thật thì `ENCRYPTION_KEY` phải giống Production.
- `GOOGLE_SA_JSON`: dán nguyên JSON vào ô giá trị (Vercel hỗ trợ nhiều dòng).
- Sau khi sửa biến môi trường phải **Redeploy** thì mới có hiệu lực.

### 8.4. Tên miền

1. Project → **Settings → Domains** → thêm tên miền (hoặc dùng `*.vercel.app` có sẵn).
2. Cập nhật `NEXTAUTH_URL` = tên miền mới → Redeploy.
3. Thêm 2 redirect URI của tên miền mới vào OAuth client (mục 3.3).
4. Nếu Drive đã kết nối trước đó thì không cần kết nối lại (refresh token không phụ thuộc tên miền); chỉ khi bấm "Kết nối lại" mới cần redirect URI mới.

### 8.5. Cron jobs

`vercel.json`:

| Path | Lịch (UTC) | Giờ VN | Việc làm |
| --- | --- | --- | --- |
| `/api/cron/publish-payroll` | `0 17 4 * *` | 00:00 ngày **5** hằng tháng | Tự chốt & công bố bảng lương tháng trước (`autoPublishPayrolls`), bỏ qua tháng admin đã mở khoá; ghi audit |
| `/api/cron/hourly` | `0 18 * * *` | **01:00** hằng đêm | Xem bên dưới |

Việc `/api/cron/hourly` làm (theo thứ tự trong `src/app/api/cron/hourly/route.ts`):

1. Đánh dấu lượt chấm công **quên check-out** (`markMissingCheckouts`).
2. Upload lại **ảnh chờ** lên Drive (`retryPendingPhotos`).
3. Tạo **bảng lương nháp** (`ensureDraftPayrolls`) và công bố dự phòng nếu cron ngày 5 bị lỡ.
4. **Gửi lại ảnh chốt ca** lỗi lên Telegram (`retryFailedClosings`).
5. Tính lại doanh thu ngày theo cách luỹ kế cho dữ liệu cũ (`migrateDayCalc`).
6. **Ghi Google Sheet** các ngày chưa ghi được (`syncPendingDays`).
7. **Báo cáo Telegram** ngày (hôm qua) / tuần (thứ 2) / tháng (ngày 1) – nếu bật (`runScheduledReports`).
8. Đảm bảo **TTL index** cho các bảng log (`ensureTtlIndexes`).
9. **Phát hiện bất thường** chốt ca & két (`runDailyAnomaly`).
10. **Tự dọn dữ liệu** mỗi tháng 1 lần nếu Chủ bật (`runAutoCleanup`).

Bảo vệ cron: đặt `CRON_SECRET` trong Vercel. Vercel Cron tự gửi header `Authorization: Bearer <CRON_SECRET>`; thiếu biến này thì endpoint luôn trả **401**.

Gói **Hobby** chỉ cho cron chạy **1 lần/ngày** – vì vậy "hourly" thực tế chạy lúc 01:00. Muốn chạy hằng giờ:

- Gói Pro: đổi lịch thành `0 * * * *`; hoặc
- Dùng dịch vụ ngoài (VD cron-job.org) gọi:

```bash
curl -H "Authorization: Bearer xxxx" https://tiembosau.vercel.app/api/cron/hourly
```

Chạy tay để kiểm tra cũng dùng lệnh trên; kết quả là JSON tóm tắt (`missing`, `uploaded`, `published`, `closingsResent`, `sheetDays`, `reports`, …).

### 8.6. Thời gian chạy hàm (maxDuration)

Các route nặng (cron hourly, đọc ảnh bằng Gemini, chốt ca, xuất Excel, nhập chấm công, layout admin / nhân viên có nút AI…) đặt `export const maxDuration = 60` (60 giây – mức tối đa của gói Hobby mặc định). Cron hourly làm nhiều việc tuần tự nên nếu dữ liệu lớn có thể chạm giới hạn → các bước sau sẽ được làm ở lần chạy kế tiếp. `next.config.ts` cho phép body server action tối đa **4 MB** (ảnh chấm công base64); API chặn ảnh > 1,5 MB.

---

## 9. Lần chạy đầu tiên

### 9.1. Seed dữ liệu

App **tự seed** ở lần truy cập đầu (tạo document `Settings` và 3 cơ sở mặc định nếu DB chưa có cơ sở nào): **TBS Geleximco** (`TBS-GLX`, mẫu cột Grab), **TBS Văn Phú** (`TBS-VP`, mẫu cũ), **TBS Đô Nghĩa** (`TBS-DN`, mẫu cũ). Muốn chủ động (và đồng bộ index) thì chạy từ máy, với `MONGODB_URI` trỏ tới DB thật trong `.env.local`:

```bash
npm run seed
```

> Script `npm run set-admin-password` vẫn còn nhưng **không còn tác dụng**: đăng nhập admin hiện nay chỉ bằng Gmail (trang Cài đặt ghi rõ "không còn mật khẩu chung"); trường `adminPasswordHash` không được đọc ở đâu nữa. Không cần chạy.

### 9.2. Chủ đăng nhập

1. Mở `https://tiembosau.vercel.app/admin/login` → **Đăng nhập bằng Google** bằng đúng Gmail `OWNER_EMAIL` (VD `chu.quan@gmail.com`).
2. Gmail trùng `OWNER_EMAIL` → vào thẳng `/admin` với quyền **Admin Tổng** (không tạo hồ sơ nhân viên).

### 9.3. Kết nối Drive và cấu hình chung

1. **Cài đặt → Kết nối Google Drive** (mục 3.4). Thấy "Đã kết nối" + email là xong.
2. **Cài đặt → Cấu hình chấm công**: bước làm tròn giờ (mặc định 0,5h, làm tròn xuống), dung sai làm tròn, ngưỡng đi muộn / về sớm (5 phút), chặn check-out trong N phút sau check-in, số giờ coi là quên check-out (16h), số thiết bị tối đa / nhân viên (1), sai số GPS tối đa (100 m), số ngày phiên admin (7).
3. **Cài đặt → ✨ Cài đặt AI** (nếu có key Gemini): bật/tắt từng chức năng, giới hạn, nhập hạn mức free theo AI Studio; nhập nội dung cho Trợ lý cửa hàng (nội quy, bảo quản, cách chốt ca…).
4. **Cài đặt → 📦 Nhận hàng các cơ sở**: bật/tắt Nhận hàng, Tồn kho.

### 9.4. Thêm admin và phân quyền

**Quản lý admin** (chỉ Admin Tổng) → **➕ Thêm admin**: nhập Gmail + tên hiển thị + tick quyền. Admin đăng nhập ở `/admin/login` bằng Gmail đó → app tạo phiên admin (cookie `tbs_admin`, lưu DB). Admin Tổng xem được ai đang online, khoá tài khoản, đăng xuất từng phiên. Mặc định admin **không có** các quyền tài chính, lương, xuất Excel, cơ sở, duyệt chấm công bù, hàng hoá… – xem bảng quyền trong `docs/PROJECT.md`. Lãi lỗ và Quản lý admin chỉ Admin Tổng.

### 9.5. Cơ sở

**Admin → Cơ sở** → sửa từng cơ sở:

1. **Toạ độ**: đứng tại quán bấm "Dùng vị trí hiện tại", hoặc dán toạ độ / link Google Maps vào ô "Dán toạ độ / link Google Maps" (VD `20.9876, 105.7890`).
2. **Bán kính (m)**: mặc định 100, tối thiểu 20.
3. **Cách xác thực khi chấm công**: Chụp ảnh khuôn mặt (mặc định bật), Vị trí GPS (mặc định bật), WiFi của quán (mặc định tắt – kiểm tra theo IP public của quán; nhập IP từng mạng, mỗi dòng 1 IP). Bật nhiều cách → phải qua tất cả.
4. **Múi giờ**, các **Telegram chat ID** (mục 6), **Google Sheet** (mục 4.4). (% phí sàn Grab / Shopee của từng cơ sở – dùng tính lãi lỗ – nhập ở **Tài chính → Cài đặt**.)
5. Lưu → bấm các nút **Gửi thử** / **Kiểm tra Google Sheet**.

### 9.6. Ca làm việc và ngày lễ

1. **Ca làm việc** → tạo ca mẫu cho từng cơ sở (tên, giờ bắt đầu – kết thúc; giờ kết thúc nhỏ hơn giờ bắt đầu = ca qua đêm), định mức tối thiểu / mục tiêu số người.
   Ca có giờ bắt đầu **muộn nhất** của cơ sở được coi là **ca cuối ngày** (chốt ca Tối → ghi doanh thu ngày lên Sheet).
2. Tab **Ngày lễ** → thêm ngày lễ + hệ số lương (mặc định ×2).
3. **Xếp ca tự động** → xếp lịch tuần (tay, theo đăng ký, hoặc tự động có xem trước).

### 9.7. Nhân viên

1. Nhân viên mở site trên điện thoại (HTTPS) → **Đăng nhập Google** → điền thông tin đăng ký (cơ sở, SĐT, ngân hàng…) → màn hình **chờ duyệt**.
2. Admin → **Duyệt đăng ký** → duyệt (thiết bị đầu tiên được duyệt cùng), đặt lương giờ / hình thức lương ở **Nhân viên**.
3. Muốn cho một nhân viên làm quản lý: **Nhân viên → chi tiết** → cấp quyền quản lý (Xếp ca / Thưởng-phạt / Duyệt đổi ca-làm hộ) và cơ sở được quản lý → nhân viên thấy nút **Quản lý** (`/manage`).

---

## 10. Phát triển trên máy (local)

```bash
npm install                 # cài thư viện (Node 22)
cp .env.example .env.local  # rồi điền giá trị
npm run dev                 # http://localhost:3000
npm run typecheck           # tsc --noEmit
npm test                    # unit test (tsx --test, danh sách file trong package.json)
npm run build               # build production như Vercel
```

Script khác:

| Lệnh | Việc |
| --- | --- |
| `npm run seed` | Tạo Settings + 3 cơ sở mặc định + đồng bộ index |
| `npm run check-gemini` | Kiểm tra `GEMINI_API_KEY`, liệt kê / gọi thử các model |
| `node scripts/check-db.mjs` | Kiểm tra kết nối MongoDB |
| `npx tsx scripts/clean-extras-notes.ts [--apply]` | Dọn ghi chú phụ cấp / tạm ứng rác trong dòng lương (không `--apply` = chạy thử) |
| `npx tsx scripts/demo-ai.ts` | Chạy thử phần AI với MongoDB cục bộ + Gemini giả (cần `MONGODB_URI` trỏ DB demo cục bộ) |

Các script trong `scripts/` tự đọc `.env.local` / `.env` (`scripts/env.ts`).

**Camera & GPS cần HTTPS.** Trình duyệt chỉ cho dùng camera / vị trí trên HTTPS (riêng `localhost` được miễn). Muốn test trên điện thoại thật:

- Dùng link Vercel Preview; hoặc
- Mở tunnel HTTPS tới máy (`cloudflared tunnel --url http://localhost:3000`, `ngrok http 3000`) → đặt `NEXTAUTH_URL` = URL tunnel và thêm redirect URI tương ứng trên Google Cloud.

Model nhận diện khuôn mặt (`@vladmandic/face-api`, TinyFaceDetector) được tự host trong `public/models/` – không cần tải thêm.

---

## 11. Xử lý sự cố thường gặp

| Triệu chứng / thông báo | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| `Thiếu biến môi trường MONGODB_URI` | Chưa đặt biến | Thêm `MONGODB_URI` (Vercel: nhớ Redeploy) |
| `MongoServerSelectionError` / timeout khi kết nối DB | Atlas chưa mở `0.0.0.0/0`, sai mật khẩu, mật khẩu có ký tự đặc biệt chưa encode | Mục 2 bước 3–4; chạy `node scripts/check-db.mjs` |
| Google báo `Error 400: redirect_uri_mismatch` | Redirect URI chưa khai báo hoặc `NEXTAUTH_URL` sai (thừa `/`, http/https) | Thêm đúng 2 URI ở mục 3.3, sửa `NEXTAUTH_URL`, Redeploy |
| Google báo "Access blocked: app has not completed verification" / chỉ test user đăng nhập được | Consent screen đang **Testing** | Thêm Gmail vào Test users hoặc **Publish app** |
| `/admin/login` báo "Gmail này chưa có quyền quản lý" | Gmail chưa được thêm ở Quản lý admin, hoặc sai `OWNER_EMAIL` | Admin Tổng thêm Gmail; kiểm tra `OWNER_EMAIL` (không phân biệt hoa thường) |
| `Thiếu ADMIN_JWT_SECRET` | Thiếu cả `ADMIN_JWT_SECRET` lẫn `NEXTAUTH_SECRET` | Đặt biến |
| `ENCRYPTION_KEY phải là 64 ký tự hex (32 byte)` | Khoá sai độ dài | Tạo lại theo mục 7.1 (**chỉ** khi chưa có dữ liệu mã hoá) |
| Cài đặt ghi "Đã kết nối" Drive nhưng upload báo `Chưa kết nối Google Drive`; STK nhân viên bị trống | `ENCRYPTION_KEY` đã bị đổi → không giải mã được | Khôi phục khoá cũ. Nếu mất hẳn: kết nối lại Drive và nhập lại STK |
| `Google không trả về refresh token – hãy thu hồi quyền app…` | Google chỉ trả refresh token lần cấp quyền đầu | Vào <https://myaccount.google.com/permissions> → xoá quyền app → **Kết nối lại** |
| Kết nối Drive rớt sau ~7 ngày (`invalid_grant`) | Consent screen ở chế độ Testing | Publish app rồi kết nối lại |
| Cài đặt báo "N ảnh đang chờ upload lại lên Drive" | Drive mất kết nối / lỗi tạm thời | Kết nối lại Drive; cron đêm tự upload. Ảnh thử 20 lần vẫn lỗi được tính là "kẹt" (dọn được ở Cài đặt) |
| `Kết nối thất bại: state-error` khi kết nối Drive | Cookie `tbs_gstate` hết hạn (quá 10 phút) hoặc mở ở trình duyệt khác | Bấm lại Kết nối Google Drive trong cùng trình duyệt |
| `Chưa cấu hình service account Google (GOOGLE_SA_JSON hoặc GOOGLE_SA_EMAIL + GOOGLE_SA_PRIVATE_KEY)` | Thiếu / dán sai biến SA | Mục 4.2 (dùng `GOOGLE_SA_JSON` hoặc base64) |
| Kiểm tra Google Sheet báo **403 / "The caller does not have permission"** | Chưa share file cho email service account | Share file với quyền **Người chỉnh sửa** (mục 4.3) |
| Lỗi 403 "Google Sheets API has not been used in project…" | Chưa bật Sheets API | Bật ở APIs & Services → Library |
| Kiểm tra sheet báo không có tab tháng / ghi lỗi "Unable to parse range" | Tab tháng chưa tạo hoặc sai mẫu tên | Tạo tab (VD `T11`) theo mẫu, kiểm tra "Tên tab tháng" |
| `Cơ sở chưa gắn Google Sheet doanh thu` | Chưa dán link sheet | Mục 4.4 |
| `Chưa cấu hình GEMINI_API_KEY` | Không có key | Mục 5 |
| `GEMINI_API_KEY không hợp lệ` | Key sai / đã xoá | Tạo key mới |
| `…: hết lượt miễn phí trong ngày (N lượt/ngày)` (HTTP 429) | Hết hạn mức free của project × model | Chờ reset (~15h VN), thêm key ở **project khác** (`GEMINI_API_KEY_2…`), dùng model dự phòng hoặc bật billing. Xem Cài đặt → AI |
| `…: quá nhiều lượt trong 1 phút` | Giới hạn RPM | Chờ vài chục giây rồi thử lại |
| `…: máy chủ Google đang quá tải` (500/503/504) | Gemini quá tải | App tự thử model dự phòng; thử lại sau |
| `Gemini không hỗ trợ vị trí máy chủ đang gọi…` | Hàm chạy ở Hong Kong | Giữ `"regions": ["sin1"]` trong `vercel.json` / Settings → Functions |
| Chức năng AI báo tắt / hết lượt / hết ngân sách | Giới hạn trong **Cài đặt → AI** | Tăng giới hạn hoặc bật lại chức năng |
| `Chưa cấu hình TELEGRAM_BOT_TOKEN` | Thiếu token | Mục 6.1 |
| `Chưa cấu hình nhóm Telegram (TELEGRAM_CHAT_ID hoặc Telegram chat ID của cơ sở)` / `Chưa có Telegram chat ID` | Chưa nhập chat ID | Nhập ở Cơ sở / Tài chính → Cài đặt hoặc env |
| `Telegram: Bad Request: chat not found` | Sai chat ID (thiếu dấu `-`, thiếu `-100`), bot chưa ở trong nhóm | Thêm bot vào nhóm, lấy lại chat ID |
| `Telegram: Bad Request: group chat was upgraded to a supergroup chat` | Nhóm được nâng cấp → đổi chat ID | Lấy chat ID mới (`-100…`) |
| `Telegram: Forbidden: bot was kicked…` / `not enough rights to send photos` | Bot bị xoá / thiếu quyền | Thêm lại bot, cho quyền gửi ảnh |
| Cron trả **401 Unauthorized** | Thiếu `CRON_SECRET` hoặc header sai | Đặt `CRON_SECRET`, gọi kèm `Authorization: Bearer <CRON_SECRET>` |
| Nhân viên: "Cần bật vị trí (GPS) để chấm công" / camera không mở | Trang không chạy HTTPS hoặc chưa cấp quyền vị trí / camera | Dùng HTTPS; vào cài đặt trình duyệt cho phép |
| "GPS chưa chính xác (sai số …m)" | Sai số lớn hơn "Sai số GPS tối đa" | Ra chỗ thoáng, bật vị trí chính xác; hoặc tăng ngưỡng trong Cài đặt |
| "Hãy đến quán để check-in." | Ngoài bán kính cơ sở | Kiểm tra toạ độ / bán kính cơ sở |
| "… chưa được cấu hình vị trí – liên hệ admin" | Cơ sở chưa có lat/lng | Nhập toạ độ ở Cơ sở |
| "Hãy kết nối WiFi của quán…" | Bật kiểm tra WiFi nhưng IP không khớp (4G, VPN, iCloud Private Relay, IP quán đổi) | Tắt 4G/VPN; cập nhật IP WiFi quán |
| Nhân viên thấy thông báo thiết bị chưa được duyệt / không chấm công được trên máy mới | Thiết bị mới / đổi máy / xoá dữ liệu trình duyệt | Nhân viên bấm yêu cầu đổi thiết bị; admin → Duyệt đăng ký → **Thiết bị** → duyệt |
| Server action báo lỗi "Body exceeded 4mb limit" | Ảnh quá lớn | Chụp lại (client đã nén); giới hạn ở `next.config.ts` |
