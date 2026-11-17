/*
 * Chính sách quyền riêng tư: Admin Tổng soạn bằng Markdown (Cài đặt → Quyền riêng tư), lưu ở Settings.
 *  - privacyVersion = 0: chưa phát hành → trang /privacy báo "chưa có", không bắt nhân viên đồng ý.
 *  - Phát hành bản mới (version + 1) → nhân viên có User.privacyVersion < bản hiện tại phải đồng ý lại mới chấm công được.
 *  - "Lưu sửa nhỏ" giữ nguyên số phiên bản (sửa lỗi chính tả, thông tin liên hệ…).
 */

/** Mẫu gợi ý khi chưa soạn – Admin Tổng điền phần [ … ] rồi phát hành. */
export const PRIVACY_TEMPLATE = `# Chính sách quyền riêng tư

> **Tóm tắt:** app chỉ lưu những gì cần để **chấm công, xếp ca, trả lương**. Ảnh và vị trí chỉ lấy **lúc bạn bấm chấm công**, ảnh không lưu lại. Nghỉ việc thì dữ liệu cá nhân được xoá trong 7 ngày.

## 1. Ai giữ dữ liệu của bạn
Tiệm Bơ Sầu – [tên hộ kinh doanh / công ty, địa chỉ].
Người phụ trách: [họ tên, SĐT / Zalo].

## 2. Dữ liệu thu và mục đích
| Dữ liệu | Để làm gì |
|---|---|
| Ảnh khuôn mặt lúc chấm công | Xác nhận đúng người |
| Vị trí GPS / IP WiFi lúc bấm | Xác nhận đang ở quán |
| Mã thiết bị, trình duyệt | Chặn chấm công hộ |
| Họ tên, SĐT, Gmail | Liên hệ, xếp ca |
| STK ngân hàng (mã hoá) | Chuyển lương |

## 3. Lưu ở đâu, bao lâu
Dữ liệu lưu trên **MongoDB** và **Vercel** – máy chủ đặt ở **nước ngoài**.
- **Ảnh chấm công:** không lưu – chụp chỉ để xác nhận.
- **Nhật ký đăng nhập:** 180 ngày rồi tự xoá.
- **Khi nghỉ việc:** xoá dữ liệu cá nhân trong **7 ngày**.

## 4. Chia sẻ cho ai
Chỉ chủ quán và admin được phân quyền xem. App gửi **tên + giờ chấm công** vào nhóm Telegram quản lý.
Không bán, không cho thuê, không dùng để quảng cáo.

## 5. Quyền của bạn
- **Xem** thông tin cá nhân của mình ở Tài khoản.
- **Sửa** SĐT, STK ở Tài khoản.
- **Rút đồng ý / xin xoá** dữ liệu: báo người phụ trách ở mục 1. Rút đồng ý ảnh & vị trí thì không chấm công trên app được nữa.
- **Khiếu nại** với người phụ trách ở mục 1.

## 6. Bảo vệ dữ liệu
Đăng nhập bằng Google; STK ngân hàng được mã hoá; mọi thao tác của admin đều ghi nhật ký; admin chỉ thấy phần được Admin Tổng cấp quyền.

## 7. Thay đổi chính sách
Khi đổi chính sách, app hiện thông báo và xin bạn đồng ý lại trước khi chấm công.
`;

export const PRIVACY_MAX = 50_000;

type PrivacySettings = { privacyVersion?: number | null };
type PrivacyUser = { privacyVersion?: number | null };

/** Nhân viên cần đồng ý (lại) chính sách hiện tại mới được chấm công. */
export function needsPrivacyConsent(s: PrivacySettings, u: PrivacyUser) {
  const v = s.privacyVersion ?? 0;
  return v > 0 && (u.privacyVersion ?? 0) < v;
}
