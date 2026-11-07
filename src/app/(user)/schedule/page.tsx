import Link from "next/link";
import { requireActiveUser } from "@/lib/guards";
import { ShiftAssignment, Store } from "@/lib/models";
import { addDays, daysOfMonth, isYmd, localDate, localMonth, monthRange, nextMonth, prevMonth, viMonth, weekDays, weekdayVi, weekStartOf } from "@/lib/time";
import { Alert, Card, LinkButton } from "@/components/ui";
import { cn } from "@/lib/format";
import { WeekNav } from "./WeekNav";
import MonthShiftBoard from "@/app/admin/(panel)/attendance/MonthShiftBoard";
import { loadMonthBoard } from "@/app/admin/(panel)/attendance/month-board-data";

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

  // chế độ tháng: 1 bảng ca × ngày cả tháng (chỉ của mình) – ngày đã qua hiện kết quả chấm công
  // bảng ca × ngày kèm cảnh báo chấm công (tuần: 7 ngày, tháng: cả tháng) – chỉ của mình
  const board = user.storeId
    ? await loadMonthBoard(
        String(user.storeId),
        view === "month" ? month : ws.slice(0, 7),
        tz,
        await Store.find().select("name createdAt").lean(),
        String(user._id),
        view === "week" ? weekDays(ws) : undefined,
      )
    : null;
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
  const approvedCount = (days: string[]) => mine.filter((m) => days.includes(m.date) && (m.status ?? "APPROVED") === "APPROVED").length;
  const pendingCount = mine.filter((m) => m.status === "PENDING").length;
  const nextWeek = addDays(weekStartOf(today), 7);

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
          {!board || board.templates.length === 0 ? (
            <Alert tone="yellow">Cơ sở chưa có ca làm việc.</Alert>
          ) : (
            <Card>
              <MonthShiftBoard month={ws.slice(0, 7)} today={today} {...board} compactLegend linkable={false} />
            </Card>
          )}
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
          {board && board.templates.length ? (
            <Card>
              <MonthShiftBoard month={month} today={today} {...board} compactLegend linkable={false} />
              <p className="mt-2 text-center text-sm">
                Tháng này bạn có <b>{approvedCount(daysOfMonth(month))}</b> ca đã duyệt.
              </p>
            </Card>
          ) : (
            <Alert tone="yellow">Cơ sở chưa có ca làm việc.</Alert>
          )}
          {supportList(daysOfMonth(month))}
        </>
      )}
    </>
  );
}
