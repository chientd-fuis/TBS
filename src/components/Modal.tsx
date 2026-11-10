"use client";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Nút mở popup (modal giữa màn hình, gắn vào <body>) – không bị bảng có thanh cuộn / thẻ cha cắt mất như popup "absolute".
 * Esc hoặc bấm nền tối để đóng.
 */
export default function Modal({ label, title, children, className }: { label: ReactNode; title: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className ?? "rounded-lg px-2 py-2 text-xs font-semibold text-accent hover:bg-primary-light"}>
        {label}
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label={title}>
            <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <b className="text-accent">{title}</b>
                <button type="button" onClick={() => setOpen(false)} aria-label="Đóng" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-cream">
                  <X size={18} />
                </button>
              </div>
              {children}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
