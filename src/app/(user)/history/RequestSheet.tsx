"use client";
import { useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Loader2, Plus, X } from "lucide-react";
import { normalizeTime } from "@/components/TimeInput";
import { roundedHours, type RoundingConfig } from "@/lib/calc";
import { ATT_EDIT_EVENT } from "@/components/user/AttEditButton";
import { submitAdjustment } from "../actions";

/** 1 lượt chấm công để chọn sửa giờ (giờ HH:mm theo giờ cơ sở) */
export type PickAtt = {
  id: string;
  workDate: string;
  /** "Thứ 5 · 12/11" */
  day: string;
  shiftLabel: string | null;
  /** giờ bắt đầu / hết khối ca được xếp (điền nhanh "Đúng giờ ca") */
  shiftStart: string | null;
  shiftEnd: string | null;
  inTime: string;
  outTime: string | null;
  hours: number | null;
  status: string;
  late: number;
  early: number;
  /** đã có yêu cầu sửa đang chờ duyệt */
  pending: boolean;
  /** tháng đã trả lương */
  locked: boolean;
};
export type DayShift = { name: string; start: string; end: string };
type Kind = "MISSING" | "EDIT";

const toMin = (t: string) => {
  const n = normalizeTime(t);
  if (!n) return null;
  const [h, m] = n.split(":").map(Number);
  return h * 60 + m;
};
/** [vào, ra] tính bằng phút trong ngày; ra ≤ vào = qua đêm */
const span = (a: string, b: string): [number, number] | null => {
  const s = toMin(a);
  const e = toMin(b);
  if (s == null || e == null) return null;
  return [s, e <= s ? e + 1440 : e];
};
/** lượt đã chấm: quên check-out chỉ có giờ vào, đang trong ca tính tới hết ngày */
const attSpan = (a: PickAtt): [number, number] => {
  const s = toMin(a.inTime) ?? 0;
  if (a.status === "OPEN") return [s, 2880];
  const e = a.outTime ? toMin(a.outTime) : null;
  return [s, e == null ? s : e <= s ? e + 1440 : e];
};
const overlaps = (r: [number, number], a: [number, number]) => (a[1] === a[0] ? a[0] >= r[0] && a[0] < r[1] : Math.min(a[1], r[1]) - Math.max(a[0], r[0]) > 0);
const hv = (n: number | null | undefined) => `${String(n ?? 0).replace(".", ",")}h`;
const ddmm = (ymd: string) => `${ymd.slice(8)}/${ymd.slice(5, 7)}`;
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}'` : `${m}'`);

const REASONS: Record<Kind, string[]> = {
  MISSING: ["Quên cả check-in và check-out", "Điện thoại hết pin", "Lỗi app / GPS / WiFi"],
  EDIT: ["Quên check-out", "Vào làm rồi mới check-in", "Bấm nhầm giờ", "Lỗi app / GPS / WiFi"],
};

function Chip({ on, disabled, onClick, children }: { on?: boolean; disabled?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full px-3 py-2 text-sm ${on ? "bg-accent text-white" : disabled ? "bg-[#f6f0e0] text-ink/50 line-through" : "bg-white text-ink ring-1 ring-[#e2d3b0] active:bg-primary-light"}`}
    >
      {children}
    </button>
  );
}

function TimeBox({ label, value, onChange, hint, warn }: { label: string; value: string; onChange: (v: string) => void; hint?: string; warn?: boolean }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold">
      <span>
        {label} <span className="text-danger">*</span>
      </span>
      <input
        inputMode="numeric"
        autoComplete="off"
        maxLength={5}
        placeholder="VD 08:30"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d:.h]/g, ""))}
        onBlur={() => {
          const n = normalizeTime(value);
          if (n) onChange(n);
        }}
        className="h-12 w-full rounded-xl bg-white px-3 text-base font-normal text-ink ring-1 ring-[#e2d3b0] focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {hint && <span className={`text-xs font-medium ${warn ? "text-[#c2410c]" : "text-ink/70"}`}>{hint}</span>}
    </label>
  );
}

function Reason({ kind, value, onChange }: { kind: Kind; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">
        Lý do <span className="text-danger">*</span>
      </span>
      <div className="flex flex-wrap gap-1.5">
        {REASONS[kind].map((r) => (
          <Chip key={r} on={value === r} onClick={() => onChange(r)}>
            {r}
          </Chip>
        ))}
      </div>
      <textarea
        rows={2}
        aria-label="Lý do"
        value={value}
        maxLength={300}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ghi rõ để admin duyệt nhanh"
        className="resize-none rounded-xl bg-white px-3 py-2.5 text-base text-ink ring-1 ring-[#e2d3b0] focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  );
}

/**
 * Popup "Gửi yêu cầu chấm công" (trang Lịch sử) – 2 tab:
 *  - Quên chấm công: chấm bù 1 ca app không có lượt nào (bắt buộc ngày, giờ vào, giờ ra, lý do).
 *  - Sửa giờ ca đã chấm: chọn 1 lượt (hoặc bấm nhãn Quên check-out / Muộn / Sớm trong bảng) → sửa giờ vào / ra.
 * Dữ liệu từng tab giữ riêng; gửi lỗi (kể cả mất mạng) → giữ nguyên, chỉ hiện lỗi. Gửi xong mới xoá.
 */
export default function RequestSheet({
  atts,
  shifts,
  today,
  minDate,
  round,
}: {
  atts: PickAtt[];
  shifts: Record<string, DayShift[]>;
  today: string;
  minDate: string;
  round: RoundingConfig;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Kind>("MISSING");
  // tab Quên chấm công
  const [date, setDate] = useState(today);
  const [mIn, setMIn] = useState("");
  const [mOut, setMOut] = useState("");
  const [mReason, setMReason] = useState("");
  // tab Sửa giờ
  const [attId, setAttId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [eIn, setEIn] = useState("");
  const [eOut, setEOut] = useState("");
  const [eReason, setEReason] = useState("");
  const [error, setError] = useState<{ msg: string; overlapId?: string } | null>(null);
  const [toast, setToast] = useState("");
  const [sending, startSend] = useTransition();

  const byId = useMemo(() => new Map(atts.map((a) => [a.id, a])), [atts]);
  const usable = (a: PickAtt) => !a.pending && !a.locked && a.status !== "OPEN";
  const att = attId ? (byId.get(attId) ?? null) : null;
  const hrs = (sp: [number, number] | null) => (sp ? roundedHours(new Date(0), new Date((sp[1] - sp[0]) * 60_000), round) : null);

  /** mở tab Sửa giờ với 1 lượt (carry: giờ / lý do mang từ tab chấm bù sang) */
  const editAtt = useCallback(
    (id: string, carry?: { inT?: string; outT?: string; reason?: string }) => {
      const a = byId.get(id);
      if (!a) return;
      setTab("EDIT");
      setAttId(id);
      setChoosing(false);
      setError(null);
      setEIn(carry?.inT || a.inTime);
      setEOut(carry?.outT || a.outTime || "");
      if (carry?.reason) setEReason(carry.reason);
    },
    [byId],
  );

  // bấm nhãn Quên check-out / Muộn / Sớm trong bảng chấm công → mở đúng lượt
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const a = byId.get(id);
      if (!a || !usable(a)) return;
      editAtt(id);
      setOpen(true);
    };
    window.addEventListener(ATT_EDIT_EVENT, on);
    return () => window.removeEventListener(ATT_EDIT_EVENT, on);
  }, [byId, editAtt]);
  // mở popup: khoá cuộn trang phía sau
  useEffect(() => {
    if (!open) return;
    const o = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = o;
    };
  }, [open]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const openSheet = () => {
    // còn lượt quên check-out chưa gửi → mở sẵn tab Sửa giờ để chọn
    if (!attId && atts.some((a) => a.status === "MISSING_CHECKOUT" && usable(a))) {
      setTab("EDIT");
      setChoosing(true);
    }
    setError(null);
    setOpen(true);
  };

  /* ---- tab Quên chấm công ---- */
  const dayAtts = atts.filter((a) => a.workDate === date);
  const mSpan = span(mIn, mOut);
  const clash = mSpan ? dayAtts.find((a) => overlaps(mSpan, attSpan(a))) : undefined;
  const dayShifts = (shifts[date] ?? []).map((s) => {
    const sp = span(s.start, s.end);
    return { ...s, done: !!sp && dayAtts.some((a) => overlaps(sp, attSpan(a))) };
  });

  /* ---- tab Sửa giờ ---- */
  const eSpan = span(eIn, eOut);
  const inDiff = att ? (toMin(att.inTime) ?? 0) - (toMin(eIn) ?? toMin(att.inTime) ?? 0) : 0;
  const changed = !!att && (normalizeTime(eIn) !== att.inTime || (normalizeTime(eOut) || null) !== att.outTime);
  const picks = [...atts].sort((a, b) => Number(b.status === "MISSING_CHECKOUT" && usable(b)) - Number(a.status === "MISSING_CHECKOUT" && usable(a)));
  const shown = showAll ? picks : picks.slice(0, 8);

  const send = () => {
    setError(null);
    const fd = new FormData();
    fd.set("kind", tab);
    if (tab === "EDIT") {
      const i = normalizeTime(eIn);
      const o = normalizeTime(eOut);
      if (!att) return setError({ msg: "Chọn lượt cần sửa" });
      if (!i) return setError({ msg: "Nhập giờ vào (dạng 24h, VD 08:00)" });
      if (!o) return setError({ msg: "Nhập giờ ra (dạng 24h, VD 17:30)" });
      if (!changed) return setError({ msg: "Bạn chưa đổi giờ nào so với app đang ghi" });
      if (eReason.trim().length < 5) return setError({ msg: "Nhập lý do (ít nhất 5 ký tự)" });
      fd.set("attendanceId", att.id);
      fd.set("checkInTime", i);
      fd.set("checkOutTime", o);
      fd.set("reason", eReason.trim());
    } else {
      const i = normalizeTime(mIn);
      const o = normalizeTime(mOut);
      if (!date) return setError({ msg: "Chọn ngày làm" });
      if (!i) return setError({ msg: "Nhập giờ vào (dạng 24h, VD 08:00)" });
      if (!o) return setError({ msg: "Nhập giờ ra (dạng 24h, VD 17:30)" });
      if (clash) return setError({ msg: `Trùng lượt đã chấm ${clash.inTime} → ${clash.outTime ?? "quên check-out"} (${clash.shiftLabel ?? "ngoài ca"}). Không thể chấm bù chồng lên lượt đã có.`, overlapId: clash.id });
      if (mReason.trim().length < 5) return setError({ msg: "Nhập lý do (ít nhất 5 ký tự)" });
      fd.set("workDate", date);
      fd.set("checkInTime", i);
      fd.set("checkOutTime", o);
      fd.set("reason", mReason.trim());
    }
    const kind = tab;
    startSend(async () => {
      try {
        const r = await submitAdjustment(null, fd);
        if (r?.ok) {
          if (kind === "EDIT") {
            setAttId(null);
            setEIn("");
            setEOut("");
            setEReason("");
          } else {
            setMIn("");
            setMOut("");
            setMReason("");
          }
          setOpen(false);
          setToast(kind === "EDIT" ? "Đã gửi yêu cầu sửa giờ – chờ admin duyệt." : "Đã gửi yêu cầu chấm bù – chờ admin duyệt.");
          router.refresh();
        } else setError({ msg: r?.error || "Gửi không thành công – thử lại", overlapId: r?.overlapId });
      } catch {
        setError({ msg: "Mất kết nối mạng – dữ liệu vẫn còn, bấm Gửi lại." });
      }
    });
  };

  const tabBtn = (k: Kind, title: string, sub: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === k}
      onClick={() => {
        setTab(k);
        setError(null);
        if (k === "EDIT" && !attId) setChoosing(true);
      }}
      className={`rounded-[11px] px-1.5 py-2 text-center ${tab === k ? "bg-primary text-ink shadow-sm" : "text-ink/70"}`}
    >
      <span className={`block text-sm ${tab === k ? "font-bold" : "font-semibold"}`}>{title}</span>
      <span className="block text-[11px]">{sub}</span>
    </button>
  );
  const overlapAtt = error?.overlapId ? byId.get(error.overlapId) : undefined;

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-semibold text-white active:scale-[.99]"
      >
        <Plus size={18} aria-hidden /> Gửi yêu cầu chấm công
      </button>
      {toast && (
        <div role="status" className="fixed inset-x-0 top-3 z-[60] flex justify-center px-4">
          <div className="flex max-w-md items-center gap-2 rounded-2xl bg-secondary-dark px-4 py-3 text-sm text-white shadow-lg">
            <Check size={18} aria-hidden /> {toast}
          </div>
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 sm:items-center sm:p-4" onClick={() => !sending && setOpen(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Gửi yêu cầu chấm công"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92dvh] w-full max-w-md flex-col gap-3.5 overflow-y-auto rounded-t-3xl bg-cream px-4 pb-5 pt-2.5 text-ink sm:rounded-3xl"
          >
            <div className="mx-auto h-1 w-10 shrink-0 rounded bg-[#e2d3b0] sm:hidden" />
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-accent">Gửi yêu cầu chấm công</h2>
              <button type="button" aria-label="Đóng" onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full bg-white ring-1 ring-[#f1e6c8]">
                <X size={16} />
              </button>
            </div>
            <div role="tablist" className="grid grid-cols-2 gap-1 rounded-2xl bg-[#f3e9cf] p-1">
              {tabBtn("MISSING", "Quên chấm công", "Chấm bù ca bị thiếu")}
              {tabBtn("EDIT", "Sửa giờ ca đã chấm", "Quên check-out, vào sớm…")}
            </div>

            {tab === "MISSING" ? (
              <>
                <p className="text-[13px] leading-relaxed text-ink/75">
                  Bạn đã đi làm nhưng <b>app không có lượt nào</b> cho ca đó (quên cả check-in lẫn check-out). Admin duyệt → thêm 1 lượt chấm công mới.
                </p>
                <label className="flex flex-col gap-1.5 text-sm font-semibold">
                  <span>
                    Ngày làm <span className="text-danger">*</span>
                  </span>
                  <input
                    type="date"
                    value={date}
                    min={minDate}
                    max={today}
                    onChange={(e) => setDate(e.target.value)}
                    className="h-12 rounded-xl bg-white px-3 text-base font-normal text-ink ring-1 ring-[#e2d3b0] focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </label>
                {dayShifts.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold">
                      Ca được xếp hôm đó <span className="font-medium text-ink/70">(bấm để điền giờ)</span>
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {dayShifts.map((s) => (
                        <Chip
                          key={`${s.name}${s.start}`}
                          disabled={s.done}
                          on={!s.done && normalizeTime(mIn) === s.start && normalizeTime(mOut) === s.end}
                          onClick={() => {
                            setMIn(s.start);
                            setMOut(s.end);
                          }}
                        >
                          {s.name} {s.start}–{s.end}
                          {s.done ? " · đã chấm" : ""}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <TimeBox label="Giờ vào" value={mIn} onChange={setMIn} />
                  <TimeBox label="Giờ ra" value={mOut} onChange={setMOut} />
                </div>
                <p className="-mt-1.5 text-xs text-ink/70">Cả giờ vào và giờ ra đều bắt buộc. Giờ ra nhỏ hơn giờ vào = làm qua đêm.</p>
                {mSpan &&
                  (clash ? (
                    <div className="rounded-xl bg-[#fdecec] px-3 py-2.5 text-[13px] leading-relaxed text-[#9f1d1d] ring-1 ring-[#f5c2c2]">
                      <b>Trùng lượt đã chấm:</b> {clash.shiftLabel ?? "Ngoài ca"} {clash.inTime} → {clash.outTime ?? "quên check-out"}.
                      {usable(clash) && (
                        <button
                          type="button"
                          onClick={() => editAtt(clash.id, { inT: normalizeTime(mIn) || undefined, outT: normalizeTime(mOut) || undefined, reason: mReason })}
                          className="mt-2 block rounded-lg bg-white px-3 py-2 font-bold text-accent ring-1 ring-[#f5c2c2]"
                        >
                          Sửa giờ lượt {clash.inTime} → {clash.outTime ?? "…"} thay vì chấm bù
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl bg-[#eef7f0] px-3 py-2.5 text-[13px] leading-relaxed ring-1 ring-[#bfe3c8]">
                      {dayAtts.length > 0 ? (
                        <>
                          Hôm {ddmm(date)} app đã có: <b>{dayAtts.map((a) => `${a.shiftLabel ?? "Ngoài ca"} ${a.inTime} → ${a.outTime ?? "quên check-out"}`).join("; ")}</b>. Không trùng → sẽ{" "}
                        </>
                      ) : (
                        <>Sẽ </>
                      )}
                      thêm lượt mới{" "}
                      <b>
                        {normalizeTime(mIn)} → {normalizeTime(mOut)} · {hv(hrs(mSpan))}
                      </b>
                      .
                    </div>
                  ))}
                <Reason kind="MISSING" value={mReason} onChange={setMReason} />
              </>
            ) : choosing || !att ? (
              <>
                <p className="text-sm font-semibold">Chọn lượt cần sửa</p>
                {picks.length === 0 ? (
                  <p className="rounded-xl bg-white px-3 py-3 text-sm text-ink/70 ring-1 ring-[#f1e6c8]">Chưa có lượt chấm công nào trong tháng này và tháng trước.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {shown.map((a) => {
                      const ok = usable(a);
                      const missing = a.status === "MISSING_CHECKOUT";
                      return (
                        <button
                          key={a.id}
                          type="button"
                          disabled={!ok}
                          onClick={() => editAtt(a.id)}
                          className={`flex items-center gap-2.5 rounded-2xl p-3 text-left ${ok ? `bg-white ring-1 ${missing ? "ring-[#f5c2c2]" : "ring-[#f1e6c8]"} active:bg-primary-light` : "bg-[#f6f0e0] text-ink/60 ring-1 ring-[#f1e6c8]"}`}
                        >
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="text-sm font-bold">
                              {a.day}
                              {a.shiftLabel ? ` · ${a.shiftLabel}` : " · Ngoài ca"}
                            </span>
                            <span className="text-[13px]">
                              vào {a.inTime} → {a.outTime ? `ra ${a.outTime} · ${hv(a.hours)}` : a.status === "OPEN" ? "đang trong ca" : <b className="text-danger">quên check-out</b>}
                            </span>
                          </span>
                          {a.pending ? (
                            <span className="whitespace-nowrap rounded-full bg-[#fef3c7] px-2 py-0.5 text-xs font-semibold text-[#854d0e]">Đang chờ duyệt</span>
                          ) : a.locked ? (
                            <span className="whitespace-nowrap rounded-full bg-[#eee] px-2 py-0.5 text-xs font-semibold">Đã trả lương</span>
                          ) : a.status === "OPEN" ? (
                            <span className="whitespace-nowrap rounded-full bg-primary-light px-2 py-0.5 text-xs font-semibold">Đang trong ca</span>
                          ) : missing ? (
                            <span className="whitespace-nowrap rounded-full bg-[#b91c1c] px-2 py-0.5 text-xs font-semibold text-white">Quên check-out</span>
                          ) : a.late ? (
                            <span className="whitespace-nowrap rounded-full bg-[#ffedd5] px-2 py-0.5 text-xs font-semibold text-[#9a3412]">Muộn {mins(a.late)}</span>
                          ) : a.early ? (
                            <span className="whitespace-nowrap rounded-full bg-[#ffedd5] px-2 py-0.5 text-xs font-semibold text-[#9a3412]">Sớm {mins(a.early)}</span>
                          ) : null}
                          {ok && <ChevronRight size={18} className="shrink-0" aria-hidden />}
                        </button>
                      );
                    })}
                    {picks.length > shown.length && (
                      <button type="button" onClick={() => setShowAll(true)} className="self-center px-3 py-2 text-sm font-semibold text-accent">
                        Xem thêm {picks.length - shown.length} lượt cũ hơn
                      </button>
                    )}
                  </div>
                )}
                <p className="text-xs leading-relaxed text-ink/70">Lượt quên check-out luôn ở trên cùng. Chỉ hiện tháng này và tháng trước; lượt đang chờ duyệt hoặc tháng đã trả lương không chọn được.</p>
                <p className="rounded-xl bg-white px-3 py-2.5 text-[13px] leading-relaxed ring-1 ring-[#f1e6c8]">
                  Không thấy lượt nào cho ca bạn đã làm? Đó là quên chấm công → dùng tab{" "}
                  <button type="button" onClick={() => setTab("MISSING")} className="font-bold text-accent underline">
                    Quên chấm công
                  </button>
                  .
                </p>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5 rounded-2xl bg-white p-3 ring-2 ring-primary">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-ink/70">LƯỢT CẦN SỬA</span>
                    <button type="button" onClick={() => setChoosing(true)} className="text-[13px] font-semibold text-accent underline">
                      Đổi lượt khác
                    </button>
                  </div>
                  <p className="text-[15px] font-bold">
                    {att.day}
                    {att.shiftLabel ? ` · ${att.shiftLabel}` : " · Ngoài ca"}
                  </p>
                  <p className="text-[13px]">
                    App đang ghi: vào <b>{att.inTime}</b> →{" "}
                    {att.outTime ? (
                      <>
                        ra <b>{att.outTime}</b>
                      </>
                    ) : (
                      <span className="rounded-full bg-[#b91c1c] px-2 py-0.5 text-xs font-semibold text-white">Quên check-out</span>
                    )}
                  </p>
                  <p className="text-xs text-ink/70">Giờ công đang tính: {hv(att.hours)}</p>
                </div>
                {att.shiftStart && att.shiftEnd && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold">Điền nhanh</span>
                    <div className="flex flex-wrap gap-1.5">
                      <Chip
                        on={normalizeTime(eIn) === att.shiftStart && normalizeTime(eOut) === att.shiftEnd}
                        onClick={() => {
                          setEIn(att.shiftStart!);
                          setEOut(att.shiftEnd!);
                        }}
                      >
                        Đúng giờ ca {att.shiftStart} → {att.shiftEnd}
                      </Chip>
                      {!att.outTime && (
                        <Chip
                          on={normalizeTime(eIn) === att.inTime && normalizeTime(eOut) === att.shiftEnd}
                          onClick={() => {
                            setEIn(att.inTime);
                            setEOut(att.shiftEnd!);
                          }}
                        >
                          Giữ giờ vào, ra {att.shiftEnd}
                        </Chip>
                      )}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <TimeBox
                    label="Giờ vào"
                    value={eIn}
                    onChange={setEIn}
                    warn={inDiff !== 0}
                    hint={inDiff > 0 ? `App ghi ${att.inTime} · sớm hơn ${mins(inDiff)}` : inDiff < 0 ? `App ghi ${att.inTime} · muộn hơn ${mins(-inDiff)}` : undefined}
                  />
                  <TimeBox label="Giờ ra" value={eOut} onChange={setEOut} hint={att.shiftEnd ? `Ca kết thúc ${att.shiftEnd}` : undefined} />
                </div>
                {changed && eSpan && (
                  <div className="rounded-xl bg-primary-light px-3 py-2.5 text-[13px] leading-relaxed">
                    <b>Sau khi admin duyệt</b>
                    <div className="grid grid-cols-[72px_1fr] gap-x-2">
                      <span className="text-ink/70">Giờ vào</span>
                      <span>
                        {att.inTime} → <b>{normalizeTime(eIn)}</b>
                      </span>
                      <span className="text-ink/70">Giờ ra</span>
                      <span>
                        {att.outTime ?? "quên"} → <b>{normalizeTime(eOut)}</b>
                      </span>
                      <span className="text-ink/70">Giờ công</span>
                      <span>
                        {hv(att.hours)} → <b>{hv(hrs(eSpan))}</b>
                      </span>
                    </div>
                  </div>
                )}
                <Reason kind="EDIT" value={eReason} onChange={setEReason} />
              </>
            )}

            {error && (
              <div role="alert" className="flex flex-col gap-2 rounded-xl bg-[#fdecec] px-3 py-2.5 text-[13px] leading-relaxed text-[#9f1d1d] ring-1 ring-[#f5c2c2]">
                <span>{error.msg}</span>
                {tab === "MISSING" && overlapAtt && usable(overlapAtt) && !clash && (
                  <button
                    type="button"
                    onClick={() => editAtt(overlapAtt.id, { inT: normalizeTime(mIn) || undefined, outT: normalizeTime(mOut) || undefined, reason: mReason })}
                    className="self-start rounded-lg bg-white px-3 py-2 font-bold text-accent ring-1 ring-[#f5c2c2]"
                  >
                    Sửa giờ lượt {overlapAtt.inTime} → {overlapAtt.outTime ?? "…"} thay vì chấm bù
                  </button>
                )}
              </div>
            )}
            {!(tab === "EDIT" && (choosing || !att)) && (
              <div className="mt-auto flex flex-col gap-2">
                <button
                  type="button"
                  onClick={send}
                  disabled={sending}
                  className="flex h-[50px] items-center justify-center gap-2 rounded-2xl bg-primary text-base font-bold text-ink disabled:opacity-70"
                >
                  {sending && <Loader2 size={18} className="animate-spin" aria-hidden />}
                  {sending ? "Đang gửi…" : error ? "Gửi lại" : tab === "EDIT" ? "Gửi yêu cầu sửa giờ" : "Gửi yêu cầu chấm bù"}
                </button>
                <p className="text-center text-xs text-ink/70">
                  {tab === "EDIT" ? "Admin duyệt → sửa đúng lượt này, không tạo lượt mới." : "Ca đã có lượt rồi nhưng sai giờ? Dùng tab Sửa giờ ca đã chấm."}
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
