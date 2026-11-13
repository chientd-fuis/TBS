"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/format";
import { activeLink, canSee, NAV } from "./nav-items";

/** Thanh tab đầu trang cho mục menu gộp nhiều trang (Ca làm việc | Ngày lễ, Duyệt đăng ký | Thiết bị, Quản lý admin | Hoạt động admin). */
export default function SectionTabs({ counts, owner = false, perms = [], hide = [] }: { counts: Record<string, number>; owner?: boolean; perms?: string[]; hide?: string[] }) {
  const path = usePathname();
  const access = { owner, perms, hide };
  for (const g of NAV) {
    if (!g.tabs) continue;
    const links = g.links.filter((l) => canSee(l, access));
    const cur = activeLink(path, links);
    if (!cur || links.length < 2) continue;
    return (
      <nav className="flex flex-wrap gap-2">
        {links.map((l) => {
          const n = l.badge ? counts[l.badge] ?? 0 : 0;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold ring-1",
                l === cur ? "bg-secondary text-white ring-secondary" : "bg-card text-ink ring-line-strong hover:bg-primary-light",
              )}
            >
              {l.label}
              {n > 0 && <span className="rounded-full bg-danger px-1.5 text-xs font-bold text-white">{n}</span>}
            </Link>
          );
        })}
      </nav>
    );
  }
  return null;
}
