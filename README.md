# Tiệm Bơ Sầu – Chấm công bằng khuôn mặt

Next.js 15 (App Router) + MongoDB + Google Drive (lưu ảnh). Code theo `SPEC_cham_cong.md` v1.1.

## Tính năng đã có

| Nhóm | Chức năng | Spec |
|---|---|---|
| Nhân viên | Đăng nhập Google, đăng ký cơ sở + chụp ảnh khuôn mặt mẫu, chờ duyệt | 4.1 |
| | Ràng buộc thiết bị (deviceId cookie + localStorage + fingerprint), yêu cầu đổi thiết bị | 4.1.1 |
| | Chấm công: kiểm tra thiết bị → GPS (bán kính, sai số) → camera + chớp mắt (liveness) + so khớp khuôn mặt → giờ server | 4.2 |
| | Làm tròn giờ công (bước 0,5h, làm tròn xuống, có tuỳ chọn dung sai), cảnh báo đi muộn / về sớm theo ca | 4.3, 4.4 |
| | Xem chấm công tháng, lịch ca, bảng lương (sau khi công bố), gửi yêu cầu điều chỉnh, khiếu nại lương | 4.5, 4.6 |
| | Đăng ký ca theo tuần (chỉ tuần tương lai), xem lịch của mình dạng bảng ca × ngày theo tuần / tháng | 4.7 |
| Admin | Đăng nhập: Chủ bằng Google, admin khác bằng **mật khẩu chung** + tên hiển thị; đổi mật khẩu (đăng xuất mọi phiên cũ); Chủ đặt lại mật khẩu | 2.1 |
| | Dashboard hôm nay, duyệt đăng ký (+ thiết bị đầu tiên), nhân viên (lương giờ có ngày hiệu lực), thiết bị + cảnh báo nghi chấm hộ | 3.1, 3.3 |
| | Cơ sở (3 cơ sở tạo sẵn), ca mẫu (hỗ trợ qua đêm), xếp ca hàng loạt, copy tuần trước | 1.2, 3.2, 3.4 |
| | **Xếp ca tự động**: lịch tuần theo mẫu, duyệt đăng ký (từng ca / từng người / tất cả), xếp tay, định mức người/ca, xếp tự động có xem trước (ít ca nhất, hay làm ca, hay làm cùng), tổng hợp số ca & cảnh báo thiếu người | 3.2.1 |
| | Bảng chấm công theo mẫu, tổng hợp tháng, chấm hộ, sửa / xoá có lịch sử, "Thêm phạt" từ dòng muộn/sớm | 5, 3.5, 7.1 |
| | Thưởng / phạt nhập tự do (VND), bảng lương (phụ cấp, tạm ứng), công bố sớm / tự công bố 00:00 ngày 5, khoá tháng, mở khoá | 3.6, 3.7 |
| | Xuất Excel 7 loại báo cáo (header vàng/nâu, freeze, filter, dòng tổng, tô màu) + audit log | 3.8 |
| | **Chốt ca**: nhân viên chụp ảnh cuối ca (camera sau, tối đa 4 ảnh) → gửi album vào nhóm Telegram của cơ sở; admin xem / gửi lại; webhook cho hệ thống phân tích ảnh | – |
| | Cài đặt: kết nối Google Drive, cấu hình làm tròn / ngưỡng / số thiết bị…, lịch sử đăng nhập admin, nhật ký thao tác | 2.1 |
| Hệ thống | Cron: quên check-out, upload lại ảnh lỗi, tạo bảng lương nháp, công bố ngày 5 | 6.1 |

**Chưa làm (Phase 3 / P2 còn lại):** thông báo (email/push), nghỉ phép / đổi ca, chế độ kiosk, thống kê biểu đồ, đa ngôn ngữ, PDF bảng lương.

## Cài đặt

### 1. Yêu cầu
- Node.js **20.9+** (khuyến nghị 22 LTS – đã test 22). Kiểm tra: `node -v`
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
2. **Cài đặt** → đặt mật khẩu admin chung → **Kết nối Google Drive**.
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
    admin/login/       # đăng nhập admin (mật khẩu chung / Google của Chủ)
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
- **Nhận diện khuôn mặt** chạy trên trình duyệt (`@vladmandic/face-api`: TinyFaceDetector + 68 landmarks + FaceRecognitionNet). Server so khoảng cách descriptor với ảnh mẫu (ngưỡng mặc định 0,5). Liveness: bắt buộc chớp mắt (EAR). Không có chức năng upload ảnh.
- **Chống chấm trùng**: unique partial index "1 lượt OPEN / nhân viên" + check-out dùng `findOneAndUpdate` có điều kiện + chặn check-out trong N phút sau check-in.
- **Làm tròn**: mặc định làm tròn xuống tuyệt đối (14h55' → 14,5). Dữ liệu sheet cũ có dung sai ~5 phút (14h55' → 15) → chỉnh "Dung sai làm tròn" trong Cài đặt nếu muốn giữ cách cũ.
- **Khoá tháng**: bảng lương đã công bố/đã trả → không chấm hộ, sửa chấm công, thêm/xoá thưởng phạt cho tháng đó. Mở khoá thì cron ngày 5 không tự công bố lại.
- **Ảnh**: upload Drive của Chủ theo `/TBS Chấm công/{Cơ sở}/{Nhân viên}/{YYYY-MM}/`. Mất kết nối → giữ tạm trong MongoDB, cron upload lại.
