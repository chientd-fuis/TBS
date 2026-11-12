"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { HELP_SECTIONS } from "@/lib/help";
import { cn } from "@/lib/format";

/**
 * Đầu các trang Trợ giúp: nút quay lại + tiêu đề + hàng tab 4 mục.
 * Nằm trong layout (không dựng lại khi chuyển mục) → hàng tab giữ vị trí cuộn; tab đang chọn tự cuộn vào giữa
 * (trước đây mỗi lần chọn tab, hàng tab cuộn về đầu làm tab vừa chọn bị che).
 */
export default function HelpNav() {
  const path = usePathname();
  const sec = HELP_SECTIONS.find((s) => path === s.href || path.startsWith(`${s.href}/`));
  const bar = useRef<HTMLElement>(null);
  const first = useRef(true);

  useEffect(() => {
    const nav = bar.current;
    const el = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !el) return;
    // chỉ cuộn NGANG trong hàng tab (không kéo cả trang), lần đầu nhảy thẳng, các lần sau cuộn mượt
    const left = el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: first.current ? "auto" : "smooth" });
    first.current = false;
  }, [sec?.key]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link href={sec ? "/help" : "/"} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-[#f1e6c8]" aria-label="Quay lại">
          <ChevronLeft size={20} />
        </Link>
        <h1 className="min-w-0 truncate text-lg font-bold text-accent">{sec ? `${sec.icon} ${sec.label}` : "Trợ giúp"}</h1>
      </div>
      {sec && (
        <nav ref={bar} className="-mx-1 flex gap-1.5 overflow-x-auto scroll-smooth px-1 pb-1 text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Mục trợ giúp">
          {HELP_SECTIONS.map((s) => {
            const on = s.key === sec.key;
            return (
              <Link
                key={s.key}
                href={s.href}
                scroll={false}
                aria-current={on ? "page" : undefined}
                className={cn("shrink-0 rounded-full px-3 py-1.5", on ? "bg-secondary font-bold text-white" : "bg-white text-ink/70 ring-1 ring-[#f1e6c8]")}
              >
                {s.icon} {s.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
