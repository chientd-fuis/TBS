import {
  BadgeCheck,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  FileSpreadsheet,
  Gift,
  Inbox,
  LayoutDashboard,
  Package,
  PiggyBank,
  Receipt,
  Settings,
  ShieldCheck,
  Store,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/** 1 trang trong menu. perm: cần 1 trong các quyền; owner: chỉ Admin Tổng; badge: khoá số đếm (chờ duyệt…) */
export type NavLink = { href: string; label: string; perm?: readonly string[]; owner?: boolean; badge?: string };
/** 1 mục menu trái – có thể gộp nhiều trang (tabs = hiện thanh tab đầu trang để chuyển qua lại) */
export type NavGroup = { label: string; icon: LucideIcon; links: NavLink[]; tabs?: boolean };

export const NAV: NavGroup[] = [
  { label: "Tổng quan", icon: LayoutDashboard, links: [{ href: "/admin", label: "Tổng quan" }] },
  { label: "Lịch làm việc", icon: CalendarDays, links: [{ href: "/admin/work-schedule", label: "Lịch làm việc" }] },
  { label: "Xếp ca tự động", icon: CalendarRange, links: [{ href: "/admin/schedule", label: "Xếp ca tự động", badge: "shiftRequests" }] },
  { label: "Thưởng / Phạt", icon: Gift, links: [{ href: "/admin/bonus-penalty", label: "Thưởng / Phạt" }] },
  { label: "Chấm công", icon: ClipboardList, links: [{ href: "/admin/attendance", label: "Chấm công" }] },
  { label: "Nhân viên", icon: Users, links: [{ href: "/admin/employees", label: "Nhân viên" }] },
  { label: "Bảng lương", icon: Wallet, links: [{ href: "/admin/payroll", label: "Bảng lương", perm: ["payroll"] }] },
  {
    label: "Duyệt đăng ký",
    icon: BadgeCheck,
    tabs: true,
    links: [
      { href: "/admin/approvals", label: "Duyệt đăng ký", badge: "approvals" },
      { href: "/admin/devices", label: "Thiết bị", badge: "devices" },
    ],
  },
  { label: "Yêu cầu", icon: Inbox, links: [{ href: "/admin/requests", label: "Yêu cầu", badge: "requests" }] },
  { label: "Tài chính", icon: PiggyBank, links: [{ href: "/admin/finance", label: "Tài chính", perm: ["finance.shiftExpenses", "finance.bills", "finance.rent", "finance.settings"] }] },
  { label: "Chốt ca", icon: Receipt, links: [{ href: "/admin/closings", label: "Chốt ca" }] },
  {
    // các trang này đã có thanh tab riêng (GoodsTabs – kèm trạng thái Tồn kho tắt / bật)
    label: "Hàng hoá, nguyên liệu",
    icon: Package,
    links: [
      { href: "/admin/goods", label: "Nhận hàng", perm: ["goods"] },
      { href: "/admin/goods/stock", label: "Tồn kho", perm: ["goods"] },
      { href: "/admin/goods/items", label: "Nguyên liệu & giá nhập", perm: ["goods"] },
      { href: "/admin/goods/report", label: "Tổng hợp hàng nhập", perm: ["goods"] },
    ],
  },
  {
    label: "Ca làm việc",
    icon: CalendarClock,
    tabs: true,
    links: [
      { href: "/admin/shifts", label: "Ca làm việc" },
      { href: "/admin/holidays", label: "Ngày lễ" },
    ],
  },
  { label: "Xuất Excel", icon: FileSpreadsheet, links: [{ href: "/admin/export", label: "Xuất Excel", perm: ["export"] }] },
  { label: "Cơ sở", icon: Store, links: [{ href: "/admin/stores", label: "Cơ sở", perm: ["stores"] }] },
  {
    label: "Quản lý admin",
    icon: ShieldCheck,
    tabs: true,
    links: [
      { href: "/admin/admins", label: "Quản lý admin", owner: true },
      { href: "/admin/activity", label: "Hoạt động admin", perm: ["activity"] },
    ],
  },
  { label: "Cài đặt", icon: Settings, links: [{ href: "/admin/settings", label: "Cài đặt" }] },
];

export type NavAccess = { owner: boolean; perms: readonly string[]; hide: readonly string[] };

/** Trang admin này được thấy không (quyền + chức năng đang tắt) */
export const canSee = (l: NavLink, a: NavAccess) =>
  !a.hide.some((h) => l.href === h || l.href.startsWith(`${h}/`)) && (a.owner || (!l.owner && (!l.perm || l.perm.some((p) => a.perms.includes(p)))));

/** đường dẫn hiện tại thuộc trang này (kể cả trang con) */
export const onPage = (path: string, href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));

/** trang con đang mở trong nhóm: khớp đường dẫn dài nhất (VD /admin/goods/items không tính là /admin/goods) */
export const activeLink = (path: string, links: NavLink[]) =>
  links.filter((l) => onPage(path, l.href)).sort((a, b) => b.href.length - a.href.length)[0];
