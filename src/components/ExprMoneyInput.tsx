"use client";
import { useState } from "react";
import { cn } from "@/lib/format";
import { evalMoneyExpr } from "@/lib/revenue";

/**
 * Ô nhập tiền cho phép gõ phép cộng: "10000 + 20000 + 20k", "30k sữa chua + 20k ship".
 * Rời ô → hiện tổng (50.000); bấm vào lại → hiện đúng nội dung đã gõ để sửa.
 */
export default function ExprMoneyInput({
  value,
  onChange,
  placeholder,
  ...p
}: {
  value: string;
  onChange: (raw: string) => void;
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const [focus, setFocus] = useState(false);
  const r = evalMoneyExpr(value);
  const plain = /^[\d.,\s]*(k|tr\d{0,3})?\s*đ?$/i.test(value.trim()); // chỉ 1 con số → không cần hiện lại biểu thức
  return (
    <div>
      <div className="relative">
        <input
          {...p}
          type="text"
          autoComplete="off"
          enterKeyHint="next"
          value={focus ? value : value.trim() ? r.value.toLocaleString("vi-VN") : ""}
          placeholder={focus ? "VD: 10000 + 20k" : placeholder}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "block w-full min-w-0 rounded-xl border bg-white py-2 pr-7 pl-3 text-sm outline-none focus:ring-2 focus:ring-primary/40",
            focus ? "text-left" : "text-right font-semibold tabular-nums",
            !r.ok && value.trim() ? "border-danger" : "border-[#e9d9a8] focus:border-primary-dark",
          )}
        />
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-ink/50">đ</span>
      </div>
      {focus && value.trim() && (
        <p className="mt-0.5 text-right text-[11px] text-ink/60">= {r.value.toLocaleString("vi-VN")} đ</p>
      )}
      {!focus && value.trim() && !plain && (
        <p className="mt-0.5 truncate text-right text-[11px] text-ink/60" title={value}>{value}</p>
      )}
      {!r.ok && value.trim() && <p className="mt-0.5 text-[11px] text-danger">Có khoản không có số tiền</p>}
    </div>
  );
}
