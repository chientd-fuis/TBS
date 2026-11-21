"use client";
import { Clock } from "lucide-react";
import { cn } from "@/lib/format";
import type { Entry, TplInfo } from "@/lib/schedule";
import { Sheet } from "./RegHistory";

/*
 * Lịch cá nhân 1 nhân viên trong tuần (chế độ xem → bấm tên).
 * Cùng kiểu lưới với "Lịch sử đăng ký" (hàng = ca, cột = T2…CN) để admin quen mắt;
 * gồm cả ca chưa chốt (nét đứt) & ca đi hỗ trợ cơ sở khác (hàng riêng).
 */

const DOW = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
type St = "ok" | "wait" | "draft";
const CLS: Record<St, string> = {
  ok: "bg-secondary-dark text-white",
  wait: "bg-late-strong text-warn ring-1 ring-warn/40",
  draft: "border border-dashed border-secondary bg-ok-soft text-good",
};
const MARK: Record<St, string> = { ok: "✓", wait: "?", draft: "✓" };
const TEXT: Record<St, string> = { ok: "Đã xếp", wait: "Chờ duyệt", draft: "Chưa chốt lịch" };

export function PersonScheduleSheet({
  userId,
  name,
  supportFrom,
  days,
  today,
  templates,
  entries,
  external,
  onClose,
  onOpenHistory,
}: {
  userId: string;
  name: string;
  supportFrom?: string;
  days: string[];
  today: string;
  templates: TplInfo[];
  entries: (Entry & { draft?: string })[];
  external: { userId: string; date: string; startTime: string; endTime: string; shiftName: string; storeName: string }[];
  onClose: () => void;
  onOpenHistory: () => void;
}) {
  const mine = entries.filter((e) => e.userId === userId && e.status !== "REJECTED");
  const away = external.filter((x) => x.userId === userId && days.includes(x.date));
  const stOf = (date: string, tplId: string): St | null => {
    const e = mine.find((x) => x.date === date && x.tplId === tplId);
    if (!e) return null;
    return e.draft ? "draft" : e.status === "PENDING" ? "wait" : "ok";
  };
  const ok = mine.filter((e) => e.status === "APPROVED").length;
  const wait = mine.filter((e) => e.status === "PENDING").length;
  return (
    <Sheet
      title={name}
      sub={`Lịch cá nhân · tuần ${days[0].slice(8)}/${days[0].slice(5, 7)} – ${days[6].slice(8)}/${days[6].slice(5, 7)}${supportFrom ? ` · hỗ trợ từ ${supportFrom}` : ""}`}
      onClose={onClose}
    >
      <p className="text-sm">
        <b>{ok}</b> ca đã xếp{wait ? <> · <b className="text-warn">{wait}</b> chờ duyệt</> : null}
        {away.length ? <> · <b className="text-info-fg">{away.length}</b> ca ở cơ sở khác</> : null}
      </p>
      <section>
        <div className="grid gap-[3px] text-center text-[11px]" style={{ gridTemplateColumns: `48px repeat(7, minmax(0, 1fr))` }}>
          <span />
          {days.map((d, i) => (
            <span key={d} className={cn("rounded-md py-0.5 leading-tight", d === today ? "bg-primary font-bold text-on-primary" : "text-ink/60")}>
              {DOW[i]}
              <span className="block text-[10px]">{d.slice(8)}/{d.slice(5, 7)}</span>
            </span>
          ))}
          {templates.map((t) => (
            <Row key={t.id} name={t.name}>
              {days.map((d) => {
                const st = stOf(d, t.id);
                return (
                  <span key={d} title={st ? TEXT[st] : ""} className={cn("flex h-8 items-center justify-center rounded-lg font-bold", st ? CLS[st] : "bg-cream", d < today && "opacity-50")}>
                    {st ? MARK[st] : ""}
                  </span>
                );
              })}
            </Row>
          ))}
          {away.length > 0 && (
            <Row name="Nơi khác">
              {days.map((d) => {
                const xs = away.filter((x) => x.date === d);
                return (
                  <span
                    key={d}
                    title={xs.map((x) => `${x.shiftName} ${x.startTime}–${x.endTime} · ${x.storeName}`).join("\n")}
                    className={cn("flex h-8 items-center justify-center rounded-lg font-bold", xs.length ? "bg-info-bg text-info-fg ring-1 ring-info-line" : "bg-cream", d < today && "opacity-50")}
                  >
                    {xs.length ? "⇄" : ""}
                  </span>
                );
              })}
            </Row>
          )}
        </div>
        <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-ink/60">
          <span>✓ Đã xếp</span>
          <span>? Chờ duyệt</span>
          <span className="text-good">✓ nét đứt = chưa chốt</span>
          {away.length > 0 && <span className="text-info-fg">⇄ Ca ở cơ sở khác</span>}
        </p>
        {away.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-info-fg">
            {away.map((x, i) => (
              <li key={i}>
                ⇄ {DOW[days.indexOf(x.date)]} {x.date.slice(8)}/{x.date.slice(5, 7)} · {x.shiftName} {x.startTime}–{x.endTime} · {x.storeName}
              </li>
            ))}
          </ul>
        )}
      </section>
      <button onClick={onOpenHistory} className="inline-flex min-h-10 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-accent ring-1 ring-line-strong hover:bg-primary-light">
        <Clock size={14} /> Lịch sử đăng ký ca
      </button>
    </Sheet>
  );
}

const Row = ({ name, children }: { name: string; children: React.ReactNode }) => (
  <>
    <span className="truncate pt-2 text-left font-semibold">{name}</span>
    {children}
  </>
);
