"use client";
import { useEffect, useState, useTransition } from "react";
import { BellRing, Megaphone } from "lucide-react";
import { cn } from "@/lib/format";
import { shiftLabel, type ReminderItem } from "@/lib/reminders";
import { markShiftRemindersSeen } from "@/app/reminder-actions";

const dm = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;
const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const wd = (d: string) => WD[new Date(`${d}T00:00:00`).getDay()];

/** Thẻ popup nhắc việc (dùng cho nhân viên + xem trước ở admin) */
export function ReminderCard({ r, onOk, busy, compact = false }: { r: Pick<ReminderItem, "date" | "shift" | "text" | "level" | "by" | "at" | "start" | "end">; onOk?: () => void; busy?: boolean; compact?: boolean }) {
  const imp = r.level === "IMPORTANT";
  return (
    <section className="overflow-hidden rounded-3xl bg-card shadow-2xl">
      <div className={cn("flex flex-col gap-2 text-white", imp ? "bg-[#c62828]" : "bg-[#2f5aa8]", compact ? "p-3" : "px-4 pt-4 pb-3.5")}>
        <div className="flex items-center gap-2.5">
          <span className={cn("grid shrink-0 place-items-center rounded-xl bg-white/20", compact ? "h-8 w-8" : "h-11 w-11")}>
            <BellRing size={compact ? 16 : 22} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold tracking-wide uppercase opacity-85">Bảng tin Bơ Sầu{imp ? " · Quan trọng" : ""}</span>
            <span className={cn("block font-extrabold", compact ? "text-sm" : "text-lg")}>Nhắc việc {shiftLabel(r.shift)}</span>
          </span>
          <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-1 text-xs font-bold">
            {wd(r.date)} {dm(r.date)}
          </span>
        </div>
        {!compact && r.start && (
          <span className="text-[13px] opacity-90">
            Ca {r.start} – {r.end}
          </span>
        )}
      </div>
      <div className={cn("space-y-3", compact ? "p-3" : "p-4")}>
        <p className={cn("leading-snug font-bold whitespace-pre-line", compact ? "text-sm" : "text-lg")}>{r.text || "Nội dung nhắc việc…"}</p>
        <p className="text-xs text-ink/60">
          {r.by} · gửi {r.at}
        </p>
        {!compact && (
          <p className="rounded-xl bg-cream px-3 py-2 text-xs text-ink/70">
            Nhắc việc này nằm ở <b>Bảng tin</b> trang Chấm công tới hết {r.shift === "Tất cả" ? "ngày" : "ca" + (r.end ? ` (${r.end})` : "")}.
          </p>
        )}
        <button
          type="button"
          onClick={onOk}
          disabled={busy}
          className={cn("w-full rounded-2xl border border-primary-dark bg-primary font-extrabold text-on-primary disabled:opacity-60", compact ? "h-10 text-sm" : "h-13 text-base")}
        >
          {busy ? "Đang lưu…" : "Đã hiểu"}
        </button>
      </div>
    </section>
  );
}

/** Popup nhắc việc chưa xem – ở mọi trang của nhân viên (layout). Nhiều tin → lần lượt từng tin. */
export default function ReminderPopup({ items }: { items: ReminderItem[] }) {
  const [left, setLeft] = useState(items);
  const [busy, start] = useTransition();
  useEffect(() => setLeft(items), [items]);
  const r = left[0];
  useEffect(() => {
    if (!r) return;
    const o = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = o;
    };
  }, [r]);
  if (!r) return null;
  const ok = () =>
    start(async () => {
      await markShiftRemindersSeen([r.id]).catch(() => null);
      setLeft((l) => l.slice(1));
    });
  return (
    <div role="dialog" aria-modal="true" aria-label="Nhắc việc" className="fixed inset-0 z-[75] flex items-center justify-center bg-black/55 p-6">
      <div className="w-full max-w-sm animate-[tbs-toast_.25s_ease-out]">
        <ReminderCard r={r} onOk={ok} busy={busy} />
        {left.length > 1 && <p className="mt-2 text-center text-xs text-white/85">Còn {left.length - 1} nhắc việc nữa</p>}
      </div>
    </div>
  );
}

/** Bảng tin trang Chấm công: các nhắc việc của ca đang / sắp làm (tới hết ca) */
export function ReminderBoard({ items }: { items: ReminderItem[] }) {
  if (!items.length) return null;
  // tiêu đề theo nhắc việc của ca (nếu có); chỉ có nhắc "cả ngày" thì ghi cả ngày
  const head = items.find((x) => x.shift !== "Tất cả") ?? items[0];
  const end = head.end;
  return (
    <section aria-label="Bảng tin Bơ Sầu" className="space-y-2.5 rounded-2xl bg-info-bg p-3 ring-1 ring-info-line">
      <div className="flex items-center gap-2">
        <Megaphone size={19} className="text-info-fg" aria-hidden />
        <b className="flex-1 text-sm text-info-fg">Bảng tin Bơ Sầu</b>
        <span className="text-xs text-info-fg/80">
          {shiftLabel(head.shift).replace(/^c/, "C")}
          {end ? ` · tới ${end}` : ""}
        </span>
      </div>
      {items.map((r) => (
        <div key={r.id} className="flex gap-2.5 rounded-xl bg-card px-3 py-2.5">
          <span className={cn("w-1.5 shrink-0 rounded-full", r.level === "IMPORTANT" ? "bg-danger" : "bg-info-fg")} aria-hidden />
          <span className={cn("min-w-0 flex-1 text-sm", r.level === "IMPORTANT" ? "text-bad-fg" : "text-info-fg")}>
            {r.level === "IMPORTANT" && <span className="mr-1.5 rounded-full bg-bad-bg px-1.5 py-0.5 text-[11px] font-bold">Quan trọng</span>}
            <span className="whitespace-pre-line">{r.text}</span>
            <span className="mt-0.5 block text-xs opacity-75">
              {r.by} · {r.at}
            </span>
          </span>
        </div>
      ))}
    </section>
  );
}
