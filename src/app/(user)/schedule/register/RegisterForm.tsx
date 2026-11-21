"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import type { GridTpl } from "@/components/WeekGrid";
import { cn } from "@/lib/format";
import { weekdayVi } from "@/lib/time";
import { saveShiftRequests } from "../actions";

type St = "PENDING" | "APPROVED" | "REJECTED";

/** 1 dòng lịch sử đăng ký của chính nhân viên (lib/shift-reg-log.ts – giữ 14 ngày) */
export type MyRegLog = {
  id: string;
  kind: "SUBMIT" | "APPROVE" | "REJECT" | "ASSIGN" | "REMOVE";
  byStaff: boolean;
  at: number;
  add: { date: string; tplId: string }[];
  remove: { date: string; tplId: string }[];
};

/*
 * Ô đăng ký ca – mỗi ô 1 ký hiệu:
 *  + xám viền đứt = chưa chọn (kể cả bỏ chọn ca đã gửi – Gửi đăng ký mới thực sự bỏ)
 *  + đỏ viền đứt nền đỏ nhạt = mới chọn, chưa gửi · ? cam = đã gửi, chờ duyệt
 *  ✓ xanh = đã duyệt (khoá) · ✕ = bị từ chối (bấm để đăng ký lại)
 */
const LOOK = {
  none: { ch: "+", cls: "border-2 border-dashed border-[#c4bfb9] bg-card text-[#a8a29e]", label: "Trống – bấm để chọn" },
  add: { ch: "+", cls: "border-2 border-dashed border-[#c81e1e] bg-[#ffecec] text-[#c81e1e]", label: "Mới chọn – chưa gửi" },
  wait: { ch: "?", cls: "border border-[#f5b97a] bg-[#ffe8cc] text-[#9a3d00]", label: "Đã gửi – chờ duyệt" },
  ok: { ch: "✓", cls: "border border-[#18783c] bg-[#18783c] text-white cursor-default", label: "Đã duyệt (khoá)" },
  rej: { ch: "✕", cls: "border border-[#f5c2c2] bg-[#fde2e2] text-[#9f1d1d]", label: "Bị từ chối – bấm để đăng ký lại" },
} as const;

const wdShort = (d: string) => {
  const w = weekdayVi(d);
  return w === "Chủ Nhật" ? "CN" : w.replace("Thứ ", "T");
};
function whenVi(t: number) {
  const d = new Date(t);
  const z = (n: number) => String(n).padStart(2, "0");
  const same = d.toDateString() === new Date().toDateString();
  return `${same ? "Hôm nay" : `${z(d.getDate())}/${z(d.getMonth() + 1)}`} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

export default function RegisterForm({
  weekStart,
  days,
  templates,
  existing,
  logs = [],
}: {
  weekStart: string;
  days: string[];
  templates: GridTpl[];
  existing: { key: string; status: St }[];
  logs?: MyRegLog[];
}) {
  const router = useRouter();
  // chỉ xét các ô có trên bảng (ca đang hoạt động của cơ sở × 7 ngày) – bỏ ca hỗ trợ cơ sở khác, ca mẫu đã tắt
  const visible = useMemo(() => new Set(days.flatMap((d) => templates.map((t) => `${d}|${t.id}`))), [days, templates]);
  const mine = useMemo(() => existing.filter((e) => visible.has(e.key)), [existing, visible]);
  const status = useMemo(() => new Map(mine.map((e) => [e.key, e.status])), [mine]);
  const [sel, setSel] = useState<Set<string>>(() => new Set(mine.filter((e) => e.status !== "REJECTED").map((e) => e.key)));
  const [msg, setMsg] = useState<{ tone: "green" | "red" | "orange"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const lookOf = (k: string) => {
    const st = status.get(k);
    if (st === "APPROVED") return LOOK.ok;
    if (sel.has(k)) return st === "PENDING" ? LOOK.wait : LOOK.add;
    return st === "REJECTED" ? LOOK.rej : LOOK.none;
  };
  const toggle = (k: string, label: string) => {
    if (status.get(k) === "APPROVED") {
      setMsg({ tone: "orange", text: `Ca ${label} đã được duyệt – muốn bỏ thì liên hệ admin.` });
      return;
    }
    setMsg(null);
    const n = new Set(sel);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setSel(n);
  };
  const submit = () =>
    start(async () => {
      const r = await saveShiftRequests(weekStart, [...sel]);
      setMsg(r.error ? { tone: "red", text: r.error } : { tone: "green", text: r.message || "Đã gửi" });
      if (!r.error) router.refresh();
    });

  const before = useMemo(() => new Set(mine.filter((e) => e.status !== "REJECTED").map((e) => e.key)), [mine]);
  const changes = [...sel].filter((k) => !before.has(k)).length + [...before].filter((k) => !sel.has(k)).length;

  const tplName = useMemo(() => new Map(templates.map((t) => [t.id, t.name])), [templates]);
  const itemLabel = (i: { date: string; tplId: string }) => `${wdShort(i.date)} ${tplName.get(i.tplId) ?? "ca cũ"}`;

  return (
    <div className="space-y-3">
      <div className="space-y-1 rounded-2xl bg-card p-2.5 ring-1 ring-line">
        <div className="grid grid-cols-[48px_repeat(7,minmax(0,1fr))] gap-1 text-center text-xs text-ink/70">
          <span />
          {days.map((d) => (
            <span key={d} className="py-1 leading-tight">
              <b className="block text-[11px]">{wdShort(d)}</b>
              {d.slice(8)}
            </span>
          ))}
        </div>
        {templates.map((t) => (
          <div key={t.id} className="grid grid-cols-[48px_repeat(7,minmax(0,1fr))] gap-1">
            <span className="flex min-w-0 flex-col justify-center text-xs font-bold leading-tight">
              <span className="truncate">{t.name}</span>
              <span className="text-[10px] font-normal text-ink/60">
                {t.startTime.slice(0, 2)}–{t.endTime.slice(0, 2)}
              </span>
            </span>
            {days.map((d) => {
              const k = `${d}|${t.id}`;
              const lk = lookOf(k);
              const label = `${wdShort(d)} ${d.slice(8)}/${d.slice(5, 7)} ${t.name}`;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggle(k, label)}
                  aria-label={`${label} – ${lk.label}`}
                  aria-pressed={sel.has(k) || status.get(k) === "APPROVED"}
                  className={cn("flex h-12 items-center justify-center rounded-lg text-lg font-bold transition", lk.cls)}
                >
                  {lk.ch}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-ink/70">
        {[LOOK.ok, LOOK.wait, LOOK.add, LOOK.rej, LOOK.none].map((x) => (
          <span key={x.label} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md text-[13px] font-bold", x.cls)}>{x.ch}</span>
            {x.label}
          </span>
        ))}
      </div>
      <p className="text-xs text-ink/60">Ca đã được duyệt không tự bỏ được – liên hệ admin nếu cần đổi. Bỏ chọn ca đang chờ duyệt rồi Gửi đăng ký là huỷ ca đó.</p>

      {/* thanh gửi: dính đáy màn hình (trên menu dưới) */}
      <div className="sticky bottom-20 z-20 flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-lg ring-1 ring-line">
        <div className="flex-1 text-sm leading-snug">
          Làm <b>{sel.size}</b> ca tuần này
          <span className={cn("block text-xs", changes ? "font-semibold text-warn" : "text-ink/60")}>
            {changes ? `${changes} thay đổi chưa gửi` : "Không có thay đổi"}
          </span>
        </div>
        <Button onClick={submit} disabled={pending || !changes} className="px-5">
          {pending && <Loader2 size={16} className="animate-spin" />} Gửi đăng ký
        </Button>
      </div>

      <section className="rounded-2xl bg-card p-3 ring-1 ring-line">
        <h2 className="mb-2 font-bold">Lịch sử đăng ký tuần này</h2>
        {!logs.length ? (
          <p className="text-sm text-ink/60">Chưa có thao tác nào.</p>
        ) : (
          <ol>
            {logs.map((l, i) => {
              const n = l.add.length + l.remove.length;
              const v = {
                SUBMIT: { dot: "#c2410c", title: l.remove.length ? "Sửa đăng ký" : `Gửi đăng ký ${l.add.length} ca` },
                APPROVE: { dot: "#18783c", title: `Duyệt ${n} ca` },
                REJECT: { dot: "#b42318", title: `Từ chối ${n} ca` },
                ASSIGN: { dot: "#18783c", title: `Xếp thêm ${n} ca` },
                REMOVE: { dot: "#6e6a66", title: `Bỏ ${n} ca khỏi lịch` },
              }[l.kind];
              const chip = l.kind === "APPROVE" || l.kind === "ASSIGN" ? "bg-[#e3f3e7] text-[#18783c]" : l.kind === "REJECT" ? "bg-[#fde2e2] text-[#9f1d1d]" : "bg-[#fff4e5] text-[#9a3d00]";
              return (
                <li key={l.id} className="flex gap-2.5">
                  <div className="flex flex-col items-center">
                    <span className="mt-1 size-3 rounded-full" style={{ background: v.dot }} />
                    {i < logs.length - 1 && <span className="w-0.5 flex-1 bg-line" />}
                  </div>
                  <div className="flex-1 pb-3.5">
                    <p className="text-xs text-ink/60">
                      {whenVi(l.at)} · {l.byStaff ? "Bạn" : "Quản lý"}
                    </p>
                    <p className="font-semibold">{v.title}</p>
                    <div className="mt-1 flex flex-wrap gap-1 text-xs">
                      {l.add.map((x) => (
                        <span key={`a${x.date}${x.tplId}`} className={cn("rounded-md px-2 py-0.5 font-semibold", chip)}>
                          {l.kind === "SUBMIT" && l.remove.length ? "+ " : ""}
                          {itemLabel(x)}
                        </span>
                      ))}
                      {l.remove.map((x) => (
                        <span key={`r${x.date}${x.tplId}`} className="rounded-md bg-ink/10 px-2 py-0.5 text-ink/70 line-through">
                          − {itemLabel(x)}
                        </span>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <p className="text-[11px] text-ink/50">Lịch sử tự xoá sau 14 ngày.</p>
      </section>
    </div>
  );
}
