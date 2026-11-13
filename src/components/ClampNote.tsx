"use client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/format";

/**
 * Ghi chú dài trong bảng (chấm công…): mặc định gọn 2 dòng, chạm để xem đủ / thu gọn.
 * Chỉ hiện "Xem thêm" khi chữ thật sự dài hơn 2 dòng.
 */
export default function ClampNote({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 1);
  }, [children, open]);
  return (
    <span className={cn("block", className)}>
      <span ref={ref} className={cn("block", !open && "line-clamp-2")}>
        {children}
      </span>
      {(long || open) && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-0.5 text-[11px] font-semibold text-accent underline">
          {open ? "Thu gọn" : "Xem thêm"}
        </button>
      )}
    </span>
  );
}
