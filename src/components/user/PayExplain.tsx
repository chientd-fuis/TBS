"use client";
import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { explainPayAction } from "@/app/(user)/payroll/actions";

/** Nút "Vì sao lương tháng này là X?" → AI giải thích từ bảng lương của chính nhân viên. */
export default function PayExplain({ month, netPay, left: left0, limit }: { month: string; netPay: string; left: number | null; limit: number }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [left, setLeft] = useState(left0);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Button
        type="button"
        className="w-full"
        disabled={pending || left === 0}
        onClick={() =>
          start(async () => {
            setErr("");
            const r = await explainPayAction(month).catch(() => ({ error: "Mất kết nối hoặc AI trả lời quá lâu – thử lại sau ít phút" }) as Awaited<ReturnType<typeof explainPayAction>>);
            if (r.error) setErr(r.error);
            else {
              setText(r.text ?? "");
              if (r.left != null) setLeft(r.left);
            }
          })
        }
      >
        {pending ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Vì sao lương tháng này là {netPay} ₫?
      </Button>
      {left != null && <p className="text-center text-xs text-ink/60">còn {left}/{limit} lượt tháng này</p>}
      {err && <p className="rounded-xl bg-[#fffaf3] p-2 text-sm text-warn">{err}</p>}
      {text && (
        <div className="rounded-2xl border border-[#ddd6fe] bg-[#fdfcff] p-3 text-sm whitespace-pre-line">
          <p className="mb-1 text-xs font-bold text-[#6d28d9]">AI giải thích</p>
          {text}
          <p className="mt-2 text-xs text-ink/60">AI chỉ đọc bảng lương của chính bạn. Thấy sai? Gửi phản hồi bên dưới để admin kiểm tra.</p>
        </div>
      )}
    </div>
  );
}
