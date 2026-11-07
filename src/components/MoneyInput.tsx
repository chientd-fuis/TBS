"use client";
import { cn } from "@/lib/format";

const fmt = (n: number | null) => (n == null ? "" : n.toLocaleString("vi-VN"));

/** Ô nhập tiền VND: gõ số, tự hiện dấu chấm hàng nghìn (7.060.000). Giá trị rỗng = null. */
export default function MoneyInput({
  value,
  onChange,
  className,
  highlight,
  ...p
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  className?: string;
  highlight?: boolean;
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
}) {
  return (
    <div className="relative">
      <input
        {...p}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={fmt(value)}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 12);
          onChange(digits ? Number(digits) : null);
        }}
        className={cn(
          "block w-full min-w-0 rounded-xl border border-[#e9d9a8] bg-white py-2 pr-8 pl-3 text-right text-sm tabular-nums outline-none focus:border-primary-dark focus:ring-2 focus:ring-primary/40",
          highlight && "bg-[#eef6ff] ring-1 ring-[#93c5fd]",
          className,
        )}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink/50">đ</span>
    </div>
  );
}
