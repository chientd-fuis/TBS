"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/format";

/*
 * Lịch sử chốt ca: ẩn / hiện cột (giống Doanh thu theo ngày) + khung "Lọc & cột" thu gọn trên điện thoại.
 * Mỗi ô bảng có class `ccol-<key>`; component này sinh CSS ẩn cột → bảng vẫn render ở server.
 *  - Mặc định máy tính: đủ cột (trừ cột gộp "Ca (MB)").
 *  - Mặc định điện thoại: Ca (MB) = dd/mm (Ca X), Nhân viên, Doanh thu, Ghi chú, Thao tác (Xoá).
 *  - Tự chọn → nhớ trên máy này (localStorage), áp dụng mọi màn hình.
 */

export const CLOSING_COLS = [
  { k: "mb", label: "Ca (MB)" },
  { k: "time", label: "Thời gian" },
  { k: "emp", label: "Nhân viên" },
  { k: "store", label: "Cơ sở" },
  { k: "shift", label: "Ca" },
  { k: "photo", label: "Ảnh" },
  { k: "rev", label: "Doanh thu" },
  { k: "note", label: "Ghi chú" },
  { k: "tg", label: "Telegram" },
  { k: "sheet", label: "Google Sheet" },
  { k: "act", label: "Thao tác" },
] as const;
type ColKey = (typeof CLOSING_COLS)[number]["k"];
const MOBILE_SHOW = new Set<ColKey>(["mb", "emp", "rev", "note", "act"]);
const DESKTOP_HIDE = new Set<ColKey>(["mb"]);
const STORE_KEY = "tbs-closings-hidden-cols";

type Ctx = { shown: (k: ColKey) => boolean; flip: (k: ColKey) => void; all: () => void; reset: () => void; custom: boolean };
const C = createContext<Ctx | null>(null);

const sel = (ks: Iterable<string>) => [...ks].map((k) => `#closings-tbl .ccol-${k}`).join(",");

export function ColsProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState<Set<ColKey> | null>(null);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved) setHidden(new Set(JSON.parse(saved) as ColKey[]));
    } catch {}
    return () => mq.removeEventListener("change", on);
  }, []);
  const save = (h: Set<ColKey> | null) => {
    setHidden(h);
    try {
      if (h) localStorage.setItem(STORE_KEY, JSON.stringify([...h]));
      else localStorage.removeItem(STORE_KEY);
    } catch {}
  };
  const shown = (k: ColKey) => (hidden ? !hidden.has(k) : wide ? !DESKTOP_HIDE.has(k) : MOBILE_SHOW.has(k));
  const flip = (k: ColKey) => save(new Set(CLOSING_COLS.map((c) => c.k).filter((x) => (x === k ? shown(x) : !shown(x)))));
  // mặc định dùng media query (không nháy khi tải trang); đã tự chọn thì theo lựa chọn
  const mobileHide = CLOSING_COLS.map((c) => c.k).filter((k) => !MOBILE_SHOW.has(k));
  const css = hidden
    ? hidden.size
      ? `${sel(hidden)}{display:none}`
      : ""
    : `${sel(DESKTOP_HIDE)}{display:none}@media (max-width:767px){${sel(mobileHide)}{display:none}${sel(MOBILE_SHOW)}{display:table-cell}}`;
  return (
    <C.Provider value={{ shown, flip, all: () => save(new Set()), reset: () => save(null), custom: !!hidden }}>
      {css && <style>{css}</style>}
      {children}
    </C.Provider>
  );
}

/** Thanh chọn cột (đặt trong khung Lọc & cột) */
export function ColsToggle() {
  const c = useContext(C);
  if (!c) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-ink/60">Cột:</span>
      {CLOSING_COLS.map((x) => (
        <button
          key={x.k}
          type="button"
          onClick={() => c.flip(x.k)}
          aria-pressed={c.shown(x.k)}
          className={cn("rounded-full px-2.5 py-1 ring-1", c.shown(x.k) ? "bg-secondary font-semibold text-white ring-secondary" : "bg-card text-ink/50 ring-line line-through")}
        >
          {x.label}
        </button>
      ))}
      <button type="button" onClick={c.all} className="rounded-full px-2 py-1 text-accent underline">
        Hiện tất cả
      </button>
      {c.custom && (
        <button type="button" onClick={c.reset} className="rounded-full px-2 py-1 text-ink/60 underline">
          Mặc định
        </button>
      )}
    </div>
  );
}

/** Điện thoại: bộ lọc + chọn cột gói trong 1 nút "Lọc & cột" bấm để xổ ra. Máy tính: luôn mở. */
export function FilterExpand({ summary, children }: { summary?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl bg-cream px-3 py-2.5 text-left text-sm font-semibold ring-1 ring-line md:hidden"
      >
        <SlidersHorizontal size={16} className="shrink-0 text-accent" aria-hidden />
        <span className="flex-1">
          Lọc &amp; cột
          {summary && <span className="ml-1.5 font-normal text-ink/60">· {summary}</span>}
        </span>
        <ChevronDown size={16} className={cn("shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <div className={cn("space-y-3 pt-3 md:block md:pt-0", !open && "hidden")}>{children}</div>
    </div>
  );
}
