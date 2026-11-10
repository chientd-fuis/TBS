"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/format";
import { activeLink, canSee, NAV } from "./nav-items";

export default function AdminNav({ counts, owner = false, perms = [], hide = [] }: { counts: Record<string, number>; owner?: boolean; perms?: string[]; hide?: string[] }) {
  const path = usePathname();
  const access = { owner, perms, hide };
  return (
    <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible lg:px-3">
      {NAV.map((g) => {
        const links = g.links.filter((l) => canSee(l, access));
        if (!links.length) return null;
        const active = !!activeLink(path, links);
        // gộp số chờ xử lý của các trang con (VD Duyệt đăng ký + Thiết bị)
        const n = links.reduce((s, l) => s + (l.badge ? counts[l.badge] ?? 0 : 0), 0);
        const Icon = g.icon;
        return (
          <Link
            key={g.label}
            href={links[0].href}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm whitespace-nowrap",
              active ? "bg-primary font-bold text-ink" : "text-white/90 hover:bg-white/10",
            )}
          >
            <Icon size={17} />
            <span className="flex-1">{g.label}</span>
            {n > 0 && <span className="rounded-full bg-danger px-1.5 text-xs font-bold text-white">{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
