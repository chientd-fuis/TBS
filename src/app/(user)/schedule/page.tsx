import Link from "next/link";
import { requireActiveUser } from "@/lib/guards";
import { APPROVED_SHIFT, CoverRequest, ShiftAssignment, Store, User } from "@/lib/models";
import CoverForm, { type CoverCandidate } from "@/components/user/CoverForm";
import CancelCoverButton from "@/components/user/CancelCoverButton";
import SwapForm, { type SwapPeer } from "@/components/user/SwapForm";
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

  // Nhờ làm hộ: ca đã duyệt của tôi trong 14 ngày tới + người có thể nhờ
  const upcoming = await ShiftAssignment.find({ userId: user._id, date: { $gte: today, $lte: addDays(today, 13) }, ...APPROVED_SHIFT })
    .sort({ date: 1, startTime: 1 })
    .lean();
  // yêu cầu tôi gửi + yêu cầu đổi ca người khác gửi tới tôi
  const covers = await CoverRequest.find({
    $and: [
      { $or: [{ fromUserId: user._id }, { toUserId: user._id, kind: "SWAP" }] },
      { $or: [{ status: "PENDING" }, { decidedAt: { $gte: new Date(Date.now() - 7 * 86400_000) } }] },
    ],
  })
    .sort({ createdAt: -1 })
    .lean();
  const allStores = new Map((await Store.find().select("name").lean()).map((x) => [String(x._id), x.name.replace(/^TBS\s*/i, "")]));
  const people = await User.find({ status: "ACTIVE", _id: { $ne: user._id } }).select("name storeId").sort({ name: 1 }).lean();
  const names = new Map(people.map((p) => [String(p._id), p.name]));
  const candidates: CoverCandidate[] = people.map((p) => ({
    id: String(p._id),
    name: p.name ?? "",
    store: allStores.get(String(p.storeId)) ?? "",
    same: String(p.storeId) === String(user.storeId),
  }));
  // Đổi ca: ca đã duyệt (14 ngày tới) của người khác – chỉ đổi được khi cả 2 đều có ca đã duyệt
  const peerShifts = await ShiftAssignment.find({ userId: { $in: people.map((p) => p._id) }, date: { $gte: today, $lte: addDays(today, 13) }, ...APPROVED_SHIFT })
    .select("userId storeId date shiftName startTime endTime")
    .sort({ date: 1, startTime: 1 })
    .lean();
  const peers: SwapPeer[] = candidates.map((c) => ({
    ...c,
    shifts: peerShifts
      .filter((s) => String(s.userId) === c.id)
      .map((s) => ({
        id: String(s._id),
        label: `${weekdayVi(s.date)} ${s.date.slice(8)}/${s.date.slice(5, 7)} · ${s.shiftName ?? ""} ${s.startTime}–${s.endTime}${String(s.storeId) !== String(user.storeId) ? ` · ${allStores.get(String(s.storeId)) ?? ""}` : ""}`,
      })),
  }));
  const pendingCover = new Map(
    covers
      .filter((c) => c.status === "PENDING")
      .flatMap((c) => [[String(c.shiftAssignmentId), c] as const, ...(c.toShiftAssignmentId ? [[String(c.toShiftAssignmentId), c] as const] : [])]),
  );
  const dmy = (d?: string | null) => (d ? `${d.slice(8)}/${d.slice(5, 7)}` : "");
  const COVER_ST = { PENDING: ["Chờ admin duyệt", "text-warn"], APPROVED: ["Đã duyệt", "text-secondary-dark"], REJECTED: ["Bị từ chối", "text-danger"], CANCELLED: ["Đã huỷ", "text-ink/50"] } as const;

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

      <Card title="Nhờ làm hộ / Đổi ca">
        {!upcoming.length ? (
          <p className="text-sm text-ink/60">Bạn chưa có ca đã duyệt trong 2 tuần tới.</p>
        ) : (
          <ul className="divide-y divide-[#f1e6c8]">
            {upcoming.map((m) => {
              const label = `${m.shiftName ?? ""} ${m.startTime}–${m.endTime} ${weekdayVi(m.date)} ${m.date.slice(8)}/${m.date.slice(5, 7)}`;
              const p = pendingCover.get(String(m._id));
              return (
                <li key={String(m._id)} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <b>{weekdayVi(m.date)} {m.date.slice(8)}/{m.date.slice(5, 7)}</b> · {m.shiftName} {m.startTime}–{m.endTime}
                    {String(m.storeId) !== String(user.storeId) && <span className="text-xs text-ink/60"> · {allStores.get(String(m.storeId))}</span>}
                  </span>
                  {p ? (
                    <span className="text-xs text-warn">
                      {p.kind === "SWAP"
                        ? String(p.fromUserId) === String(user._id)
                          ? `Đang xin đổi với ${names.get(String(p.toUserId)) ?? "?"} – chờ duyệt`
                          : `${names.get(String(p.fromUserId)) ?? "?"} xin đổi ca này – chờ duyệt`
                        : `Đang nhờ ${names.get(String(p.toUserId)) ?? "?"} – chờ duyệt`}
                    </span>
                  ) : (
                    <span className="flex flex-wrap gap-1.5">
                      <CoverForm shiftId={String(m._id)} label={label} candidates={candidates} />
                      <SwapForm shiftId={String(m._id)} label={label} peers={peers} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {covers.length > 0 && (
          <div className="mt-3 border-t border-[#f1e6c8] pt-2">
            <p className="mb-1 text-xs font-semibold text-accent">Yêu cầu nhờ làm hộ / đổi ca</p>
            <ul className="space-y-1 text-xs">
              {covers.map((c) => {
                const st = COVER_ST[c.status as keyof typeof COVER_ST];
                const mineReq = String(c.fromUserId) === String(user._id);
                const a = `${c.shiftName} ${c.startTime}–${c.endTime} ${dmy(c.date)}`;
                const b = `${c.toShiftName} ${c.toStartTime}–${c.toEndTime} ${dmy(c.toDate)}`;
                return (
                  <li key={String(c._id)} className="flex flex-wrap items-center gap-x-2">
                    <span className="flex-1">
                      {c.kind === "SWAP" ? (
                        mineReq ? (
                          <>⇄ Đổi ca <b>{a}</b> của bạn lấy <b>{b}</b> của <b>{names.get(String(c.toUserId)) ?? "?"}</b></>
                        ) : (
                          <><b>{names.get(String(c.fromUserId)) ?? "?"}</b> xin đổi ca <b>{a}</b> của họ lấy <b>{b}</b> của bạn</>
                        )
                      ) : (
                        <>Nhờ <b>{names.get(String(c.toUserId)) ?? "?"}</b> · {a}</>
                      )}
                      {c.reply && <span className="text-ink/60"> – {c.reply}</span>}
                    </span>
                    <span className={st[1]}>{st[0]}</span>
                    {c.status === "PENDING" && mineReq && <CancelCoverButton id={String(c._id)} />}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <p className="mt-2 text-[11px] text-ink/50">
          Admin duyệt xong lịch làm việc tự cập nhật và cả 2 người nhận được thông báo. Đổi ca: chỉ đổi được khi cả 2 người đều có ca đã được duyệt.
        </p>
      </Card>
    </>
  );
}
