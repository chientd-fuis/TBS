"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Check, Loader2, Settings2, Sparkles, X, Zap } from "lucide-react";
import { Alert, Badge, Button, Card } from "@/components/ui";
import { WeekGrid, type GridTpl } from "@/components/WeekGrid";
import { cn } from "@/lib/format";
import { slotLevel, type AutoOptions, type Entry, type TplInfo } from "@/lib/schedule";
import { viDate, weekdayVi } from "@/lib/time";
import ExportImage from "./ExportImage";
import { addToSlot, autoSchedule, decideShifts, removeFromSlot, saveStaffing, type PlanView } from "../../../actions/schedule";

type Props = {
  storeId: string;
  storeName: string;
  weekStart: string;
  days: string[];
  today: string;
  templates: TplInfo[];
  entries: Entry[];
  staff: { id: string; name: string }[];
  names: Record<string, string>;
  /** userId → tên cơ sở gốc của người được gọi sang hỗ trợ */
  supportFrom: Record<string, string>;
  /** ca của nhân viên cơ sở này đang đi hỗ trợ nơi khác */
  external: { userId: string; date: string; startTime: string; endTime: string; shiftName: string; storeName: string }[];
  /** nhân viên các cơ sở khác (để gọi sang hỗ trợ) */
  otherStaff: { id: string; name: string; storeName: string }[];
  isPast: boolean;
};

const hours = (t: TplInfo) => {
  const [a, b] = [t.startTime, t.endTime].map((x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3)));
  return ((b - a + 1440) % 1440 || 1440) / 60;
};

export default function ScheduleBoard(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [showAuto, setShowAuto] = useState(false);
  const [showStaffing, setShowStaffing] = useState(false);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [opts, setOpts] = useState<AutoOptions>({
    approvePending: true,
    fillTo: "min",
    preferFrequentShift: true,
    preferCoworkers: true,
    maxShiftsPerWeek: 0,
    onlyRequested: false,
  });

  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string; plan?: PlanView }>, after?: (r: { plan?: PlanView }) => void) =>
    start(async () => {
      const r = await fn();
      if (r.error) setMsg({ tone: "red", text: r.error });
      else {
        setMsg(r.message ? { tone: "green", text: r.message } : null);
        after?.(r);
        router.refresh();
      }
    });

  const otherGroups = useMemo(
    () => Object.entries(p.otherStaff.reduce<Record<string, Props["otherStaff"]>>((m, s) => ((m[s.storeName] ??= []).push(s), m), {})),
    [p.otherStaff],
  );
  /** Nhân viên đang có ca ở cơ sở khác trong ngày → tên cơ sở (để admin biết khi xếp) */
  const busyAway = (uid: string, date: string) => p.external.find((x) => x.userId === uid && x.date === date)?.storeName;
  const cell = (tplId: string, date: string) => p.entries.filter((e) => e.tplId === tplId && e.date === date && e.status !== "REJECTED");
  const pendingAll = p.entries.filter((e) => e.status === "PENDING");
  const proposed = useMemo(() => new Map((plan?.changes ?? []).filter((c) => c.kind === "add").map((c) => [`${c.date}|${c.tplId}|${c.userId}`, c])), [plan]);

  // tổng hợp theo nhân viên
  const summary = useMemo(() => {
    const ids = new Set([...p.staff.map((s) => s.id), ...p.entries.map((e) => e.userId)]);
    return [...ids]
      .map((id) => {
        const mine = p.entries.filter((e) => e.userId === id);
        const ok = mine.filter((e) => e.status === "APPROVED");
        const byTpl = Object.fromEntries(p.templates.map((t) => [t.id, ok.filter((e) => e.tplId === t.id).length]));
        const h = ok.reduce((s, e) => s + hours(p.templates.find((t) => t.id === e.tplId) ?? p.templates[0]), 0);
        const away = p.external.filter((x) => x.userId === id && p.days.includes(x.date));
        return {
          id,
          name: p.names[id] ?? "?",
          ok: ok.length,
          wait: mine.filter((e) => e.status === "PENDING").length,
          rej: mine.filter((e) => e.status === "REJECTED").length,
          byTpl,
          h,
          from: p.supportFrom[id],
          away: Object.entries(away.reduce<Record<string, number>>((m, x) => ((m[x.storeName] = (m[x.storeName] ?? 0) + 1), m), {})),
        };
      })
      .sort((a, b) => b.ok - a.ok || a.name.localeCompare(b.name));
  }, [p]);
  const avg = summary.length ? summary.reduce((s, x) => s + x.ok, 0) / summary.length : 0;

  const warnings = p.days.flatMap((d) =>
    p.templates.map((t) => {
      const c = cell(t.id, d).filter((e) => e.status === "APPROVED").length;
      return { d, t, c, level: slotLevel(c, t.minStaff, t.targetStaff) };
    }),
  ).filter((w) => w.level !== "ok");

  const pendingByUser = Object.entries(
    pendingAll.reduce<Record<string, string[]>>((m, e) => ((m[e.userId] ??= []).push(e.id), m), {}),
  );

  return (
    <div className="space-y-4">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {p.isPast && <Alert tone="gray">Tuần đã qua – vẫn sửa được nhưng không ảnh hưởng chấm công đã ghi nhận.</Alert>}

      {/* Thanh công cụ */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={pending || !pendingAll.length} onClick={() => run(() => decideShifts(p.storeId, pendingAll.map((e) => e.id), "APPROVED"))}>
          <Check size={16} /> Duyệt tất cả ({pendingAll.length})
        </Button>
        <Button onClick={() => { setShowAuto((v) => !v); setPlan(null); }}>
          <Sparkles size={16} /> Xếp ca tự động
        </Button>
        <Button variant="outline" onClick={() => setShowStaffing((v) => !v)}>
          <Settings2 size={16} /> Định mức người / ca
        </Button>
        <ExportImage storeName={p.storeName} weekStart={p.weekStart} days={p.days} templates={p.templates} entries={p.entries} names={p.names} />
        {pending && <Loader2 className="animate-spin text-accent" size={18} />}
        <div className="ml-auto flex flex-wrap gap-2 text-xs">
          <Badge tone="orange">Chờ duyệt</Badge>
          <Badge tone="gray">Đã duyệt</Badge>
          <span className="inline-flex items-center gap-1"><Zap size={12} className="text-secondary" /> Tự động xếp</span>
          <Badge tone="red">Thiếu người</Badge>
          <Badge tone="yellow">Ít người</Badge>
          <span className="inline-flex items-center gap-1 rounded-md bg-[#dbeafe] px-1.5 text-[#1e40af]"><ArrowLeftRight size={12} /> Hỗ trợ</span>
        </div>
      </div>

      {showStaffing && (
        <Card title="Định mức người theo ca">
          <p className="mb-2 text-xs text-ink/70">Tối thiểu: dưới mức này báo <b className="text-danger">Thiếu người</b>. Định mức: dưới mức này báo <b className="text-warn">Ít người</b>; xếp tự động sẽ duyệt / bù tới mức này.</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {p.templates.map((t) => (
              <StaffingRow key={t.id} t={t} disabled={pending} onSave={(min, target) => run(() => saveStaffing(p.storeId, t.id, min, target))} />
            ))}
          </div>
        </Card>
      )}

      {showAuto && (
        <Card title="Xếp ca tự động (nâng cao)">
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1 accent-[#3c9c54]" checked={opts.approvePending} onChange={(e) => setOpts({ ...opts, approvePending: e.target.checked })} />
              <span><b>Duyệt đăng ký đang chờ</b> tới định mức mỗi ca (ưu tiên người đang có ít ca, đăng ký sớm). Đăng ký vượt định mức để admin tự quyết.</span>
            </label>
            <label className="flex items-start gap-2">
              <span className="mt-0.5 whitespace-nowrap font-bold">Bù ca thiếu:</span>
              <select className="rounded-lg border border-[#e9d9a8] px-2 py-1" value={opts.fillTo} onChange={(e) => setOpts({ ...opts, fillTo: e.target.value as AutoOptions["fillTo"] })}>
                <option value="none">Không bù</option>
                <option value="min">Bù tới mức tối thiểu</option>
                <option value="target">Bù tới định mức</option>
              </select>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1 accent-[#3c9c54]" checked={opts.preferFrequentShift} onChange={(e) => setOpts({ ...opts, preferFrequentShift: e.target.checked })} />
              <span><b>Ưu tiên người hay làm ca này</b> (8 tuần gần nhất)</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1 accent-[#3c9c54]" checked={opts.preferCoworkers} onChange={(e) => setOpts({ ...opts, preferCoworkers: e.target.checked })} />
              <span><b>Ưu tiên người hay làm cùng</b> với những người đã có trong ca</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1 accent-[#3c9c54]" checked={opts.onlyRequested} onChange={(e) => setOpts({ ...opts, onlyRequested: e.target.checked })} />
              <span>Khi bù ca, <b>chỉ lấy người đã đăng ký</b> ít nhất 1 ca trong tuần</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="font-bold">Tối đa ca / người / tuần:</span>
              <input type="number" min={0} className="w-20 rounded-lg border border-[#e9d9a8] px-2 py-1" value={opts.maxShiftsPerWeek} onChange={(e) => setOpts({ ...opts, maxShiftsPerWeek: Number(e.target.value) || 0 })} />
              <span className="text-xs text-ink/60">(0 = không giới hạn)</span>
            </label>
          </div>
          <p className="mt-2 text-xs text-ink/60">Luôn ưu tiên người đang có <b>ít ca nhất</b> trong tuần; không xếp trùng giờ; không xếp người đã bị từ chối ca đó.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" disabled={pending} onClick={() => run(() => autoSchedule(p.storeId, p.weekStart, opts, false), (r) => setPlan(r.plan ?? null))}>Xem trước</Button>
            <Button disabled={pending} onClick={() => run(() => autoSchedule(p.storeId, p.weekStart, opts, true), () => setPlan(null))}>Áp dụng</Button>
          </div>
          {plan && (
            <div className="mt-3 rounded-xl bg-cream p-3 text-sm">
              <p className="font-bold">Đề xuất: {plan.changes.filter((c) => c.kind === "approve").length} duyệt · {plan.changes.filter((c) => c.kind === "add").length} xếp thêm (hiện nét đứt trên bảng)</p>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto text-xs">
                {plan.changes.map((c, i) => (
                  <li key={i}>
                    {c.kind === "approve" ? "✓ Duyệt" : "＋ Xếp"} <b>{c.userName}</b> – {c.tplName} {weekdayVi(c.date)} {viDate(c.date).slice(0, 5)} <span className="text-ink/60">({c.reason})</span>
                  </li>
                ))}
              </ul>
              {plan.shortages.length > 0 && <p className="mt-1 text-xs text-danger">Sau khi áp dụng vẫn còn {plan.shortages.filter((s) => s.level === "short").length} ca thiếu, {plan.shortages.filter((s) => s.level === "low").length} ca ít người.</p>}
            </div>
          )}
        </Card>
      )}

      {/* Bảng lịch theo mẫu */}
      <WeekGrid
        templates={p.templates as GridTpl[]}
        days={p.days}
        today={p.today}
        renderRowHead={(t) => (
          <>
            <div className="text-base font-bold">{t.name}</div>
            <div className="text-[11px] font-normal">{t.startTime}–{t.endTime}</div>
            {(t.minStaff || t.targetStaff) ? <div className="text-[10px] font-normal text-ink/60">tối thiểu {t.minStaff} · định mức {t.targetStaff}</div> : null}
          </>
        )}
        cellClass={(t, d) => {
          const c = cell(t.id, d).filter((e) => e.status === "APPROVED").length;
          const lv = slotLevel(c, t.minStaff ?? 0, t.targetStaff ?? 0);
          return lv === "short" ? "!bg-[#fbd5d5]" : undefined; // ít người chỉ hiện nhãn, giữ màu hàng theo mẫu
        }}
        renderCell={(t, d) => {
          const list = cell(t.id, d);
          const inCell = new Set(list.map((e) => e.userId));
          const approvedN = list.filter((e) => e.status === "APPROVED").length;
          const tpl = t as TplInfo;
          const lv = slotLevel(approvedN, tpl.minStaff, tpl.targetStaff);
          const props = [...proposed.values()].filter((c) => c.date === d && c.tplId === t.id);
          return (
            <div className="flex min-h-16 flex-col gap-0.5">
              {list.map((e) => (
                <div
                  key={e.id}
                  className={cn(
                    "group flex items-center gap-0.5 rounded-md px-1 py-0.5 text-xs",
                    e.status === "PENDING"
                      ? "bg-[#ffd8b8] font-semibold text-warn ring-1 ring-warn/40"
                      : p.supportFrom[e.userId]
                        ? "bg-[#dbeafe] text-[#1e40af] ring-1 ring-[#93c5fd]"
                        : "bg-white/80",
                  )}
                  title={
                    p.supportFrom[e.userId]
                      ? `Hỗ trợ từ ${p.supportFrom[e.userId]}`
                      : e.status === "PENDING" ? "Nhân viên đăng ký – chờ duyệt" : e.source === "AUTO" ? "Xếp tự động" : ""
                  }
                >
                  {p.supportFrom[e.userId] && <ArrowLeftRight size={10} className="shrink-0" />}
                  {e.source === "AUTO" && e.status === "APPROVED" && <Zap size={10} className="shrink-0 text-secondary" />}
                  <span className="flex-1 truncate">{p.names[e.userId] ?? "?"}</span>
                  {e.status === "PENDING" ? (
                    <>
                      <button title="Duyệt" disabled={pending} onClick={() => run(() => decideShifts(p.storeId, [e.id], "APPROVED"))} className="rounded bg-secondary px-0.5 text-white"><Check size={12} /></button>
                      <button title="Từ chối" disabled={pending} onClick={() => run(() => decideShifts(p.storeId, [e.id], "REJECTED"))} className="rounded bg-danger px-0.5 text-white"><X size={12} /></button>
                    </>
                  ) : (
                    <button title="Bỏ khỏi ca" disabled={pending} onClick={() => run(() => removeFromSlot(p.storeId, e.id))} className="hidden rounded px-0.5 text-danger group-hover:block"><X size={12} /></button>
                  )}
                </div>
              ))}
              {props.map((c) => (
                <div key={c.userId} className="rounded-md border border-dashed border-secondary px-1 py-0.5 text-xs text-secondary-dark" title={c.reason}>
                  + {c.userName}
                </div>
              ))}
              <div className="mt-auto flex items-center gap-1 pt-0.5">
                <select
                  className="w-full min-w-0 rounded border border-transparent bg-transparent text-[11px] text-ink/60 hover:border-[#c9d6e8] hover:bg-white"
                  value=""
                  disabled={pending}
                  onChange={(ev) => ev.target.value && run(() => addToSlot(p.storeId, t.id, d, ev.target.value))}
                >
                  <option value="">＋ Thêm…</option>
                  <optgroup label="Nhân viên cơ sở">
                    {p.staff.filter((s) => !inCell.has(s.id)).map((s) => {
                      const away = busyAway(s.id, d);
                      return (
                        <option key={s.id} value={s.id}>{s.name}{away ? ` (đang hỗ trợ ${away})` : ""}</option>
                      );
                    })}
                  </optgroup>
                  {otherGroups.map(([store, list]) => {
                    const free = list.filter((s) => !inCell.has(s.id));
                    return free.length ? (
                      <optgroup key={store} label={`Gọi hỗ trợ từ ${store}`}>
                        {free.map((s) => (
                          <option key={s.id} value={s.id}>⇄ {s.name}</option>
                        ))}
                      </optgroup>
                    ) : null;
                  })}
                </select>
                {lv === "short" && <span className="whitespace-nowrap text-[10px] font-bold text-danger">Thiếu {tpl.minStaff - approvedN}</span>}
                {lv === "low" && <span className="whitespace-nowrap text-[10px] font-bold text-warn">Ít {approvedN}/{tpl.targetStaff}</span>}
              </div>
            </div>
          );
        }}
      />

      {/* Duyệt theo người */}
      {pendingByUser.length > 0 && (
        <Card title={`Chờ duyệt theo nhân viên (${pendingByUser.length})`}>
          <div className="flex flex-wrap gap-2">
            {pendingByUser.map(([uid, ids]) => (
              <div key={uid} className="flex items-center gap-1 rounded-xl bg-[#ffe8d9] px-2 py-1 text-sm">
                <b>{p.names[uid]}</b> <span className="text-xs">({ids.length} ca)</span>
                <button disabled={pending} onClick={() => run(() => decideShifts(p.storeId, ids, "APPROVED"))} className="rounded-lg bg-secondary px-2 py-0.5 text-xs font-bold text-white">Duyệt</button>
                <button disabled={pending} onClick={() => run(() => decideShifts(p.storeId, ids, "REJECTED"))} className="rounded-lg bg-white px-2 py-0.5 text-xs text-danger ring-1 ring-danger/40">Từ chối</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Cảnh báo */}
      {warnings.length > 0 && (
        <Card title="⚠️ Cảnh báo ca thiếu / ít người">
          <ul className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {warnings.map((w) => (
              <li key={`${w.d}${w.t.id}`}>
                <Badge tone={w.level === "short" ? "red" : "yellow"}>{w.level === "short" ? "Thiếu người" : "Ít người"}</Badge> {w.t.name} · {weekdayVi(w.d)} {viDate(w.d).slice(0, 5)}: {w.c}/{w.level === "short" ? w.t.minStaff : w.t.targetStaff}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Tổng hợp số ca */}
      <Card title="Tổng hợp số ca của nhân viên trong tuần">
        <div className="overflow-x-auto">
          <table className="tbs">
            <thead>
              <tr>
                <th>Nhân viên</th>
                {p.templates.map((t) => <th key={t.id} className="text-center">{t.name}</th>)}
                <th className="text-right">Tổng ca đã duyệt</th>
                <th className="text-right">Giờ dự kiến</th>
                <th className="text-right">Chờ duyệt</th>
                <th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.id} className={s.ok === 0 && !s.away.length ? "row-missing" : ""}>
                  <td className="font-semibold">
                    {s.name}
                    {s.from && <span className="ml-1 rounded bg-[#dbeafe] px-1 text-[10px] font-normal text-[#1e40af]">hỗ trợ từ {s.from}</span>}
                  </td>
                  {p.templates.map((t) => <td key={t.id} className="text-center">{s.byTpl[t.id] || ""}</td>)}
                  <td className="text-right font-bold">{s.ok}</td>
                  <td className="text-right">{s.h ? s.h.toFixed(1) : ""}</td>
                  <td className="text-right text-warn">{s.wait || ""}</td>
                  <td className="text-xs">
                    {s.ok === 0 && !s.away.length && <Badge tone="red">Chưa có ca</Badge>}{" "}
                    {s.ok > 0 && avg > 0 && s.ok >= avg * 1.5 && <Badge tone="orange">Nhiều ca</Badge>}{" "}
                    {s.ok > 0 && avg > 0 && s.ok <= avg * 0.5 && <Badge tone="yellow">Ít ca</Badge>}{" "}
                    {s.rej > 0 && <span className="text-ink/60">{s.rej} ca bị từ chối</span>}{" "}
                    {s.away.map(([st, n]) => (
                      <span key={st} className="mr-1 rounded bg-[#dbeafe] px-1 text-[#1e40af]">⇄ {n} ca ở {st}</span>
                    ))}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="font-bold">TỔNG</td>
                {p.templates.map((t) => <td key={t.id} className="text-center font-bold">{summary.reduce((a, s) => a + (s.byTpl[t.id] || 0), 0)}</td>)}
                <td className="text-right font-bold">{summary.reduce((a, s) => a + s.ok, 0)}</td>
                <td className="text-right font-bold">{summary.reduce((a, s) => a + s.h, 0).toFixed(1)}</td>
                <td className="text-right font-bold text-warn">{pendingAll.length || ""}</td>
                <td className="text-xs">TB {avg.toFixed(1)} ca/người</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function StaffingRow({ t, onSave, disabled }: { t: TplInfo; onSave: (min: number, target: number) => void; disabled: boolean }) {
  const [min, setMin] = useState(t.minStaff);
  const [target, setTarget] = useState(t.targetStaff);
  return (
    <div className="flex items-center gap-2 rounded-xl bg-cream p-2 text-sm">
      <b className="w-16 truncate">{t.name}</b>
      <label className="text-xs">Tối thiểu <input type="number" min={0} value={min} onChange={(e) => setMin(Number(e.target.value))} className="w-14 rounded border border-[#e9d9a8] px-1" /></label>
      <label className="text-xs">Định mức <input type="number" min={0} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="w-14 rounded border border-[#e9d9a8] px-1" /></label>
      <button disabled={disabled} onClick={() => onSave(min, target)} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-primary px-2 py-1 text-xs font-bold">Lưu</button>
    </div>
  );
}
