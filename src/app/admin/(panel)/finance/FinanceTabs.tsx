"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/format";

const TABS = [
  { href: "/admin/finance", label: "Lãi lỗ", owner: true },
  { href: "/admin/finance/revenue", label: "Doanh thu theo ngày" },
  { href: "/admin/finance/shift-expenses", label: "Chi phí trong ca" },
  { href: "/admin/finance/expenses", label: "Bill / chuyển khoản" },
  { href: "/admin/finance/fixed", label: "Tiền thuê nhà" },
  { href: "/admin/finance/settings", label: "Cài đặt", owner: true },
];

export default function FinanceTabs({ isOwner }: { isOwner: boolean }) {
  const path = usePathname();
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 ring-1 ring-[#f1e6c8]">
      {TABS.filter((t) => isOwner || !t.owner).map((t) => {
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
