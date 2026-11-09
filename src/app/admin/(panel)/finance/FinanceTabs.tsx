"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/format";

// owner = chỉ Admin Tổng; perm = quyền Admin Tổng cấp cho admin (lib/permissions.ts)
const TABS: { href: string; label: string; owner?: boolean; perm?: string }[] = [
  { href: "/admin/finance", label: "Lãi lỗ", owner: true },
  { href: "/admin/finance/revenue", label: "Doanh thu theo ngày", owner: true },
  { href: "/admin/finance/shift-expenses", label: "Chi phí trong ca", perm: "finance.shiftExpenses" },
  { href: "/admin/finance/expenses", label: "Bill / chuyển khoản", perm: "finance.bills" },
  { href: "/admin/finance/fixed", label: "Tiền thuê nhà", perm: "finance.rent" },
  { href: "/admin/finance/settings", label: "Cài đặt", perm: "finance.settings" },
];

export default function FinanceTabs({ isOwner, perms = [] }: { isOwner: boolean; perms?: string[] }) {
  const path = usePathname();
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 ring-1 ring-[#f1e6c8]">
      {TABS.filter((t) => isOwner || (!t.owner && (!t.perm || perms.includes(t.perm)))).map((t) => {
        const active = t.href === "/admin/finance" ? path === t.href : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn("shrink-0 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap", active ? "bg-secondary font-bold text-white" : "text-ink/70 hover:bg-primary-light")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
