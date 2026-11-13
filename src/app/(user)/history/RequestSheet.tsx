"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Loader2, Plus, X } from "lucide-react";
import { normalizeTime } from "@/components/TimeInput";
import { roundedHours, type RoundingConfig } from "@/lib/calc";
import { ATT_EDIT_EVENT } from "@/components/user/AttEditButton";
import { minutesVi as mins } from "@/lib/format";
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
/** giờ vào / ra vô lý: trùng nhau (= 24 tiếng) hoặc quá 16 tiếng → báo ngay dưới ô giờ, không cho gửi */
const MAX_SPAN_MIN = 16 * 60;
const spanIssue = (sp: [number, number] | null) => {
  if (!sp) return null;
  const d = sp[1] - sp[0];
  if (d === 1440) return "Giờ ra trùng giờ vào – kiểm tra lại.";
  if (d > MAX_SPAN_MIN)
    return `Một lượt làm việc không quá 16 tiếng (đang là ${Math.floor(d / 60)} tiếng${d % 60 ? ` ${d % 60} phút` : ""}). Kiểm tra lại giờ vào / giờ ra – giờ ra nhỏ hơn giờ vào là làm qua đêm.`;
  return null;
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
      className={`rounded-full px-3 py-2 text-sm ${on ? "bg-accent text-on-accent" : disabled ? "bg-muted text-ink/50 line-through" : "bg-card text-ink ring-1 ring-line-strong active:bg-primary-light"}`}
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
        // chạm vào ô đã có giờ (đủ 5 ký tự) → chọn hết để gõ đè luôn, không bị kẹt do giới hạn 5 ký tự
        onFocus={(e) => {
          const el = e.currentTarget;
          window.setTimeout(() => el.setSelectionRange(0, el.value.length), 0);
        }}
        onBlur={() => {
          const n = normalizeTime(value);
          if (n) onChange(n);
        }}
        className="h-12 w-full rounded-xl bg-card px-3 text-base font-normal text-ink ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {hint && <span className={`text-xs font-medium ${warn ? "text-late-fg" : "text-ink/70"}`}>{hint}</span>}
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
        className="resize-none rounded-xl bg-card px-3 py-2.5 text-base text-ink ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  );
}

/**
 * Popup "Gửi yêu cầu chấm công" (trang Lịch sử) – 2 tab:
 *  - Quên chấm công: chấm bù 1 ca app không có lượt nào (bắt buộc ngày, giờ vào, giờ ra, lý do).
 *  - Sửa giờ ca đã chấm: chọn 1 lượt (hoặc bấm nhãn Quên check-out / Đi muộn / Về sớm trong bảng) → sửa giờ vào / ra.
 * Dữ liệu từng tab giữ riêng; gửi lỗi (kể cả mất mạng) → giữ nguyên, chỉ hiện lỗi. Gửi thành công → xoá sạch cả 2 tab.
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

  /**
   * Nút "Sửa giờ lượt … thay vì chấm bù": hiện đang mở (vòng xoay) cho người dùng thấy đã bấm,
   * rồi chuyển sang tab Sửa giờ (mang theo giờ + lý do đã điền) và cuộn popup lên đầu để thấy form.
   */
  const sheetRef = useRef<HTMLElement>(null);
  const [jumping, setJumping] = useState<string | null>(null);
  const jumpToEdit = (a: PickAtt) => {
    if (jumping) return;
    setJumping(a.id);
    const carry = { inT: normalizeTime(mIn) || undefined, outT: normalizeTime(mOut) || undefined, reason: mReason };
    window.setTimeout(() => {
      editAtt(a.id, carry);
      setJumping(null);
      sheetRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }, 350);
  };
  const jumpBtn = (a: PickAtt, className: string) => (
    <button
      type="button"
      onClick={() => jumpToEdit(a)}
      disabled={!!jumping}
      aria-busy={jumping === a.id || undefined}
      className={`inline-flex items-center gap-2 rounded-lg bg-card px-3 py-2 font-bold text-accent ring-1 ring-bad-line active:scale-[.98] disabled:opacity-80 ${className}`}
    >
      {jumping === a.id ? (
        <>
          <Loader2 size={16} className="animate-spin" aria-hidden /> Đang mở lượt {a.inTime} → {a.outTime ?? "…"}…
        </>
      ) : (
        <>
          Sửa giờ lượt {a.inTime} → {a.outTime ?? "…"} thay vì chấm bù
        </>
      )}
    </button>
  );

  // bấm nhãn Quên check-out / Đi muộn / Về sớm trong bảng chấm công → mở đúng lượt
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
  /**
   * iPhone (Safari): popup cố định có ô nhập → bật bàn phím, Safari tự cuộn trang phía sau làm popup lệch khỏi chỗ chạm
   * (chạm ô Giờ vào không được, chạm nhiều lần như bị đơ). Cách chữa:
   *  - khoá hẳn trang phía sau (body position: fixed, giữ vị trí cuộn, trả lại khi đóng)
   *  - khung popup bám theo vùng nhìn thấy (visualViewport) → bàn phím mở thì popup co lại phía trên bàn phím
   */
  const [vv, setVv] = useState<{ top: number; h: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const y = window.scrollY;
    const b = document.body.style;
    const prev = { position: b.position, top: b.top, left: b.left, right: b.right, overflow: b.overflow };
    Object.assign(b, { position: "fixed", top: `-${y}px`, left: "0", right: "0", overflow: "hidden" });
    const v = window.visualViewport;
    // chỉ bám theo vùng nhìn thấy khi bàn phím đang mở (vùng nhìn thấy thấp hơn hẳn cửa sổ); bình thường để popup phủ kín như cũ
    const fit = () => v && setVv(v.height < window.innerHeight - 120 ? { top: v.offsetTop, h: v.height } : null);
    fit();
    v?.addEventListener("resize", fit);
    v?.addEventListener("scroll", fit);
    return () => {
      v?.removeEventListener("resize", fit);
      v?.removeEventListener("scroll", fit);
      Object.assign(b, prev);
      window.scrollTo(0, y);
      setVv(null);
    };
  }, [open]);
  // gửi bị lỗi → cuộn tới ô báo lỗi (tránh lỗi nằm khuất dưới đáy popup / sau thanh trình duyệt)
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [error]);
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
  const mIssue = spanIssue(mSpan);
  const clash = mSpan && !mIssue ? dayAtts.find((a) => overlaps(mSpan, attSpan(a))) : undefined;
  const dayShifts = (shifts[date] ?? []).map((s) => {
    const sp = span(s.start, s.end);
    return { ...s, done: !!sp && dayAtts.some((a) => overlaps(sp, attSpan(a))) };
  });

  /* ---- tab Sửa giờ ---- */
  const eSpan = span(eIn, eOut);
  const eIssue = spanIssue(eSpan);
  const inDiff = att ? (toMin(att.inTime) ?? 0) - (toMin(eIn) ?? toMin(att.inTime) ?? 0) : 0;
  const changed = !!att && (normalizeTime(eIn) !== att.inTime || (normalizeTime(eOut) || null) !== att.outTime);
  const picks = [...atts].sort((a, b) => Number(b.status === "MISSING_CHECKOUT" && usable(b)) - Number(a.status === "MISSING_CHECKOUT" && usable(a)));
  const shown = showAll ? picks : picks.slice(0, 8);

  /** Về trạng thái ban đầu: cả tab Quên chấm công lẫn Sửa giờ (giờ, lý do, lượt đã chọn, ngày) */
  const resetForm = () => {
    setTab("MISSING");
    setDate(today);
    setMIn("");
    setMOut("");
    setMReason("");
    setAttId(null);
    setChoosing(false);
    setShowAll(false);
    setEIn("");
    setEOut("");
    setEReason("");
    setError(null);
  };

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
      if (eIssue) return setError({ msg: eIssue });
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
      if (mIssue) return setError({ msg: mIssue });
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
          resetForm(); // gửi thành công (tab nào cũng vậy) → xoá sạch cả 2 tab, lần mở sau là form trống
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
      className={`rounded-[11px] px-1.5 py-2 text-center ${tab === k ? "bg-primary text-on-primary shadow-sm" : "text-ink/70"}`}
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
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-semibold text-on-accent active:scale-[.99]"
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
        <div
          className="fixed inset-x-0 top-0 bottom-0 z-50 flex touch-manipulation items-end justify-center bg-shade/50 sm:items-center sm:p-4"
          style={vv ? { top: vv.top, height: vv.h, bottom: "auto" } : undefined}
          onClick={() => !sending && setOpen(false)}
        >
          <section
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Gửi yêu cầu chấm công"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92%] w-full max-w-md flex-col gap-3.5 overflow-y-auto overscroll-contain rounded-t-3xl bg-cream px-4 pb-5 pt-2.5 text-ink sm:rounded-3xl"
          >
            <div className="mx-auto h-1 w-10 shrink-0 rounded bg-line-strong sm:hidden" />
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-accent">Gửi yêu cầu chấm công</h2>
              <button type="button" aria-label="Đóng" onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full bg-card ring-1 ring-line">
                <X size={16} />
              </button>
            </div>
            <div role="tablist" className="grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1">
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
                    className="h-12 rounded-xl bg-card px-3 text-base font-normal text-ink ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-primary"
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
                  (mIssue ? (
                    <div role="alert" className="rounded-xl bg-bad-soft px-3 py-2.5 text-[13px] leading-relaxed text-bad-fg ring-1 ring-bad-line">
                      {mIssue}
                    </div>
                  ) : clash ? (
                    <div className="rounded-xl bg-bad-soft px-3 py-2.5 text-[13px] leading-relaxed text-bad-fg ring-1 ring-bad-line">
                      <b>Trùng lượt đã chấm:</b> {clash.shiftLabel ?? "Ngoài ca"} {clash.inTime} → {clash.outTime ?? "quên check-out"}.
                      {usable(clash) && <div className="mt-2">{jumpBtn(clash, "")}</div>}
                    </div>
                  ) : (
                    <div className="rounded-xl bg-ok-soft px-3 py-2.5 text-[13px] leading-relaxed ring-1 ring-ok-line">
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
                  <p className="rounded-xl bg-card px-3 py-3 text-sm text-ink/70 ring-1 ring-line">Chưa có lượt chấm công nào trong tháng này và tháng trước.</p>
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
                          className={`flex items-center gap-2.5 rounded-2xl p-3 text-left ${ok ? `bg-card ring-1 ${missing ? "ring-bad-line" : "ring-line"} active:bg-primary-light` : "bg-muted text-ink/60 ring-1 ring-line"}`}
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
                            <span className="whitespace-nowrap rounded-full bg-wait-bg px-2 py-0.5 text-xs font-semibold text-wait-fg">Đang chờ duyệt</span>
                          ) : a.locked ? (
                            <span className="whitespace-nowrap rounded-full bg-mute-bg px-2 py-0.5 text-xs font-semibold">Đã trả lương</span>
                          ) : a.status === "OPEN" ? (
                            <span className="whitespace-nowrap rounded-full bg-primary-light px-2 py-0.5 text-xs font-semibold">Đang trong ca</span>
                          ) : missing ? (
                            <span className="whitespace-nowrap rounded-full bg-[#b91c1c] px-2 py-0.5 text-xs font-semibold text-white">Quên check-out</span>
                          ) : a.late ? (
                            <span className="whitespace-nowrap rounded-full bg-late-bg px-2 py-0.5 text-xs font-semibold text-late-fg">Đi muộn {mins(a.late)}</span>
                          ) : a.early ? (
                            <span className="whitespace-nowrap rounded-full bg-late-bg px-2 py-0.5 text-xs font-semibold text-late-fg">Về sớm {mins(a.early)}</span>
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
                <p className="rounded-xl bg-card px-3 py-2.5 text-[13px] leading-relaxed ring-1 ring-line">
                  Không thấy lượt nào cho ca bạn đã làm? Đó là quên chấm công → dùng tab{" "}
                  <button type="button" onClick={() => setTab("MISSING")} className="font-bold text-accent underline">
                    Quên chấm công
                  </button>
                  .
                </p>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5 rounded-2xl bg-card p-3 ring-2 ring-primary">
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
                {eIssue && (
                  <div role="alert" className="rounded-xl bg-bad-soft px-3 py-2.5 text-[13px] leading-relaxed text-bad-fg ring-1 ring-bad-line">
                    {eIssue}
                  </div>
                )}
                {changed && eSpan && !eIssue && (
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
              <div ref={errorRef} role="alert" className="flex flex-col gap-2 rounded-xl bg-bad-soft px-3 py-2.5 text-[13px] leading-relaxed text-bad-fg ring-1 ring-bad-line">
                <span>{error.msg}</span>
                {tab === "MISSING" && overlapAtt && usable(overlapAtt) && !clash && jumpBtn(overlapAtt, "self-start")}
              </div>
            )}
            {!(tab === "EDIT" && (choosing || !att)) && (
              <div className="mt-auto flex flex-col gap-2">
                <button
                  type="button"
                  onClick={send}
                  disabled={sending}
                  className="flex h-[50px] items-center justify-center gap-2 rounded-2xl bg-primary text-base font-bold text-on-primary disabled:opacity-70"
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
