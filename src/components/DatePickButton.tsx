"use client";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { cn } from "@/lib/format";

const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/**
 * Nút chọn ngày dạng "viên thuốc": icon lịch + dd/mm (không hiện năm).
 * Ô date thật phủ trong suốt lên nút nên bấm vào là mở lịch của máy (iOS / Android / PC);
 * sự kiện change nổi lên form cha (AutoFilterForm lọc ngay).
 *  - size: sm (trong dòng) · md (thanh lọc) · lg (ô form nhân viên, cao 48px, rộng hết)
 *  - placeholder: chữ khi chưa chọn (không có → chỉ icon)
 *  - clearable: nút ✕ bỏ chọn ngày (trong form lọc → lọc lại ngay)
 *  - weekday: hiện thứ (T2, T3…) trước ngày
 */
export function DatePickButton({
  name,
  value,
  max,
  min,
  className,
  onChange,
  small = false,
  size,
  placeholder,
  clearable = false,
  weekday = false,
}: {
  name?: string;
  value?: string;
  max?: string;
  min?: string;
  className?: string;
  /** dùng khi không nằm trong form lọc (VD chọn ngày cho từng lần nhận hàng) */
  onChange?: (v: string) => void;
  /** = size "sm" (giữ cho chỗ cũ) */
  small?: boolean;
  size?: "sm" | "md" | "lg";
  placeholder?: string;
  clearable?: boolean;
  weekday?: boolean;
}) {
  const sz = size ?? (small ? "sm" : "md");
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  const ref = useRef<HTMLInputElement>(null);
  const iconOnly = !v && !placeholder;
  const wd = v ? WD[new Date(`${v}T00:00:00`).getDay()] : "";

  const clear = () => {
    setV("");
    onChange?.("");
    const el = ref.current;
    if (el) {
      el.value = "";
      el.form?.requestSubmit();
    }
  };

  return (
    <span className={cn("relative inline-flex shrink-0", sz === "lg" && "flex w-full", className)}>
      <label
        title="Chọn ngày"
        className={cn(
          "relative flex cursor-pointer items-center gap-2 border font-bold text-ink focus-within:ring-2 focus-within:ring-primary/40",
          v ? "border-primary-dark/60 bg-primary-light" : "border-line-strong bg-card",
          sz === "sm" && "h-8 gap-1.5 rounded-xl px-2.5 text-xs",
          sz === "md" && "h-[38px] rounded-2xl px-3 text-sm",
          sz === "lg" && "h-12 w-full rounded-2xl px-4 text-base",
          iconOnly && (sz === "sm" ? "w-8 justify-center px-0" : "w-[38px] justify-center px-0"),
          clearable && v && "pr-9",
        )}
      >
        <CalendarDays size={sz === "sm" ? 15 : sz === "lg" ? 20 : 18} className="shrink-0" />
        {v ? (
          <span className="tabular-nums">
            {weekday && <span className="mr-1 font-semibold text-ink/60">{wd}</span>}
            {v.slice(8, 10)}/{v.slice(5, 7)}
          </span>
        ) : (
          placeholder && <span className="font-medium text-ink/50">{placeholder}</span>
        )}
        <input
          ref={ref}
          type="date"
          name={name}
          value={v}
          max={max}
          min={min}
          aria-label="Chọn ngày"
          onChange={(e) => {
            setV(e.target.value);
            onChange?.(e.target.value);
          }}
          onClick={(e) => {
            // PC: bấm vào đâu trên nút cũng mở lịch (mặc định chỉ mở khi bấm đúng icon nhỏ)
            try {
              e.currentTarget.showPicker?.();
            } catch {}
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      {clearable && v && (
        <button
          type="button"
          aria-label="Bỏ chọn ngày"
          onClick={clear}
          className="absolute top-1/2 right-1.5 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ink/60 hover:bg-card hover:text-danger"
        >
          <X size={14} />
        </button>
      )}
    </span>
  );
}
