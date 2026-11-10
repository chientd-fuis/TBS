"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import Modal from "@/components/Modal";

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
