"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Clock, X } from "lucide-react";
import { cn } from "@/lib/format";
import type { Entry, TplInfo } from "@/lib/schedule";
import type { RegLogView } from "@/lib/shift-reg-log";

/*
 * Xếp ca → LỊCH SỬ ĐĂNG KÝ tuần đang xem (giữ 14 ngày): theo nhân viên / theo thời gian / theo 1 ô ca.
 * Điện thoại: khung trượt từ dưới lên · máy tính: khung bên phải.
 */

type Status = "ok" | "wait" | "rej" | "removed" | "self";
const DOW = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const STATUS_TEXT: Record<Status, string> = { ok: "Đã xếp", wait: "Chờ duyệt", rej: "Từ chối", removed: "Admin bỏ", self: "NV tự bỏ" };

type Base = { logs: RegLogView[]; entries: Entry[]; templates: TplInfo[]; days: string[]; names: Record<string, string> };

const keyOf = (date: string, tplId: string) => `${date}|${tplId}`;

/** "Hôm nay 08:30" / "20/11 22:10" */
export function whenVi(t: number) {
  const d = new Date(t);
  const z = (n: number) => String(n).padStart(2, "0");
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  return `${same ? "Hôm nay" : `${z(d.getDate())}/${z(d.getMonth() + 1)}`} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

/** Trạng thái hiện tại của 1 nhân viên ở 1 ô ca (ô có trong lịch sử hoặc đang có ca). */
function statusOf(b: Base, userId: string, date: string, tplId: string): Status | null {
  const e = b.entries.find((x) => x.userId === userId && x.date === date && x.tplId === tplId);
  if (e) return e.status === "APPROVED" ? "ok" : e.status === "PENDING" ? "wait" : "rej";
  // không còn bản ghi → xem lần cuối ô này bị bỏ bởi ai (logs mới nhất trước)
  for (const l of b.logs) {
    if (l.userId !== userId) continue;
    if (l.remove.some((x) => x.date === date && x.tplId === tplId)) return l.kind === "REMOVE" ? "removed" : "self";
    if (l.add.some((x) => x.date === date && x.tplId === tplId)) return null;
  }
  return null;
}

function useLabels(b: Base) {
  return useMemo(() => {
    const tpl = new Map(b.templates.map((t) => [t.id, t]));
    const short = (date: string, tplId: string) => `${DOW[b.days.indexOf(date)] ?? date.slice(8)} ${tpl.get(tplId)?.name ?? "?"}`;
    const long = (date: string, tplId: string) => `${DOW[b.days.indexOf(date)] ?? ""} ${date.slice(8)}/${date.slice(5, 7)} · ${tpl.get(tplId)?.name ?? "?"}`;
    return { short, long };
  }, [b.templates, b.days]);
}

/** Tóm tắt 1 nhân viên trong tuần: số lần gửi, lần cuối, đếm theo trạng thái. */
function summarize(b: Base, userId: string) {
  const mine = b.logs.filter((l) => l.userId === userId);
  const keys = new Set<string>();
  for (const l of mine) for (const x of [...l.add, ...l.remove]) keys.add(keyOf(x.date, x.tplId));
  for (const e of b.entries) if (e.userId === userId) keys.add(keyOf(e.date, e.tplId));
  const count: Record<Status, number> = { ok: 0, wait: 0, rej: 0, removed: 0, self: 0 };
  for (const k of keys) {
    const [d, t] = k.split("|");
    const s = statusOf(b, userId, d, t);
    if (s) count[s]++;
  }
  return { submits: mine.filter((l) => l.kind === "SUBMIT").length, last: mine[0]?.at ?? 0, count, keys: [...keys] };
}

/* ---------------- Khung (điện thoại: từ dưới lên · máy tính: bên phải) ---------------- */
function Sheet({ title, sub, onClose, children }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end lg:items-stretch lg:justify-end" role="dialog" aria-modal="true">
      <button aria-label="Đóng" className="absolute inset-0 bg-shade/40 lg:bg-shade/15" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-card shadow-2xl lg:h-full lg:max-h-none lg:w-[420px] lg:rounded-none lg:rounded-l-2xl">
        <div className="flex justify-center pt-2 lg:hidden"><span className="h-1 w-10 rounded-full bg-line-strong" /></div>
        <div className="flex items-center gap-2 border-b border-line py-2 pr-2 pl-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-bold">{title}</div>
            {sub && <div className="text-xs text-ink/60">{sub}</div>}
          </div>
          <button aria-label="Đóng" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-primary-light"><X size={20} /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 pb-8">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

const statusCls: Record<Status, string> = {
  ok: "bg-secondary-dark text-white",
  wait: "bg-late-strong text-warn ring-1 ring-warn/40",
  rej: "bg-bad-bg text-danger ring-1 ring-bad-line",
  removed: "bg-bad-soft text-danger line-through",
  self: "bg-muted text-ink/60 line-through",
};
const statusMark: Record<Status, string> = { ok: "✓", wait: "?", rej: "✕", removed: "B", self: "H" };

function Timeline({ b, logs, showUser }: { b: Base; logs: RegLogView[]; showUser?: boolean }) {
  const { short } = useLabels(b);
  // "gửi" = lần SUBMIT đầu tiên của người đó trong tuần, các lần sau = "sửa"
  const firstSubmit = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of [...b.logs].reverse()) if (l.kind === "SUBMIT" && !m.has(l.userId)) m.set(l.userId, l.id);
    return m;
  }, [b.logs]);
  if (!logs.length) return <p className="text-sm text-ink/60">Chưa có thao tác nào.</p>;
  return (
    <ol className="space-y-0">
      {logs.map((l, i) => {
        const who = b.names[l.userId] ?? "?";
        const title =
          l.kind === "SUBMIT"
            ? `${who} ${firstSubmit.get(l.userId) === l.id ? `gửi đăng ký ${l.add.length} ca` : "sửa đăng ký"}`
            : l.kind === "APPROVE"
              ? `Duyệt ${l.add.length} ca${showUser ? ` của ${who}` : ""}`
              : l.kind === "REJECT"
                ? `Từ chối ${l.add.length} ca${showUser ? ` của ${who}` : ""}`
                : l.kind === "ASSIGN"
                  ? `Xếp ${who} vào ${l.add.length} ca`
                  : `Bỏ ${who} khỏi ${l.remove.length} ca`;
        const dot = l.kind === "APPROVE" || l.kind === "ASSIGN" ? "bg-secondary-dark" : l.kind === "REJECT" || l.kind === "REMOVE" ? "bg-danger" : "bg-warn";
        const addCls = l.kind === "REJECT" ? "bg-bad-bg text-danger" : l.kind === "SUBMIT" ? "bg-late-bg text-warn" : "bg-ok-bg text-good";
        return (
          <li key={l.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={cn("mt-1 h-3 w-3 rounded-full", dot)} />
              {i < logs.length - 1 && <span className="w-0.5 flex-1 bg-line" />}
            </div>
            <div className="flex-1 pb-3">
              <div className="text-xs text-ink/60">{whenVi(l.at)} · {l.byStaff ? "Nhân viên" : l.by}</div>
              <div className="text-sm font-semibold">{title}</div>
              <div className="mt-1 flex flex-wrap gap-1 text-xs">
                {l.add.map((x) => (
                  <span key={`a${x.date}${x.tplId}`} className={cn("rounded-md px-2 py-0.5 font-semibold", addCls)}>{l.kind === "SUBMIT" ? "+ " : ""}{short(x.date, x.tplId)}</span>
                ))}
                {l.remove.map((x) => (
                  <span key={`r${x.date}${x.tplId}`} className={cn("rounded-md px-2 py-0.5 line-through", l.kind === "REMOVE" ? "bg-bad-soft text-danger" : "bg-muted text-ink/60")}>− {short(x.date, x.tplId)}</span>
                ))}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------- Thẻ "Lịch sử đăng ký tuần này" ---------------- */
export function RegHistoryCard({ b, onOpenUser }: { b: Base; onOpenUser: (userId: string) => void }) {
  const [tab, setTab] = useState<"user" | "time">("user");
  const [showAll, setShowAll] = useState(false);
  const users = useMemo(() => {
    const ids = [...new Set(b.logs.map((l) => l.userId))];
    return ids.map((id) => ({ id, name: b.names[id] ?? "?", ...summarize(b, id) })).sort((a, c) => c.last - a.last);
  }, [b]);
  if (!b.logs.length) return null;
  return (
    <section className="rounded-2xl bg-card p-3 ring-1 ring-line sm:p-4">
      <div className="mb-2 flex items-center gap-2">
        <Clock size={18} className="text-accent" />
        <h3 className="flex-1 font-bold">Lịch sử đăng ký tuần này</h3>
        <span className="text-xs text-ink/60">giữ 14 ngày</span>
      </div>
      <div className="mb-2 inline-flex rounded-xl bg-muted p-1 text-sm" role="tablist">
        {(["user", "time"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("rounded-lg px-3 py-1.5", tab === t ? "bg-primary font-bold text-on-primary" : "")}>
            {t === "user" ? "Theo nhân viên" : "Theo thời gian"}
          </button>
        ))}
      </div>
      {tab === "user" ? (
        <ul className="divide-y divide-line">
          {users.map((u) => (
            <li key={u.id}>
              <button onClick={() => onOpenUser(u.id)} className="flex min-h-14 w-full items-center gap-3 py-1.5 text-left hover:bg-primary-light/40">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">{initials(u.name)}</span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate">{u.name}</b>
                  <span className="block text-xs text-ink/60">{u.submits ? `${u.submits} lần gửi · ` : ""}{u.last ? whenVi(u.last) : ""}</span>
                </span>
                <span className="flex flex-wrap justify-end gap-1">
                  {u.count.rej > 0 && <Pill cls="bg-bad-bg text-danger">{u.count.rej} từ chối</Pill>}
                  {u.count.removed > 0 && <Pill cls="bg-bad-soft text-danger">{u.count.removed} bị bỏ</Pill>}
                  {u.count.self > 0 && <Pill cls="bg-muted text-ink/70">{u.count.self} tự bỏ</Pill>}
                  {u.count.wait > 0 && <Pill cls="bg-late-bg text-warn">{u.count.wait} chờ</Pill>}
                  {u.count.ok > 0 && !u.count.rej && !u.count.wait && <Pill cls="bg-ok-bg text-good">{u.count.ok} đã xếp</Pill>}
                </span>
                <ChevronRight size={16} className="shrink-0 text-ink/50" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <Timeline b={b} logs={showAll ? b.logs : b.logs.slice(0, 15)} showUser />
          {b.logs.length > 15 && !showAll && (
            <button onClick={() => setShowAll(true)} className="min-h-11 w-full rounded-xl text-sm font-semibold ring-1 ring-line-strong">Xem thêm {b.logs.length - 15} thao tác</button>
          )}
        </>
      )}
    </section>
  );
}

const Pill = ({ cls, children }: { cls: string; children: ReactNode }) => <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap", cls)}>{children}</span>;
const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

/* ---------------- Lịch sử 1 nhân viên ---------------- */
export function UserHistorySheet({
  b,
  userId,
  busy,
  onClose,
  onRestore,
}: {
  b: Base;
  userId: string;
  busy: boolean;
  onClose: () => void;
  onRestore: (date: string, tplId: string) => void;
}) {
  const { long } = useLabels(b);
  const logs = b.logs.filter((l) => l.userId === userId);
  const s = summarize(b, userId);
  const back = s.keys
    .map((k) => {
      const [date, tplId] = k.split("|");
      const st = statusOf(b, userId, date, tplId);
      if (st !== "rej" && st !== "removed") return null;
      // lần quyết định gần nhất của ô này
      const dec = logs.find((l) => (l.kind === "REJECT" ? l.add : l.kind === "REMOVE" ? l.remove : []).some((x) => x.date === date && x.tplId === tplId));
      return { date, tplId, st, dec };
    })
    .filter(Boolean) as { date: string; tplId: string; st: Status; dec?: RegLogView }[];
  back.sort((a, c) => a.date.localeCompare(c.date));
  return (
    <Sheet title={b.names[userId] ?? "?"} sub={`Lịch sử đăng ký · tuần ${b.days[0].slice(8)}/${b.days[0].slice(5, 7)} – ${b.days[6].slice(8)}/${b.days[6].slice(5, 7)}`} onClose={onClose}>
      <section>
        <h4 className="mb-2 text-sm font-bold">Kết quả hiện tại</h4>
        <div className="grid gap-[3px] text-center text-[11px]" style={{ gridTemplateColumns: `48px repeat(7, minmax(0, 1fr))` }}>
          <span />
          {DOW.map((d) => <span key={d} className="text-ink/60">{d}</span>)}
          {b.templates.map((t) => (
            <Row key={t.id} name={t.name}>
              {b.days.map((d) => {
                const st = statusOf(b, userId, d, t.id);
                return (
                  <span key={d} title={st ? STATUS_TEXT[st] : ""} className={cn("flex h-8 items-center justify-center rounded-lg font-bold", st ? statusCls[st] : "bg-cream")}>
                    {st ? statusMark[st] : ""}
                  </span>
                );
              })}
            </Row>
          ))}
        </div>
        <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-ink/60">
          <span>✓ Đã xếp</span><span>? Chờ duyệt</span><span>✕ Từ chối</span><span>B Admin bỏ</span><span>H NV tự bỏ</span>
        </p>
      </section>

      {back.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-sm font-bold">Ca bị từ chối / bị bỏ ({back.length})</h4>
          {back.map((x) => (
            <div key={`${x.date}${x.tplId}`} className="flex items-center gap-2 rounded-xl bg-bad-soft px-3 py-2">
              <span className="min-w-0 flex-1 text-sm">
                <b>{long(x.date, x.tplId)}</b>
                <span className="block text-xs text-ink/60">{x.dec ? `${x.dec.by} ${x.st === "rej" ? "từ chối" : "bỏ khỏi ca"} ${whenVi(x.dec.at)}` : STATUS_TEXT[x.st]}</span>
              </span>
              <button disabled={busy} onClick={() => onRestore(x.date, x.tplId)} className="min-h-10 rounded-lg bg-card px-3 text-sm font-semibold ring-1 ring-line-strong disabled:opacity-50">
                Xếp lại
              </button>
            </div>
          ))}
        </section>
      )}

      <section>
        <h4 className="mb-2 text-sm font-bold">Dòng thời gian</h4>
        <Timeline b={b} logs={logs} />
      </section>
      <p className="text-[11px] text-ink/60">Lịch sử tự xoá sau 14 ngày kể từ lúc thao tác.</p>
    </Sheet>
  );
}
const Row = ({ name, children }: { name: string; children: ReactNode }) => (
  <>
    <span className="truncate pt-2 text-left font-semibold">{name}</span>
    {children}
  </>
);

/* ---------------- Lịch sử 1 ô ca ---------------- */
/** Số người từng đăng ký ô này mà giờ bị từ chối / bị bỏ / tự bỏ (để hiện nút trên ô). */
export function slotLost(b: Base, date: string, tplId: string) {
  const users = new Set<string>();
  for (const l of b.logs) for (const x of [...l.add, ...l.remove]) if (x.date === date && x.tplId === tplId) users.add(l.userId);
  for (const e of b.entries) if (e.date === date && e.tplId === tplId && e.status === "REJECTED") users.add(e.userId);
  let rej = 0;
  let gone = 0;
  for (const u of users) {
    const s = statusOf(b, u, date, tplId);
    if (s === "rej") rej++;
    else if (s === "removed" || s === "self") gone++;
  }
  return { rej, gone };
}

export function SlotHistorySheet({
  b,
  date,
  tplId,
  busy,
  onClose,
  onDecide,
  onRestore,
  onOpenUser,
}: {
  b: Base;
  date: string;
  tplId: string;
  busy: boolean;
  onClose: () => void;
  onDecide: (entryId: string, decision: "APPROVED" | "REJECTED") => void;
  onRestore: (userId: string) => void;
  onOpenUser: (userId: string) => void;
}) {
  const { long } = useLabels(b);
  const t = b.templates.find((x) => x.id === tplId);
  const has = (l: RegLogView, k: "add" | "remove") => l[k].some((x) => x.date === date && x.tplId === tplId);
  const users = new Set<string>();
  for (const l of b.logs) if (has(l, "add") || has(l, "remove")) users.add(l.userId);
  for (const e of b.entries) if (e.date === date && e.tplId === tplId) users.add(e.userId);
  const order: Status[] = ["ok", "wait", "rej", "removed", "self"];
  const rows = [...users]
    .map((u) => {
      const st = statusOf(b, u, date, tplId);
      const mine = b.logs.filter((l) => l.userId === u);
      const reg = [...mine].reverse().find((l) => l.kind === "SUBMIT" && has(l, "add"));
      const last = mine.find((l) => has(l, "add") || has(l, "remove"));
      const entry = b.entries.find((e) => e.userId === u && e.date === date && e.tplId === tplId);
      return { u, st, reg, last, entry };
    })
    .filter((r) => r.st)
    .sort((a, c) => order.indexOf(a.st!) - order.indexOf(c.st!));
  const approvedN = b.entries.filter((e) => e.date === date && e.tplId === tplId && e.status === "APPROVED").length;
  return (
    <Sheet title={long(date, tplId)} sub={`${t?.startTime ?? ""}–${t?.endTime ?? ""} · đang có ${approvedN}${t?.targetStaff ? ` / cần ${t.targetStaff}` : ""} người`} onClose={onClose}>
      <h4 className="text-sm font-bold">Ai từng đăng ký ca này</h4>
      {!rows.length && <p className="text-sm text-ink/60">Chưa có ai đăng ký ca này trong 14 ngày qua.</p>}
      <div className="space-y-2">
        {rows.map(({ u, st, reg, last, entry }) => {
          const detail = [
            reg ? `Đăng ký ${whenVi(reg.at)}` : "",
            last && last !== reg
              ? `${last.byStaff ? "tự bỏ" : `${last.by} ${last.kind === "REJECT" ? "từ chối" : last.kind === "REMOVE" ? "bỏ" : last.kind === "APPROVE" ? "duyệt" : "xếp"}`} ${whenVi(last.at)}`
              : "",
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div key={u} className={cn("space-y-2 rounded-xl p-3", st === "wait" ? "bg-late-bg" : st === "ok" ? "ring-1 ring-line" : st === "self" ? "bg-cream" : "bg-bad-soft")}>
              <div className="flex items-center gap-2">
                <button onClick={() => onOpenUser(u)} className="min-w-0 flex-1 text-left">
                  <b className="underline decoration-dotted underline-offset-2">{b.names[u] ?? "?"}</b>
                  {detail && <span className="block text-xs text-ink/60">{detail}</span>}
                </button>
                {st === "ok" && <Pill cls="bg-ok-bg text-good">Đã xếp</Pill>}
                {st === "self" && <Pill cls="bg-muted text-ink/70">NV tự bỏ</Pill>}
                {(st === "rej" || st === "removed") && (
                  <button disabled={busy} onClick={() => onRestore(u)} className="min-h-10 rounded-lg bg-card px-3 text-sm font-semibold ring-1 ring-line-strong disabled:opacity-50">Xếp lại</button>
                )}
                {st === "wait" && <Pill cls="bg-late-strong text-warn">Chờ duyệt</Pill>}
              </div>
              {st === "wait" && entry && (
                <div className="flex gap-2">
                  <button disabled={busy} onClick={() => onDecide(entry.id, "APPROVED")} className="flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl bg-secondary-dark font-bold text-white disabled:opacity-50"><Check size={16} /> Duyệt</button>
                  <button disabled={busy} onClick={() => onDecide(entry.id, "REJECTED")} className="flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl bg-card text-danger ring-1 ring-bad-line disabled:opacity-50"><X size={16} /> Từ chối</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ink/60">Bấm tên → lịch sử cả tuần của người đó.</p>
    </Sheet>
  );
}
