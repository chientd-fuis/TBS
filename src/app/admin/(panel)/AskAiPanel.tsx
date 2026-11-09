"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { askDataAction } from "../actions/ai";

type Msg = { role: "q" | "a"; text: string; source?: string; denied?: boolean; error?: boolean };
const SUGGEST = ["Hôm nay ai chưa đến ca?", "Tháng này ai đi muộn nhiều nhất?", "Tuần này ai quên check-out?", "Tuần sau ca nào thiếu người?"];

/** Nút "Hỏi AI" + panel chat bên phải: hỏi dữ liệu bằng tiếng Việt, AI chỉ tra cứu theo quyền của admin. */
export default function AskAiPanel({ left: left0, limit }: { left: number | null; limit: number }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [left, setLeft] = useState(left0);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs, pending]);

  const ask = (text: string) => {
    const t = text.trim();
    if (!t || pending) return;
    setQ("");
    setMsgs((m) => [...m, { role: "q", text: t }]);
    start(async () => {
      // server bị cắt (quá thời gian / mất mạng) → báo trong khung chat, không làm sập trang
      const r = await askDataAction(t).catch(() => ({ error: "Mất kết nối hoặc AI trả lời quá lâu – thử lại sau ít phút" }) as Awaited<ReturnType<typeof askDataAction>>);
      setMsgs((m) => [...m, r.error ? { role: "a", text: r.error, error: true } : { role: "a", text: r.answer ?? "", source: r.source, denied: r.denied }]);
      if (r.left != null) setLeft(r.left);
    });
  };

  return (
    <>
      <Button type="button" className="px-3 py-1.5" onClick={() => setOpen(true)}>
        <Sparkles size={15} /> Hỏi AI
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/30" onClick={() => setOpen(false)}>
          <aside className="flex h-full w-full max-w-md flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-center justify-between gap-2 border-b border-[#f1e6c8] px-4 py-3">
              <div>
                <b className="text-accent">✨ Hỏi AI</b> <span className="text-xs text-ink/60">· tra dữ liệu theo quyền của bạn</span>
              </div>
              <div className="flex items-center gap-2">
                {left != null && <span className="rounded-full bg-primary-light px-2 py-0.5 text-xs font-semibold">Còn {left}/{limit} câu hôm nay</span>}
                <button type="button" onClick={() => setOpen(false)} aria-label="Đóng">
                  <X size={18} />
                </button>
              </div>
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto bg-cream px-4 py-3 text-sm">
              {!msgs.length && <p className="text-xs text-ink/60">Hỏi về chấm công, đi muộn, giờ công, ngày lễ, lịch ca, ca thiếu người… AI chỉ đọc dữ liệu, không sửa gì.</p>}
              {msgs.map((m, i) =>
                m.role === "q" ? (
                  <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 font-medium">
                    {m.text}
                  </div>
                ) : (
                  <div key={i} className={`max-w-[94%] rounded-2xl rounded-bl-md border px-3 py-2 whitespace-pre-line ${m.denied || m.error ? "border-[#fecaca] bg-[#fff7f7]" : "border-[#f1e6c8] bg-white"}`}>
                    {m.text}
                    {m.source && <p className="mt-1.5 border-t border-dashed border-[#f1e6c8] pt-1 text-[11px] text-ink/60">Nguồn: {m.source}</p>}
                  </div>
                ),
              )}
              {pending && (
                <p className="flex items-center gap-1.5 text-xs text-ink/60">
                  <Loader2 size={14} className="animate-spin" /> Đang tra dữ liệu…
                </p>
              )}
              <div ref={end} />
            </div>
            <div className="space-y-2 border-t border-[#f1e6c8] p-3">
              <div className="flex flex-wrap gap-1.5">
                {SUGGEST.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-[#f1e6c8] bg-white px-2.5 py-0.5 text-xs">
                    {s}
                  </button>
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  ask(q);
                }}
              >
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hỏi về chấm công, lịch ca, nhân viên…" maxLength={400} aria-label="Câu hỏi" />
                <Button type="submit" disabled={pending || !q.trim() || left === 0} aria-label="Gửi">
                  <Send size={16} />
                </Button>
              </form>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
