"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, BellRing, Check, ChevronDown, Clock, Eye, Pencil, Loader2, Plus, Save, Settings2, Sparkles, TriangleAlert, Undo2, X, Zap } from "lucide-react";
import { Alert, Badge, Button, Card } from "@/components/ui";
import { WeekGrid, type GridTpl } from "@/components/WeekGrid";
import { cn } from "@/lib/format";
import { slotLevel, targetFor, type AutoOptions, type Entry, type TplInfo } from "@/lib/schedule";
import { viDate, weekdayVi } from "@/lib/time";
import WeekSheet from "./WeekSheet";
import { DayWeatherHead } from "./WeatherStrip";
import type { DayWeather } from "@/lib/weather";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { autoSchedule, commitSchedule, requestRegistration, saveStaffing, type DraftAdd, type DraftOps, type PlanView } from "../../../actions/schedule";
import { PersonScheduleSheet } from "./PersonSchedule";
import type { RegLogView } from "@/lib/shift-reg-log";
import { RegHistoryCard, SlotHistorySheet, UserHistorySheet, slotLost } from "./RegHistory";

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
  /** userId → yêu cầu đăng ký ca của tuần (OPEN / DONE / OFF) */
  regRequests: Record<string, { status: string; requestedAt: number }>;
  /** tuần sau trở đi mới gửi yêu cầu đăng ký được */
  canRequest: boolean;
  isPast: boolean;
  /** điều hướng tuần (tuần trước / sau) – đặt ngay trên bảng xếp ca */
  weekNav?: React.ReactNode;
  /** lịch sử đăng ký ca của tuần (lib/shift-reg-log.ts – giữ 14 ngày) */
  regLogs?: RegLogView[];
  /** ngày → thời tiết (hiện trong tiêu đề cột ngày) */
  weather?: Record<string, DayWeather>;
};

/** thao tác nháp trên 1 ca đã có (chưa lưu) */
type EntryOp = "approve" | "reject" | "remove";
/** ca hiển thị = ca đã lưu + thao tác nháp */
type Eff = Entry & { draft?: EntryOp | "add" };
const sameAdd = (a: DraftAdd, b: DraftAdd) => a.tplId === b.tplId && a.date === b.date && a.userId === b.userId;

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
  // cảnh báo ca thiếu: điện thoại thu gọn thành panel, bấm mới mở
  const [showWarn, setShowWarn] = useState(false);
  const dayHead = (d: string) => <DayWeatherHead w={p.weather?.[d]} past={d < p.today} />;
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  // mặc định XEM như ảnh lịch tuần; có ca đăng ký chờ duyệt → mở chế độ sửa để duyệt / từ chối ngay trên lịch
  const [mode, setMode] = useState<"view" | "edit">(() => (p.entries.some((e) => e.status === "PENDING") ? "edit" : "view"));
  // ---- NHÁP: duyệt / từ chối / thêm / bỏ chỉ ghi ở máy; bấm "Chốt lịch" mới lưu 1 lần ----
  const [ops, setOps] = useState<Record<string, EntryOp>>({});
  const [adds, setAdds] = useState<DraftAdd[]>([]);
  const dirtyN = Object.keys(ops).length + adds.length;
  // ca thêm bị trùng giờ khi chốt → hỏi "Vẫn xếp"
  const [clashList, setClashList] = useState<(DraftAdd & { text: string })[] | null>(null);
  // chuyển trang khi còn thay đổi chưa lưu → hỏi lại
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  // chế độ xem: bấm tên → lịch cá nhân
  const [personUser, setPersonUser] = useState<string | null>(null);
  // lịch sử đăng ký: 1 nhân viên / 1 ô ca
  const [histUser, setHistUser] = useState<string | null>(null);
  const [histSlot, setHistSlot] = useState<{ date: string; tplId: string } | null>(null);
  const hb = { logs: p.regLogs ?? [], entries: p.entries, templates: p.templates, days: p.days, names: p.names };
  const [opts, setOpts] = useState<AutoOptions>({
    approvePending: true,
    fillTo: "min",
    preferFrequentShift: true,
    preferCoworkers: true,
    maxShiftsPerWeek: 0,
    onlyRequested: false,
  });

  /** Tải lại dữ liệu nhưng GIỮ tuần đang xếp: trang mở không có ?week= (tự nhảy tuần sau vì có ca chờ duyệt)
   *  → refresh sau khi duyệt hết sẽ rơi về tuần hiện tại, nên ghim ?week= vào URL. */
  const reload = () => {
    if (new URLSearchParams(window.location.search).get("week") === p.weekStart) router.refresh();
    else router.replace(`${window.location.pathname}?week=${p.weekStart}`, { scroll: false }); // dùng chung cho /admin và /manage
  };

  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string; plan?: PlanView }>, after?: (r: { plan?: PlanView }) => void) =>
    start(async () => {
      const r = await fn();
      if (r.error) setMsg({ tone: "red", text: r.error });
      else {
        setMsg(r.message ? { tone: "green", text: r.message } : null);
        after?.(r);
        reload();
      }
    });

  /** Nháp: đặt / bỏ thao tác cho các ca đã có. */
  const setOp = (ids: string[], op: EntryOp | null) =>
    setOps((o) => {
      const n = { ...o };
      for (const id of ids) {
        if (op) n[id] = op;
        else delete n[id];
      }
      return n;
    });
  const decide = (ids: string[], d: "APPROVED" | "REJECTED") => setOp(ids, d === "APPROVED" ? "approve" : "reject");
  /** Nháp: xếp 1 người vào ô. Người đó đang có ca ở ô (vừa bị bỏ / đang chờ) → chỉ cần huỷ bỏ / duyệt. */
  const addSlot = (tplId: string, date: string, userId: string) => {
    const ex = p.entries.find((e) => e.tplId === tplId && e.date === date && e.userId === userId && e.status !== "REJECTED");
    if (ex) return setOp([ex.id], ex.status === "PENDING" ? "approve" : null);
    const a = { tplId, date, userId };
    setAdds((l) => (l.some((x) => sameAdd(x, a)) ? l : [...l, a]));
  };
  const dropAdd = (a: DraftAdd) => setAdds((l) => l.filter((x) => !sameAdd(x, a)));
  const discard = () => {
    setOps({});
    setAdds([]);
  };

  const eff = useMemo<Eff[]>(
    () => [
      ...p.entries.map((e) => (ops[e.id] ? { ...e, draft: ops[e.id] } : e)),
      ...adds.map((a) => ({ id: `new|${a.date}|${a.tplId}|${a.userId}`, userId: a.userId, tplId: a.tplId, date: a.date, status: "APPROVED" as const, source: "MANUAL", draft: "add" as const })),
    ],
    [p.entries, ops, adds],
  );
  /** lịch SAU KHI chốt (để đếm, cảnh báo, chế độ xem): duyệt → APPROVED, từ chối → REJECTED, bỏ → mất */
  const live = useMemo<Eff[]>(
    () => eff.filter((e) => e.draft !== "remove").map((e) => (e.draft === "approve" ? { ...e, status: "APPROVED" as const } : e.draft === "reject" ? { ...e, status: "REJECTED" as const } : e)),
    [eff],
  );

  /** Chốt lịch: gửi toàn bộ nháp 1 lần. force = các ca trùng giờ admin đồng ý "Vẫn xếp". */
  const commit = (force?: DraftAdd[], after?: () => void) =>
    start(async () => {
      const payload: DraftOps = {
        approve: Object.keys(ops).filter((k) => ops[k] === "approve"),
        reject: Object.keys(ops).filter((k) => ops[k] === "reject"),
        remove: Object.keys(ops).filter((k) => ops[k] === "remove"),
        add: adds.map((a) => (force?.some((x) => sameAdd(x, a)) ? { ...a, force: true } : a)),
      };
      const noPendingLeft = !live.some((e) => e.status === "PENDING");
      const r = await commitSchedule(p.storeId, payload);
      if (r.error && !r.errors) {
        // lỗi chung (quyền, mạng…) → giữ nguyên nháp
        setMsg({ tone: "red", text: r.error });
        return;
      }
      const clashes = r.clashes ?? [];
      setOps({});
      setAdds(clashes.map(({ tplId, date, userId }) => ({ tplId, date, userId })));
      setMsg(r.error ? { tone: "red", text: r.error } : r.message ? { tone: "green", text: r.message } : null);
      if (clashes.length) setClashList(clashes);
      else {
        setClashList(null);
        if (noPendingLeft) setMode("view");
        after?.();
      }
      if (!after || clashes.length) reload();
    });

  // còn thay đổi chưa lưu: chặn đóng tab / tải lại và mọi link chuyển trang trong app → hỏi lại
  useEffect(() => {
    if (!dirtyN) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return; // trang ngoài: beforeunload lo
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveTo(url.pathname + url.search + url.hash);
    };
    window.addEventListener("beforeunload", onBefore);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBefore);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirtyN]);

  const otherGroups = useMemo(
    () => Object.entries(p.otherStaff.reduce<Record<string, Props["otherStaff"]>>((m, s) => ((m[s.storeName] ??= []).push(s), m), {})),
    [p.otherStaff],
  );
  /** Nhân viên đang có ca ở cơ sở khác trong ngày → tên cơ sở (để admin biết khi xếp) */
  const busyAway = (uid: string, date: string) => p.external.find((x) => x.userId === uid && x.date === date)?.storeName;
  /** ca trong ô theo lịch sau khi chốt (để đếm) */
  const cell = (tplId: string, date: string) => live.filter((e) => e.tplId === tplId && e.date === date && e.status !== "REJECTED");
  /** ca chờ duyệt chưa được quyết (kể cả nháp) */
  const pendingAll = live.filter((e) => e.status === "PENDING");
  const proposed = useMemo(() => new Map((plan?.changes ?? []).filter((c) => c.kind === "add").map((c) => [`${c.date}|${c.tplId}|${c.userId}`, c])), [plan]);

  // tổng hợp theo nhân viên
  const summary = useMemo(() => {
    const ids = new Set([...p.staff.map((s) => s.id), ...live.map((e) => e.userId)]);
    return [...ids]
      .map((id) => {
        const mine = live.filter((e) => e.userId === id);
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
  }, [p, live]);
  const homeIds = new Set(p.staff.map((x) => x.id));
  // nhân viên cơ sở chưa có ca nào trong tuần (không tính người đã báo nghỉ / đang được yêu cầu)
  const unregistered = summary.filter((x) => homeIds.has(x.id) && x.ok + x.wait === 0 && !x.away.length && !["OPEN", "OFF"].includes(p.regRequests[x.id]?.status ?? ""));
  const fmtTime = (t: number) => {
    const d = new Date(t);
    const z = (n: number) => String(n).padStart(2, "0");
    return `${z(d.getHours())}:${z(d.getMinutes())} ${z(d.getDate())}/${z(d.getMonth() + 1)}`;
  };
  const avg = summary.length ? summary.reduce((s, x) => s + x.ok, 0) / summary.length : 0;

  const warnings = p.days.flatMap((d) =>
    p.templates.map((t) => {
      const c = cell(t.id, d).filter((e) => e.status === "APPROVED").length;
      return { d, t, c, tg: targetFor(t, d), level: slotLevel(c, t.minStaff, targetFor(t, d)) };
    }),
  ).filter((w) => w.level !== "ok");

  const pendingByUser = Object.entries(
    pendingAll.reduce<Record<string, string[]>>((m, e) => ((m[e.userId] ??= []).push(e.id), m), {}),
  );

  return (
    <div className={cn("space-y-4", dirtyN > 0 && "pb-24")}>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {p.isPast && <Alert tone="gray">Tuần đã qua – vẫn sửa được nhưng không ảnh hưởng chấm công đã ghi nhận.</Alert>}

      {/* Thanh công cụ */}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending || !dirtyN} onClick={() => commit()} title="Lưu mọi thay đổi trên lịch">
          <Save size={16} /> Chốt lịch{dirtyN ? ` (${dirtyN})` : ""}
        </Button>
        <Button variant="secondary" disabled={pending || !pendingAll.length} onClick={() => decide(pendingAll.map((e) => e.id), "APPROVED")}>
          <Check size={16} /> Duyệt tất cả ({pendingAll.length})
        </Button>
        <Button onClick={() => { setShowAuto((v) => !v); setPlan(null); }}>
          <Sparkles size={16} /> Xếp ca tự động
        </Button>
        <Button variant="outline" onClick={() => setShowStaffing((v) => !v)}>
          <Settings2 size={16} /> Định mức người / ca
        </Button>
        {pending && <Loader2 className="animate-spin text-accent" size={18} />}
        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs">
          <span className="inline-flex items-center gap-1 rounded-md bg-card px-1.5 py-0.5 ring-1 ring-line"><Check size={11} className="text-secondary" /> Đã lưu</span>
          <span className="inline-flex items-center gap-1 rounded-md bg-late-strong px-1.5 py-0.5 font-semibold text-warn ring-1 ring-warn/40"><Clock size={11} /> Chờ duyệt</span>
          <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-secondary bg-ok-soft px-1.5 py-0.5 font-semibold text-good"><Plus size={11} /> Chưa lưu</span>
          <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-danger/60 bg-bad-soft px-1.5 py-0.5 text-danger/80 line-through">Sẽ bỏ</span>
          <span className="inline-flex items-center gap-1 rounded-md bg-info-bg px-1.5 py-0.5 text-info-fg ring-1 ring-info-line"><ArrowLeftRight size={11} /> Hỗ trợ</span>
          <span className="inline-flex items-center gap-1"><Zap size={11} className="text-secondary" /> Tự động</span>
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
              <input type="checkbox" className="mt-1 accent-secondary" checked={opts.approvePending} onChange={(e) => setOpts({ ...opts, approvePending: e.target.checked })} />
              <span><b>Duyệt đăng ký đang chờ</b> tới định mức mỗi ca (ưu tiên người đang có ít ca, đăng ký sớm). Đăng ký vượt định mức để admin tự quyết.</span>
            </label>
            <label className="flex items-start gap-2">
              <span className="mt-0.5 whitespace-nowrap font-bold">Bù ca thiếu:</span>
              <select className="rounded-lg border border-line-strong px-2 py-1" value={opts.fillTo} onChange={(e) => setOpts({ ...opts, fillTo: e.target.value as AutoOptions["fillTo"] })}>
                <option value="none">Không bù</option>
                <option value="min">Bù tới mức tối thiểu</option>
                <option value="target">Bù tới định mức</option>
              </select>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1 accent-secondary" checked={opts.preferFrequentShift} onChange={(e) => setOpts({ ...opts, preferFrequentShift: e.target.checked })} />
              <span><b>Ưu tiên người hay làm ca này</b> (8 tuần gần nhất)</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1 accent-secondary" checked={opts.preferCoworkers} onChange={(e) => setOpts({ ...opts, preferCoworkers: e.target.checked })} />
              <span><b>Ưu tiên người hay làm cùng</b> với những người đã có trong ca</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1 accent-secondary" checked={opts.onlyRequested} onChange={(e) => setOpts({ ...opts, onlyRequested: e.target.checked })} />
              <span>Khi bù ca, <b>chỉ lấy người đã đăng ký</b> ít nhất 1 ca trong tuần</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="font-bold">Tối đa ca / người / tuần:</span>
              <input type="number" min={0} className="w-20 rounded-lg border border-line-strong px-2 py-1" value={opts.maxShiftsPerWeek} onChange={(e) => setOpts({ ...opts, maxShiftsPerWeek: Number(e.target.value) || 0 })} />
              <span className="text-xs text-ink/60">(0 = không giới hạn)</span>
            </label>
          </div>
          <p className="mt-2 text-xs text-ink/60">Luôn ưu tiên người đang có <b>ít ca nhất</b> trong tuần; không xếp trùng giờ; không xếp người đã bị từ chối ca đó.</p>
          {dirtyN > 0 && <p className="mt-2 text-xs font-semibold text-warn">Đang có {dirtyN} thay đổi chưa lưu – bấm Chốt lịch trước khi xếp tự động.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" disabled={pending || dirtyN > 0} onClick={() => run(() => autoSchedule(p.storeId, p.weekStart, opts, false), (r) => { setPlan(r.plan ?? null); setMode("edit"); })}>Xem trước</Button>
            <Button
              disabled={pending || dirtyN > 0}
              onClick={() =>
                // luôn tính lại bản xem trước để hộp xác nhận hiện đúng số ca sẽ thay đổi
                run(() => autoSchedule(p.storeId, p.weekStart, opts, false), (r) => {
                  setPlan(r.plan ?? null);
                  setConfirmApply(true);
                })
              }
            >
              Áp dụng
            </Button>
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

      <ConfirmDialog
        open={confirmApply}
        title="Áp dụng xếp ca tự động?"
        confirmLabel="Áp dụng"
        busy={pending}
        onCancel={() => setConfirmApply(false)}
        onConfirm={() =>
          run(() => autoSchedule(p.storeId, p.weekStart, opts, true), () => {
            setPlan(null);
            setConfirmApply(false);
          })
        }
      >
        <p>
          Tuần <b>{viDate(p.days[0]).slice(0, 5)} – {viDate(p.days[6]).slice(0, 5)}</b> · {p.storeName}
        </p>
        {plan && plan.changes.length ? (
          <ul className="list-disc pl-5">
            <li>Duyệt <b>{plan.changes.filter((c) => c.kind === "approve").length}</b> đăng ký đang chờ</li>
            <li>Xếp thêm <b>{plan.changes.filter((c) => c.kind === "add").length}</b> ca cho nhân viên</li>
          </ul>
        ) : (
          <p className="text-ink/70">Không có thay đổi nào theo tuỳ chọn hiện tại.</p>
        )}
        {plan && plan.shortages.some((x) => x.level === "short") && (
          <p className="text-danger">Sau khi áp dụng vẫn còn {plan.shortages.filter((x) => x.level === "short").length} ca thiếu người.</p>
        )}
        <p className="text-xs text-ink/60">Ca xếp tự động có thể bỏ từng ca trên bảng sau khi áp dụng.</p>
      </ConfirmDialog>

      {dirtyN > 0 && (
        <div className="fixed inset-x-3 bottom-20 z-40 mx-auto flex max-w-lg items-center gap-2 rounded-2xl bg-ink px-3 py-2 text-sm text-white shadow-lg lg:bottom-6">
          <span className="flex-1">
            <b>{dirtyN}</b> thay đổi chưa lưu
          </span>
          <button disabled={pending} onClick={() => setAskDiscard(true)} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-white/80 underline disabled:opacity-50">
            <Undo2 size={16} /> Huỷ
          </button>
          <button disabled={pending} onClick={() => commit()} className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-primary px-3 font-bold text-on-primary disabled:opacity-50">
            {pending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Chốt lịch
          </button>
        </div>
      )}

      <ConfirmDialog
        open={askDiscard}
        danger
        title="Huỷ mọi thay đổi chưa lưu?"
        confirmLabel="Huỷ thay đổi"
        cancelLabel="Giữ lại"
        onCancel={() => setAskDiscard(false)}
        onConfirm={() => {
          discard();
          setAskDiscard(false);
        }}
      >
        <p>{dirtyN} thay đổi trên lịch (duyệt / từ chối / thêm / bỏ ca) sẽ mất.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!leaveTo}
        danger
        title="Lịch có thay đổi chưa lưu"
        confirmLabel="Bỏ thay đổi & chuyển trang"
        cancelLabel="Ở lại"
        busy={pending}
        onCancel={() => setLeaveTo(null)}
        onConfirm={() => {
          const to = leaveTo!;
          discard();
          setLeaveTo(null);
          router.push(to);
        }}
      >
        <p>
          Bạn có <b>{dirtyN} thay đổi</b> chưa bấm <b>Chốt lịch</b>. Chuyển trang bây giờ sẽ mất các thay đổi này.
        </p>
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            const to = leaveTo!;
            setLeaveTo(null);
            commit(undefined, () => router.push(to));
          }}
        >
          <Save size={16} /> Chốt lịch rồi chuyển trang
        </Button>
      </ConfirmDialog>

      {personUser && (
        <PersonScheduleSheet
          userId={personUser}
          name={p.names[personUser] ?? "?"}
          supportFrom={p.supportFrom[personUser]}
          days={p.days}
          today={p.today}
          templates={p.templates}
          entries={live}
          external={p.external}
          onClose={() => setPersonUser(null)}
          onOpenHistory={() => {
            setHistUser(personUser);
            setPersonUser(null);
          }}
        />
      )}

      {histUser && (
        <UserHistorySheet
          b={hb}
          userId={histUser}
          busy={pending}
          onClose={() => setHistUser(null)}
          onRestore={(date, tplId) => addSlot(tplId, date, histUser)}
        />
      )}
      {histSlot && (
        <SlotHistorySheet
          b={hb}
          date={histSlot.date}
          tplId={histSlot.tplId}
          busy={pending}
          onClose={() => setHistSlot(null)}
          onDecide={(id, d) => decide([id], d)}
          onRestore={(userId) => addSlot(histSlot.tplId, histSlot.date, userId)}
          onOpenUser={(u) => {
            setHistSlot(null);
            setHistUser(u);
          }}
        />
      )}

      <ConfirmDialog
        open={!!clashList}
        danger
        title="Có ca trùng giờ – chưa lưu"
        confirmLabel={pending ? "Đang xếp…" : "Vẫn xếp (bỏ ca cũ)"}
        cancelLabel="Để sau"
        busy={pending}
        onCancel={() => setClashList(null)}
        onConfirm={() => clashList && commit(clashList)}
      >
        {clashList && (
          <div className="space-y-2">
            <ul className="list-disc space-y-1 pl-5 font-semibold text-danger">
              {clashList.map((c) => (
                <li key={`${c.date}${c.tplId}${c.userId}`}>{c.text}</li>
              ))}
            </ul>
            <p>
              Bấm <b>Vẫn xếp</b> để <b>bỏ ca đã xếp</b> ở trên và xếp nhân viên vào ca này (nhân viên nhận thông báo đổi lịch). Bấm <b>Để sau</b> thì các ca này vẫn nằm trong nháp.
            </p>
          </div>
        )}
      </ConfirmDialog>

      {/* Bảng lịch theo mẫu – thanh chọn tuần ghim trên đầu khi cuộn (điện thoại) */}
      <div className="sticky top-[52px] z-20 -mx-4 flex flex-wrap items-center justify-between gap-2 border-b border-line bg-cream/95 px-4 py-2 shadow-sm backdrop-blur lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0 lg:shadow-none lg:backdrop-blur-none">
        {p.weekNav}
        <div className="inline-flex rounded-xl bg-card p-1 ring-1 ring-line" role="tablist">
          <button
            role="tab"
            aria-selected={mode === "view"}
            onClick={() => setMode("view")}
            className={cn("inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm", mode === "view" ? "bg-primary text-on-primary font-bold" : "hover:bg-primary-light")}
          >
            <Eye size={16} /> Chế độ xem
          </button>
          <button
            role="tab"
            aria-selected={mode === "edit"}
            onClick={() => setMode("edit")}
            className={cn("inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm", mode === "edit" ? "bg-primary text-on-primary font-bold" : "hover:bg-primary-light")}
          >
            <Pencil size={16} /> Chế độ sửa
          </button>
        </div>
      </div>
      {mode === "view" ? (
        <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
          <WeekSheet storeName={p.storeName} days={p.days} templates={p.templates} entries={live} names={p.names} withPending supportFrom={p.supportFrom} width="100%" renderDayHead={dayHead} onNameClick={setPersonUser} />
        </div>
      ) : (
      <WeekGrid
        templates={p.templates as GridTpl[]}
        days={p.days}
        today={p.today}
        renderDayHead={dayHead}
        renderRowHead={(t) => <div className="text-base font-bold">{t.name}</div>}
        renderCell={(t, d) => {
          // ca trong ô kể cả ca nháp sẽ bỏ / từ chối (gạch ngang, bấm hoàn tác được)
          const list = eff.filter((e) => e.tplId === t.id && e.date === d && e.status !== "REJECTED");
          const inCell = new Set(list.map((e) => e.userId));
          const props = [...proposed.values()].filter((c) => c.date === d && c.tplId === t.id);
          return (
            <div className="flex min-h-16 flex-col gap-0.5">
              {list.map((e) => {
                const name = p.names[e.userId] ?? "?";
                const sup = p.supportFrom[e.userId];
                const gone = e.draft === "remove" || e.draft === "reject";
                const tip =
                  e.draft === "add" ? "Chưa lưu: sẽ xếp khi chốt lịch"
                  : e.draft === "approve" ? "Chưa lưu: sẽ duyệt khi chốt lịch"
                  : e.draft === "reject" ? "Chưa lưu: sẽ từ chối khi chốt lịch"
                  : e.draft === "remove" ? "Chưa lưu: sẽ bỏ khỏi ca khi chốt lịch"
                  : e.status === "PENDING" ? "Nhân viên đăng ký – chờ duyệt"
                  : sup ? `Đã lưu · hỗ trợ từ ${sup}`
                  : e.source === "AUTO" ? "Đã lưu · xếp tự động" : "Đã lưu";
                return (
                  <div
                    key={e.id}
                    title={tip}
                    className={cn(
                      "group flex items-center gap-0.5 rounded-md px-1 py-0.5 text-xs",
                      gone
                        ? "border border-dashed border-danger/60 bg-bad-soft text-danger/80"
                        : e.draft
                          ? "border border-dashed border-secondary bg-ok-soft font-semibold text-good"
                          : e.status === "PENDING"
                            ? "bg-late-strong font-semibold text-warn ring-1 ring-warn/40"
                            : sup
                              ? "bg-info-bg text-info-fg ring-1 ring-info-line"
                              : "bg-card ring-1 ring-line",
                    )}
                  >
                    {e.draft === "add" ? (
                      <Plus size={10} className="shrink-0" />
                    ) : e.draft === "approve" ? (
                      <Check size={10} className="shrink-0" />
                    ) : gone ? null : e.status === "PENDING" ? (
                      <Clock size={10} className="shrink-0" />
                    ) : sup ? (
                      <ArrowLeftRight size={10} className="shrink-0" />
                    ) : e.source === "AUTO" ? (
                      <Zap size={10} className="shrink-0 text-secondary" />
                    ) : (
                      <Check size={10} className="shrink-0 text-secondary" />
                    )}
                    <span className={cn("flex-1 truncate", gone && "line-through")}>{name}</span>
                    {e.draft ? (
                      <button
                        title="Hoàn tác"
                        aria-label={`Hoàn tác thay đổi của ${name}`}
                        onClick={() => (e.draft === "add" ? dropAdd(e) : setOp([e.id], null))}
                        className="shrink-0 rounded p-0.5 hover:bg-card"
                      >
                        <Undo2 size={12} />
                      </button>
                    ) : e.status === "PENDING" ? (
                      <>
                        <button title="Duyệt" aria-label={`Duyệt ${name}`} onClick={() => setOp([e.id], "approve")} className="rounded bg-secondary px-0.5 text-white"><Check size={12} /></button>
                        <button title="Từ chối" aria-label={`Từ chối ${name}`} onClick={() => setOp([e.id], "reject")} className="rounded bg-danger px-0.5 text-white"><X size={12} /></button>
                      </>
                    ) : (
                      <button
                        title="Bỏ khỏi ca"
                        aria-label={`Bỏ ${name} khỏi ca`}
                        onClick={() => setOp([e.id], "remove")}
                        className="shrink-0 rounded p-0.5 text-danger/60 hover:bg-danger hover:text-white"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
              {props.map((c) => (
                <div key={c.userId} className="rounded-md border border-dotted border-secondary px-1 py-0.5 text-xs text-good" title={c.reason}>
                  + {c.userName} <span className="text-[10px] opacity-70">(đề xuất)</span>
                </div>
              ))}
              {(() => {
                const lost = slotLost(hb, d, t.id);
                if (!lost.rej && !lost.gone) return null;
                return (
                  <button
                    onClick={() => setHistSlot({ date: d, tplId: t.id })}
                    className="inline-flex items-center gap-0.5 self-start rounded px-0.5 text-[11px] font-semibold text-danger hover:bg-bad-soft"
                    title="Ai từng đăng ký ca này"
                  >
                    <Clock size={11} /> {[lost.rej ? `${lost.rej} từ chối` : "", lost.gone ? `${lost.gone} bỏ` : ""].filter(Boolean).join(" · ")}
                  </button>
                );
              })()}
              <div className="mt-auto flex items-center gap-1 pt-0.5">
                <select
                  className="w-full min-w-0 rounded border border-transparent bg-transparent text-[11px] text-ink/60 hover:border-grid-line hover:bg-card"
                  value=""
                  disabled={pending}
                  onChange={(ev) => ev.target.value && addSlot(t.id, d, ev.target.value)}
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
              </div>
            </div>
          );
        }}
      />
      )}

      {/* Duyệt theo người */}
      {pendingByUser.length > 0 && (
        <Card title={`Chờ duyệt theo nhân viên (${pendingByUser.length})`}>
          <div className="flex flex-wrap gap-2">
            {pendingByUser.map(([uid, ids]) => (
              <div key={uid} className="flex items-center gap-1 rounded-xl bg-late-bg px-2 py-1 text-sm">
                <b>{p.names[uid]}</b> <span className="text-xs">({ids.length} ca)</span>
                <button onClick={() => setHistUser(uid)} aria-label={`Lịch sử đăng ký của ${p.names[uid] ?? ""}`} title="Lịch sử đăng ký" className="rounded-lg bg-card p-1 text-accent ring-1 ring-line-strong"><Clock size={14} /></button>
                <button disabled={pending} onClick={() => decide(ids, "APPROVED")} className="rounded-lg bg-secondary px-2 py-0.5 text-xs font-bold text-white">Duyệt</button>
                <button disabled={pending} onClick={() => decide(ids, "REJECTED")} className="rounded-lg bg-card px-2 py-0.5 text-xs text-danger ring-1 ring-danger/40">Từ chối</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Lịch sử đăng ký tuần này (giữ 14 ngày) */}
      <RegHistoryCard b={hb} onOpenUser={setHistUser} />

      {/* Cảnh báo */}
      {warnings.length > 0 && (
        <div className="rounded-2xl bg-card p-4 ring-1 ring-line">
          <button
            type="button"
            onClick={() => setShowWarn((v) => !v)}
            aria-expanded={showWarn}
            className="flex w-full items-center gap-2 text-left font-bold lg:pointer-events-none"
          >
            <TriangleAlert size={18} className="text-danger" />
            <span className="flex-1">
              Cảnh báo ca thiếu / ít người ({warnings.length})
            </span>
            <ChevronDown size={18} className={cn("transition-transform lg:hidden", showWarn && "rotate-180")} />
          </button>
          <ul className={cn("mt-3 grid gap-1 text-sm sm:grid-cols-2 lg:grid lg:grid-cols-3", !showWarn && "hidden")}>
            {warnings.map((w) => (
              <li key={`${w.d}${w.t.id}`}>
                <Badge tone={w.level === "short" ? "red" : "yellow"}>{w.level === "short" ? "Thiếu người" : "Ít người"}</Badge> {w.t.name} · {weekdayVi(w.d)} {viDate(w.d).slice(0, 5)}: {w.c}/{w.level === "short" ? w.t.minStaff : w.tg}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tổng hợp số ca */}
      <Card
        title="Tổng hợp số ca của nhân viên trong tuần"
        actions={
          p.canRequest ? (
            <Button
              variant="outline"
              disabled={pending || !unregistered.length}
              onClick={() => run(() => requestRegistration(p.storeId, p.weekStart, unregistered.map((x) => x.id)))}
              title="Gửi yêu cầu đăng ký ca cho tất cả nhân viên chưa có ca tuần này"
            >
              <BellRing size={16} /> Yêu cầu NV chưa có ca đăng ký ({unregistered.length})
            </Button>
          ) : (
            <span className="text-xs text-ink/60">Yêu cầu đăng ký ca chỉ gửi được cho tuần sau trở đi</span>
          )
        }
      >
        <div className="overflow-x-auto">
          <table className="tbs">
            <thead>
              <tr>
                <th>Nhân viên</th>
                {p.templates.map((t) => <th key={t.id} className="hidden sm:table-cell text-center">{t.name}</th>)}
                <th className="hidden sm:table-cell text-right">Tổng ca đã duyệt</th>
                <th className="hidden sm:table-cell text-right">Giờ dự kiến</th>
                <th className="hidden sm:table-cell text-right">Chờ duyệt</th>
                <th>Ghi chú</th>
                <th className="text-center">Đăng ký ca</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.id} className={s.ok === 0 && !s.wait && !s.away.length && p.regRequests[s.id]?.status !== "OFF" ? "row-missing" : ""}>
                  <td className="font-semibold">
                    <button type="button" onClick={() => setHistUser(s.id)} className="text-left font-semibold underline decoration-dotted underline-offset-2 hover:text-accent" title="Xem lịch sử đăng ký ca">{s.name}</button>
                    {s.from && <span className="ml-1 rounded bg-info-bg px-1 text-[10px] font-normal text-info-fg">hỗ trợ từ {s.from}</span>}
                  </td>
                  {p.templates.map((t) => <td key={t.id} className="hidden sm:table-cell text-center">{s.byTpl[t.id] || ""}</td>)}
                  <td className="hidden sm:table-cell text-right font-bold">{s.ok}</td>
                  <td className="hidden sm:table-cell text-right">{s.h ? s.h.toFixed(1) : ""}</td>
                  <td className="hidden sm:table-cell text-right text-warn">{s.wait || ""}</td>
                  <td className="text-xs">
                    {s.ok === 0 && !s.wait && !s.away.length && p.regRequests[s.id]?.status !== "OFF" && <Badge tone="red">Chưa có ca</Badge>}{" "}
                    {s.ok > 0 && avg > 0 && s.ok >= avg * 1.5 && <Badge tone="orange">Nhiều ca</Badge>}{" "}
                    {s.ok > 0 && avg > 0 && s.ok <= avg * 0.5 && <Badge tone="yellow">Ít ca</Badge>}{" "}
                    {s.rej > 0 && <span className="text-ink/60">{s.rej} ca bị từ chối</span>}{" "}
                    {s.away.map(([st, n]) => (
                      <span key={st} className="mr-1 rounded bg-info-bg px-1 text-info-fg">⇄ {n} ca ở {st}</span>
                    ))}
                  </td>
                  <td className="whitespace-nowrap text-center text-xs">
                    {homeIds.has(s.id) && (() => {
                      const rq = p.regRequests[s.id];
                      if (rq?.status === "DONE") return <Badge tone="green">Đã đăng ký</Badge>;
                      if (rq?.status === "OFF") return <Badge tone="gray">Báo nghỉ tuần này</Badge>;
                      return (
                        <span className="inline-flex items-center gap-1">
                          {rq?.status === "OPEN" && <Badge tone="orange">Đã yêu cầu {fmtTime(rq.requestedAt)}</Badge>}
                          {p.canRequest && (
                            <button
                              disabled={pending}
                              onClick={() => run(() => requestRegistration(p.storeId, p.weekStart, [s.id]))}
                              className="inline-flex items-center gap-1 rounded-lg bg-primary text-on-primary px-2 py-0.5 font-bold hover:bg-primary-dark disabled:opacity-50"
                              title="Nhân viên sẽ thấy cảnh báo và nút Đăng ký ca"
                            >
                              <BellRing size={12} /> {rq?.status === "OPEN" ? "Nhắc lại" : "Yêu cầu đăng ký"}
                            </button>
                          )}
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="font-bold">TỔNG</td>
                {p.templates.map((t) => <td key={t.id} className="hidden sm:table-cell text-center font-bold">{summary.reduce((a, s) => a + (s.byTpl[t.id] || 0), 0)}</td>)}
                <td className="hidden sm:table-cell text-right font-bold">{summary.reduce((a, s) => a + s.ok, 0)}</td>
                <td className="hidden sm:table-cell text-right font-bold">{summary.reduce((a, s) => a + s.h, 0).toFixed(1)}</td>
                <td className="hidden sm:table-cell text-right font-bold text-warn">{pendingAll.length || ""}</td>
                <td className="text-xs">TB {avg.toFixed(1)} ca/người</td>
                <td />
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
      <label className="text-xs">Tối thiểu <input type="number" min={0} value={min} onChange={(e) => setMin(Number(e.target.value))} className="w-14 rounded border border-line-strong px-1" /></label>
      <label className="text-xs">Định mức <input type="number" min={0} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="w-14 rounded border border-line-strong px-1" /></label>
      <button disabled={disabled} onClick={() => onSave(min, target)} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-primary text-on-primary px-2 py-1 text-xs font-bold">Lưu</button>
    </div>
  );
}
