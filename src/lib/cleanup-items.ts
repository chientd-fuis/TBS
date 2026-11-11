/* Danh mục các loại dữ liệu có thể dọn – dùng chung cho server + giao diện (không import database). */

export const CLEANUP_KEYS = [
  "loginLogs",
  "auditLogs",
  "adjustLogs",
  "photos",
  "notices",
  "requests",
  "payrollFeedback",
  "reportLogs",
  "stuckPhotos",
  "devices",
  "junkUsers",
  "faces",
  "orphans",
  "metaData",
  "activityLogs",
  "aiLogs",
  "anomalyLogs",
  "sessions",
  "unusedCollections",
  "attendance",
] as const;
export type CleanupKey = (typeof CLEANUP_KEYS)[number];

export type CleanupItem = {
  key: CleanupKey;
  label: string;
  hint?: string;
  group: "log" | "request" | "account" | "photo" | "data";
  /** mặc định được tick */
  on: boolean;
  /** an toàn → được chạy trong lần dọn tự động hằng tháng */
  auto: boolean;
};

export const CLEANUP_ITEMS: CleanupItem[] = [
  { key: "loginLogs", group: "log", on: true, auto: true, label: "Lịch sử đăng nhập", hint: "Nhân viên + admin" },
  { key: "auditLogs", group: "log", on: true, auto: false, label: "Nhật ký thao tác admin" },
  { key: "adjustLogs", group: "log", on: false, auto: false, label: "Lịch sử sửa chấm công", hint: "Ai sửa giờ, lúc nào – nên giữ nếu còn đối soát" },
  { key: "activityLogs", group: "log", on: true, auto: true, label: "Nhật ký hoạt động admin & quản lý cơ sở", hint: "Lịch sử 7 ngày của admin, nhật ký thao tác của nhân viên quản lý" },
  { key: "aiLogs", group: "log", on: true, auto: true, label: "Nhật ký AI", hint: "Số token từng lần gọi, lượt gọi Gemini, câu hỏi trợ lý – chỉ để thống kê" },
  { key: "anomalyLogs", group: "log", on: true, auto: true, label: "Kết quả AI soát bất thường cũ", hint: "Các lần quét chốt ca & két, mục đã đánh dấu xử lý" },
  { key: "sessions", group: "account", on: true, auto: true, label: "Phiên đăng nhập admin đã hết hạn / đã đăng xuất", hint: "Không ảnh hưởng admin đang đăng nhập (mọi tháng)" },
  { key: "reportLogs", group: "log", on: true, auto: true, label: "Nhật ký gửi báo cáo Telegram", hint: "Chỉ dùng để chống gửi trùng" },
  { key: "notices", group: "request", on: true, auto: true, label: "Thông báo của nhân viên", hint: "Thông báo cũ + thông báo đã đọc quá 30 ngày" },
  { key: "requests", group: "request", on: true, auto: true, label: "Yêu cầu đã xử lý xong", hint: "Nhờ làm hộ, sửa công, đăng ký ca, ca bị từ chối · đơn chờ duyệt mà ca đã qua → hết hạn" },
  { key: "payrollFeedback", group: "request", on: true, auto: true, label: "Phản hồi lương đã giải quyết", hint: "Của các tháng cũ" },
  { key: "devices", group: "account", on: true, auto: false, label: "Thiết bị cũ", hint: "Bị từ chối / thu hồi, thiết bị của nhân viên đã nghỉ" },
  { key: "junkUsers", group: "account", on: false, auto: false, label: "Tài khoản rác", hint: "Đăng ký mới bỏ dở / bị từ chối, chưa từng chấm công – xoá kèm thiết bị, khuôn mặt" },
  { key: "faces", group: "account", on: true, auto: false, label: "Dữ liệu khuôn mặt của người đã nghỉ", hint: "Dữ liệu sinh trắc – đi làm lại thì đăng ký lại" },
  { key: "photos", group: "photo", on: true, auto: false, label: "Ảnh check-in / check-out & chốt ca", hint: "Bỏ liên kết ảnh + xoá ảnh tạm trong database" },
  { key: "stuckPhotos", group: "photo", on: true, auto: true, label: "Ảnh tải lên bị kẹt", hint: "Ảnh tạm đã thử tải lên Drive 20 lần vẫn lỗi (mọi tháng)" },
  { key: "orphans", group: "data", on: true, auto: true, label: "Dữ liệu mồ côi (mọi tháng)", hint: "Doanh thu ngày không còn chốt ca, ca / thông báo / thiết bị của người hoặc cơ sở đã bị xoá" },
  { key: "metaData", group: "data", on: true, auto: true, label: "Dữ liệu phụ của chốt ca, chi phí & nhận hàng", hint: "Kết quả AI đọc ảnh, mã tin nhắn Telegram – giữ nguyên số liệu" },
  {
    key: "attendance",
    group: "data",
    on: false,
    auto: false,
    label: "Chấm công cũ (giữ thâm niên & tổng công)",
    hint: "Chỉ tháng cũ hơn 3 tháng ĐÃ TRẢ lương. Lưu lại tổng ngày / giờ công từng tháng + ngày đi làm đầu tiên rồi mới xoá; mất giờ vào / ra từng ngày của các tháng đó",
  },
  { key: "unusedCollections", group: "data", on: false, auto: false, label: "Bảng không còn dùng", hint: "Bảng cũ trong database app không còn đọc / ghi (bản cũ để lại) – xoá hẳn cả bảng, mọi tháng" },
];

export const GROUP_LABEL: Record<CleanupItem["group"], string> = {
  log: "Nhật ký",
  request: "Yêu cầu & thông báo",
  account: "Tài khoản & thiết bị",
  photo: "Ảnh",
  data: "Dữ liệu khác",
};

/** Kết quả từng loại: tổng + chi tiết (label, số). */
export type CleanupPart = { total: number; parts: [string, number][]; warn?: string };
export type CleanupCounts = Partial<Record<CleanupKey, CleanupPart>> & { driveFolders?: number; driveRemaining?: number };

/** Tự xoá (TTL index MongoDB) – hiển thị cho người dùng biết. */
export const TTL_RULES = [
  { label: "Lịch sử đăng nhập", days: 180 },
  { label: "Thông báo nhân viên đã đọc", days: 30 },
  { label: "Nhật ký gửi báo cáo", days: 180 },
  { label: "Lượt gọi Gemini", days: 10 },
  { label: "Hoạt động admin", days: 7 },
  { label: "Nhật ký quản lý cơ sở", days: 30 },
  { label: "Câu hỏi trợ lý", days: 90 },
  { label: "AI soát bất thường", days: 120 },
  { label: "Nhật ký token AI", days: 400 },
];

export const fmtBytes = (b: number) =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;

/** Các loại an toàn chạy trong lần tự dọn hằng tháng. */
export const AUTO_KEYS_UI: CleanupKey[] = CLEANUP_ITEMS.filter((i) => i.auto).map((i) => i.key);
