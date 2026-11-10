import Link from "next/link";
import { cn } from "@/lib/format";

const TABS = [
  { key: "receive", href: "/admin/goods", label: "📦 Nhận hàng" },
  { key: "stock", href: "/admin/goods/stock", label: "📋 Tồn kho" },
  { key: "items", href: "/admin/goods/items", label: "🏷️ Nguyên liệu & giá" },
  { key: "report", href: "/admin/goods/report", label: "📊 Tổng hợp hàng nhập" },
] as const;

export default function GoodsTabs({ active, stockOn }: { active: (typeof TABS)[number]["key"]; stockOn: boolean }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-2">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={cn(
            "rounded-xl px-3 py-1.5 text-sm font-semibold ring-1",
            active === t.key ? "bg-secondary text-white ring-secondary" : "bg-white text-ink ring-[#e9d9a8] hover:bg-primary-light",
          )}
        >
          {t.label}
          {t.key === "stock" && !stockOn && <span className="ml-1 text-xs font-normal opacity-70">(đang tắt)</span>}
        </Link>
      ))}
    </nav>
  );
}
