"use client";
import { useState, useTransition } from "react";
import { Loader2, UserRoundPlus, X } from "lucide-react";
import { Button, Select, Textarea } from "@/components/ui";
import { requestCover } from "@/app/(user)/schedule/cover-actions";

export type CoverCandidate = { id: string; name: string; store: string; same: boolean };

/** Nút "Nhờ làm hộ" cho 1 ca: chọn người + lời nhắn → gửi admin duyệt. */
export default function CoverForm({ shiftId, label, candidates }: { shiftId: string; label: string; candidates: CoverCandidate[] }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const same = candidates.filter((c) => c.same);
  const other = candidates.filter((c) => !c.same);
  if (!open)
    return (
      <button type="button" onClick={() => { setOpen(true); setMsg(null); }} className="flex items-center gap-1 rounded-lg bg-primary-light px-2.5 py-1 text-xs font-semibold text-accent ring-1 ring-primary">
        <UserRoundPlus size={14} /> Nhờ làm hộ
      </button>
    );
  return (
    <div className="mt-2 w-full space-y-2 rounded-xl bg-cream p-2.5">
      <div className="flex items-center justify-between text-xs font-semibold text-accent">
        <span>Nhờ làm hộ {label}</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Đóng"><X size={16} /></button>
      </div>
      <Select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Người làm hộ">
        <option value="">– Chọn người làm hộ –</option>
        {same.length > 0 && (
          <optgroup label="Cùng cơ sở">
            {same.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </optgroup>
        )}
        {other.length > 0 && (
          <optgroup label="Cơ sở khác">
            {other.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.store}</option>)}
          </optgroup>
        )}
      </Select>
      <Textarea rows={2} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Lý do / lời nhắn (không bắt buộc)" />
      {msg && <p className={`text-xs ${msg.ok ? "text-good" : "text-danger"}`}>{msg.text}</p>}
      <Button
        type="button"
        variant="secondary"
        className="w-full py-2"
        disabled={!to || pending}
        onClick={() =>
          start(async () => {
            const r = await requestCover(shiftId, to, note);
            if (r.ok) {
              setMsg({ ok: true, text: "Đã gửi – chờ admin duyệt." });
              setOpen(false);
            } else setMsg({ ok: false, text: r.error || "Gửi thất bại" });
          })
        }
      >
        {pending && <Loader2 size={16} className="animate-spin" />} Gửi admin duyệt
      </Button>
    </div>
  );
}
