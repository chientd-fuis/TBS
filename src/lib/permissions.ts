/*
 * Phân quyền.
 *  - Admin Tổng (Google): toàn quyền.
 *  - Admin (đăng nhập Gmail được Admin Tổng thêm / duyệt): mặc định KHÔNG có các quyền dưới đây – Admin Tổng cấp thêm từng quyền.
 *    Lãi lỗ và Quản lý admin: CHỈ Admin Tổng. Doanh thu theo ngày / Sổ quỹ: cấp được quyền XEM (sửa / ghi phiếu chỉ Admin Tổng).
 *  - Nhân viên: admin cấp quyền quản lý (xếp ca / thưởng-phạt / duyệt đổi ca-làm hộ) trong các cơ sở được giao.
 */
export const ADMIN_PERMS = [
  { key: "adjustments", label: "Duyệt yêu cầu chấm công bù (nhân viên gửi)", group: "Chấm công" },
  { key: "finance.shiftExpenses", label: "Tài chính – Chi phí trong ca", group: "Tài chính" },
  { key: "finance.bills", label: "Tài chính – Bill / chuyển khoản", group: "Tài chính" },
  { key: "finance.rent", label: "Tài chính – Tiền thuê nhà", group: "Tài chính" },
  { key: "finance.revenue", label: "Tài chính – Xem doanh thu theo ngày (không sửa)", group: "Tài chính" },
  { key: "finance.cashbook", label: "Tài chính – Xem sổ quỹ (không ghi phiếu)", group: "Tài chính" },
  { key: "finance.cashcount", label: "Tài chính – Sổ quỹ: xem số tiền thực tế đã lấy & Đếm tiền (cần thêm quyền xem sổ quỹ)", group: "Tài chính" },
  { key: "finance.settings", label: "Tài chính – Cài đặt", group: "Tài chính" },
  { key: "payroll", label: "Bảng lương", group: "Lương" },
  { key: "payEstimate", label: "Lương tạm tính ở Tổng quan", group: "Lương" },
  { key: "goods", label: "Nhận hàng / tồn kho các cơ sở (xem / nhập)", group: "Hàng hoá" },
  { key: "goods.items", label: "Nguyên liệu & giá nhập (thêm / sửa / xoá món, giá)", group: "Hàng hoá" },
  { key: "goods.report", label: "Tổng hợp hàng nhập (tiền nhập / tiêu thụ từng cơ sở)", group: "Hàng hoá" },
  { key: "export", label: "Xuất Excel", group: "Khác" },
  { key: "stores", label: "Cơ sở (cài đặt cơ sở)", group: "Khác" },
  { key: "activity", label: "Hoạt động admin", group: "Khác" },
] as const;
export type AdminPerm = (typeof ADMIN_PERMS)[number]["key"];
export const ADMIN_PERM_KEYS = ADMIN_PERMS.map((p) => p.key) as AdminPerm[];
export const FINANCE_PERMS: AdminPerm[] = ["finance.shiftExpenses", "finance.bills", "finance.rent", "finance.revenue", "finance.cashbook", "finance.settings"];
export const isAdminPerm = (v: unknown): v is AdminPerm => typeof v === "string" && (ADMIN_PERM_KEYS as string[]).includes(v);

type WithPerms = { kind: "OWNER" | "ADMIN"; perms?: readonly string[] };
/** Admin Tổng luôn có quyền; admin cần được cấp. */
export const can = (a: WithPerms | null | undefined, perm: AdminPerm) => !!a && (a.kind === "OWNER" || !!a.perms?.includes(perm));
export const canAny = (a: WithPerms | null | undefined, perms: AdminPerm[]) => perms.some((p) => can(a, p));

/* ---------- Quyền quản lý cho nhân viên ---------- */
export const STAFF_PERMS = [
  { key: "schedule", label: "Xếp ca tự động", hint: "Xếp ca / duyệt đăng ký ca ở cơ sở được giao" },
  { key: "bonus", label: "Thưởng / phạt", hint: "Tạo thưởng / phạt; chỉ sửa / xoá được cái mình tạo" },
  { key: "cover", label: "Duyệt đổi ca / làm hộ", hint: "Duyệt yêu cầu đổi ca, nhờ làm hộ ở cơ sở được giao" },
] as const;
export type StaffPerm = (typeof STAFF_PERMS)[number]["key"];
export const isStaffPerm = (v: unknown): v is StaffPerm => typeof v === "string" && STAFF_PERMS.some((p) => p.key === v);

/** Cơ sở nhân viên được quản lý: cơ sở gốc + cơ sở admin giao thêm. */
export function managedStoreIds(u: { storeId?: unknown; managerStoreIds?: unknown[] | null }) {
  return [...new Set([u.storeId, ...(u.managerStoreIds ?? [])].filter(Boolean).map(String))];
}
export const staffCan = (u: { managerPerms?: string[] | null } | null | undefined, perm: StaffPerm) => !!u?.managerPerms?.includes(perm);

