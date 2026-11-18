"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DatePickButton } from "@/components/DatePickButton";
import { ReminderCard } from "@/components/ShiftReminders";
import { deleteReminder, saveReminder } from "@/app/admin/actions/reminders";

export type EditReminder = { id: string; date: string; shift: string; storeIds: string[]; text: string; level: "NORMAL" | "IMPORTANT"; by: string };
const SHIFTS = ["Sáng", "Chiều", "Tối", "Tất cả"] as const;
const ALL = "Tất cả";
const chip = (on: boolean) => `rounded-xl px-3.5 py-2 text-sm font-semibold ${on ? "bg-accent text-on-accent" : "bg-card ring-1 ring-line-strong"}`;

/** Soạn nhắc nhở + xem trước popup / Bảng tin như nhân viên thấy */
export default function ReminderEditor({
  initial,
  today,
  stores,
  targets,
}: {
  initial: EditReminder | null;
  today: string;
  stores: { id: string; name: string }[];
  /** nhân viên nhận nhắc nhở đang mở (đã lưu) + đã xem chưa */
  targets: { name: string; seen: boolean }[];
}) {
  const router = useRouter();
  const [f, setF] = useState<EditReminder>(initial ?? { id: "", date: today, shift: "Sáng", storeIds: [], text: "", level: "NORMAL", by: "" });
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState("");
  const [, start] = useTransition();
  const set = <K extends keyof EditReminder>(k: K, v: EditReminder[K]) => setF((o) => ({ ...o, [k]: v }));
  const dirty = !initial || JSON.stringify({ ...f, by: "" }) !== JSON.stringify({ ...initial, by: "" });

  const save = () => {
    setBusy("save");
    setMsg({});
    start(async () => {
      const r = await saveReminder({ id: f.id || undefined, date: f.date, shift: f.shift, storeIds: f.storeIds, text: f.text, level: f.level }).catch(() => ({ error: "Mất kết nối – thử lại" }));
      setBusy("");
      if (r.error) return setMsg({ err: r.error });
      setMsg({ ok: f.id ? "Đã lưu thay đổi" : f.shift === ALL ? "Đã tạo nhắc nhở – mọi nhân viên cơ sở sẽ thấy khi mở app ngày đó" : "Đã tạo nhắc nhở – nhân viên ca đó sẽ thấy 30 phút trước giờ vào ca" });
      if (!f.id && "id" in r && r.id) router.replace(`/admin/reminders?id=${r.id}`);
      else router.refresh();
    });
  };
  const remove = () => {
    if (!f.id || !confirm("Xoá nhắc nhở này?")) return;
    setBusy("delete");
    start(async () => {
      const r = await deleteReminder(f.id).catch(() => ({ error: "Mất kết nối – thử lại" }));
      setBusy("");
      if (r.error) return setMsg({ err: r.error });
      router.replace("/admin/reminders");
    });
  };
  const clone = () => {
    setF((o) => ({ ...o, id: "", by: "" }));
    setMsg({ ok: "Đã nhân bản – chọn ngày / ca mới rồi bấm Lưu" });
  };

  const seen = targets.filter((t) => t.seen).length;
  return (
    <section className="grid gap-4 rounded-2xl bg-card p-4 ring-1 ring-line xl:grid-cols-[minmax(0,1fr)_290px]">
      <div className="space-y-4">
        <b className="text-accent">{f.id ? "Sửa nhắc nhở" : "Nhắc nhở mới"}</b>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <span className="block text-xs font-semibold text-accent">Ngày</span>
            <DatePickButton value={f.date} min={f.id ? undefined : today} onChange={(v) => v && set("date", v)} weekday />
          </div>
          <div className="space-y-1.5">
            <span className="block text-xs font-semibold text-accent">Ca</span>
            <div className="flex flex-wrap gap-1.5">
              {SHIFTS.map((s) => (
                <button key={s} type="button" onClick={() => set("shift", s)} className={chip(f.shift === s)}>
                  {s === ALL ? "Tất cả các ca" : s}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <span className="block text-xs font-semibold text-accent">Cơ sở</span>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => set("storeIds", [])} className={`rounded-full px-3 py-1.5 text-sm ${!f.storeIds.length ? "bg-accent font-bold text-on-accent" : "bg-card ring-1 ring-line-strong"}`}>
              Tất cả
            </button>
            {stores.map((s) => {
              const on = f.storeIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => set("storeIds", on ? f.storeIds.filter((x) => x !== s.id) : [...f.storeIds, s.id])}
                  className={`rounded-full px-3 py-1.5 text-sm ${on ? "bg-accent font-bold text-on-accent" : "bg-card ring-1 ring-line-strong"}`}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
          {f.id && !dirty && (
            <p className="text-xs text-ink/70">
              {targets.length ? (
                <>
                  Gửi cho <b>{targets.length} nhân viên</b> {f.shift === ALL ? "của cơ sở" : "có ca " + f.shift + " ngày này"}: {targets.map((t) => t.name).join(", ")}
                </>
              ) : (
                <span className="text-warn">{f.shift === ALL ? "Cơ sở chưa có nhân viên nào." : "Chưa có nhân viên nào được xếp ca " + f.shift + " ngày này – xếp ca xong sẽ tự nhận."}</span>
              )}
            </p>
          )}
        </div>
        <label className="block space-y-1.5">
          <span className="block text-xs font-semibold text-accent">Nội dung *</span>
          <textarea
            rows={3}
            maxLength={200}
            value={f.text}
            onChange={(e) => set("text", e.target.value)}
            placeholder="VD: 9h nhập sữa + đá – ca Sáng kiểm giúp nhé"
            className="w-full resize-none rounded-xl border border-line-strong bg-card px-3 py-2 text-base"
          />
          <span className="block text-right text-xs text-ink/50">{f.text.length}/200</span>
        </label>
        <div className="space-y-1.5">
          <span className="block text-xs font-semibold text-accent">Mức độ</span>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => set("level", "NORMAL")} className={`rounded-xl px-3.5 py-2 text-sm font-semibold ${f.level === "NORMAL" ? "bg-info-fg text-white" : "bg-card ring-1 ring-line-strong"}`}>
              Thông thường
            </button>
            <button type="button" onClick={() => set("level", "IMPORTANT")} className={`rounded-xl px-3.5 py-2 text-sm font-semibold ${f.level === "IMPORTANT" ? "bg-danger text-white" : "bg-card ring-1 ring-line-strong"}`}>
              Quan trọng (đỏ)
            </button>
          </div>
        </div>
        <p className="rounded-xl bg-info-bg px-3 py-2 text-[13px] text-info-fg">
          {f.shift === ALL ? (
            <>
              Gửi <b>mọi nhân viên của cơ sở</b> (dù ngày đó có ca hay không, kể cả người có ca hỗ trợ ở cơ sở): popup hiện khi mở app <b>trong ngày đó</b> · nằm ở Bảng tin tới hết ngày.
            </>
          ) : (
            <>
              Popup hiện <b>30 phút trước giờ vào ca {f.shift}</b> của từng nhân viên · nằm ở Bảng tin tới hết ca rồi tự ẩn.
            </>
          )}{" "}
          Sửa nội dung → nhân viên đã xem sẽ thấy lại.
        </p>
        {msg.err && <p className="rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad-fg">{msg.err}</p>}
        {msg.ok && <p className="rounded-xl bg-ok-bg px-3 py-2 text-sm text-good">{msg.ok}</p>}
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <button type="button" onClick={save} disabled={!!busy || !f.text.trim()} className="rounded-xl border border-primary-dark bg-primary px-4 py-2 font-extrabold text-on-primary disabled:opacity-50">
            {busy === "save" ? "Đang lưu…" : "Lưu nhắc nhở"}
          </button>
          {f.id && (
            <button type="button" onClick={clone} disabled={!!busy} className="rounded-xl bg-chip px-4 py-2 font-semibold">
              Nhân bản sang ngày khác
            </button>
          )}
          {f.id && (
            <button type="button" onClick={remove} disabled={!!busy} className="ml-auto px-2 py-2 font-semibold text-danger underline">
              {busy === "delete" ? "Đang xoá…" : "Xoá"}
            </button>
          )}
        </div>
      </div>

      <aside className="space-y-3">
        <span className="block text-sm font-semibold text-ink/70">Xem trước trên điện thoại</span>
        <div className="mx-auto w-[260px] rounded-[2.2rem] bg-ink/90 p-2.5 shadow-lg">
          <div className="flex min-h-[420px] items-center rounded-[1.8rem] bg-black/45 p-3">
            <div className="w-full">
              <ReminderCard compact r={{ date: f.date, shift: f.shift as "Sáng", text: f.text, level: f.level, by: f.by || "Admin", at: "07:30", start: "", end: "" }} />
            </div>
          </div>
        </div>
        <div className={`flex gap-2 rounded-xl p-2.5 text-xs ring-1 ${f.level === "IMPORTANT" ? "bg-bad-bg text-bad-fg ring-bad-line" : "bg-info-bg text-info-fg ring-info-line"}`}>
          <b className="shrink-0">Bảng tin:</b>
          <span className="min-w-0 break-words">{f.text || "…"}</span>
        </div>
        {f.id && targets.length > 0 && (
          <div className="rounded-xl bg-muted p-3 text-sm">
            <p className="mb-1 font-semibold">
              Đã xem {seen}/{targets.length}
            </p>
            <ul className="space-y-0.5 text-xs">
              {targets.map((t) => (
                <li key={t.name} className={t.seen ? "text-good" : "text-ink/70"}>
                  {t.seen ? "✓" : "○"} {t.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </section>
  );
}
