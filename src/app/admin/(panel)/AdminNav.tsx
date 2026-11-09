"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
  CalendarClock,
  CalendarHeart,
  CalendarRange,
  ClipboardList,
  History,
  FileSpreadsheet,
  Gift,
  Inbox,
  Receipt,
  LayoutDashboard,
  PiggyBank,
  Settings,
  ShieldCheck,
  Smartphone,
  Store,
  Users,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/format";

const items = [
  { href: "/admin", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/admin/schedule", label: "Xếp ca tự động", icon: CalendarRange, badge: "shiftRequests" },
  { href: "/admin/bonus-penalty", label: "Thưởng / Phạt", icon: Gift },
  { href: "/admin/attendance", label: "Chấm công", icon: ClipboardList },
  { href: "/admin/employees", label: "Nhân viên", icon: Users },
  { href: "/admin/payroll", label: "Bảng lương", icon: Wallet, perm: ["payroll"] },
  { href: "/admin/approvals", label: "Duyệt đăng ký", icon: BadgeCheck, badge: "approvals" },
  { href: "/admin/requests", label: "Yêu cầu", icon: Inbox, badge: "requests" },
  { href: "/admin/finance", label: "Tài chính", icon: PiggyBank, perm: ["finance.shiftExpenses", "finance.bills", "finance.rent", "finance.settings"] },
  { href: "/admin/closings", label: "Chốt ca", icon: Receipt },
  { href: "/admin/shifts", label: "Ca làm việc", icon: CalendarClock },
  { href: "/admin/holidays", label: "Ngày lễ", icon: CalendarHeart },
  { href: "/admin/devices", label: "Thiết bị", icon: Smartphone, badge: "devices" },
  { href: "/admin/export", label: "Xuất Excel", icon: FileSpreadsheet, perm: ["export"] },
  { href: "/admin/stores", label: "Cơ sở", icon: Store, perm: ["stores"] },
  { href: "/admin/activity", label: "Hoạt động admin", icon: History, perm: ["activity"] },
  { href: "/admin/admins", label: "Quản lý admin", icon: ShieldCheck, owner: true },
  { href: "/admin/settings", label: "Cài đặt", icon: Settings },
] as const;

export default function AdminNav({ counts, owner = false, perms = [] }: { counts: Record<string, number>; owner?: boolean; perms?: string[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible lg:px-3">
      {items.filter((it) => owner || (!("owner" in it) && (!("perm" in it) || it.perm.some((p) => perms.includes(p))))).map(({ href, label, icon: Icon, ...rest }) => {
        const active = href === "/admin" ? path === "/admin" : path.startsWith(href);
        const n = "badge" in rest ? counts[rest.badge] : 0;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm whitespace-nowrap",
              active ? "bg-primary font-bold text-ink" : "text-white/90 hover:bg-white/10",
            )}
          >
            <Icon size={17} />
            <span className="flex-1">{label}</span>
            {n > 0 && <span className="rounded-full bg-danger px-1.5 text-xs font-bold text-white">{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
