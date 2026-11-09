"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/format";

export default function ManageTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto rounded-xl bg-white p-1 ring-1 ring-[#f1e6c8]">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn("shrink-0 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap", path.startsWith(t.href) ? "bg-secondary font-bold text-white" : "text-ink/70 hover:bg-primary-light")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
