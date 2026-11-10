import Link from "next/link";
import { cn } from "@/lib/format";
import { can, type AdminPerm } from "@/lib/permissions";

const TABS = [
  { key: "receive", href: "/admin/goods", label: "📦 Nhận hàng", perm: "goods" },
  { key: "stock", href: "/admin/goods/stock", label: "📋 Tồn kho", perm: "goods" },
  { key: "items", href: "/admin/goods/items", label: "🏷️ Nguyên liệu & giá", perm: "goods.items" },
  { key: "report", href: "/admin/goods/report", label: "📊 Tổng hợp hàng nhập", perm: "goods.report" },
] as const satisfies readonly { key: string; href: string; label: string; perm: AdminPerm }[];

/** chỉ hiện tab admin được cấp quyền (Nguyên liệu & giá, Tổng hợp là 2 quyền riêng) */
export default function GoodsTabs({ active, stockOn, admin }: { active: (typeof TABS)[number]["key"]; stockOn: boolean; admin: Parameters<typeof can>[0] }) {
  const tabs = TABS.filter((t) => can(admin, t.perm));
  if (tabs.length < 2) return null;
  return (
    <nav className="mb-4 flex flex-wrap gap-2">
      {tabs.map((t) => (
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
