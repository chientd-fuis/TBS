import { Types } from "mongoose";
import { APPROVED_SHIFT, Attendance, ShiftAssignment, ShiftTemplate, User } from "@/lib/models";
import { buildMonthBoard } from "@/lib/attendance-board";
import { daysOfMonth, monthRange } from "@/lib/time";
import { loadHolidays } from "@/lib/holiday";

/** Nạp dữ liệu + dựng bảng chấm công theo ca cả tháng của 1 cơ sở. */
export async function loadMonthBoard(
  storeId: string,
  month: string,
  tz: string,
  stores: { _id: unknown; name: string; createdAt?: Date | null }[],
  /** chỉ 1 nhân viên (trang Lịch làm việc của nhân viên) – kèm cả đăng ký chờ duyệt */
  onlyUserId?: string,
  /** hiển thị các ngày này thay vì cả tháng (VD 1 tuần) */
  onlyDays?: string[],
) {
  const sid = new Types.ObjectId(storeId);
  const days = onlyDays?.length ? onlyDays : daysOfMonth(month);
  const { first, last } = onlyDays?.length ? { first: onlyDays[0], last: onlyDays[onlyDays.length - 1] } : monthRange(month);
  const uid = onlyUserId ? new Types.ObjectId(onlyUserId) : null;
  const [assignments, attendances, pending] = await Promise.all([
    ShiftAssignment.find({ storeId: sid, date: { $gte: first, $lte: last }, ...(uid ? { userId: uid } : {}), ...APPROVED_SHIFT }).lean(),
    // chấm công tại cơ sở này + nhân viên cơ sở này đi hỗ trợ nơi khác (1 nhân viên: mọi lượt của người đó)
    Attendance.find(
      uid
        ? { workDate: { $gte: first, $lte: last }, userId: uid }
        : { workDate: { $gte: first, $lte: last }, $or: [{ storeId: sid }, { homeStoreId: sid }] },
    ).lean(),
    uid ? ShiftAssignment.find({ storeId: sid, userId: uid, date: { $gte: first, $lte: last }, status: "PENDING" }).lean() : Promise.resolve([]),
  ]);
  const tplDocs = await ShiftTemplate.find({ storeId: sid, $or: [{ active: true }, { _id: { $in: [...assignments, ...pending].map((a) => a.shiftTemplateId) } }] })
    .sort({ startTime: 1 })
    .lean();
  const userIds = [...new Set([...assignments.map((a) => String(a.userId)), ...attendances.map((a) => String(a.userId))])];
  const users = await User.find({ _id: { $in: userIds } }).select("name storeId").lean();
  // CS1, CS2… theo thứ tự cơ sở được tạo
  const ordered = [...stores].sort((a, b) => (a.createdAt?.getTime?.() ?? 0) - (b.createdAt?.getTime?.() ?? 0) || String(a._id).localeCompare(String(b._id)));
  const storeTag = Object.fromEntries(ordered.map((s, i) => [String(s._id), `CS${i + 1}`]));
  const storeNames = Object.fromEntries(stores.map((s) => [String(s._id), s.name]));
  const templates = tplDocs.map((t) => ({ id: String(t._id), name: t.name, startTime: t.startTime, endTime: t.endTime }));
  const { cells, rowsPerTpl } = buildMonthBoard({
    storeId,
    tz,
    days,
    templates,
    assignments: assignments
      .filter((a) => a.startTime && a.endTime)
      .map((a) => ({ id: String(a._id), userId: String(a.userId), tplId: String(a.shiftTemplateId), date: a.date, startTime: a.startTime!, endTime: a.endTime! })),
    attendances: attendances.map((a) => ({
      id: String(a._id),
      userId: String(a.userId),
      storeId: String(a.storeId),
      homeStoreId: String(a.homeStoreId ?? a.storeId),
      workDate: a.workDate,
      checkInAt: a.checkInAt,
      checkOutAt: a.checkOutAt,
      status: a.status,
      lateMinutes: a.lateMinutes,
      earlyMinutes: a.earlyMinutes,
      outOfShift: a.outOfShift,
    })),
    pending: pending
      .filter((a) => a.startTime && a.endTime)
      .map((a) => ({ id: String(a._id), userId: String(a.userId), tplId: String(a.shiftTemplateId), date: a.date, startTime: a.startTime!, endTime: a.endTime! })),
    names: Object.fromEntries(users.map((u) => [String(u._id), u.name || "?"])),
    homeOf: Object.fromEntries(users.map((u) => [String(u._id), String(u.storeId ?? "")])),
    storeTag,
    now: new Date(),
    minRows: onlyUserId ? 1 : 2,
  });
  const holidays = Object.fromEntries(await loadHolidays(first, last));
  return { days, templates, cells, rowsPerTpl, storeNames, holidays };
}
