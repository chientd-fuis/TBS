import Link from "next/link";
import { requireActiveUser } from "@/lib/guards";
import { ShiftAssignment, ShiftTemplate, Store } from "@/lib/models";
import { addDays, isYmd, localDate, localMonth, monthRange, nextMonth, prevMonth, viMonth, weekDays, weekdayVi, weekStartOf } from "@/lib/time";
import { WeekGrid, type GridTpl } from "@/components/WeekGrid";
import { Alert, Badge, Card, LinkButton } from "@/components/ui";
import { cn } from "@/lib/format";
import { WeekNav } from "./WeekNav";

export const dynamic = "force-dynamic";

/** Lịch làm việc của tôi – theo mẫu bảng ca × ngày, chỉ thấy lịch của mình (spec 4.7) */
export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ week?: string; view?: string; month?: string }> }) {
  const user = await requireActiveUser();
  const store = await Store.findById(user.storeId).lean();
  const tz = store?.timezone || "Asia/Ho_Chi_Minh";
  const today = localDate(new Date(), tz);
  const sp = await searchParams;
  const view = sp.view === "month" ? "month" : "week";
  const ws = weekStartOf(isYmd(sp.week) ? sp.week : today);
  const month = /^\d{4}-\d{2}$/.test(sp.month || "") ? sp.month! : localMonth(new Date(), tz);

  // các tuần cần hiển thị
  const weeks: string[] = [];
  if (view === "week") weeks.push(ws);
  else {
    const { first, last } = monthRange(month);
    for (let w = weekStartOf(first); w <= last; w = addDays(w, 7)) weeks.push(w);
  }
  const from = weeks[0];
  const to = addDays(weeks[weeks.length - 1], 6);
  const mine = await ShiftAssignment.find({ userId: user._id, date: { $gte: from, $lte: to } }).lean();
  const tplDocs = await ShiftTemplate.find({ storeId: user.storeId, $or: [{ active: true }, { _id: { $in: mine.map((m) => m.shiftTemplateId) } }] })
    .sort({ startTime: 1 })
    .lean();
  // ca được xếp đi hỗ trợ cơ sở khác (không nằm trong bảng ca của cơ sở gốc)
  const supportShifts = mine
    .filter((m) => String(m.storeId) !== String(user.storeId) && m.status !== "REJECTED")
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));
  const supportStore = new Map(
    (await Store.find({ _id: { $in: supportShifts.map((m) => m.storeId) } }).select("name").lean()).map((x) => [String(x._id), x.name]),
  );
  const supportList = (days: string[]) => {
    const list = supportShifts.filter((m) => days.includes(m.date));
    if (!list.length) return null;
    return (
      <div className="mt-2 rounded-xl bg-[#dbeafe] p-3 text-sm text-[#1e40af]">
        <p className="mb-1 font-bold">⇄ Ca hỗ trợ cơ sở khác</p>
        <ul className="space-y-0.5">
          {list.map((m) => (
            <li key={String(m._id)}>
              {weekdayVi(m.date)} {m.date.slice(8)}/{m.date.slice(5, 7)} · {m.shiftName} {m.startTime}–{m.endTime} tại <b>{supportStore.get(String(m.storeId))}</b>
              {m.status === "PENDING" && " (chờ duyệt)"}
            </li>
          ))}
        </ul>
      </div>
    );
  };
  const templates: GridTpl[] = tplDocs.map((t) => ({ id: String(t._id), name: t.name, startTime: t.startTime, endTime: t.endTime }));
  const at = (tplId: string, d: string) => mine.find((m) => String(m.shiftTemplateId) === tplId && m.date === d);
  const approvedCount = (days: string[]) => mine.filter((m) => days.includes(m.date) && (m.status ?? "APPROVED") === "APPROVED").length;
  const pendingCount = mine.filter((m) => m.status === "PENDING").length;
  const nextWeek = addDays(weekStartOf(today), 7);

  const grid = (w: string) => {
    const days = weekDays(w);
    return (
      <WeekGrid
        templates={templates}
        days={days}
        today={today}
        renderCell={(t, d) => {
          const m = at(t.id, d);
          if (!m) return null;
          const st = m.status ?? "APPROVED";
          return (
            <div
              className={cn(
                "rounded-md px-1.5 py-1 text-center text-xs font-bold",
                st === "APPROVED" && "bg-secondary text-white",
                st === "PENDING" && "bg-[#ffd8b8] text-warn ring-1 ring-warn/40",
                st === "REJECTED" && "bg-white/60 text-danger line-through",
              )}
            >
              {st === "APPROVED" ? `✓ ${user.name}` : st === "PENDING" ? "Chờ duyệt" : "Bị từ chối"}
            </div>
          );
        }}
      />
    );
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-accent">Lịch làm việc</h1>
        <div className="flex rounded-xl bg-white p-1 text-sm ring-1 ring-[#f1e6c8]">
          <Link href={`/schedule?week=${ws}`} className={cn("rounded-lg px-3 py-1", view === "week" && "bg-primary font-bold")}>Tuần</Link>
          <Link href={`/schedule?view=month&month=${month}`} className={cn("rounded-lg px-3 py-1", view === "month" && "bg-primary font-bold")}>Tháng</Link>
        </div>
      </div>

      <LinkButton href={`/schedule/register?week=${ws >= nextWeek ? ws : nextWeek}`} className="w-full">
        📝 Đăng ký ca {ws >= nextWeek ? "tuần này đang xem" : "tuần sau"}
      </LinkButton>
      {pendingCount > 0 && <Alert tone="orange">Bạn có {pendingCount} ca đăng ký đang chờ admin duyệt (ô màu cam).</Alert>}

      {view === "week" ? (
        <>
          <WeekNav ws={ws} href={(w) => `/schedule?week=${w}`} label={ws === weekStartOf(today) ? "Tuần này" : ws === nextWeek ? "Tuần sau" : undefined} />
          {templates.length === 0 ? <Alert tone="yellow">Cơ sở chưa có ca làm việc.</Alert> : grid(ws)}
          {supportList(weekDays(ws))}
          <p className="text-center text-sm">Tuần này bạn có <b>{approvedCount(weekDays(ws))}</b> ca đã duyệt.</p>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between rounded-xl bg-white p-1 ring-1 ring-[#f1e6c8]">
            <Link href={`/schedule?view=month&month=${prevMonth(month)}`} className="rounded-lg px-3 py-1.5 hover:bg-primary-light">‹</Link>
            <span className="text-sm font-bold">Tháng {viMonth(month)}</span>
            <Link href={`/schedule?view=month&month=${nextMonth(month)}`} className="rounded-lg px-3 py-1.5 hover:bg-primary-light">›</Link>
          </div>
          {weeks.map((w) => (
            <Card key={w} title={<span className="text-sm">Tuần {w.slice(8)}/{w.slice(5, 7)} – {addDays(w, 6).slice(8)}/{addDays(w, 6).slice(5, 7)}</span>} actions={<Badge tone="green">{approvedCount(weekDays(w))} ca</Badge>}>
              {grid(w)}
              {supportList(weekDays(w))}
            </Card>
          ))}
        </>
      )}
      <div className="flex flex-wrap justify-center gap-2 text-xs">
        <span className="rounded bg-secondary px-2 py-0.5 font-bold text-white">✓ Đã duyệt</span>
        <span className="rounded bg-[#ffd8b8] px-2 py-0.5 font-bold text-warn">Chờ duyệt</span>
        <span className="rounded bg-white px-2 py-0.5 text-danger line-through">Bị từ chối</span>
      </div>
    </>
  );
}
