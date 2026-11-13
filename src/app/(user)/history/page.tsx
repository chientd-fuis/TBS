import { requireActiveUser } from "@/lib/guards";
import { AdjustmentRequest, APPROVED_SHIFT, Attendance, ShiftAssignment, Store } from "@/lib/models";
import { localDate, localMonth, localTime, prevMonth, viDate, weekdayVi } from "@/lib/time";
import { hoursVi } from "@/lib/format";
import { AttendanceTable, summarize } from "@/components/AttendanceTable";
import { MonthPicker } from "@/components/MonthPicker";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card } from "@/components/ui";
import { cancelAdjustment } from "../actions";
import { labelSupport } from "@/lib/support";
import { isMonthLocked, payStoreOf } from "@/lib/attendance";
import { getSettings } from "@/lib/settings";
import RequestSheet, { type DayShift, type PickAtt } from "./RequestSheet";

export const dynamic = "force-dynamic";

const KIND = {
  EDIT: { label: "Sửa giờ", cls: "bg-info-bg text-info-fg" },
  MISSING: { label: "Chấm bù ca", cls: "bg-violet-bg text-violet-fg" },
  OLD: { label: "Điều chỉnh", cls: "bg-mute-bg text-ink" },
} as const;
const STATUS = {
  PENDING: ["Chờ duyệt", "yellow"],
  APPROVED: ["Đã duyệt", "green"],
  REJECTED: ["Từ chối", "red"],
  CANCELLED: ["Đã huỷ", "gray"],
} as const;

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireActiveUser();
  const store = await Store.findById(user.storeId).lean();
  const tz = store?.timezone || "Asia/Ho_Chi_Minh";
  const { month: m } = await searchParams;
  const now = new Date();
  const curMonth = localMonth(now, tz);
  const month = /^\d{4}-\d{2}$/.test(m || "") ? m! : curMonth;
  const today = localDate(now, tz);
  const rows = await labelSupport(await Attendance.find({ userId: user._id, month }).sort({ checkInAt: -1 }).lean());
  const sum = summarize(rows);
  const requests = await AdjustmentRequest.find({ userId: user._id }).sort({ createdAt: -1 }).limit(10).lean();

  // ---- dữ liệu popup "Gửi yêu cầu chấm công": lượt tháng này + tháng trước, ca được xếp, cách làm tròn ----
  const prevM = prevMonth(curMonth);
  const lockCache = new Map<string, boolean>();
  const locked = async (storeId: unknown, mo: string) => {
    const k = `${storeId}|${mo}`;
    if (!lockCache.has(k)) lockCache.set(k, await isMonthLocked(String(storeId), mo, user._id));
    return lockCache.get(k)!;
  };
  const recent = await Attendance.find({ userId: user._id, month: { $in: [prevM, curMonth] } })
    .select("workDate month storeId homeStoreId shiftLabel checkInAt checkOutAt roundedHours status lateMinutes earlyMinutes")
    .sort({ checkInAt: -1 })
    .lean();
  const pendingIds = new Set(
    (await AdjustmentRequest.find({ userId: user._id, status: "PENDING", attendanceId: { $ne: null } }).select("attendanceId").lean()).map((r) => String(r.attendanceId)),
  );
  const hm = (d: Date) => localTime(d, tz).slice(0, 5);
  const picks: PickAtt[] = [];
  for (const a of recent) {
    // nhãn khối ca "Chiều+Tối 13:00–23:00" → giờ bắt đầu / hết ca (điền nhanh)
    const sm = a.shiftLabel?.match(/(\d{2}:\d{2})–(\d{2}:\d{2})\s*$/);
    picks.push({
      id: String(a._id),
      workDate: a.workDate,
      day: `${weekdayVi(a.workDate)} · ${viDate(a.workDate).slice(0, 5)}`,
      shiftLabel: a.shiftLabel ?? null,
      shiftStart: sm?.[1] ?? null,
      shiftEnd: sm?.[2] ?? null,
      inTime: hm(a.checkInAt),
      outTime: a.checkOutAt ? hm(a.checkOutAt) : null,
      hours: a.roundedHours ?? null,
      status: a.status,
      late: a.lateMinutes ?? 0,
      early: a.earlyMinutes ?? 0,
      pending: pendingIds.has(String(a._id)),
      locked: await locked(payStoreOf(a), a.month),
    });
  }
  // chấm bù: từ đầu tháng trước (tháng trước đã trả lương → từ đầu tháng này)
  const minDate = (await locked(user.storeId, prevM)) ? `${curMonth}-01` : `${prevM}-01`;
  const shiftList = await ShiftAssignment.find({ userId: user._id, date: { $gte: minDate, $lte: today }, ...APPROVED_SHIFT })
    .select("date shiftName startTime endTime")
    .sort({ startTime: 1 })
    .lean();
  const shifts: Record<string, DayShift[]> = {};
  for (const s of shiftList) if (s.startTime && s.endTime) (shifts[s.date] ??= []).push({ name: s.shiftName || "Ca", start: s.startTime, end: s.endTime });
  const settings = await getSettings();
  const round = { stepHours: settings.roundStepHours, graceMinutes: settings.roundGraceMinutes, graceHourMinutes: settings.roundGraceHourMinutes ?? settings.roundGraceMinutes };
  const editable = new Set(picks.filter((p) => !p.pending && !p.locked && p.status !== "OPEN").map((p) => p.id));

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-accent">Chấm công</h1>
        <MonthPicker month={month} base="/history" />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Card className="!p-3"><p className="text-xs">Giờ công</p><p className="text-xl font-bold">{hoursVi(sum.totalRounded)}</p></Card>
        <Card className="!p-3"><p className="text-xs">Ngày công</p><p className="text-xl font-bold">{sum.workDays}</p></Card>
        <Card className="!p-3"><p className="text-xs">Đi muộn / Về sớm</p><p className="text-xl font-bold text-warn">{sum.late} / {sum.early}</p></Card>
      </div>
      {sum.missing > 0 && (
        <p className="rounded-xl bg-bad-soft px-3 py-2.5 text-sm text-bad-fg ring-1 ring-bad-line">
          Có <b>{sum.missing} lượt quên check-out</b>. Bấm vào chữ <b>Quên check-out</b> trong bảng để gửi yêu cầu sửa giờ.
        </p>
      )}
      <RequestSheet atts={picks} shifts={shifts} today={today} minDate={minDate} round={round} />
      <AttendanceTable rows={rows} tz={tz} staffView staffEdit={{ editable, pending: pendingIds }} />

      {requests.length > 0 && (
        <Card title="Yêu cầu của tôi">
          <ul className="space-y-2.5 text-sm">
            {requests.map((r) => {
              const k = KIND[(r.kind as "EDIT" | "MISSING" | undefined) ?? "OLD"] ?? KIND.OLD;
              const st = STATUS[r.status as keyof typeof STATUS] ?? STATUS.PENDING;
              const bIn = r.before?.checkInAt ? hm(r.before.checkInAt) : null;
              const bOut = r.before?.checkOutAt ? hm(r.before.checkOutAt) : null;
              return (
                <li key={String(r._id)} className="space-y-1 rounded-xl bg-cream p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${k.cls}`}>{k.label}</span>
                    <Badge tone={st[1]}>{st[0]}</Badge>
                  </div>
                  <p className="font-semibold">
                    {r.workDate && `${weekdayVi(r.workDate)} · ${viDate(r.workDate).slice(0, 5)}`}
                    {r.before?.shiftLabel ? ` · ${r.before.shiftLabel}` : ""}
                  </p>
                  {r.kind === "EDIT" ? (
                    <div className="grid grid-cols-[64px_1fr] gap-x-2 text-[13px]">
                      {bIn !== r.checkInTime && (
                        <>
                          <span className="text-ink/70">Giờ vào</span>
                          <span>
                            {bIn ?? "—"} → <b>{r.checkInTime}</b>
                          </span>
                        </>
                      )}
                      {bOut !== r.checkOutTime && (
                        <>
                          <span className="text-ink/70">Giờ ra</span>
                          <span>
                            {bOut ?? "quên"} → <b>{r.checkOutTime}</b>
                          </span>
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="text-[13px]">
                      {r.kind === "MISSING" ? "Thêm lượt: " : ""}
                      <b>
                        {r.checkInTime || "--"} → {r.checkOutTime || "--"}
                      </b>
                    </p>
                  )}
                  <p className="text-xs text-ink/70">{r.reason}</p>
                  {r.adminReply && (
                    <p className="text-xs">
                      Admin{r.adminName ? ` ${r.adminName}` : ""}: {r.adminReply}
                    </p>
                  )}
                  {r.status === "PENDING" && (
                    <ActionForm action={cancelAdjustment} submitLabel="Huỷ yêu cầu" variant="ghost" successText="" className="pt-1" confirm="Huỷ yêu cầu này?" buttonClassName="!px-0 !py-1 text-sm text-danger">
                      <input type="hidden" name="id" value={String(r._id)} />
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
