"use client";
import { useState, useTransition } from "react";
import { ArrowLeftRight, Loader2, X } from "lucide-react";
import { Button, Select, Textarea } from "@/components/ui";
import { requestSwap } from "@/app/(user)/schedule/cover-actions";

export type SwapPeer = { id: string; name: string; store: string; same: boolean; shifts: { id: string; label: string }[] };

/** Nút "Đổi ca" cho 1 ca đã duyệt của tôi: chọn người + 1 ca đã duyệt của họ → gửi admin duyệt. */
export default function SwapForm({ shiftId, label, peers }: { shiftId: string; label: string; peers: SwapPeer[] }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [theirShift, setTheirShift] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const peer = peers.find((p) => p.id === to);
  const noShift = !!peer && !peer.shifts.length;
  const same = peers.filter((c) => c.same);
  const other = peers.filter((c) => !c.same);
  if (!open)
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setMsg(null);
        }}
        className="flex items-center gap-1 rounded-lg bg-[#dbeafe] px-2.5 py-1 text-xs font-semibold text-[#1e40af] ring-1 ring-[#93c5fd]"
      >
        <ArrowLeftRight size={14} /> Đổi ca
      </button>
    );
  return (
    <div className="mt-2 w-full space-y-2 rounded-xl bg-[#eff6ff] p-2.5">
      <div className="flex items-center justify-between text-xs font-semibold text-[#1e40af]">
        <span>Đổi {label}</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Đóng">
          <X size={16} />
        </button>
      </div>
      <Select
        value={to}
        onChange={(e) => {
          setTo(e.target.value);
          setTheirShift("");
          setMsg(null);
        }}
        aria-label="Đổi với ai"
      >
        <option value="">– Đổi với ai –</option>
        {same.length > 0 && (
          <optgroup label="Cùng cơ sở">
            {same.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {!c.shifts.length ? " (chưa có ca đã duyệt)" : ""}
              </option>
            ))}
          </optgroup>
        )}
        {other.length > 0 && (
          <optgroup label="Cơ sở khác">
            {other.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.store}
                {!c.shifts.length ? " (chưa có ca đã duyệt)" : ""}
              </option>
            ))}
          </optgroup>
        )}
      </Select>
      {noShift && (
        <p className="rounded-lg bg-[#fde2e2] px-2 py-1.5 text-xs text-danger">
          {peer.name} chưa có ca nào đã được duyệt trong 2 tuần tới – chỉ đổi được khi cả 2 người đều có ca đã duyệt.
        </p>
      )}
      {peer && !noShift && (
        <Select value={theirShift} onChange={(e) => setTheirShift(e.target.value)} aria-label="Lấy ca nào của họ">
          <option value="">– Lấy ca nào của {peer.name} –</option>
          {peer.shifts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      )}
      <Textarea rows={2} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Lý do / lời nhắn (không bắt buộc)" />
      {msg && <p className={`text-xs ${msg.ok ? "text-secondary-dark" : "text-danger"}`}>{msg.text}</p>}
      <Button
        type="button"
        variant="secondary"
        className="w-full py-2"
        disabled={!theirShift || pending}
        onClick={() =>
          start(async () => {
            const r = await requestSwap(shiftId, theirShift, note);
            if (r.ok) {
              setMsg({ ok: true, text: "Đã gửi – chờ admin duyệt." });
              setOpen(false);
            } else setMsg({ ok: false, text: r.error || "Gửi thất bại" });
          })
        }
      >
        {pending && <Loader2 size={16} className="animate-spin" />} Gửi admin duyệt đổi ca
      </Button>
    </div>
  );
}
