import { can } from "./permissions";
import type { AdminSession } from "./admin-session";

/**
 * Các khối trên trang Tổng quan admin. Mỗi admin tự chọn hiện / ẩn (Cài đặt → Trang Tổng quan hiển thị gì),
 * nhưng chỉ trong phạm vi quyền: khối cần quyền mà admin không có thì không hiện và không có trong danh sách chọn.
 * Lưu danh sách khối BỊ ẨN (AdminPref.dashHidden) → khối mới thêm sau này mặc định hiện.
 */
export const DASH_WIDGETS = [
  { key: "quick", label: "Nút nhanh: Nhập chi phí / Nhận hàng", hint: "Góc phải tiêu đề" },
  { key: "todo", label: "Việc cần xác nhận", hint: "Yêu cầu chờ duyệt, ai cần xác nhận" },
  { key: "anomaly", label: "Bất thường chốt ca & két", hint: "Chỉ Admin Tổng", owner: true },
  { key: "payTotal", label: "Tổng lương tạm tính tất cả cơ sở", perm: "payEstimate" },
  { key: "stores", label: "Thẻ từng cơ sở: ca hôm nay · đang làm · đi muộn · chưa đến", hint: "Tắt = ẩn cả các mục con bên dưới" },
  { key: "weather", label: "↳ Cảnh báo thời tiết – nên giảm ca", hint: "Cần bật thời tiết trong Cài đặt AI" },
  { key: "storePay", label: "↳ Lương tạm tính từng cơ sở", perm: "payEstimate" },
  { key: "people", label: "↳ Danh sách đang làm / chưa check-in" },
  { key: "staffActs", label: "↳ Nhân viên quản lý đã thao tác (7 ngày)" },
  { key: "missing", label: "↳ Số lượt quên check-out cần xử lý" },
  { key: "activity", label: "Hoạt động admin hôm nay & hôm qua", perm: "activity" },
] as const satisfies readonly { key: string; label: string; hint?: string; perm?: string; owner?: boolean }[];

export type DashKey = (typeof DASH_WIDGETS)[number]["key"];

/** Khối admin này được phép thấy (theo quyền) */
export function allowedWidgets(admin: AdminSession) {
  return DASH_WIDGETS.filter((w) => ("owner" in w && w.owner ? admin.kind === "OWNER" : "perm" in w && w.perm ? can(admin, w.perm as Parameters<typeof can>[1]) : true));
}

/** Hàm kiểm tra 1 khối có hiện không: đủ quyền + không bị admin ẩn */
export function widgetShown(admin: AdminSession, hidden: string[] | null | undefined) {
  const ok = new Set<string>(allowedWidgets(admin).map((w) => w.key));
  const off = new Set(hidden ?? []);
  return (k: DashKey) => ok.has(k) && !off.has(k);
}
