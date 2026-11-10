"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { askStoreAssistant } from "./actions";

type Msg = { role: "q" | "a"; text: string; status?: string };
const SUGGEST = ["Quản lý cơ sở mình là ai?", "Sầu riêng mở rồi bảo quản sao?", "Quên check-out thì làm gì?", "Đi muộn bị phạt thế nào?", "Nguyên liệu hỏng thì làm sao?", "Chốt ca như thế nào?", "Nhận hàng ghi vào app thế nào?"];

/** Chat với Trợ lý cửa hàng (lịch sử chỉ giữ trên màn hình). */
export default function AssistantChat({ enabled, left: left0, limit }: { enabled: boolean; left: number | null; limit: number }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [left, setLeft] = useState(left0);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  // braces: newer browsers make scrollIntoView return a Promise, which React would call as the effect cleanup
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, pending]);

  const ask = (text: string) => {
    const t = text.trim();
    if (!t || pending) return;
    setQ("");
    setMsgs((m) => [...m, { role: "q", text: t }]);
    start(async () => {
      const r = await askStoreAssistant(t).catch(() => ({ error: "Mất kết nối hoặc AI trả lời quá lâu – thử lại sau ít phút" }) as Awaited<ReturnType<typeof askStoreAssistant>>);
      if (r.error) setMsgs((m) => [...m, { role: "a", text: r.error!, status: "ERROR" }]);
      else {
        setMsgs((m) => [...m, { role: "a", text: r.answer!.answer, status: r.answer!.status }]);
        if (r.left != null) setLeft(r.left);
      }
    });
  };

  if (!enabled) return <p className="rounded-xl bg-cream p-3 text-sm text-ink/70">Admin chưa bật Trợ lý cửa hàng.</p>;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-ink/60">
        <span>Chỉ trả lời: nội quy · ai là quản lý · bảo quản · nguyên liệu có vấn đề · cách chốt ca · cách chấm công</span>
        {left != null && <span className="shrink-0 font-semibold">còn {left}/{limit} câu hôm nay</span>}
      </div>
      {!msgs.length && (
        <div className="flex flex-wrap gap-1.5">
          {SUGGEST.map((s) => (
            <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-[#f1e6c8] bg-white px-3 py-1 text-xs">
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-2.5">
        {msgs.map((m, i) =>
          m.role === "q" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm font-medium">
              {m.text}
            </div>
          ) : (
            <div
              key={i}
              className={`max-w-[94%] rounded-2xl rounded-bl-md border px-3 py-2 text-sm whitespace-pre-line ${
                m.status === "OUT_OF_SCOPE" || m.status === "ERROR" ? "border-[#fde2c4] bg-[#fffaf3]" : m.status === "MISSING" ? "border-[#f1e6c8] bg-cream" : "border-[#f1e6c8] bg-white"
              }`}
            >
              {m.text}
            </div>
          ),
        )}
        {pending && (
          <p className="flex items-center gap-1.5 text-xs text-ink/60">
            <Loader2 size={14} className="animate-spin" /> Trợ lý đang trả lời…
          </p>
        )}
        <div ref={end} />
      </div>
      <form
        className="sticky bottom-20 flex gap-2 rounded-2xl bg-cream p-2 ring-1 ring-[#f1e6c8]"
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hỏi về nội quy, chốt ca, chấm công…" maxLength={500} aria-label="Câu hỏi" />
        <Button type="submit" disabled={pending || !q.trim() || left === 0} aria-label="Gửi">
          <Send size={16} />
        </Button>
      </form>
    </div>
  );
}
