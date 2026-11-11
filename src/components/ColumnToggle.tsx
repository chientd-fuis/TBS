"use client";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/format";

/**
 * Ẩn / hiện cột của bảng bên trong (cho mobile dễ nhìn). cols = các cột được phép ẩn (n = thứ tự cột, bắt đầu từ 1);
 * cột không có trong cols luôn hiện. Ẩn bằng CSS nth-child → không đụng bảng server; nhớ lựa chọn trên máy này (storageKey).
 * Ô gộp cột (colSpan) không bị ẩn → dòng nào cần thẳng hàng thì viết đủ ô.
 */
export function ColumnToggle({
  cols,
  storageKey,
  keepNote,
  minimalLabel,
  defaultHidden = [],
  children,
}: {
  cols: readonly { n: number; label: string }[];
  storageKey: string;
  /** VD "Tên + Thực nhận luôn hiện" */
  keepNote: string;
  /** nút ẩn hết các cột ẩn được, VD "Chỉ tên + thực nhận" */
  minimalLabel: string;
  /** cột ẩn sẵn khi máy này chưa chọn lần nào */
  defaultHidden?: number[];
  children: ReactNode;
}) {
  const all = cols.map((c) => c.n);
  const [hidden, setHidden] = useState<number[]>(defaultHidden);
  const [open, setOpen] = useState(false);
  const scope = `ct-${storageKey.replace(/[^a-z0-9]/gi, "")}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const v = raw == null ? defaultHidden : JSON.parse(raw);
      if (Array.isArray(v)) setHidden(v.filter((n) => all.includes(n)));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  const save = (v: number[]) => {
    setHidden(v);
    try {
      localStorage.setItem(storageKey, JSON.stringify(v));
    } catch {}
  };
  const toggle = (n: number) => save(hidden.includes(n) ? hidden.filter((x) => x !== n) : [...hidden, n]);
  const minimal = hidden.length === all.length;
  const css = hidden.map((n) => `.${scope} thead th:nth-child(${n}), .${scope} tbody tr > td:nth-child(${n}):not([colspan]) { display: none; }`).join("\n");

  return (
    <div className={scope}>
      {css && <style>{css}</style>}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-xl bg-white px-3 py-1.5 font-semibold ring-1 ring-[#e9d9a8] hover:bg-primary-light">
          👁 Ẩn / hiện cột{hidden.length ? ` (đang ẩn ${hidden.length})` : ""}
        </button>
        <button
          type="button"
          onClick={() => save(minimal ? [] : all)}
          className={cn("rounded-xl px-3 py-1.5 ring-1", minimal ? "bg-secondary font-semibold text-white ring-secondary" : "bg-white ring-[#e9d9a8] hover:bg-primary-light")}
        >
          {minimal ? "Hiện đủ cột" : minimalLabel}
        </button>
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap gap-1.5 rounded-xl bg-cream p-2 text-sm">
          {cols.map((c) => {
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
          <span className="self-center text-xs text-ink/50">{keepNote}</span>
        </div>
      )}
      {children}
    </div>
  );
}
