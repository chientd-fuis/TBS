"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { BookOpenText, X } from "lucide-react";
import RulesView from "@/components/RulesView";

const KEY = "tbs_rules_seen";

/** Mã ngắn của nội dung nội quy – admin đổi nội dung là đổi mã → hiện badge NEW. */
function rulesVersion(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Nút "Nội quy" trên header: chạm để mở popup nội quy, X để đóng; badge NEW đỏ khi admin vừa cập nhật mà nhân viên chưa xem. */
export default function RulesButton({ rules, assistant = true }: { rules: string; assistant?: boolean }) {
  const [open, setOpen] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const ver = rulesVersion(rules);

  useEffect(() => {
    try {
      setIsNew(localStorage.getItem(KEY) !== ver);
    } catch {
      setIsNew(false); // trình duyệt chặn lưu trữ → không hiện badge
    }
  }, [ver]);

  // popup mở → khoá cuộn trang phía sau, Esc để đóng
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

  const openRules = () => {
    setOpen(true);
    setIsNew(false);
    try {
      localStorage.setItem(KEY, ver);
    } catch {
      /* bỏ qua */
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openRules}
        aria-label={isNew ? "Nội quy cửa hàng (có cập nhật mới)" : "Nội quy cửa hàng"}
        className="relative flex items-center gap-1 rounded-xl bg-white/70 px-2.5 py-1.5 text-xs font-bold text-accent ring-1 ring-accent/30"
      >
        <BookOpenText size={15} /> Nội quy
        {isNew && (
          <span className="pointer-events-none absolute -right-2 -top-2 animate-pulse rounded-full bg-danger px-1.5 py-0.5 text-[9px] font-bold leading-none text-white ring-2 ring-white">NEW</span>
        )}
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 sm:items-center sm:p-4" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Nội quy cửa hàng">
            <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-3xl bg-cream shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-2 border-b border-[#f1e6c8] px-4 py-3">
                <b className="flex items-center gap-2 text-accent">
                  <BookOpenText size={20} /> Nội quy cửa hàng
                </b>
                <button type="button" onClick={() => setOpen(false)} aria-label="Đóng" className="flex h-11 w-11 items-center justify-center rounded-full bg-white ring-1 ring-[#f1e6c8]">
                  <X size={22} />
                </button>
              </div>
              <div className="overflow-y-auto px-4 py-4">
                <RulesView text={rules} />
              </div>
              <div className="border-t border-[#f1e6c8] px-4 py-3 text-center text-sm">
                Còn thắc mắc?{" "}
                {assistant ? (
                  <Link href="/assistant" className="font-semibold text-accent underline" onClick={() => setOpen(false)}>
                    Hỏi trợ lý cửa hàng
                  </Link>
                ) : (
                  "Hỏi quản lý ca."
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
