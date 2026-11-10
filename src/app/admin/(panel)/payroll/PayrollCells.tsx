"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import Modal from "@/components/Modal";
import { evalCalc } from "@/lib/calc-expr";

/**
 * Ô tiền phụ cấp / tạm ứng: gõ "155k", "1tr2", "31 × 5k" → rời ô hiện 155.000; bấm lại hiện đúng chữ đã gõ.
 * Gửi đi qua input ẩn `name` (số nguyên) – gõ sai thì viền đỏ, giữ số cũ.
 */
export function MoneyField({ name, defaultValue, label, className }: { name: string; defaultValue: number; label: string; className?: string }) {
  const [text, setText] = useState(defaultValue ? defaultValue.toLocaleString("vi-VN") : "0");
  const [focus, setFocus] = useState(false);
  const v = text.trim() === "" ? 0 : evalCalc(text);
  const ok = v != null && v >= 0;
  return (
    <>
      <input type="hidden" name={name} value={ok ? v : defaultValue} />
      <input
        type="text"
        inputMode="text"
        autoComplete="off"
        aria-label={label}
        title={ok ? label : `${label}: không hiểu số tiền (VD 155k, 1tr2, 31 × 5k)`}
        value={focus || !ok ? text : v.toLocaleString("vi-VN")}
        onFocus={(e) => {
          setFocus(true);
          requestAnimationFrame(() => e.target.select());
        }}
        onBlur={() => {
          setFocus(false);
          if (ok) setText(v.toLocaleString("vi-VN"));
        }}
        onChange={(e) => setText(e.target.value)}
        className={`block w-full min-w-0 bg-white px-2 py-2 text-right text-sm tabular-nums outline-none ${ok ? "" : "text-danger"} ${className ?? ""}`}
      />
    </>
  );
}

/** Số tài khoản + nút copy (chỉ copy số TK, không kèm tên ngân hàng). */
export function CopyAccount({ account }: { account: string }) {
  const [done, setDone] = useState(false);
  if (!account) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(account.replace(/\s+/g, ""));
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* trình duyệt chặn clipboard (http / quyền) – bỏ qua */
    }
  };
  return (
    <span className="inline-flex items-center gap-1">
      {account}
      <button type="button" onClick={copy} aria-label="Copy số tài khoản" title="Copy số tài khoản" className="rounded p-1 text-ink/60 hover:bg-primary-light hover:text-accent">
        {done ? <Check size={14} className="text-secondary-dark" /> : <Copy size={14} />}
      </button>
    </span>
  );
}

/** Số tiền thưởng / phạt: bấm (điện thoại không hover được) → popup chi tiết từng khoản. */
export function BpAmount({ amount, tip, title, className }: { amount: string; tip: string; title: string; className: string }) {
  if (!tip) return <span>{amount}</span>;
  return (
    <Modal label={amount} title={title} className={`cursor-pointer underline decoration-dotted underline-offset-2 ${className}`}>
      <ul className="space-y-1 text-sm">
        {tip.split("\n").map((l, i) => (
          <li key={i}>{l.replace(/^- /, "• ")}</li>
        ))}
      </ul>
    </Modal>
  );
}
