"use client";
import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/format";

/**
 * Nút chọn ngày gọn cho thanh lọc: chưa chọn → chỉ icon lịch; đã chọn → icon + dd/mm.
 * Ô date thật phủ trong suốt lên nút nên bấm vào là mở lịch của máy (iOS / Android / PC);
 * sự kiện change nổi lên form cha (AutoFilterForm lọc ngay).
 */
export function DatePickButton({
  name,
  value,
  max,
  min,
  className,
  onChange,
  small = false,
}: {
  name?: string;
  value?: string;
  max?: string;
  min?: string;
  className?: string;
  /** dùng khi không nằm trong form lọc (VD chọn ngày cho từng lần nhận hàng) */
  onChange?: (v: string) => void;
  small?: boolean;
}) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  return (
    <label
      title="Chọn ngày"
      className={cn(
        "relative flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-line-strong bg-card px-2.5 text-sm font-semibold text-ink focus-within:border-primary-dark focus-within:ring-2 focus-within:ring-primary/40",
        small ? "h-8 rounded-lg px-2 text-xs" : "h-[38px]",
        v ? "bg-primary-light" : small ? "w-8 px-0" : "w-[38px] px-0",
        className,
      )}
    >
      <CalendarDays size={small ? 15 : 18} />
      {v && <span className="tabular-nums">{v.slice(8, 10)}/{v.slice(5, 7)}</span>}
      <input
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
  );
}
