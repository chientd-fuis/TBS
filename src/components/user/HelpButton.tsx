"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronRight, CircleHelp, X } from "lucide-react";
import { HELP_SECTIONS } from "@/lib/help";

/** Nút "?" (Help) trên header app nhân viên → menu 4 mục: hướng dẫn app, quy trình, thông tin quán, tình huống hay gặp. */
export default function HelpButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex shrink-0 items-center gap-1 rounded-xl bg-white/70 px-2.5 py-1.5 text-xs font-bold text-accent ring-1 ring-accent/30"
      >
        <CircleHelp size={15} strokeWidth={2.5} /> Trợ giúp
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 sm:items-center sm:p-4" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Trợ giúp">
            <div className="w-full max-w-lg rounded-t-3xl bg-cream pb-[env(safe-area-inset-bottom)] shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-2 border-b border-[#f1e6c8] px-4 py-3">
                <b className="flex items-center gap-2 text-accent">
                  <CircleHelp size={20} /> Trợ giúp
                </b>
                <button type="button" onClick={() => setOpen(false)} aria-label="Đóng" className="flex h-11 w-11 items-center justify-center rounded-full bg-white ring-1 ring-[#f1e6c8]">
                  <X size={22} />
                </button>
              </div>
              <ul className="space-y-2 p-4">
                {HELP_SECTIONS.map((s) => (
                  <li key={s.key}>
                    <Link
                      href={s.href}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-[#f1e6c8] hover:bg-primary-light"
                    >
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
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
