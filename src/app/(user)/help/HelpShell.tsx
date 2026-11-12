import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { HELP_SECTIONS, type HelpSectionKey } from "@/lib/help";
import { cn } from "@/lib/format";

/** Khung chung các trang Help: nút quay lại + tab chuyển 4 mục. */
export default function HelpShell({ current, children }: { current: HelpSectionKey | null; children: React.ReactNode }) {
  const sec = HELP_SECTIONS.find((s) => s.key === current);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link href={current ? "/help" : "/"} className="flex h-9 w-9 items-center justify-center rounded-full bg-white ring-1 ring-[#f1e6c8]" aria-label="Quay lại">
          <ChevronLeft size={20} />
        </Link>
        <h1 className="text-lg font-bold text-accent">{sec ? `${sec.icon} ${sec.label}` : "Trợ giúp"}</h1>
      </div>
      {current && (
        <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 text-xs" aria-label="Mục trợ giúp">
          {HELP_SECTIONS.map((s) => (
            <Link
              key={s.key}
              href={s.href}
              className={cn("shrink-0 rounded-full px-3 py-1.5", s.key === current ? "bg-secondary font-bold text-white" : "bg-white text-ink/70 ring-1 ring-[#f1e6c8]")}
            >
              {s.icon} {s.label}
            </Link>
          ))}
        </nav>
      )}
      {children}
    </div>
  );
}
