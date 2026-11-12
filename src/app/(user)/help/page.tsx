import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireActiveUser } from "@/lib/guards";
import { HELP_SECTIONS } from "@/lib/help";

/** Trợ giúp: danh sách 4 mục (cũng mở được từ nút "Trợ giúp" trên header). Đầu trang ở layout (HelpNav). */
export default async function HelpHome() {
  await requireActiveUser();
  return (
    <ul className="space-y-2">
      {HELP_SECTIONS.map((s) => (
        <li key={s.key}>
          <Link href={s.href} className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-[#f1e6c8] hover:bg-primary-light">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-light text-2xl" aria-hidden>
              {s.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-accent">{s.label}</span>
              <span className="block text-xs text-ink/60">{s.hint}</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-accent" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
