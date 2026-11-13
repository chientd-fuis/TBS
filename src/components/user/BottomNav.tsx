"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Clock, ScanFace, UserRound, Wallet } from "lucide-react";
import { cn } from "@/lib/format";

const items = [
  { href: "/", label: "Chấm công", icon: ScanFace },
  { href: "/history", label: "Lịch sử", icon: Clock },
  { href: "/schedule", label: "Lịch ca", icon: CalendarDays },
  { href: "/payroll", label: "Bảng lương", icon: Wallet },
  { href: "/account", label: "Tài khoản", icon: UserRound },
];

export default function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" || path.startsWith("/closing") : path.startsWith(href);
          return (
            <li key={href}>
              <Link href={href} className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", active ? "font-bold text-accent" : "text-ink/60")}>
                <span className={cn("rounded-full px-3 py-1", active && "bg-primary text-on-primary")}>
                  <Icon size={20} />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
