import { Types } from "mongoose";
import { connectDB } from "./db";
import { APPROVED_SHIFT, Attendance, Payroll, ShiftAssignment, Store, type AttendanceDoc } from "./models";
import { getSettings } from "./settings";
import { addDays, DEFAULT_TZ, localDate, localMonth, zonedToDate } from "./time";
import { earlyMinutes, lateMinutes, roundedHours, totalHours } from "./calc";

type Id = string | Types.ObjectId;

export async function storeTz(storeId: Id) {
  const s = await Store.findById(storeId).select("timezone").lean();
  return s?.timezone || DEFAULT_TZ;
}

export function shiftWindow(date: string, startTime: string, endTime: string, tz: string) {
  const start = zonedToDate(date, startTime, tz);
  let end = zonedToDate(date, endTime, tz);
  if (end <= start) end = zonedToDate(addDays(date, 1), endTime, tz); // ca qua đêm
  return { start, end };
}

/** Tìm ca được xếp phù hợp nhất với thời điểm check-in (spec 4.4). */
export async function findShiftFor(userId: Id, at: Date, tz: string, storeId?: Id) {
  const today = localDate(at, tz);
  const list = await ShiftAssignment.find({
    userId,
    date: { $in: [today, addDays(today, -1)] },
    ...(storeId ? { storeId } : {}),
    ...APPROVED_SHIFT,
  }).lean();
  let best: { a: (typeof list)[number]; start: Date; end: Date; score: number } | null = null;
  for (const a of list) {
    if (!a.startTime || !a.endTime) continue;
    const { start, end } = shiftWindow(a.date, a.startTime, a.endTime, tz);
    // chỉ xét ca mà thời điểm nằm trong [start - 3h, end]
    if (at.getTime() < start.getTime() - 3 * 3600_000 || at.getTime() > end.getTime()) continue;
    const score = Math.abs(at.getTime() - start.getTime());
    if (!best || score < best.score) best = { a, start, end, score };
  }
  return best;
}

/**
 * Ca dùng cho CHỐT CA: ưu tiên ca gắn với lượt chấm công; nếu không có thì ca đã duyệt
 * mà thời điểm chốt nằm trong [giờ bắt đầu − 1h, giờ kết thúc + 4h] (chốt ca thường sau giờ kết thúc).
 */
export async function findShiftForClosing(userId: Id, at: Date, tz: string, attendanceShiftId?: Id | null, storeId?: Id) {
  if (attendanceShiftId) {
    const a = await ShiftAssignment.findById(attendanceShiftId).lean();
    if (a) return a;
  }
  const today = localDate(at, tz);
  const list = await ShiftAssignment.find({
    userId,
    date: { $in: [today, addDays(today, -1)] },
    ...(storeId ? { storeId } : {}),
    ...APPROVED_SHIFT,
  }).lean();
  let best: (typeof list)[number] | null = null;
  let bestScore = Infinity;
  for (const a of list) {
    if (!a.startTime || !a.endTime) continue;
    const { start, end } = shiftWindow(a.date, a.startTime, a.endTime, tz);
    if (at.getTime() < start.getTime() - 3600_000 || at.getTime() > end.getTime() + 4 * 3600_000) continue;
    const score = Math.abs(at.getTime() - end.getTime());
    if (score < bestScore) {
      best = a;
      bestScore = score;
    }
  }
  return best;
}

/** Tính lại các trường tổng giờ / làm tròn / muộn / sớm của 1 bản ghi. */
export async function computeFields(att: {
  storeId: Id;
  shiftAssignmentId?: Id | null;
  checkInAt: Date;
  checkOutAt?: Date | null;
}) {
  const settings = await getSettings();
  const tz = await storeTz(att.storeId);
  const out: Partial<AttendanceDoc> = {
    workDate: localDate(att.checkInAt, tz),
    month: localMonth(att.checkInAt, tz),
    lateMinutes: 0,
    earlyMinutes: 0,
  };
  let shift: { start: Date; end: Date } | null = null;
  if (att.shiftAssignmentId) {
    const a = await ShiftAssignment.findById(att.shiftAssignmentId).lean();
    if (a?.startTime && a.endTime) shift = shiftWindow(a.date, a.startTime, a.endTime, tz);
  }
  if (shift) out.lateMinutes = lateMinutes(att.checkInAt, shift.start, settings.lateThresholdMinutes);
  if (att.checkOutAt) {
    out.totalHours = totalHours(att.checkInAt, att.checkOutAt);
    out.roundedHours = roundedHours(att.checkInAt, att.checkOutAt, {
      stepHours: settings.roundStepHours,
      graceMinutes: settings.roundGraceMinutes,
    });
    if (shift) out.earlyMinutes = earlyMinutes(att.checkOutAt, shift.end, settings.earlyThresholdMinutes);
  }
  return out;
}

/** Cơ sở trả lương cho 1 lượt chấm công (= cơ sở gốc; bản ghi cũ chưa có homeStoreId → cơ sở làm việc). */
export function payStoreOf(a: { storeId: Id; homeStoreId?: Id | null }) {
  return a.homeStoreId ?? a.storeId;
}

/** Điều kiện lọc chấm công thuộc bảng lương của 1 cơ sở (gồm giờ đi hỗ trợ nơi khác). */
export function payStoreFilter(storeId: Id) {
  const id = typeof storeId === "string" ? new Types.ObjectId(storeId) : storeId;
  return { $or: [{ homeStoreId: id }, { homeStoreId: { $exists: false }, storeId: id }, { homeStoreId: null, storeId: id }] };
}

/** Tháng đã khoá (bảng lương đã công bố / đã trả) → không cho sửa. */
export async function isMonthLocked(storeId: Id, month: string) {
  await connectDB();
  const p = await Payroll.findOne({ storeId, month }).select("status").lean();
  return !!p && p.status !== "DRAFT";
}

export async function assertNotLocked(storeId: Id, month: string) {
  if (await isMonthLocked(storeId, month))
    throw new Error(`Tháng ${month} đã chốt bảng lương – cần mở khoá bảng lương trước khi sửa`);
}

export async function openAttendance(userId: Id) {
  return Attendance.findOne({ userId, status: "OPEN" });
}

/** Lượt đang mở đã "quá hạn" (quá N giờ, hoặc đã quá giờ kết thúc ca + 4h) → coi là quên check-out. */
export async function isStaleOpen(
  a: { checkInAt: Date; shiftAssignmentId?: unknown; storeId: Id },
  missingCheckoutHours: number,
  now = Date.now(),
) {
  if (now - a.checkInAt.getTime() > missingCheckoutHours * 3600_000) return true;
  if (a.shiftAssignmentId) {
    const s = await ShiftAssignment.findById(a.shiftAssignmentId).lean();
    if (s?.startTime && s.endTime) {
      const { end } = shiftWindow(s.date, s.startTime, s.endTime, await storeTz(a.storeId));
      return now > end.getTime() + 4 * 3600_000;
    }
  }
  return false;
}

/** Đánh dấu lượt quên check-out (cron hằng giờ). */
export async function markMissingCheckouts() {
  await connectDB();
  const settings = await getSettings();
  const opens = await Attendance.find({ status: "OPEN" });
  let n = 0;
  for (const a of opens) {
    if (await isStaleOpen(a, settings.missingCheckoutHours)) {
      await Attendance.updateOne({ _id: a._id, status: "OPEN" }, { $set: { status: "MISSING_CHECKOUT" } });
      n++;
    }
  }
  return n;
}
