# Tài liệu dự án – Tiệm Bơ Sầu

**Tiệm Bơ Sầu** là ứng dụng web nội bộ cho một chuỗi nhỏ quán chè / kem (3 cơ sở mặc định: TBS Geleximco, TBS Văn Phú, TBS Đô Nghĩa) để quản lý **chấm công bằng khuôn mặt + GPS + thiết bị**, **xếp ca**, **bảng lương**, **thưởng / phạt**, **chốt ca & doanh thu**, **tài chính** (lãi lỗ, chi phí, sổ quỹ…), **hàng hoá / nguyên liệu**, kèm các chức năng **AI (Gemini)**, thông báo **Telegram** và đồng bộ **Google Sheets**. Tài liệu này dành cho lập trình viên tiếp quản code: mô tả kiến trúc, cấu trúc thư mục, mô hình phân quyền, các module nghiệp vụ, mô hình dữ liệu, cron, test và quy ước code. Hướng dẫn cài đặt / triển khai xem `docs/SETUP.md`.

## Mục lục

1. [Mục đích & người dùng](#1-mục-đích--người-dùng)
2. [Công nghệ](#2-công-nghệ)
3. [Cấu trúc thư mục](#3-cấu-trúc-thư-mục)
4. [Xác thực & phân quyền](#4-xác-thực--phân-quyền)
5. [Các module nghiệp vụ](#5-các-module-nghiệp-vụ)
6. [Mô hình dữ liệu (Mongoose)](#6-mô-hình-dữ-liệu-mongoose)
7. [Cron jobs](#7-cron-jobs)
8. [Kiểm thử](#8-kiểm-thử)
9. [Quy ước code](#9-quy-ước-code)
10. [Hạn chế đã biết / việc còn lại](#10-hạn-chế-đã-biết--việc-còn-lại)

---

## 1. Mục đích & người dùng

| Vai trò | Đăng nhập | Vào đâu | Làm gì |
| --- | --- | --- | --- |
| **Admin Tổng** (Chủ) | Google, Gmail = `OWNER_EMAIL` | `/admin` | Toàn quyền. Riêng Admin Tổng: Quản lý admin, Lãi lỗ, sửa doanh thu ngày / ghi phiếu sổ quỹ, kết nối Google Drive, cấu hình chấm công, Cài đặt AI, dọn dữ liệu, xuất "Tổng hợp tháng" |
| **Admin** | Google, Gmail được Admin Tổng thêm (`AdminAccount`) | `/admin` | Các trang cơ bản + những quyền được cấp (bảng ở mục 4.3) |
| **Nhân viên** | Google, Gmail cá nhân (`User`) | `/` (app di động) | Đăng ký, chấm công, xem lịch sử, lịch ca / đăng ký ca, bảng lương, chốt ca, nhận hàng / tồn kho, trợ lý AI, yêu cầu sửa công, nhờ làm hộ / đổi ca |
| **Nhân viên quản lý** | như nhân viên, có `managerPerms` | `/manage` | Xếp ca / thưởng-phạt / duyệt đổi ca-làm hộ trong cơ sở được giao |

Giao diện tiếng Việt, tối ưu cho điện thoại (trang nhân viên rộng tối đa `max-w-lg`, có thanh điều hướng dưới, PWA manifest trong `public/`).

---

## 2. Công nghệ

Phiên bản lấy từ `package.json` (đều ghim cố định, không có `^`):

| Nhóm | Thư viện | Phiên bản |
| --- | --- | --- |
| Runtime | Node.js | 22.x (`engines`, `.nvmrc`) |
| Framework | `next` (App Router, server actions) | 15.5.29 |
| UI | `react`, `react-dom` | 19.3.1 |
| CSS | `tailwindcss`, `@tailwindcss/postcss` | 4.3.5 |
| Icon | `lucide-react` | 1.70.0 |
| DB | `mongoose` | 9.12.0 |
| Auth | `next-auth` (Google provider, JWT session) | 4.24.15 |
| JWT phiên admin | `jose` | 6.2.15 |
| Validate | `zod` | 4.6.7 |
| Google APIs | `@googleapis/drive` 27.0.0, `@googleapis/sheets` 18.1.2 | |
| Khuôn mặt (trình duyệt) | `@vladmandic/face-api` (TinyFaceDetector, model tự host ở `public/models/`) | 1.7.15 |
| Excel | `exceljs` | 4.4.0 |
| Ảnh hoá DOM (xuất ảnh lịch ca) | `html-to-image` | 1.11.13 |
| Mật khẩu (cũ) | `bcryptjs` | 3.0.3 |
| Dev | `typescript` 5.9.3, `tsx` 4.23.15, `@types/node` 22.20.5, `@types/react` 19.3.0 | |

Dịch vụ ngoài: MongoDB Atlas, Vercel (region `sin1`, cron), Google OAuth / Drive / Sheets, Google Gemini (REST `generateContent`, gọi bằng `fetch`, không dùng SDK), Telegram Bot API (`fetch`), Open-Meteo (thời tiết, không cần key).

`next.config.ts`: `serverExternalPackages: ["mongoose", "exceljs", "@googleapis/drive"]`, `serverActions.bodySizeLimit: "4mb"` (ảnh base64). Alias import `@/*` → `src/*` (`tsconfig.json`).

---

## 3. Cấu trúc thư mục

```
src/
  app/
    (user)/            # app nhân viên (layout bắt buộc nhân viên ACTIVE)
    login/ onboarding/ pending/   # đăng nhập, đăng ký lần đầu, chờ duyệt
    manage/            # khu vực nhân viên quản lý
    admin/
      login/           # đăng nhập trang quản lý (Gmail)
      (panel)/         # trang quản lý (layout + menu)
      actions/         # server actions của admin (trả về FormState)
    api/               # route handlers (REST, cron, OAuth)
  components/          # UI dùng chung + components/user (camera, chấm công…)
  lib/                 # nghiệp vụ, model, tích hợp ngoài
  types/face-api.d.ts
tests/                 # unit test (node:test qua tsx)
scripts/               # seed, kiểm tra DB / Gemini, script bảo trì
public/                # icon, manifest, models/ (face-api)
mockups/               # bản phác giao diện (không thuộc build)
vercel.json            # region + cron
```

### 3.1. `src/app/(user)` – app nhân viên

Layout `(user)/layout.tsx` gọi `requireActiveUser()` (chưa đăng nhập → `/login`; `NEW`/`REJECTED` → `/onboarding`; `PENDING` → `/pending`; `INACTIVE` → `/login?error=inactive`; Gmail của Chủ → `/admin`). Thanh dưới: Chấm công · Lịch sử · Lịch ca · Bảng lương · Tài khoản. Header có nút **Hỏi trợ lý** (nếu bật AI) và **Quản lý** (nếu có quyền quản lý) hoặc **Nội quy**.

| Route | Chức năng |
| --- | --- |
| `/` (`page.tsx`) | Màn hình chấm công (`CheckInWidget`: thiết bị → GPS/WiFi → camera) |
| `/closing` | Chốt ca: chụp ảnh, nhập / AI đọc số liệu doanh thu, gửi nhóm Telegram |
| `/history` | Lịch sử chấm công tháng, gửi yêu cầu điều chỉnh |
| `/schedule`, `/schedule/register` | Lịch ca tuần / tháng, đăng ký ca tuần sau, nhờ làm hộ / đổi ca (`cover-actions.ts`) |
| `/payroll` | Bảng lương đã công bố, khiếu nại lương, giải thích lương (AI) |
| `/receive`, `/stock` | Báo nhận hàng / kiểm kho cho cơ sở (gõ chữ hoặc AI đọc ảnh) |
| `/assistant` | Trợ lý cửa hàng (AI, chỉ trả lời 6 chủ đề) |
| `/account` | Thông tin tài khoản, thiết bị |
| `actions.ts` | Server actions nhân viên (yêu cầu sửa công, phản hồi lương, …) |

### 3.2. `src/app/admin` – trang quản lý

`admin/(panel)/layout.tsx` kiểm tra phiên admin, dựng menu từ `nav-items.ts` (ẩn mục theo quyền / chức năng tắt, badge số chờ duyệt). Các trang:

| Route | Chức năng | Quyền |
| --- | --- | --- |
| `/admin` | Tổng quan hôm nay (đang làm, badge Mới đến / sắp hết ca…, cảnh báo bất thường, lương tạm tính) | mọi admin (`payEstimate` cho lương tạm tính) |
| `/admin/work-schedule` | Lịch làm việc | mọi admin |
| `/admin/schedule`, `/admin/schedule/[storeId]` | Xếp ca tự động theo tuần, duyệt đăng ký, dự báo số người (AI), thời tiết, xuất ảnh lịch | mọi admin |
| `/admin/bonus-penalty` | Thưởng / phạt | mọi admin |
| `/admin/attendance`, `/admin/attendance/[id]` | Bảng chấm công (theo ca cả tháng / chi tiết), chấm hộ, sửa, xoá hàng loạt, nhập Excel / AI đọc ảnh | mọi admin |
| `/admin/employees`, `/admin/employees/[id]` | Nhân viên, lương giờ có ngày hiệu lực, hình thức lương, quyền quản lý, chuyển tài khoản | mọi admin |
| `/admin/payroll` | Bảng lương | `payroll` |
| `/admin/approvals`, `/admin/devices` | Duyệt đăng ký, thiết bị | mọi admin |
| `/admin/requests` | Yêu cầu (sửa công, đổi ca / làm hộ, khiếu nại lương) | duyệt sửa công cần `adjustments` |
| `/admin/finance/*` | Tài chính: lãi lỗ, doanh thu ngày, chi phí trong ca, bill/CK, tiền thuê, sổ quỹ, đếm tiền, cài đặt | các quyền `finance.*` |
| `/admin/closings`, `/admin/closings/anomaly` | Chốt ca, nhập bù, gửi lại Telegram, ghi sheet; bất thường | mọi admin |
| `/admin/goods`, `/goods/stock`, `/goods/items`, `/goods/report` | Nhận hàng, tồn kho, nguyên liệu & giá, tổng hợp | `goods`, `goods.items`, `goods.report` |
| `/admin/shifts`, `/admin/holidays` | Ca mẫu, ngày lễ | mọi admin |
| `/admin/export` | Xuất Excel | `export` |
| `/admin/stores` | Cơ sở | `stores` |
| `/admin/admins`, `/admin/activity` | Quản lý admin (chỉ Admin Tổng), hoạt động admin | owner / `activity` |
| `/admin/settings`, `/admin/settings/ai` | Cài đặt chung, Drive, dọn dữ liệu, cài đặt AI | xem được; sửa chủ yếu Admin Tổng |

`admin/(panel)/AskAiPanel.tsx`: khung **Hỏi AI** cho admin. `SectionTabs`, `MobileMenu`, `AdminNav`: điều hướng.

### 3.3. `src/app/admin/actions` – server actions

| File | Nội dung |
| --- | --- |
| `auth.ts` | Vào trang quản lý / thoát |
| `admins.ts` | Thêm / sửa / khoá admin, phân quyền, đăng xuất phiên |
| `people.ts` | Duyệt nhân viên, sửa hồ sơ, lương, quyền quản lý, thiết bị |
| `ops.ts` | Chấm công, ca, thưởng phạt, bảng lương, cơ sở… (nhiều thao tác vận hành) |
| `schedule.ts`, `cover.ts`, `holiday.ts` | Xếp ca, duyệt đổi ca / làm hộ, ngày lễ |
| `closing.ts` | Chốt ca: gửi lại, sửa số, ghi sheet, gửi thử Telegram |
| `finance.ts` | Chi phí, tiền thuê, sổ quỹ, đếm tiền, cài đặt tài chính |
| `goods.ts` | Nhận hàng, tồn kho, danh mục nguyên liệu / giá |
| `settings.ts` | Cấu hình chấm công, Drive, dọn dữ liệu |
| `ai.ts` | Cài đặt AI, Hỏi AI, nội quy, dự báo |
| `activity.ts` | Hoạt động admin |
| `types.ts` | `FormState`, helper đọc `FormData` (`num`, `dec`, `str`), `errMsg` |

### 3.4. `src/app/manage` – nhân viên quản lý

Tab hiện theo `managerPerms`: `/manage/schedule` (xếp ca), `/manage/bonus` (thưởng / phạt), `/manage/requests` (duyệt đổi ca / làm hộ). Kiểm tra quyền bằng `src/lib/staff-guard.ts` (phải thuộc cơ sở gốc hoặc `managerStoreIds`). Thao tác ghi `StaffActivity` (hiện ở Tổng quan cơ sở).

### 3.5. `src/app/api` – route handlers

| Route | Mô tả |
| --- | --- |
| `auth/[...nextauth]` | NextAuth (Google) |
| `google/connect`, `google/callback` | Admin Tổng kết nối Google Drive (OAuth `drive.file`, state cookie `tbs_gstate`) |
| `admin/enter` | Tạo phiên admin sau khi đăng nhập Google |
| `attendance` | GET trạng thái, POST check-in / check-out |
| `device/hello`, `device/request` | Ghi nhận thiết bị, yêu cầu đổi thiết bị |
| `onboarding` | Nhân viên đăng ký lần đầu |
| `photo` | Proxy xem ảnh chấm công từ Drive / ảnh tạm (admin xem tất cả, nhân viên chỉ ảnh của mình) |
| `closing`, `closing/ocr` | Nhân viên chốt ca; AI đọc ảnh tờ chốt ca |
| `goods/read` | AI đọc ảnh / tin nhắn nhận hàng |
| `admin/closing`, `admin/closing/ocr` | Admin nhập bù chốt ca; AI đọc ảnh |
| `admin/expenses`, `admin/expenses/ocr`, `admin/expenses/bulk` | Chi phí (bill / CK / sao kê), gửi nhóm Quản lý doanh thu |
| `admin/attendance/import`, `admin/attendance/ocr` | File mẫu + đọc Excel chấm công; AI đọc ảnh bảng chấm công (chỉ xem trước, chưa ghi DB) |
| `admin/export` | Xuất Excel (ghi audit log) |
| `cron/hourly`, `cron/publish-payroll` | Cron (mục 7) |
| `dev-logout` | Đã gỡ – luôn 404 |

### 3.6. `src/lib` – nghiệp vụ & tích hợp

| Module | Vai trò |
| --- | --- |
| `db.ts` | `connectDB()` – cache kết nối Mongoose trên `globalThis` cho serverless |
| `models.ts` | Toàn bộ Mongoose model (mục 6) |
| `settings.ts` | `ensureSeed()` (Settings + 3 cơ sở mặc định), `getSettings()` |
| `auth.ts` | `authOptions` NextAuth, `isOwnerEmail`, `getSessionEmail` |
| `admin-session.ts`, `admin-enter.ts` | Phiên admin (cookie JWT `tbs_admin` + `AdminLoginSession`), `getAdmin()`, `adminActor()` |
| `guards.ts` | `requireAdmin`, `requireOwner`, `requirePerm` (trang – redirect); `assertAdmin`, `assertOwner`, `assertPerm` (server action – ném lỗi); `requireActiveUser`, `getCurrentUser` |
| `permissions.ts` | `ADMIN_PERMS`, `STAFF_PERMS`, `can()`, `canAny()`, `staffCan()`, `managedStoreIds()` |
| `staff-guard.ts` | Guard cho nhân viên quản lý |
| `crypto.ts` | AES-256-GCM (`ENCRYPTION_KEY`) cho STK, refresh token |
| `time.ts` | Ngày / giờ theo múi giờ bằng `Intl` (`localDate`, `localMonth`, `zonedToDate`, `weekStartOf`, `viDate`…) |
| `format.ts` | Định dạng hiển thị |
| `calc.ts` | Công thức giờ công, làm tròn, muộn / sớm, khoảng cách GPS |
| `calc-expr.ts` | `evalCalc` – máy tính biểu thức tiền an toàn ("31 × 5k", "1tr2 / 4", "- 10%") |
| `revenue.ts` | Doanh thu chốt ca: `evalMoneyExpr`, `parseMoney`, chuẩn hoá OCR, cộng luỹ kế, ô Google Sheet, `CLOSING_SHIFTS` |
| `attendance.ts` | Tìm ca phù hợp khi check-in, quên check-out (`markMissingCheckouts`), gộp ca liền nhau |
| `attendance-admin.ts` | Chấm hộ / sửa giờ / duyệt yêu cầu điều chỉnh |
| `attendance-board.ts` | Bảng chấm công theo ca cả tháng (thuần) |
| `attendance-import*.ts` | Nhập chấm công từ Excel / kết quả AI |
| `attendance-notify.ts` | Tin Telegram nhóm chấm công |
| `checkin-methods.ts` | Cách xác thực theo cơ sở: face / GPS / WiFi (so IP public, IPv6 /64) |
| `device.ts` | Ràng buộc thiết bị (cookie + localStorage + fingerprint), `clientInfo()` |
| `support.ts` | Đi hỗ trợ cơ sở khác, chặn trùng giờ |
| `schedule.ts`, `schedule-data.ts` | Thuật toán xếp ca tự động (thuần) + dữ liệu tuần |
| `cover.ts` | Nhờ làm hộ / đổi ca |
| `holiday.ts` | Ngày lễ, hệ số lương |
| `salary.ts`, `payroll.ts`, `pay-explain.ts`, `seniority.ts` | Hình thức lương, tính / công bố bảng lương, giải thích lương (AI), thâm niên |
| `closing.ts`, `closing-context.ts`, `day-revenue.ts` | Chốt ca → Telegram / webhook; ngữ cảnh ca; doanh thu ngày + ghi sheet |
| `sheets.ts` | Service account → Google Sheets (`writeDayRow`, `checkSheet`) |
| `drive.ts` | OAuth Drive của Chủ, upload ảnh, `PendingPhoto` + retry |
| `telegram.ts` | `sendPhotosToTelegram`, `sendTelegramText` |
| `finance.ts`, `finance-data.ts`, `finance-report.ts` | Công thức lãi lỗ (thuần), dữ liệu, báo cáo Telegram ngày / tuần / tháng |
| `cashbook.ts` | Sổ quỹ (TK / TM), loại phiếu |
| `goods.ts`, `goods-server.ts` | Danh mục nguyên liệu, bộ đọc "nhận 5mn, 2nl…", lưu + gửi Telegram |
| `ocr.ts` | Gọi Gemini (nhiều key, model dự phòng, diễn giải lỗi), OCR chốt ca / bill / sao kê |
| `ai.ts`, `ai-free.ts`, `ai-quips.ts` | Cài đặt AI, giới hạn / ngân sách token, đếm lượt free theo key × model × ngày Pacific |
| `ask-ai.ts`, `ask-actions.ts` | Hỏi AI (admin): chọn công cụ truy vấn; đề xuất hành động → phiếu xác nhận |
| `assistant.ts`, `rules-format.ts`, `rules-summary.ts` | Trợ lý cửa hàng, định dạng / tóm tắt nội quy |
| `anomaly.ts` | Phát hiện bất thường chốt ca & két (quy tắc thuần + AI tóm tắt) |
| `forecast.ts`, `weather.ts` | Dự báo số người / ca, thời tiết Open-Meteo |
| `live-badges.ts` | Badge nhân viên đang làm ở Tổng quan |
| `export.ts`, `export-summary.ts` | Xuất Excel 8 loại |
| `cleanup.ts`, `cleanup-items.ts` | Dọn dữ liệu cũ, TTL index, tự dọn hằng tháng, thống kê dung lượng |
| `audit.ts`, `activity.ts`, `activity-server.ts` | Audit log, hoạt động admin 7 ngày, nhật ký nhân viên quản lý |
| `account-merge.ts` | Chuyển dữ liệu từ Gmail cũ sang Gmail mới của nhân viên |
| `cron.ts` | `isCronAuthorized` (Bearer `CRON_SECRET`) |
| `api.ts` | `HttpError`, `jsonError`, `dataUrlToBuffer` (ảnh ≤ 1,5 MB) |
| `dev-auth.ts`, `local-mongo.ts` | Đã gỡ (file rỗng) |

### 3.7. `src/components`

- `ActionForm.tsx` – form gọi server action, hiển thị lỗi / thành công, hộp xác nhận riêng (`confirm`).
- `ui.tsx` – `Card`, `Button`, `LinkButton`, `Field`, `Input`, `Select`, `Badge`, `Alert`, `PageTitle`…
- Nhập liệu: `MoneyInput`, `ExprMoneyInput` (gõ biểu thức tiền), `TimeInput`, `MonthPicker`, `DatePickButton`, `PayTermsFields`.
- Bảng / lưới: `AttendanceTable`, `WeekGrid`, `WeekBadge`, `ColumnToggle`, `AutoFilterForm`.
- Khác: `Modal`, `ConfirmDialog`, `ApproveRejectForm`, `GoodsEntry`, `GoodsForm`, `RulesView`, `PullToRefresh`, `Logo`.
- `components/user/`: `CheckInWidget`, `FaceCamera` (face-api, tự chụp khi có mặt trong khung ~0,8s), `PhotoCamera` (camera sau – chốt ca), `useDevice`, `DeviceNotice`, `CoverForm`, `SwapForm`, `WeekOffButton`, `RegRequestAlert`, `UserNotices`, `RulesButton`, `PayExplain`, `BottomNav`, `AuthButtons`.

### 3.8. `scripts/`

| Script | Mục đích |
| --- | --- |
| `seed.ts` (`npm run seed`) | `ensureSeed()` + `syncIndexes()` |
| `set-admin-password.ts` | Đặt mật khẩu admin chung – **di sản**, đăng nhập bằng mật khẩu đã bỏ |
| `check-db.mjs` | Kiểm tra kết nối MongoDB |
| `check-gemini.mjs` (`npm run check-gemini`) | Kiểm tra key / model Gemini |
| `clean-extras-notes.ts` | Dọn ghi chú phụ cấp / tạm ứng rác (`--apply` để ghi) |
| `demo-ai.ts` | Chạy thử AI trên MongoDB cục bộ với Gemini giả |
| `env.ts` | Đọc `.env.local` / `.env` cho script |
| `seed-mock.ts` | Đã gỡ |

---

## 4. Xác thực & phân quyền

### 4.1. Đăng nhập Google (NextAuth)

`src/lib/auth.ts`: Google provider, `session.strategy = "jwt"` (30 ngày), trang đăng nhập `/login`. Callback `signIn`:

- Gmail = `OWNER_EMAIL` → ghi `AdminLoginLog` (kind `OWNER`), **không** tạo `User`.
- Gmail là `AdminAccount` → không tự tạo hồ sơ nhân viên (chỉ cập nhật tên / ảnh nếu đã có).
- Còn lại → upsert `User` với `status: "NEW"` → nhân viên đi qua `/onboarding` (chọn cơ sở, họ tên, SĐT, ngân hàng, STK) → `PENDING` → admin duyệt → `ACTIVE`.

### 4.2. Phiên admin

`src/lib/admin-session.ts`:

- **Admin Tổng**: chỉ cần phiên NextAuth với email = `OWNER_EMAIL` → `getAdmin()` trả `{ kind: "OWNER", perms: [] }` (luôn có mọi quyền).
- **Admin**: sau khi đăng nhập Google, `/admin/login` → `/api/admin/enter` → `startAdminSession()` (`admin-enter.ts`) kiểm tra `AdminAccount.status === "ACTIVE"`, tạo `AdminLoginSession` (sid, IP, UA, thiết bị, hết hạn sau `Settings.adminSessionDays`) và cookie `tbs_admin` (JWT HS256 ký bằng `ADMIN_JWT_SECRET` hoặc `NEXTAUTH_SECRET`). Cookie thiết bị `tbs_admin_dev` để Admin Tổng xem máy đăng nhập.
- Mỗi request: phiên phải chưa bị thu hồi, chưa hết hạn, tài khoản `ACTIVE` và **cùng Gmail** với phiên Google hiện tại.
- Admin Tổng thêm admin ở **Quản lý admin** (`addAdminAccount` tạo luôn `ACTIVE`), khoá (`BLOCKED`), xem online, đăng xuất từng phiên.

Guards (`src/lib/guards.ts`): trang thiếu đăng nhập → `/admin/login`; trang chỉ owner → `/admin?error=owner-only`; thiếu quyền → `/admin?error=forbidden`; trong server action thì ném lỗi thay vì redirect.

### 4.3. Quyền admin (`ADMIN_PERMS` – `src/lib/permissions.ts`)

Admin mặc định **không có** các quyền dưới đây; Admin Tổng tick cấp từng quyền. **Lãi lỗ** và **Quản lý admin** chỉ Admin Tổng; Doanh thu theo ngày / Sổ quỹ cấp được quyền **xem** (sửa / ghi phiếu chỉ Admin Tổng).

| Key | Nhãn | Nhóm |
| --- | --- | --- |
| `adjustments` | Duyệt yêu cầu chấm công bù (nhân viên gửi) | Chấm công |
| `finance.shiftExpenses` | Tài chính – Chi phí trong ca | Tài chính |
| `finance.bills` | Tài chính – Bill / chuyển khoản | Tài chính |
| `finance.rent` | Tài chính – Tiền thuê nhà | Tài chính |
| `finance.revenue` | Tài chính – Xem doanh thu theo ngày (không sửa) | Tài chính |
| `finance.cashbook` | Tài chính – Xem sổ quỹ (không ghi phiếu) | Tài chính |
| `finance.cashbook.history` | Tài chính – Sổ quỹ: xem lịch sử ghi phiếu (toàn bộ) + chi tiết 2 ô Tài khoản / Tiền mặt | Tài chính |
| `finance.cashbook.history7` | Tài chính – Sổ quỹ: xem lịch sử ghi phiếu 7 ngày gần nhất + chi tiết 2 ô | Tài chính |
| `finance.cashcount` | Tài chính – Sổ quỹ: chỉ xem số tiền mặt thực tế (số nhỏ cạnh tiền mặt, không xem chi tiết) | Tài chính |
| `finance.cashcount.detail` | Tài chính – Sổ quỹ: xem số tiền mặt thực tế + chi tiết (đã lấy / chưa lấy, vốn đã lấy) | Tài chính |
| `finance.settings` | Tài chính – Cài đặt | Tài chính |
| `payroll` | Bảng lương | Lương |
| `payEstimate` | Lương tạm tính ở Tổng quan | Lương |
| `goods` | Nhận hàng / tồn kho các cơ sở (xem / nhập) | Hàng hoá |
| `goods.items` | Nguyên liệu & giá nhập (thêm / sửa / xoá món, giá) | Hàng hoá |
| `goods.report` | Tổng hợp hàng nhập (tiền nhập / tiêu thụ từng cơ sở) | Hàng hoá |
| `export` | Xuất Excel | Khác |
| `stores` | Cơ sở (cài đặt cơ sở) | Khác |
| `activity` | Hoạt động admin | Khác |

`FINANCE_PERMS` = 6 quyền tài chính chính (shiftExpenses, bills, rent, revenue, cashbook, settings) – có 1 trong số đó thì thấy menu Tài chính. Kiểm tra quyền: `can(admin, perm)`, `canAny(admin, perms)`.

### 4.4. Quyền nhân viên quản lý (`STAFF_PERMS`)

| Key | Nhãn | Mô tả |
| --- | --- | --- |
| `schedule` | Xếp ca tự động | Xếp ca / duyệt đăng ký ca ở cơ sở được giao |
| `bonus` | Thưởng / phạt | Tạo thưởng / phạt; chỉ sửa / xoá được cái mình tạo (`BonusPenalty.createdByUserId`) |
| `cover` | Duyệt đổi ca / làm hộ | Duyệt yêu cầu đổi ca, nhờ làm hộ ở cơ sở được giao |

Lưu ở `User.managerPerms`, cơ sở quản lý = cơ sở gốc + `User.managerStoreIds` (`managedStoreIds()`).

### 4.5. Quyền AI theo vai trò

`src/lib/ai.ts` – mỗi chức năng AI có danh sách vai trò `admin` / `manager` / `staff` mà Admin Tổng bật / tắt riêng (Admin Tổng luôn dùng được).

---

## 5. Các module nghiệp vụ

### 5.1. Chấm công (khuôn mặt / GPS / WiFi / thiết bị)

- **Thiết bị** (`lib/device.ts`): deviceId lưu cookie httpOnly + localStorage + fingerprint; mỗi thiết bị thuộc 1 nhân viên; số thiết bị tối đa theo `Settings.maxDevicesPerUser`. Thiết bị mới → `PENDING`, nhân viên bấm "Yêu cầu đổi thiết bị", admin duyệt ở **Thiết bị**. Fingerprint đổi → ghi audit (cảnh báo nghi chấm hộ).
- **Cách xác thực theo cơ sở** (`lib/checkin-methods.ts`): `checkFace` (mặc định bật), `checkGps` (bật), `checkWifi` (tắt). Bật nhiều → phải qua tất cả. WiFi kiểm bằng IP public (trình duyệt không đọc được SSID).
- **GPS**: sai số ≤ `Settings.maxGpsAccuracyM`, khoảng cách ≤ `Store.radiusM`. Không tiết lộ bán kính / khoảng cách cho nhân viên.
- **Khuôn mặt**: chỉ **phát hiện có mặt** trong khung bằng TinyFaceDetector trên trình duyệt, tự chụp; **không** so khớp ảnh mẫu (trường `faceMatchThreshold`, model `FaceProfile` và file model nhận dạng trong `public/models` là di sản). Ảnh lưu Drive để admin đối chiếu.
- **Giờ server**, chống chấm trùng bằng unique partial index `one_open_per_user` + check-out bằng `findOneAndUpdate` có điều kiện + chặn check-out trong `minCheckoutMinutes`.
- **Hỗ trợ cơ sở khác** (`lib/support.ts`): chỉ chấm được ở cơ sở khác khi có ca hỗ trợ đã duyệt đúng giờ (app tự nhận cơ sở theo GPS); `Attendance.homeStoreId` = cơ sở trả lương.
- **Tính giờ công** (`lib/calc.ts`): làm tròn xuống theo bước `roundStepHours` (mặc định 0,5h) với dung sai `roundGraceMinutes` / `roundGraceHourMinutes`; đi muộn / về sớm theo ngưỡng; các ca liền nhau (nghỉ ≤ 30 phút, cùng cơ sở) gộp thành 1 khối; admin cộng `extraHours`.
- **Quên check-out**: cron đánh dấu `MISSING_CHECKOUT` sau `missingCheckoutHours`.
- **Admin**: bảng chấm công theo ca cả tháng (`attendance-board.ts`, icon muộn/sớm, làm thêm, quên check-out, hỗ trợ), chấm hộ / sửa / xoá có lịch sử (`AttendanceAdjustment`), nhập hàng loạt từ Excel hoặc AI đọc ảnh bảng chấm công, duyệt yêu cầu điều chỉnh (`AdjustmentRequest`, quyền `adjustments`).
- **Thông báo**: mỗi lần check-in/out gửi ảnh + thông tin vào nhóm Telegram chấm công (`attendance-notify.ts`).

### 5.2. Xếp ca

- **Ca mẫu** (`ShiftTemplate`): giờ bắt đầu / kết thúc (qua đêm nếu kết thúc < bắt đầu), `minStaff` (thiếu người), `targetStaff` (định mức), `staffByDate` (định mức riêng theo ngày, VD áp dụng gợi ý AI).
- **Phân ca** (`ShiftAssignment`): `PENDING` (nhân viên đăng ký) / `APPROVED` / `REJECTED`; nguồn `REQUEST` / `MANUAL` / `AUTO` / `BULK`; giữ snapshot giờ ca. Bộ lọc `APPROVED_SHIFT` coi bản ghi cũ không có status là đã duyệt.
- **Xếp tự động** (`schedule.ts` – `planAutoSchedule`, thuần): lấp tới định mức, ưu tiên ít ca nhất / hay làm ca / hay làm cùng; có xem trước, tổng hợp số ca và cảnh báo thiếu người. Copy tuần trước, xếp hàng loạt.
- **Yêu cầu đăng ký ca** (`ShiftRegRequest`): admin nhắc nhân viên đăng ký tuần sau → `OPEN` / `DONE` / `OFF`.
- **Nhờ làm hộ / đổi ca** (`CoverRequest`, `cover.ts`): `COVER` hoặc `SWAP`, duyệt bởi admin hoặc nhân viên quản lý có quyền `cover`; `lockedAt` chống xử lý 2 lần.
- **Dự báo** (`forecast.ts`): doanh thu riêng từng ca (từ chốt ca luỹ kế) → gợi ý số người / ca theo trung vị doanh thu / người; AI chỉ viết lý do. **Thời tiết** Open-Meteo hiển thị cạnh lịch.
- Xuất ảnh lịch tuần (`html-to-image`).

### 5.3. Bảng lương

- Lương giờ có ngày hiệu lực (`WageHistory`); hình thức lương theo tháng (`SalaryHistory`: `HOURLY` / `FULLTIME` + lương cứng + ngày nghỉ có lương) – `salary.ts`.
- `generatePayroll` (`payroll.ts`): tổng giờ công (gồm giờ hỗ trợ cơ sở khác, tính cho cơ sở gốc), ngày lễ nhân hệ số (`Holiday`, mặc định ×2), thưởng / phạt, phụ cấp, tạm ứng (có ghi chú từng lần – `extrasNotes`), số lần muộn / sớm.
- Trạng thái `Payroll`: `DRAFT` → `PUBLISHED` (công bố sớm hoặc cron 00:00 ngày 5) → `PAID`. Có thể công bố riêng từng nhân viên (`PayrollItem.publishedAt`) và đánh dấu đã trả từng dòng (`PayrollItem.paidAt`).
- **Khoá tháng**: đã công bố / đã trả → không chấm hộ, sửa chấm công, thêm / xoá thưởng phạt cho tháng đó. Mở khoá (`unlockedAt`) → cron ngày 5 không tự công bố lại.
- Dòng lương lưu snapshot tên, ngân hàng, STK (mã hoá), chi tiết thưởng phạt (`bpDetails`).
- Nhân viên xem bảng đã công bố, gửi khiếu nại (`PayrollFeedback`), nhờ AI giải thích (`pay-explain.ts`, mặc định tắt).
- Thâm niên (`seniority.ts`) dùng ngày vào làm, `firstWorkDate`, lượt chấm công sớm nhất.

### 5.4. Thưởng / phạt

`BonusPenalty` (VND tự do, nội dung, ngày, có thể gắn lượt chấm công – "Thêm phạt" từ dòng muộn / sớm). Admin hoặc nhân viên quản lý (`bonus`) tạo; nhân viên quản lý chỉ sửa / xoá cái mình tạo. Bị chặn khi tháng đã khoá.

### 5.5. Chốt ca & doanh thu

- Nhân viên chụp ảnh tờ chốt ca (camera sau, tối đa 4 ảnh) → AI (Gemini, `closingOcr`) điền sẵn **DT máy, Tiền mặt, Tài khoản, Thu chi, Grab, Shopee**, số tổng nhân viên tự cộng, ngày; cảnh báo thiếu TM / TK / ngày hoặc ngày khác ngày chốt. Nhân viên sửa (gõ được biểu thức "30k sữa chua + 20k ship") → **Chốt ca & gửi nhóm**.
- **Âm/Dương** = DT máy − (TM + TK + Thu chi + Grab + Shopee); khác 0 bắt buộc ghi chú.
- **Số luỹ kế**: ca Chiều đã gồm ca Sáng; doanh thu ngày = số chốt ca **Tối** (chưa có thì ca gần nhất). `DayRevenue` lưu số ngày + trạng thái ghi sheet; `calcVersion = 2` (luỹ kế) – cron `migrateDayCalc` tính lại dữ liệu cũ.
- **Ca cuối ngày** = ca mẫu có giờ bắt đầu muộn nhất (`isDayEndShift`) → ghi dòng ngày lên Google Sheet (`sheets.ts`, mẫu cột `GRAB_COL` / `LEGACY`).
- Gửi album + caption vào nhóm Telegram của **cơ sở đang làm** (`closing.ts`); lỗi → `telegram.status = FAILED`, cron gửi lại; tuỳ chọn POST webhook `CLOSING_WEBHOOK_URL`.
- Admin: xem / gửi lại / sửa số (`revenueEditedBy`), nhập bù ca thiếu (`/api/admin/closing`), ghi lại sheet, trang **Bất thường**.
- **Bất thường chốt ca & két** (`anomaly.ts`): quy tắc thuần (`detectAnomalies`, ngưỡng trong `Settings.ai.anomaly`) theo từng nhân viên, AI viết tóm tắt; kết quả `AnomalyRun`, đánh dấu đã xử lý `AnomalyResolved`; gửi Telegram nếu bật.

### 5.6. Tài chính (`/admin/finance`)

| Tab | Nội dung |
| --- | --- |
| **Lãi lỗ** (chỉ Admin Tổng) | Doanh thu thật = TK + TM + Grab + Shopee + Chi phí két; Lãi = Doanh thu thật − Chi phí két − Lương NV − Chi phí admin nhập − Mặt bằng − Phí sàn. Biểu đồ tròn cơ cấu chi phí (`CostPie`). Theo cơ sở là tham khảo |
| **Doanh thu theo ngày** | Bảng `DayRevenue`, bấm dòng xem 3 ca và "DT riêng ca"; sửa số chỉ Admin Tổng |
| **Chi phí trong ca** | Tách từng khoản từ ô "Thu chi" chốt ca (`moneyExprItems`) |
| **Bill / chuyển khoản** (`Expense`) | Ảnh bill / CK / sao kê → AI (`billOcr`) đọc số tiền, ngày, nơi bán, danh mục, người nhận, nội dung CK. Danh mục **Lương NV** chỉ lưu chứng từ, không tính chi phí. Chi phí 1 cơ sở hoặc **chung** (chia theo doanh thu / đều / % tự đặt). Bill trả bằng **tiền két** (`CASHBOX`) không cộng lại. Trùng ngày + số tiền → hỏi lại. Ảnh chỉ gửi nhóm Quản lý doanh thu, không lưu |
| **Tiền thuê** (`FixedCost`) | 1 khoản / cơ sở / tháng, chia đều theo ngày; tăng giá → đặt "Đến tháng" cho khoản cũ |
| **Sổ quỹ** (`cashbook.ts`, `CashTransfer`) | Số dư ước tính TK / TM cộng dồn; phiếu Rút lãi, Bổ sung vốn, Nộp TM → TK, Rút TK → TM; phiếu "Thanh toán lương" tự sinh từ bảng lương đã trả |
| **Đếm tiền** (`CashCount`) | Đánh dấu ngày đã lấy & đếm tiền mặt; lệch → sửa tiền mặt ca cuối ngày + cảnh báo (`ShiftClosing.cashMismatch`) |
| **Cài đặt** | Chat ID nhóm Quản lý doanh thu, bật/tắt báo cáo ngày / tuần / tháng + nhận xét AI, % phí sàn Grab / Shopee từng cơ sở, gửi thử, gửi báo cáo ngay |

**Báo cáo Telegram** (`finance-report.ts`): ngày (khi cơ sở cuối cùng chốt ca Tối, hoặc cron đêm cho hôm qua), tuần (thứ 2), tháng (ngày 1); `ReportLog` chống gửi trùng. Có cảnh báo âm két, chưa chốt ca, doanh thu lệch nhiều so với trung bình cùng thứ, đi muộn / về sớm / bỏ ca, nhận xét AI.

### 5.7. Hàng hoá, nguyên liệu

- **Nhận hàng** (`GoodsReceipt.kind = RECEIVE`) và **Tồn kho / kiểm kho** (`STOCK`, mặc định tắt – `Settings.stockEnabled`); bật/tắt cả chức năng `Settings.goodsEnabled`.
- Nhân viên gõ "nhận 5mn, 2nl…" → `parseGoodsText` (`goods.ts`, chạy cả client lẫn server, không cần AI) hoặc chụp ảnh nhóm chat → AI `goodsOcr` (`/api/goods/read`). Lưu + gửi tin 📦 / 📋 vào nhóm nhận hàng của cơ sở.
- **Nguyên liệu & giá nhập** (`GoodsItem`): tên, đơn vị, tên gọi tắt, lịch sử giá theo ngày áp dụng; xoá = ẩn.
- **Tổng hợp hàng nhập**: tiền nhập / tiêu thụ từng cơ sở.

### 5.8. AI (Gemini)

Mọi lần gọi đi qua `geminiGenerate()` (`ocr.ts`): thử lần lượt key × model, bỏ qua tạm cặp đã hết lượt, giảm "thinking" cho câu hỏi chữ, che API key trong thông báo lỗi; nếu có `feature` thì `aiGuard()` kiểm tra bật/tắt, vai trò, giới hạn, ngân sách token tháng (chức năng `essential` vẫn chạy khi hết ngân sách) và ghi `AiUsage`. `ai-free.ts` ghi `AiCall` để đếm lượt free theo key × model × ngày Pacific.

| Key | Chức năng | Giới hạn mặc định | Bật mặc định |
| --- | --- | --- | --- |
| `closingOcr` | Đọc ảnh tờ chốt ca (essential) | 2000 / tháng | có |
| `goodsOcr` | Đọc tin nhắn nhận hàng | 600 / tháng | có |
| `billOcr` | Đọc bill / sao kê | 300 / tháng | có |
| `attendanceOcr` | Đọc ảnh bảng chấm công | 100 / tháng | có |
| `reportComment` | Nhận xét báo cáo tài chính | 60 / tháng | có |
| `assistant` | Trợ lý cửa hàng (nhân viên) | 10 câu / ngày / người | có |
| `anomaly` | Phát hiện bất thường chốt ca & két | 3 / ngày | có |
| `payExplain` | Giải thích lương | 3 / tháng / người | **tắt** |
| `forecast` | Dự báo số người / ca | 10 / tháng | có |
| `rulesSummary` | Tóm tắt nội quy | 30 / tháng | có |
| `ask` | Trợ lý AI (admin) – tra cứu + đề xuất thao tác có phiếu xác nhận | 30 câu / ngày / người | có |

Cấu hình lưu ở `Settings.ai` (Mixed; thiếu khoá dùng mặc định trong `AI_FEATURES`). Trợ lý cửa hàng chỉ dựa vào nội dung admin nhập (nội quy, quản lý, bảo quản, nguyên liệu, chốt ca, chấm công) và không đọc dữ liệu chấm công / lương / doanh thu; câu chưa trả lời được ghi `AssistantLog`.

### 5.9. Thông báo Telegram

| Loại | Module | Nhóm (ưu tiên → dự phòng) |
| --- | --- | --- |
| Chốt ca (album + caption) | `closing.ts` | `Store.telegramChatId` → `TELEGRAM_CHAT_ID` |
| Check-in / check-out | `attendance-notify.ts` | `Store.telegramAttendanceChatId` → `TELEGRAM_ATTENDANCE_CHAT_ID` → không gửi |
| Nhận hàng / tồn kho | `goods-server.ts` | `Store.telegramGoodsChatId` → `TELEGRAM_GOODS_CHAT_ID` → nhóm chốt ca → `TELEGRAM_CHAT_ID` |
| Bill chi phí, báo cáo, bất thường, tự dọn dữ liệu | `finance-report.ts`, `api/admin/expenses*`, `anomaly.ts`, `cleanup.ts` | `Settings.financeChatId` → `TELEGRAM_FINANCE_CHAT_ID` |

Thông báo trong app cho nhân viên dùng `UserNotice` (hiện tới khi bấm "Đã xem").

### 5.10. Google Drive & Google Sheets

- **Drive** (`drive.ts`): OAuth của Admin Tổng, scope `drive.file`, refresh token mã hoá trong `Settings`. Thư mục `TBS Chấm công/{Cơ sở}/{Nhân viên}/{YYYY-MM}` (id cache ở `Settings.rootDriveFolderId`, `Store.driveFolderId`). Upload lỗi → `PendingPhoto` (Buffer trong MongoDB) → cron `retryPendingPhotos`. Xem ảnh qua `/api/photo`.
- **Sheets** (`sheets.ts`): service account JWT, scope `spreadsheets`, `values.batchUpdate` (`USER_ENTERED`), tab theo `revenueTabPattern`, dòng = `revenueFirstRow` + ngày − 1.

### 5.11. Dọn dữ liệu & TTL

- **Dọn tay** (Admin Tổng, Cài đặt → `CleanupCard`): chọn mốc tháng (mặc định giữ tháng hiện tại + 2 tháng trước), chọn loại (`cleanup-items.ts`: lịch sử đăng nhập, nhật ký, lịch sử sửa công, log AI, yêu cầu đã xử lý, thiết bị cũ, tài khoản rác, khuôn mặt người đã nghỉ, ảnh check-in/out & chốt ca, ảnh kẹt, dữ liệu mồ côi, dữ liệu phụ, chấm công cũ – giữ tóm tắt ở `AttendanceArchive`, bảng không còn dùng…), xem trước số lượng + xác nhận; tuỳ chọn chuyển thư mục ảnh tháng cũ trên Drive vào thùng rác. **Không** xoá ca chính thức, thưởng phạt, lương, chi phí.
- **Tự dọn hằng tháng** (`Settings.autoCleanup`, mặc định tắt): cron chạy các loại `auto: true`, báo nhóm Quản lý doanh thu kèm dung lượng DB.
- **Thống kê dung lượng** so với 512 MB gói free (`getStorageStats`).
- **TTL index** (MongoDB tự xoá) – xem cột TTL ở mục 6. `ensureTtlIndexes()` chuyển index thường → TTL cho các bảng log cũ.

### 5.12. Hoạt động admin & audit

- `audit()` (`audit.ts`) ghi `AuditLog` (before / after) cho mọi thao tác quan trọng; với admin thường còn ghi `AdminActivity` (giữ 7 ngày, trang **Hoạt động admin**), với nhân viên quản lý ghi `StaffActivity` (30 ngày, Tổng quan cơ sở).
- Lịch sử đăng nhập admin (`AdminLoginLog`), phiên (`AdminLoginSession`), thiết bị admin (`AdminAccount.devices`).
- Xuất Excel ghi audit mỗi lần (file chứa STK, lương).

### 5.13. Xuất Excel

`export.ts` (`exceljs`, header vàng/nâu, freeze, autofilter, dòng tổng, tô màu) – 8 loại `EXPORT_TYPES`: `tonghopthang` (doanh thu – chi phí – lãi, mỗi tháng 1 sheet, **chỉ Admin Tổng**), `chamcong`, `tonghop`, `luong`, `thuongphat`, `chuyenkhoan`, `nhanvien`, `lichca`. Lọc theo khoảng tháng, cơ sở, nhân viên.

---

## 6. Mô hình dữ liệu (Mongoose)

Tất cả ở `src/lib/models.ts`. Tiền VND lưu số nguyên; thời gian lưu UTC; ngày nghiệp vụ lưu chuỗi `YYYY-MM-DD`, tháng `YYYY-MM` theo múi giờ cơ sở. Tên collection = tên model dạng số nhiều, chữ thường (mặc định Mongoose, VD `ShiftClosing` → `shiftclosings`).

| Model | Mục đích | Trường chính | Index / TTL |
| --- | --- | --- | --- |
| `Settings` | Cấu hình duy nhất (`key: "main"`) | Drive token (mã hoá), làm tròn, ngưỡng muộn/sớm, thiết bị tối đa, sai số GPS, ngày phiên admin, `financeChatId`, cờ báo cáo, `ai` (Mixed), `autoCleanup`, `goodsCatalog`, `goodsEnabled`, `stockEnabled`; `adminPasswordHash` (di sản) | unique `key` |
| `Store` | Cơ sở | `code`, `name`, `lat`/`lng`/`radiusM`, `checkFace/Gps/Wifi`, `wifiIps`, `timezone`, `driveFolderId`, 3 chat ID Telegram, Google Sheet (`revenueSheetId`, `revenueTabPattern`, `revenueFirstRow`, `revenueSheetLayout`), `grabFeePct`, `shopeeFeePct`, `active` | unique `code` |
| `User` | Nhân viên | `email`, `name`, `phone`, `bankAccountEnc`, `hourlyWage`, `payType`, `monthlySalary`, `status` (NEW/PENDING/ACTIVE/REJECTED/INACTIVE), `storeId`, `managerPerms`, `managerStoreIds`, `noLogin`, `adminStaff`, `firstWorkDate` | unique `email` |
| `FaceProfile` | Mẫu khuôn mặt (di sản – không còn so khớp) | `userId`, `descriptor` | unique `userId` |
| `Device` | Thiết bị nhân viên | `deviceId`, `userId`, `fingerprintHash`, `status` (PENDING/APPROVED/REVOKED/REJECTED), `requestedAt` | unique `deviceId` |
| `LoginLog` | Đăng nhập nhân viên | `userId`, `deviceId`, `ip` | **TTL 180 ngày** (`createdAt`) |
| `ShiftTemplate` | Ca mẫu | `storeId`, `name`, `startTime`, `endTime`, `minStaff`, `targetStaff`, `staffByDate` | `storeId` |
| `ShiftAssignment` | Ca được xếp / đăng ký | `userId`, `storeId`, `shiftTemplateId`, `date`, snapshot giờ, `status`, `source` | unique (`userId`,`date`,`shiftTemplateId`) |
| `ShiftRegRequest` | Nhắc đăng ký ca tuần | `userId`, `storeId`, `weekStart`, `status` (OPEN/DONE/OFF) | unique (`userId`,`weekStart`) |
| `Attendance` | Lượt chấm công | `userId`, `storeId`, `homeStoreId`, `workDate`, `month`, check-in/out (giờ, toạ độ, khoảng cách, IP, ảnh Drive / pending, thiết bị), `roundedHours`, `extraHours`, `lateMinutes`, `earlyMinutes`, `source`, `status` (OPEN/COMPLETED/MISSING_CHECKOUT), `staffNote` | partial unique `one_open_per_user` |
| `AttendanceArchive` | Tóm tắt tháng trước khi dọn chấm công cũ | `userId`, `month`, `days`, `shifts`, `hours` | (`userId`,`month`) |
| `AttendanceAdjustment` | Lịch sử sửa chấm công | `attendanceId`, `action`, `before`, `after`, `reason` | |
| `AdjustmentRequest` | Nhân viên xin sửa công | `userId`, `workDate`, giờ, `reason`, `status`, `lockedAt` | |
| `ShiftClosing` | Chốt ca | `storeId`, `workDate`, `shiftName`, ảnh, `telegram` (status/messageIds/attempts), `webhook`, `revenue`, `revenueInput`, `staffTotal`, `ocr`, `isDayEnd`, `cashMismatch`, `editCount` | (`storeId`,`workDate`,`shiftName`), `telegram.status` |
| `DayRevenue` | Doanh thu ngày + trạng thái ghi sheet | `storeId`, `date`, `dt/tk/tm/cp/grab/shopee`, `lastShift`, `calcVersion`, `sheet` | unique (`storeId`,`date`) |
| `PendingPhoto` | Ảnh chờ upload Drive | `data` (Buffer), `target`, `attempts`, `lastError` | |
| `CoverRequest` | Nhờ làm hộ / đổi ca | `fromUserId`, `toUserId`, `kind` (COVER/SWAP), ca hai bên, `status`, `lockedAt` | `status` |
| `UserNotice` | Thông báo trong app | `userId`, `text`, `tone`, `link`, `readAt` | **TTL 30 ngày** sau `readAt` |
| `GoodsReceipt` | Nhận hàng / kiểm kho | `kind`, `storeId`, `date`, `items[]`, `source`, `telegram` | (`storeId`,`date`) … |
| `GoodsItem` | Nguyên liệu + lịch sử giá | `name`, `unit`, `aliases`, `prices[]`, `active` | unique `name` |
| `Expense` | Chi phí (bill / CK) | `date`, `amount`, `category`, `kind`, `scope`, `storeId`, `allocation`, `customShares`, `paidFrom` (OWNER/CASHBOX), `countInCost`, `ocr`, `telegram` | (`month`,`date`), (`date`,`amount`) |
| `FixedCost` | Chi phí cố định (tiền thuê) | `name`, `amountPerMonth`, `scope`, `startMonth`, `endMonth` | |
| `ReportLog` | Chống gửi trùng báo cáo / tự dọn | `key` (VD `daily:2026-11-08`, `cleanup:2026-11`), `status` | unique `key`, **TTL 180 ngày** (`sentAt`) |
| `WageHistory` | Lương giờ theo ngày hiệu lực | `userId`, `hourlyWage`, `effectiveFrom` | |
| `SalaryHistory` | Hình thức lương theo tháng | `userId`, `payType`, `monthlySalary`, `paidLeaveDays`, `effectiveMonth` | |
| `BonusPenalty` | Thưởng / phạt | `userId`, `storeId`, `kind`, `date`, `amountVnd`, `content`, `createdByUserId` | (`userId`,`date`), (`storeId`,`month`) |
| `Payroll` | Bảng lương cơ sở × tháng | `storeId`, `month`, `status` (DRAFT/PUBLISHED/PAID), `unlockedAt` | unique (`storeId`,`month`) |
| `PayrollItem` | Dòng lương | giờ, ngày công, `basePay`, `allowance`, `advance`, thưởng/phạt, `netPay`, giờ hỗ trợ / ngày lễ, `paidAt`, `publishedAt`, `extrasNotes`, snapshot tên / STK / `bpDetails` | unique (`payrollId`,`userId`) |
| `Holiday` | Ngày lễ | `date`, `name`, `multiplier` (1–10, mặc định 2) | unique `date` |
| `PayrollFeedback` | Khiếu nại lương | `payrollItemId`, `content`, `status`, `adminReply` | |
| `AdminLoginLog` | Đăng nhập admin | `kind` (OWNER/PASSWORD/GOOGLE), `displayName`, `success` | **TTL 180 ngày** |
| `AdminAccount` | Tài khoản admin | `email`, `name`, `status` (PENDING/ACTIVE/BLOCKED), `perms`, `devices[]` | unique `email` |
| `CashTransfer` | Phiếu sổ quỹ | `storeId?`, `date`, `kind` (DEPOSIT/WITHDRAW/TAKE/ADD), `account`, `amount`, `counted` | `month` |
| `CashCount` | Ngày đã đếm tiền mặt | `storeId`, `date`, `countedBy` | unique (`storeId`,`date`) |
| `StaffActivity` | Nhật ký nhân viên quản lý | `storeId`, `userName`, `action`, `summary` | **TTL 30 ngày** |
| `AiUsage` | Token từng lần gọi AI theo chức năng | `feature`, `actor`, `tokens`, `model` | **TTL 400 ngày** |
| `AiCall` | Từng lần gọi API Gemini (đếm free) | `day` (Pacific), `keyTag` (băm), `model`, `status`, tokens | **TTL 10 ngày** |
| `AssistantLog` | Câu hỏi trợ lý cửa hàng | `question`, `status` | **TTL 90 ngày** |
| `AnomalyRun` | Kết quả rà bất thường | `from`, `to`, `items`, `byStaff`, `summary` | **TTL 120 ngày** |
| `AnomalyResolved` | Bất thường đã xử lý | `key`, `by` | **TTL 120 ngày** |
| `AuditLog` | Nhật ký thao tác | `actorKind`, `actorName`, `action`, `targetType/Id`, `before`, `after` | `action`, `createdAt` (không TTL – dọn tay) |
| `AdminLoginSession` | Phiên admin | `sid`, `accountId`, `deviceId`, `expiresAt`, `revokedAt` | **TTL tại `expiresAt`** |
| `AdminActivity` | Hoạt động admin (không gồm Admin Tổng) | `sid`, `adminName`, `action`, `summary`, `storeId` | **TTL 7 ngày** |

---

## 7. Cron jobs

Khai báo trong `vercel.json`, bảo vệ bằng `isCronAuthorized()` (header `Authorization: Bearer <CRON_SECRET>`).

| Path | Lịch UTC | Giờ VN | Việc |
| --- | --- | --- | --- |
| `/api/cron/publish-payroll` | `0 17 4 * *` | 00:00 ngày 5 | `autoPublishPayrolls()` – công bố bảng lương tháng trước (bỏ qua tháng đã mở khoá) + audit |
| `/api/cron/hourly` | `0 18 * * *` | 01:00 hằng ngày | `markMissingCheckouts` → `retryPendingPhotos` → `ensureDraftPayrolls` → `autoPublishPayrolls` (dự phòng) → `retryFailedClosings` → `migrateDayCalc` → `syncPendingDays` → `runScheduledReports` → `ensureTtlIndexes` → `runDailyAnomaly` → `runAutoCleanup` |

Tên "hourly" là vì thiết kế ban đầu chạy mỗi giờ; gói Vercel Hobby chỉ cho 1 lần/ngày nên hiện chạy lúc 01:00 VN. Các bước sau dùng `.catch` để một bước lỗi không chặn cả cron. `preferredRegion = "sin1"`, `maxDuration = 60`.

---

## 8. Kiểm thử

- Chạy: `npm test` → `tsx --test` với danh sách file khai báo trong `package.json` (thêm file test mới phải thêm vào script). Kiểu: `npm run typecheck`.
- Test chủ yếu cho **hàm thuần** (không DB): công thức, định dạng, thuật toán.

| File | Phạm vi |
| --- | --- |
| `calc.test.ts` | Giờ công, làm tròn, muộn / sớm, khoảng cách, múi giờ |
| `salary.test.ts` | Hình thức lương theo tháng |
| `schedule.test.ts` | Xếp ca tự động, định mức |
| `telegram.test.ts` | Gửi ảnh / album / lỗi Telegram (fetch giả) |
| `revenue.test.ts` | Biểu thức tiền, chuẩn hoá OCR, luỹ kế, ô sheet |
| `sheets-key.test.ts` | Chuẩn hoá private key service account |
| `attendance-board.test.ts` | Bảng chấm công theo ca |
| `finance.test.ts` | Lãi lỗ, phân bổ chi phí |
| `cleanup.test.ts` | Danh mục dọn, loại tự dọn an toàn, mốc giữ 2 tháng |
| `attendance-import.test.ts` | Nhập chấm công từ Excel / AI |
| `activity.test.ts` | Mô tả hoạt động admin |
| `checkin-methods.test.ts` | Cách xác thực, so IP WiFi |
| `gemini-keys.test.ts` | Đọc nhiều key Gemini |
| `permissions.test.ts` | Quyền admin / nhân viên |
| `anomaly.test.ts` | Phát hiện bất thường |
| `ai.test.ts` | Cấu hình / giới hạn AI |
| `forecast.test.ts` | Dự báo số người |
| `rules-format.test.ts` | Định dạng nội quy |
| `calc-expr.test.ts` | Máy tính biểu thức tiền |
| `ask-pick.test.ts` | Trợ lý AI admin – dò tên nhân viên, số tiền |
| `goods.test.ts` | Bộ đọc tin nhận hàng |
| `cashbook.test.ts` | Sổ quỹ |
| `live-badges.test.ts` | Badge nhân viên đang làm |
| `weather.test.ts` | Thời tiết |
| `seniority.test.ts` | Thâm niên |

`scripts/demo-ai.ts` là kịch bản thử tích hợp AI trên MongoDB cục bộ (không phải unit test).

---

## 9. Quy ước code

- **Server actions** của admin nằm ở `src/app/admin/actions/*.ts` (`"use server"`), chữ ký `(prev: FormState, fd: FormData) => Promise<FormState>` với `FormState = { ok?: boolean; error?: string } | null`. Đọc form bằng `num()`, `dec()`, `str()`; bắt lỗi bằng `errMsg(e)`. Đầu action gọi guard (`assertAdmin` / `assertOwner` / `assertPerm`) và cuối thường gọi `audit()` + `revalidatePath`.
- **`ActionForm`** (`src/components/ActionForm.tsx`) bọc `useActionState`, hiện `Alert` lỗi / thành công; `confirm` dùng `ConfirmDialog` của app (không dùng `window.confirm`).
- **Route handlers** (`src/app/api`) dùng `HttpError` + `jsonError()` (`lib/api.ts`), validate body bằng `zod`.
- **Thời gian**: luôn dùng helper trong `src/lib/time.ts` (`localDate`, `localMonth`, `localTime`, `zonedToDate`, `addDays`, `weekStartOf`…) với múi giờ của cơ sở (`Store.timezone`, mặc định `DEFAULT_TZ`) – không phụ thuộc múi giờ máy chủ. Ngày nghiệp vụ là chuỗi `YYYY-MM-DD`.
- **Tiền**: số nguyên VND. Ô nhập cho phép biểu thức: `evalMoneyExpr` (`lib/revenue.ts`, cho chốt ca: "10000 + 20k", "30k sữa chua + 20k ship") và `evalCalc` (`lib/calc-expr.ts`, có × ÷ %, "1tr2"). Không dùng `eval`.
- **Hàm thuần tách riêng để test** (`calc.ts`, `revenue.ts`, `finance.ts`, `schedule.ts`, `anomaly.ts`, `goods.ts`…); phần đụng DB ở file `*-server.ts` / `*-data.ts` hoặc module riêng.
- **Mongoose**: `getModel()` tránh khai báo lại model khi hot-reload; luôn `await connectDB()` trước truy vấn; `.lean()` cho đọc.
- **Chống xử lý 2 lần**: `lockedAt` trên yêu cầu, `findOneAndUpdate` có điều kiện, unique index.
- **Bí mật**: dữ liệu nhạy cảm (STK, refresh token) mã hoá bằng `encrypt()`; không log API key (`redactKeys`).
- **Region**: route gọi Gemini đặt `export const preferredRegion = "sin1"`; route nặng `export const maxDuration = 60`.
- **UI tiếng Việt** toàn bộ (nhãn, thông báo lỗi, comment code phần lớn cũng tiếng Việt); Tailwind v4 với màu theme (`bg-primary`, `text-accent`, `text-ink`…) trong `globals.css`; icon `lucide-react`.
- Ghi chú "spec x.y" trong code tham chiếu tài liệu đặc tả `SPEC_cham_cong.md` (không có trong repo).

---

## 10. Hạn chế đã biết / việc còn lại

Theo README ("Chưa làm – Phase 3 / P2 còn lại"):

- Thông báo email / push (hiện chỉ có Telegram + thông báo trong app).
- Nghỉ phép (đổi ca / làm hộ **đã có** qua `CoverRequest`).
- Chế độ kiosk (máy chấm công dùng chung).
- Thống kê biểu đồ (hiện mới có biểu đồ tròn chi phí ở Lãi lỗ).
- Đa ngôn ngữ.
- PDF bảng lương.

Hạn chế / nợ kỹ thuật quan sát được trong code:

- Cron "hourly" thực chất chạy 1 lần/ngày (giới hạn Vercel Hobby) → quên check-out, gửi lại Telegram, ghi lại sheet có độ trễ tới ~24h.
- Tab tháng mới trên Google Sheet phải tạo tay; app không tự tạo.
- Kiểm tra WiFi dựa trên IP public – IP quán đổi / iCloud Private Relay / VPN gây từ chối nhầm.
- Khuôn mặt chỉ phát hiện, không xác minh danh tính (đối chiếu bằng ảnh lưu Drive + ràng buộc thiết bị + GPS).
- Bộ đếm "cặp key × model vừa hết lượt" của Gemini chỉ nằm trong bộ nhớ 1 instance serverless.
- Còn file / trường di sản: `src/lib/dev-auth.ts`, `src/lib/local-mongo.ts`, `src/app/dev-login/`, `src/app/api/dev-logout/`, `scripts/seed-mock.ts` (đều ghi "Đã gỡ – xoá file này"); `Settings.adminPasswordHash` + `scripts/set-admin-password.ts` (đăng nhập mật khẩu đã bỏ); `FaceProfile`, `Settings.faceMatchThreshold`, model `face_recognition` / `face_landmark_68` trong `public/models` (không còn so khớp khuôn mặt).
- `npm run lint` gọi `next lint` nhưng `devDependencies` không có `eslint` / `eslint-config-next`.
- Danh sách test trong script `npm test` phải cập nhật tay.
