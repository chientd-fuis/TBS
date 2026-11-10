"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, Loader2, Send, Sparkles, X } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { defaultCountInCost, EXPENSE_CATEGORIES } from "@/lib/finance";
import { viDate } from "@/lib/time";
import type { AskCard } from "@/lib/ask-actions";
import { askDataAction, executeAskProposal } from "../actions/ai";

type Tx = { date?: string; amount: number; recipient?: string; transferNote?: string; purpose?: string; category?: string; dupHint?: string; pick?: boolean };
type Msg =
  | { role: "q"; text: string; photo?: string }
  | { role: "a"; text: string; source?: string; denied?: boolean; error?: boolean; card?: AskCard; state?: "wait" | "busy" | "done" | "cancel"; result?: string }
  | { role: "bill"; photo: string; txs: Tx[]; state?: "wait" | "busy" | "done"; result?: string };

const SUGGEST = [
  "Hôm nay ai chưa đến ca?",
  "Danh sách nhân viên",
  "Thưởng 50k cho Lan và Hà vì làm tốt",
  "Chấm hộ Lan hôm nay vào 8h, vẫn đang trong ca",
  "Thêm tạm ứng 500k cho Minh tháng này",
];
const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")} ₫`;
const catLabel = (k?: string) => EXPENSE_CATEGORIES.find((c) => c.key === k)?.label ?? "Khác";
const NET_ERR = "Mất kết nối hoặc AI trả lời quá lâu – thử lại sau ít phút";

/** Ảnh bill / sao kê → JPEG (cạnh dài tối đa 2400px để AI đọc rõ chữ nhỏ). */
async function fileToJpeg(file: File, maxSide = 2400): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Không đọc được ảnh (dùng JPG / PNG)"));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Nút "Hỏi AI" + panel chat: tra cứu dữ liệu theo quyền, soạn sẵn thao tác (đổi lương, thưởng/phạt, tạm ứng/phụ cấp, chấm hộ)
 * để admin bấm Xác nhận, và kiểm tra ảnh bill đã nhập vào chi tiêu chưa.
 */
export default function AskAiPanel({ left: left0, limit, billOk = false }: { left: number | null; limit: number; billOk?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [left, setLeft] = useState(left0);
  const [pending, start] = useTransition();
  const [reading, setReading] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs, pending, reading]);

  const patch = (i: number, p: Partial<Msg>) => setMsgs((m) => m.map((x, k) => (k === i ? ({ ...x, ...p } as Msg) : x)));

  const ask = (text: string) => {
    const t = text.trim();
    if (!t || pending) return;
    setQ("");
    setMsgs((m) => [...m, { role: "q", text: t }]);
    start(async () => {
      // server bị cắt (quá thời gian / mất mạng) → báo trong khung chat, không làm sập trang
      const r = await askDataAction(t).catch(() => ({ error: NET_ERR }) as Awaited<ReturnType<typeof askDataAction>>);
      setMsgs((m) => [...m, r.error ? { role: "a", text: r.error, error: true } : { role: "a", text: r.answer ?? "", source: r.source, denied: r.denied, card: r.card, state: r.card ? "wait" : undefined }]);
      if (r.left != null) setLeft(r.left);
    });
  };

  const confirm = async (i: number, card: AskCard) => {
    patch(i, { state: "busy" });
    const r = await executeAskProposal(card.proposal).catch(() => ({ error: NET_ERR }) as Awaited<ReturnType<typeof executeAskProposal>>);
    if (r.error) patch(i, { state: "wait", result: `❌ ${r.error}` });
    else {
      patch(i, { state: "done", result: `✅ ${r.message ?? "Đã lưu"}` });
      router.refresh();
    }
  };

  // ảnh bill → AI đọc giao dịch + dò trùng với chi tiêu đã nhập (cùng ngày + số tiền)
  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    let photo = "";
    try {
      photo = await fileToJpeg(file);
    } catch (e) {
      setReading(false);
      return setMsgs((m) => [...m, { role: "a", text: (e as Error).message, error: true }]);
    }
    setMsgs((m) => [...m, { role: "q", text: "Bill này đã nhập vào chi tiêu chưa?", photo }]);
    const r = await fetch("/api/admin/expenses/ocr", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ photo }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: NET_ERR };
    setReading(false);
    if (!r?.ok) return setMsgs((m) => [...m, { role: "a", text: j.error || "Không đọc được ảnh", error: true }]);
    const txs: Tx[] = (j.transactions ?? []).map((t: Tx) => ({ ...t, pick: !t.dupHint && !!t.date }));
    if (!txs.length) return setMsgs((m) => [...m, { role: "a", text: "Không thấy khoản chi (tiền ra) nào trong ảnh." }]);
    setMsgs((m) => [...m, { role: "bill", photo, txs, state: "wait" }]);
  };

  const saveBill = async (i: number, b: Extract<Msg, { role: "bill" }>) => {
    const rows = b.txs.filter((t) => t.pick && t.date);
    if (!rows.length) return;
    patch(i, { state: "busy" });
    const r = await fetch("/api/admin/expenses/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        photos: b.photo.length < 3_500_000 ? [b.photo] : [],
        rows: rows.map((t) => ({
          date: t.date,
          amount: t.amount,
          category: t.category ?? "KHAC",
          target: "SHARED", // giống màn "Nhập từ ảnh": chi phí chung của chuỗi
          content: (t.transferNote || t.purpose || "").slice(0, 300) || undefined,
          recipient: t.recipient?.slice(0, 120) || undefined,
          countInCost: defaultCountInCost(t.category ?? "KHAC"),
          fromOcr: true,
        })),
      }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: NET_ERR };
    if (!r?.ok) return patch(i, { state: "wait", result: `❌ ${j.error || "Lưu thất bại"}` });
    patch(i, { state: "done", result: `✅ Đã thêm ${rows.length} khoản vào chi tiêu. ${j.message ?? ""}` });
    router.refresh();
  };

  const busy = pending || reading;
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
                <b className="text-accent">✨ Hỏi AI</b> <span className="text-xs text-ink/60">· tra cứu & thao tác theo quyền của bạn</span>
              </div>
              <div className="flex items-center gap-2">
                {left != null && <span className="rounded-full bg-primary-light px-2 py-0.5 text-xs font-semibold">Còn {left}/{limit} câu hôm nay</span>}
                <button type="button" onClick={() => setOpen(false)} aria-label="Đóng">
                  <X size={18} />
                </button>
              </div>
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto bg-cream px-4 py-3 text-sm">
              {!msgs.length && (
                <p className="text-xs text-ink/60">
                  Hỏi về chấm công, đi muộn, giờ công, lịch ca, nhân viên, lương… hoặc nhờ làm: đổi lương giờ, thưởng / phạt (1 hay nhiều người), thêm tạm ứng / phụ cấp vào bảng lương, chấm công hộ.
                  {billOk && " Bấm 📷 gửi ảnh bill để kiểm tra đã nhập vào chi tiêu chưa."} Mọi thao tác sửa dữ liệu đều cần bạn bấm <b>Xác nhận</b>.
                </p>
              )}
              {msgs.map((m, i) =>
                m.role === "q" ? (
                  <div key={i} className="ml-auto max-w-[85%] space-y-1.5 rounded-2xl rounded-br-md bg-primary px-3 py-2 font-medium">
                    {m.photo && <img src={m.photo} alt="Ảnh bill" className="max-h-40 rounded-lg" />}
                    <div>{m.text}</div>
                  </div>
                ) : m.role === "bill" ? (
                  <div key={i} className="max-w-[94%] space-y-2 rounded-2xl rounded-bl-md border border-[#f1e6c8] bg-white px-3 py-2">
                    <p className="font-semibold">Đọc được {m.txs.length} khoản chi:</p>
                    {m.txs.map((t, k) => (
                      <label key={k} className={`flex gap-2 rounded-xl p-2 ${t.dupHint ? "bg-[#f0f9f2]" : "bg-[#fff7f0]"}`}>
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-[#3c9c54]"
                          checked={!!t.pick}
                          disabled={m.state !== "wait" || !t.date}
                          onChange={(e) => patch(i, { txs: m.txs.map((x, z) => (z === k ? { ...x, pick: e.target.checked } : x)) })}
                        />
                        <span className="min-w-0 flex-1">
                          <b>{vnd(t.amount)}</b> · {t.date ? viDate(t.date) : "không rõ ngày"} · {catLabel(t.category)}
                          <span className="block text-xs text-ink/70">{[t.recipient, t.purpose || t.transferNote].filter(Boolean).join(" – ")}</span>
                          <span className={`block text-xs font-semibold ${t.dupHint ? "text-secondary-dark" : "text-warn"}`}>
                            {t.dupHint ? `✅ Đã nhập rồi: ${t.dupHint.replace(/^Đã có /, "")}` : t.date ? "❗ Chưa nhập vào chi tiêu" : "Không đọc được ngày – nhập tay ở Tài chính → Chi phí"}
                          </span>
                        </span>
                      </label>
                    ))}
                    {m.result && <p className="text-xs">{m.result}</p>}
                    {m.state !== "done" && m.txs.some((t) => t.pick) && (
                      <Button type="button" className="w-full" disabled={m.state === "busy"} onClick={() => saveBill(i, m)}>
                        {m.state === "busy" ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Thêm {m.txs.filter((t) => t.pick).length} khoản vào chi tiêu
                      </Button>
                    )}
                    {m.state !== "done" && !m.txs.some((t) => t.pick) && m.txs.every((t) => t.dupHint) && <p className="text-xs text-ink/60">Bill này đã nhập đủ – không cần thêm.</p>}
                  </div>
                ) : (
                  <div key={i} className={`max-w-[94%] rounded-2xl rounded-bl-md border px-3 py-2 whitespace-pre-line ${m.denied || m.error ? "border-[#fecaca] bg-[#fff7f7]" : "border-[#f1e6c8] bg-white"}`}>
                    {m.text}
                    {m.card && (
                      <div className="mt-2 space-y-1.5 rounded-xl border border-secondary/40 bg-[#f7fbf8] p-2.5">
                        <p className="font-bold text-secondary-dark">📝 {m.card.title}</p>
                        <ul className="space-y-0.5 text-[13px]">
                          {m.card.lines.map((l, k) => (
                            <li key={k}>• {l}</li>
                          ))}
                        </ul>
                        {m.result && <p className="text-xs font-semibold">{m.result}</p>}
                        {m.state !== "done" && m.state !== "cancel" && (
                          <div className="flex gap-2 pt-1">
                            <Button type="button" className="flex-1" disabled={m.state === "busy"} onClick={() => confirm(i, m.card!)}>
                              {m.state === "busy" ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Xác nhận
                            </Button>
                            <Button type="button" variant="outline" disabled={m.state === "busy"} onClick={() => patch(i, { state: "cancel", result: "Đã huỷ – không lưu gì." })}>
                              Huỷ
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                    {m.source && <p className="mt-1.5 border-t border-dashed border-[#f1e6c8] pt-1 text-[11px] text-ink/60">Nguồn: {m.source}</p>}
                  </div>
                ),
              )}
              {busy && (
                <p className="flex items-center gap-1.5 text-xs text-ink/60">
                  <Loader2 size={14} className="animate-spin" /> {reading ? "Đang đọc ảnh bill…" : "Đang xử lý…"}
                </p>
              )}
              <div ref={end} />
            </div>
            <div className="space-y-2 border-t border-[#f1e6c8] p-3">
              <div className="flex flex-wrap gap-1.5">
                {SUGGEST.map((s) => (
                  <button key={s} type="button" onClick={() => setQ(s)} className="rounded-full border border-[#f1e6c8] bg-white px-2.5 py-0.5 text-xs">
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
                {billOk && (
                  <>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => (onPhoto(e.target.files?.[0]), (e.target.value = ""))} />
                    <Button type="button" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()} aria-label="Gửi ảnh bill" title="Gửi ảnh bill – kiểm tra đã nhập vào chi tiêu chưa">
                      <Camera size={16} />
                    </Button>
                  </>
                )}
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hỏi hoặc nhờ làm (thưởng, chấm hộ…)" maxLength={400} aria-label="Câu hỏi" />
                <Button type="submit" disabled={busy || !q.trim() || left === 0} aria-label="Gửi">
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
