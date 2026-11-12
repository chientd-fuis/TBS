"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/format";
import { Spinner } from "@/components/ui";
import { activeLink, canSee, NAV } from "./nav-items";

export default function AdminNav({
  counts,
  owner = false,
  perms = [],
  hide = [],
  vertical = false,
}: {
  counts: Record<string, number>;
  owner?: boolean;
  perms?: string[];
  hide?: string[];
  /** menu trượt trên điện thoại: luôn xếp dọc */
  vertical?: boolean;
}) {
  const path = usePathname();
  const access = { owner, perms, hide };
  // menu trượt (điện thoại) che header → không thấy vạch tiến trình: mục vừa bấm sáng lên ngay + vòng xoay tại chỗ
  const [going, setGoing] = useState<string | null>(null);
  useEffect(() => setGoing(null), [path]);
  useEffect(() => {
    if (!going) return;
    const t = window.setTimeout(() => setGoing(null), 15_000); // mạng treo → tự tắt
    return () => window.clearTimeout(t);
  }, [going]);
  return (
    <nav data-no-navbar className={vertical ? "flex flex-col gap-0.5 px-2.5 pb-2" : "flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible lg:px-3"}>
      {NAV.map((g) => {
        const links = g.links.filter((l) => canSee(l, access));
        if (!links.length) return null;
        const loading = vertical && going === g.label;
        const active = going && vertical ? loading : !!activeLink(path, links);
        // gộp số chờ xử lý của các trang con (VD Duyệt đăng ký + Thiết bị)
        const n = links.reduce((s, l) => s + (l.badge ? counts[l.badge] ?? 0 : 0), 0);
        const Icon = g.icon;
        return (
          <Link
            key={g.label}
            href={links[0].href}
            aria-busy={loading || undefined}
            onClick={() => {
              if (vertical && !activeLink(path, links)) setGoing(g.label);
            }}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm whitespace-nowrap",
              active ? "bg-primary font-bold text-ink" : "text-white/90 hover:bg-white/10",
            )}
          >
            <Icon size={17} />
            <span className="flex-1">{g.label}</span>
            {loading ? <Spinner className="text-ink" /> : n > 0 && <span className="rounded-full bg-danger px-1.5 text-xs font-bold text-white">{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
