"use client";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/format";

/**
 * Ẩn / hiện cột bảng lương (cho mobile dễ nhìn). Cột "Nhân viên" (1) và "Thực nhận" (9) luôn hiện.
 * Ẩn bằng CSS theo thứ tự cột (nth-child) → không đụng vào bảng server; nhớ lựa chọn trên máy này.
 */
const COLS = [
  { n: 2, label: "Giờ công" },
  { n: 3, label: "Lương giờ" },
  { n: 4, label: "Lương CB" },
  { n: 5, label: "Phụ cấp" },
  { n: 6, label: "Tạm ứng" },
  { n: 7, label: "Thưởng" },
  { n: 8, label: "Phạt" },
  { n: 10, label: "Chuyển khoản" },
  { n: 11, label: "Trả lương" },
] as const;
const KEY = "tbs.payroll.hiddenCols";
/** "Chỉ tên + thực nhận" = ẩn hết các cột trên */
const ALL = COLS.map((c) => c.n);

export default function PayrollColumns({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState<number[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "[]");
      if (Array.isArray(v)) setHidden(v.filter((n) => ALL.includes(n)));
    } catch {}
  }, []);
  const save = (v: number[]) => {
    setHidden(v);
    try {
      localStorage.setItem(KEY, JSON.stringify(v));
    } catch {}
  };
  const toggle = (n: number) => save(hidden.includes(n) ? hidden.filter((x) => x !== n) : [...hidden, n]);
  // dòng ghi chú gộp cột (colSpan) không bị ẩn; các dòng còn lại đủ 11 ô
  const css = hidden.map((n) => `.pay-cols thead th:nth-child(${n}), .pay-cols tbody tr > td:nth-child(${n}):not([colspan]) { display: none; }`).join("\n");

  return (
    <div className="pay-cols">
      {css && <style>{css}</style>}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-xl bg-white px-3 py-1.5 font-semibold ring-1 ring-[#e9d9a8] hover:bg-primary-light">
          👁 Ẩn / hiện cột{hidden.length ? ` (đang ẩn ${hidden.length})` : ""}
        </button>
        <button
          type="button"
          onClick={() => save(hidden.length === ALL.length ? [] : ALL)}
          className={cn("rounded-xl px-3 py-1.5 ring-1", hidden.length === ALL.length ? "bg-secondary font-semibold text-white ring-secondary" : "bg-white ring-[#e9d9a8] hover:bg-primary-light")}
        >
          {hidden.length === ALL.length ? "Hiện đủ cột" : "Chỉ tên + thực nhận"}
        </button>
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap gap-1.5 rounded-xl bg-cream p-2 text-sm">
          {COLS.map((c) => {
            const on = !hidden.includes(c.n);
            return (
              <button
                key={c.n}
                type="button"
                onClick={() => toggle(c.n)}
                className={cn("rounded-lg px-2.5 py-1 ring-1", on ? "bg-white font-semibold ring-[#e9d9a8]" : "bg-transparent text-ink/50 line-through ring-transparent")}
              >
                {on ? "☑" : "☐"} {c.label}
              </button>
            );
          })}
          <span className="self-center text-xs text-ink/50">Tên + Thực nhận luôn hiện</span>
        </div>
      )}
      {children}
    </div>
  );
}
