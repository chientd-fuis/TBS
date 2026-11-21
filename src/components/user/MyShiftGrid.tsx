"use client";
import { useEffect, useRef, useState } from "react";
import type { BoardChip, BoardTpl } from "@/lib/attendance-board";
import { cn, minutesVi } from "@/lib/format";
import { weekdayVi } from "@/lib/time";

/*
 * LỊCH CỦA TÔI – lưới ca × ngày, mỗi ô 1 ký hiệu (không cần tên vì chỉ có mình).
 *  ✓ xanh đậm = đã duyệt (sắp làm) · ? cam = chờ duyệt · ✓ xanh nhạt = đã làm
 *  màu nền ô đã làm: vàng = đi muộn · cam = về sớm · đỏ = quên check-out (lấy lỗi nặng nhất)
 *  + làm thêm / ⇄ hỗ trợ cơ sở khác = nền xanh lam · Ø xám = bỏ ca
 * Tuần: 7 cột vừa màn hình. Tháng: cuộn ngang, cột ca đứng yên, tự cuộn tới hôm nay.
 */

type Look = { ch: string; bg: string; fg: string; label: string };
const L = {
  ok: { ch: "✓", bg: "#18783c", fg: "#fff", label: "Đã duyệt – sắp làm" },
  wait: { ch: "?", bg: "#ffe8cc", fg: "#9a3d00", label: "Chờ duyệt" },
  done: { ch: "✓", bg: "#8fc4a0", fg: "#fff", label: "Đã làm" },
  miss: { ch: "Ø", bg: "#6e6a66", fg: "#fff", label: "Bỏ ca" },
  extra: { ch: "+", bg: "#1d63d6", fg: "#fff", label: "Làm thêm (không có lịch)" },
  sup: { ch: "⇄", bg: "#1d63d6", fg: "#fff", label: "Hỗ trợ cơ sở khác" },
} satisfies Record<string, Look>;
const TINT = {
  late: { bg: "#f5c518", fg: "#542424", label: "Đi muộn" },
  early: { bg: "#f08a24", fg: "#3b1a00", label: "Về sớm" },
  out: { bg: "#c81e1e", fg: "#fff", label: "Quên check-out" },
};

const RANK: Record<BoardChip["state"], number> = { worked: 0, upcoming: 1, pending: 2, missed: 3 };

/** ký hiệu + màu của 1 lượt (chip) */
export function lookOf(c: BoardChip): Look {
  if (c.state === "pending") return L.wait;
  if (c.state === "missed") return L.miss;
  if (c.state === "upcoming") return L.ok;
  const base = c.extra ? L.extra : c.tag?.kind === "away" ? L.sup : L.done;
  const t = c.missingOut ? TINT.out : c.early ? TINT.early : c.late ? TINT.late : null;
  return t ? { ch: base.ch, bg: t.bg, fg: t.fg, label: base.label } : base;
}

const wdShort = (d: string) => {
  const w = weekdayVi(d);
  return w === "Chủ Nhật" ? "CN" : w.replace("Thứ ", "T");
};

export default function MyShiftGrid({
  mode,
  days,
  today,
  templates,
  cells,
  storeNames,
  holidays = {},
}: {
  mode: "week" | "month";
  days: string[];
  today: string;
  templates: BoardTpl[];
  cells: Record<string, BoardChip[]>;
  storeNames: Record<string, string>;
  holidays?: Record<string, { name: string; multiplier: number }>;
}) {
  const list = (d: string, t: string) => [...(cells[`${d}|${t}`] ?? [])].sort((a, b) => RANK[a.state] - RANK[b.state]);
  // mặc định chọn ô hôm nay có ca (nếu có)
  const [sel, setSel] = useState<string | null>(() => {
    const t = templates.find((x) => list(today, x.id).length);
    return t ? `${today}|${t.id}` : null;
  });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode !== "month" || !box.current) return;
    const th = box.current.querySelector("[data-today]") as HTMLElement | null;
    if (th) box.current.scrollLeft = Math.max(0, th.offsetLeft - 100);
  }, [mode]);

  const head = (d: string, w: string) => {
    const h = holidays[d];
    return (
      <div
        key={d}
        data-today={d === today ? "1" : undefined}
        title={h ? `Ngày lễ: ${h.name} – đi làm được ×${h.multiplier} lương` : undefined}
        className={cn(
          "rounded-md py-1 text-center text-xs leading-tight",
          w,
          d === today ? "bg-primary font-bold text-on-primary" : h ? "bg-holiday text-danger" : wdShort(d) === "CN" ? "text-danger" : "text-ink/70",
        )}
      >
        <b className="block text-[11px]">{wdShort(d)}</b>
        {mode === "week" ? d.slice(8) : Number(d.slice(8))}
      </div>
    );
  };
  const cell = (t: BoardTpl, d: string, w: string) => {
    const k = `${d}|${t.id}`;
    const c = list(d, t.id)[0];
    const lk = c && lookOf(c);
    return (
      <button
        key={k}
        type="button"
        onClick={() => setSel(k)}
        aria-label={`${wdShort(d)} ${d.slice(8)}/${d.slice(5, 7)} ${t.name} – ${lk ? lk.label : "không có ca"}`}
        className={cn(
          "flex items-center justify-center rounded-lg text-[17px] font-bold",
          w,
          mode === "week" ? "h-11" : "h-10",
          !lk && (d === today ? "bg-primary-light ring-1 ring-primary" : "bg-ink/5 ring-1 ring-line"),
          c?.live && "animate-pulse",
          // ô đang chọn: viền nâu đậm vẽ BÊN TRONG ô (inset) – không lấn sang ô bên cạnh
          sel === k && "shadow-[inset_0_0_0_2.5px_var(--color-ink)]",
        )}
        style={lk ? { background: lk.bg, color: lk.fg } : undefined}
      >
        {lk?.ch}
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {mode === "week" ? (
        <div className="space-y-1">
          <div className="grid grid-cols-[48px_repeat(7,minmax(0,1fr))] gap-1">
            <span />
            {days.map((d) => head(d, ""))}
          </div>
          {templates.map((t) => (
            <div key={t.id} className="grid grid-cols-[48px_repeat(7,minmax(0,1fr))] gap-1">
              <RowHead t={t} />
              {days.map((d) => cell(t, d, ""))}
            </div>
          ))}
        </div>
      ) : (
        <div>
          <div ref={box} className="isolate overflow-x-auto pb-2">
            <div className="flex w-max flex-col gap-1 pr-2">
              <div className="flex gap-1">
                <span className="sticky left-0 z-10 w-12 shrink-0 bg-card" />
                {days.map((d) => head(d, cn("w-9 shrink-0", weekGap(d))))}
              </div>
              {templates.map((t) => (
                <div key={t.id} className="flex gap-1">
                  <div className="sticky left-0 z-10 flex w-12 shrink-0 bg-card shadow-[4px_0_6px_-4px_rgba(0,0,0,0.25)]">
                    <RowHead t={t} />
                  </div>
                  {days.map((d) => cell(t, d, cn("w-9 shrink-0", weekGap(d))))}
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-between text-[11px] text-ink/60">
            <span>← vuốt xem đầu tháng</span>
            <span>cuối tháng →</span>
          </div>
        </div>
      )}

      <Detail sel={sel} templates={templates} list={list} storeNames={storeNames} holidays={holidays} />
      <Legend />
    </div>
  );
}

/** tháng: vạch ngăn đầu mỗi tuần (thứ 2) */
const weekGap = (d: string) => (weekdayVi(d) === "Thứ 2" && d.slice(8) !== "01" ? "ml-1.5" : "");

function RowHead({ t }: { t: BoardTpl }) {
  return (
    <span className="flex min-w-0 flex-col justify-center text-xs font-bold leading-tight">
      <span className="truncate">{t.name}</span>
      <span className="text-[10px] font-normal text-ink/60">
        {t.startTime.slice(0, 2)}–{t.endTime.slice(0, 2)}
      </span>
    </span>
  );
}

function Detail({
  sel,
  templates,
  list,
  storeNames,
  holidays,
}: {
  sel: string | null;
  templates: BoardTpl[];
  list: (d: string, t: string) => BoardChip[];
  storeNames: Record<string, string>;
  holidays: Record<string, { name: string; multiplier: number }>;
}) {
  if (!sel) return <p className="text-center text-xs text-ink/60">Bấm vào ô để xem chi tiết ca.</p>;
  const [d, tid] = sel.split("|");
  const t = templates.find((x) => x.id === tid);
  if (!t) return null;
  const chips = list(d, tid);
  const h = holidays[d];
  return (
    <div className="rounded-xl bg-card p-3 ring-1 ring-line">
      <p className="font-bold">
        {wdShort(d)} {d.slice(8)}/{d.slice(5, 7)} · Ca {t.name} {t.startTime}–{t.endTime}
      </p>
      {h && <p className="text-xs font-bold text-danger">🎉 {h.name} – đi làm được ×{h.multiplier} lương</p>}
      {!chips.length ? (
        <p className="mt-1 text-sm text-ink/70">Bạn không có ca này.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {chips.map((c) => {
            const lk = lookOf(c);
            return (
              <li key={c.key} className="flex gap-2 text-sm">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg text-base font-bold" style={{ background: lk.bg, color: lk.fg }}>
                  {lk.ch}
                </span>
                <div className="min-w-0 flex-1 leading-relaxed">
                  <b>{c.live ? "Đang trong ca" : lk.label}</b>
                  {c.tag?.kind === "away" && <span> · tại {storeNames[c.tag.storeId] ?? c.tag.label}</span>}
                  {c.state === "missed" && <span className="block text-ink/70">Có lịch nhưng không chấm công – liên hệ quản lý nếu có nhầm lẫn.</span>}
                  {c.state === "upcoming" && <span className="block text-ink/70">Nhớ chấm công khi vào ca.</span>}
                  {c.state === "pending" && <span className="block text-ink/70">Đang chờ admin duyệt.</span>}
                  {c.state === "worked" && (
                    <span className="block">
                      Vào {c.inAt ?? "?"} · Ra {c.outAt ?? (c.live ? "chưa ra" : "?")}
                    </span>
                  )}
                  {(c.late || c.early || c.missingOut) && (
                    <span className="mt-1 flex flex-wrap gap-1 text-xs font-semibold">
                      {c.late ? <Tag k="late" text={`Đi muộn ${minutesVi(c.late)}`} /> : null}
                      {c.early ? <Tag k="early" text={`Về sớm ${minutesVi(c.early)}`} /> : null}
                      {c.missingOut ? <Tag k="out" text="Quên check-out" /> : null}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Tag({ k, text }: { k: keyof typeof TINT; text: string }) {
  return (
    <span className="rounded-md px-2 py-0.5" style={{ background: TINT[k].bg, color: TINT[k].fg }}>
      {text}
    </span>
  );
}

function Legend() {
  const sw = (bg: string, fg: string, ch: string) => (
    <span className="inline-flex size-5 items-center justify-center rounded text-[11px] font-bold" style={{ background: bg, color: fg }}>
      {ch}
    </span>
  );
  return (
    <div className="space-y-1 text-xs text-ink/70">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {Object.values(L).map((x) => (
          <span key={x.label} className="inline-flex items-center gap-1">
            {sw(x.bg, x.fg, x.ch)} {x.label}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>Màu nền ca đã làm:</span>
        {Object.values(TINT).map((x) => (
          <span key={x.label} className="inline-flex items-center gap-1">
            {sw(x.bg, x.fg, "✓")} {x.label}
          </span>
        ))}
      </div>
    </div>
  );
}
